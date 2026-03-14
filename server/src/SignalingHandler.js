const WebSocket = require('ws');

/**
 * Sanitize user input to prevent XSS
 * @param {string} input - Raw input string
 * @returns {string} - Sanitized string
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate room ID format (4 uppercase alphanumeric characters, excluding ambiguous chars)
 * Matches RoomManager.generateRoomId() format: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
 * @param {string} roomId - Room ID to validate
 * @returns {boolean}
 */
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[A-Z0-9]{4}$/.test(roomId);
}

/**
 * Validate message length and content
 * @param {string} message - Message to validate
 * @returns {boolean}
 */
function isValidMessage(message) {
  return typeof message === 'string' && message.length > 0 && message.length <= 1000;
}

/**
 * Get error message for token validation failure
 * @param {string} reason - Error reason
 * @returns {string} Error message
 */
function getTokenErrorMessage(reason) {
  const messages = {
    expired: 'This invite link has expired',
    max_uses_reached: 'This invite link has reached its usage limit',
    not_found: 'The room for this token no longer exists',
    invalid_format: 'Invalid token format',
    invalid_signature: 'Token signature verification failed',
    revoked: 'This token has been revoked',
    permission_denied: 'This token does not have permission for that action'
  };
  return messages[reason] || 'Invalid or expired token';
}

class SignalingHandler {
  constructor(roomManager, wss) {
    this.roomManager = roomManager;
    this.wss = wss;
    this.wsMap = new Map(); // WebSocket -> { participantId, roomId }
    this.heartbeats = new Map(); // WebSocket -> { misses: number, timer: NodeJS.Timeout }
    this.heartbeatInterval = 30000; // 30 seconds
    this.maxMisses = 3;

    // Start heartbeat check
    this.startHeartbeatCheck();
  }

  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws
   * @param {Object} session - Express session object
   */
  handleConnection(ws, session = null) {
    // Initialize heartbeat
    this.heartbeats.set(ws, { misses: 0, timer: null });

    // Store session reference if available
    if (session) {
      this.wsSessionMap = this.wsSessionMap || new Map();
      this.wsSessionMap.set(ws, session);
    }
  }

  /**
   * Handle incoming WebSocket message
   * @param {WebSocket} ws
   * @param {Object} data - Parsed message data
   */
  handleMessage(ws, data) {
    const { type, payload } = data;

    if (!type) {
      this.sendError(ws, 'Missing message type');
      return;
    }

    console.log(`[Signaling] Received: ${type}`, payload ? JSON.stringify(payload).substring(0, 100) : '');

    // Get session for this WebSocket
    const session = this.wsSessionMap?.get(ws) || null;

    switch (type) {
      case 'ping':
        this.handlePing(ws);
        break;

      case 'pong':
        // Client responding to server ping, handled in heartbeat
        break;

      case 'join-room':
        this.handleJoinRoom(ws, payload, session);
        break;

      case 'join-room-with-token':
        this.handleJoinRoomWithToken(ws, payload);
        break;

      case 'join-room-director':
        this.handleJoinRoomDirector(ws, payload);
        break;

      case 'leave-room':
        this.handleLeaveRoom(ws, payload);
        break;

      case 'offer':
        this.handleOffer(ws, payload);
        break;

      case 'answer':
        this.handleAnswer(ws, payload);
        break;

      case 'ice-candidate':
        this.handleIceCandidate(ws, payload);
        break;

      case 'chat-message':
        this.handleChatMessage(ws, payload);
        break;

      case 'mute-status':
        this.handleMuteStatus(ws, payload);
        break;

      case 'room-settings':
        this.handleRoomSettings(ws, payload);
        break;

      default:
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  /**
   * Handle WebSocket close
   * @param {WebSocket} ws
   */
  handleClose(ws) {
    const connection = this.wsMap.get(ws);

    if (connection) {
      console.log(`[Signaling] WebSocket disconnected: ${connection.participantId}`);

      if (connection.isDirector) {
        // Director leaving
        this.roomManager.leaveRoomAsDirector(connection.roomId, connection.participantId);
      } else {
        // Participant leaving
        this.roomManager.leaveRoom(connection.roomId, connection.participantId);

        // Notify room participants
        this.broadcastToRoom(connection.roomId, {
          type: 'participant-left',
          participantId: connection.participantId
        }, ws);

        // Notify directors about participant leaving
        this.roomManager.notifyDirectors(connection.roomId, {
          type: 'participant-left',
          participantId: connection.participantId
        });
      }
    }

    this.cleanupConnection(ws);
  }

  /**
   * Handle WebSocket error
   * @param {WebSocket} ws
   * @param {Error} error
   */
  handleError(ws, error) {
    console.error('[Signaling] WebSocket error:', error.message);
    this.sendError(ws, 'Connection error');
  }

  /**
   * Handle ping message
   * @param {WebSocket} ws
   */
  handlePing(ws) {
    const heartbeat = this.heartbeats.get(ws);
    if (heartbeat) {
      heartbeat.misses = 0;
    }

    this.send(ws, { type: 'pong' });
  }

  /**
   * Handle join-room-director message (director/observer mode)
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleJoinRoomDirector(ws, payload) {
    const { roomId, name } = payload || {};

    if (!roomId) {
      this.sendError(ws, 'Room ID is required');
      return;
    }

    // Validate room ID format
    if (!isValidRoomId(roomId)) {
      this.sendError(ws, 'Invalid room ID format');
      return;
    }

    try {
      const result = this.roomManager.joinRoomAsDirector(roomId, {
        name: name ? sanitizeInput(name.substring(0, 50)) : 'Director',
        ws
      });

      // Store connection mapping with director flag
      this.wsMap.set(ws, {
        participantId: result.directorId,
        roomId: result.roomId,
        isDirector: true
      });

      // Send success response
      this.send(ws, {
        type: 'joined-room',
        directorId: result.directorId,
        room: result.room,
        existingPeers: result.existingParticipants // Use same field name for consistency
      });

      console.log(`[Signaling] Director ${result.directorId} joined room ${roomId}`);
    } catch (error) {
      this.sendError(ws, error.message);
    }
  }

  /**
   * Handle join-room message
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleJoinRoom(ws, payload, session = null) {
    const { roomId, name, password, autoGenerateToken } = payload || {};

    if (!roomId) {
      this.sendError(ws, 'Room ID is required');
      return;
    }

    // Validate room ID format (4 alphanumeric characters)
    if (!isValidRoomId(roomId)) {
      this.sendError(ws, 'Invalid room ID format');
      return;
    }

    try {
      const result = this.roomManager.joinRoom(roomId, {
        name: name ? sanitizeInput(name.substring(0, 50)) : undefined,
        password,
        ws
      }, autoGenerateToken === true);

      // Store connection mapping with session reference
      this.wsMap.set(ws, {
        participantId: result.participantId,
        roomId: result.roomId,
        session
      });

      // Store token in session if generated (never send raw token to client)
      if (result.token && session) {
        if (!session.tokens) session.tokens = {};
        session.tokens[result.roomId] = result.token;
        session.roomId = result.roomId; // Track current room for auto-rejoin
      }

      // Send success response (without token - stored in session)
      this.send(ws, {
        type: 'joined-room',
        participantId: result.participantId,
        room: result.room,
        existingPeers: result.existingPeers
      });

      // Notify existing participants about new peer (excluding directors)
      this.broadcastToRoom(roomId, {
        type: 'participant-joined',
        participantId: result.participantId,
        streamName: result.participantId ? `${roomId}_${result.participantId}` : undefined,
        name: name ? sanitizeInput(name.substring(0, 50)) : 'Anonymous'
      }, ws);

      // Notify directors about new participant
      this.roomManager.notifyDirectors(roomId, {
        type: 'participant-joined',
        participantId: result.participantId,
        streamName: `${roomId}_${result.participantId}`,
        name: name ? sanitizeInput(name.substring(0, 50)) : 'Anonymous'
      });

      console.log(`[Signaling] Participant ${result.participantId} joined room ${roomId}`);
    } catch (error) {
      this.sendError(ws, error.message);
    }
  }

  /**
   * Handle join-room-with-token message
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  async handleJoinRoomWithToken(ws, payload) {
    const { roomId, token, name } = payload || {};

    if (!roomId || !token) {
      this.sendError(ws, 'Room ID and token are required');
      return;
    }

    // Validate token
    const validation = this.roomManager.validateToken(token, 'join');

    if (!validation.valid) {
      this.sendError(ws, getTokenErrorMessage(validation.reason));
      return;
    }

    // Extract info from token
    const { metadata } = validation.payload;

    try {
      // Join room with token-authenticated user
      const result = this.roomManager.joinRoom(roomId, {
        name: metadata?.name || name || 'Authenticated User',
        ws
      });

      // Store connection mapping with token info
      this.wsMap.set(ws, {
        participantId: result.participantId,
        roomId: result.roomId,
        token: token,
        authenticated: true
      });

      // Send success
      this.send(ws, {
        type: 'joined-room',
        participantId: result.participantId,
        room: result.room,
        existingPeers: result.existingPeers,
        authenticated: true
      });

      // Notify room
      this.broadcastToRoom(roomId, {
        type: 'participant-joined',
        participantId: result.participantId,
        streamName: `${roomId}_${result.participantId}`,
        name: metadata?.name || name || 'Authenticated User',
        authenticated: true
      });

      // Notify directors about new participant
      this.roomManager.notifyDirectors(roomId, {
        type: 'participant-joined',
        participantId: result.participantId,
        streamName: `${roomId}_${result.participantId}`,
        name: metadata?.name || name || 'Authenticated User',
        authenticated: true
      });

      console.log(`[Signaling] Token-authenticated participant ${result.participantId} joined room ${roomId}`);
    } catch (error) {
      this.sendError(ws, error.message);
    }
  }

  /**
   * Handle leave-room message
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleLeaveRoom(ws, payload) {
    const connection = this.wsMap.get(ws);

    if (!connection) {
      this.sendError(ws, 'Not in a room');
      return;
    }

    this.roomManager.leaveRoom(connection.roomId, connection.participantId);

    // Notify room
    this.broadcastToRoom(connection.roomId, {
      type: 'participant-left',
      participantId: connection.participantId
    }, ws);

    this.wsMap.delete(ws);

    this.send(ws, {
      type: 'left-room',
      participantId: connection.participantId
    });
  }

  /**
   * Handle WebRTC offer
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleOffer(ws, payload) {
    const { targetPeerId, sdp } = payload || {};

    if (!targetPeerId || !sdp) {
      this.sendError(ws, 'targetPeerId and sdp are required');
      return;
    }

    const connection = this.wsMap.get(ws);
    if (!connection) {
      this.sendError(ws, 'Not connected to a room');
      return;
    }

    // Find target WebSocket
    const targetWs = this.findPeerWebSocket(connection.roomId, targetPeerId);
    if (!targetWs) {
      this.sendError(ws, 'Peer not found');
      return;
    }

    // Forward offer to target
    this.send(targetWs, {
      type: 'offer',
      from: connection.participantId,
      sdp
    });
  }

  /**
   * Handle WebRTC answer
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleAnswer(ws, payload) {
    const { targetPeerId, sdp } = payload || {};

    if (!targetPeerId || !sdp) {
      this.sendError(ws, 'targetPeerId and sdp are required');
      return;
    }

    const connection = this.wsMap.get(ws);
    if (!connection) {
      this.sendError(ws, 'Not connected to a room');
      return;
    }

    // Find target WebSocket
    const targetWs = this.findPeerWebSocket(connection.roomId, targetPeerId);
    if (!targetWs) {
      this.sendError(ws, 'Peer not found');
      return;
    }

    // Forward answer to target
    this.send(targetWs, {
      type: 'answer',
      from: connection.participantId,
      sdp
    });
  }

  /**
   * Handle ICE candidate
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleIceCandidate(ws, payload) {
    const { targetPeerId, candidate } = payload || {};

    if (!targetPeerId || !candidate) {
      this.sendError(ws, 'targetPeerId and candidate are required');
      return;
    }

    const connection = this.wsMap.get(ws);
    if (!connection) {
      this.sendError(ws, 'Not connected to a room');
      return;
    }

    // Find target WebSocket
    const targetWs = this.findPeerWebSocket(connection.roomId, targetPeerId);
    if (!targetWs) {
      this.sendError(ws, 'Peer not found');
      return;
    }

    // Forward ICE candidate to target
    this.send(targetWs, {
      type: 'ice-candidate',
      from: connection.participantId,
      candidate
    });
  }

  /**
   * Handle chat message
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleChatMessage(ws, payload) {
    const { message } = payload || {};

    // Validate message presence and format
    if (!message) {
      this.sendError(ws, 'Message is required');
      return;
    }

    if (!isValidMessage(message)) {
      this.sendError(ws, 'Invalid message format or length exceeded');
      return;
    }

    const connection = this.wsMap.get(ws);
    if (!connection) {
      this.sendError(ws, 'Not connected to a room');
      return;
    }

    // Sanitize message to prevent XSS
    const sanitizedMessage = sanitizeInput(message.trim());

    // Broadcast chat message to room
    this.broadcastToRoom(connection.roomId, {
      type: 'chat-message',
      from: connection.participantId,
      message: sanitizedMessage,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle mute status change
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleMuteStatus(ws, payload) {
    const { isMuted, isVideoOff } = payload || {};

    const connection = this.wsMap.get(ws);
    if (!connection) {
      this.sendError(ws, 'Not connected to a room');
      return;
    }

    // Update participant status
    this.roomManager.updateParticipant(connection.roomId, connection.participantId, {
      isMuted: isMuted !== undefined ? isMuted : undefined,
      isVideoOff: isVideoOff !== undefined ? isVideoOff : undefined
    });

    // Broadcast to room
    this.broadcastToRoom(connection.roomId, {
      type: 'mute-status',
      participantId: connection.participantId,
      isMuted,
      isVideoOff
    });
  }

  /**
   * Handle room settings change (director only)
   * @param {WebSocket} ws
   * @param {Object} payload
   */
  handleRoomSettings(ws, payload) {
    const connection = this.wsMap.get(ws);
    if (!connection) {
      this.sendError(ws, 'Not connected to a room');
      return;
    }

    // TODO: Implement director permissions check

    // Broadcast settings to room
    this.broadcastToRoom(connection.roomId, {
      type: 'room-settings',
      settings: payload
    });
  }

  /**
   * Send message to a WebSocket
   * @param {WebSocket} ws
   * @param {Object} data
   */
  send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast message to all participants in a room
   * @param {string} roomId
   * @param {Object} data
   * @param {WebSocket} excludeWs - WebSocket to exclude
   */
  broadcastToRoom(roomId, data, excludeWs = null) {
    for (const [ws, connection] of this.wsMap.entries()) {
      if (connection.roomId === roomId && ws !== excludeWs) {
        this.send(ws, data);
      }
    }
  }

  /**
   * Broadcast room settings update to all participants in a room
   * @param {string} roomId
   * @param {Object} settings - Settings to broadcast
   */
  broadcastRoomSettings(roomId, settings) {
    this.broadcastToRoom(roomId, {
      type: 'room-settings',
      settings
    });
  }

  /**
   * Find WebSocket for a peer in a room
   * @param {string} roomId
   * @param {string} peerId
   * @returns {WebSocket|null}
   */
  findPeerWebSocket(roomId, peerId) {
    for (const [ws, connection] of this.wsMap.entries()) {
      if (connection.roomId === roomId && connection.participantId === peerId) {
        return ws;
      }
    }
    return null;
  }

  /**
   * Send error message
   * @param {WebSocket} ws
   * @param {string} message
   */
  sendError(ws, message) {
    console.error(`[Signaling] Error: ${message}`);
    this.send(ws, {
      type: 'error',
      message
    });
  }

  /**
   * Clean up connection data
   * @param {WebSocket} ws
   */
  cleanupConnection(ws) {
    this.heartbeats.delete(ws);
    this.wsMap.delete(ws);
  }

  /**
   * Start heartbeat check interval
   */
  startHeartbeatCheck() {
    setInterval(() => {
      for (const [ws, heartbeat] of this.heartbeats.entries()) {
        if (ws.readyState !== WebSocket.OPEN) {
          this.cleanupConnection(ws);
          continue;
        }

        heartbeat.misses++;

        if (heartbeat.misses >= this.maxMisses) {
          console.log('[Signaling] Heartbeat timeout, closing connection');
          ws.close();
          continue;
        }

        // Send ping
        this.send(ws, { type: 'ping' });
      }
    }, this.heartbeatInterval);
  }
}

module.exports = SignalingHandler;
