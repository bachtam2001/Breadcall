const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const crypto = require('crypto');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.directors = new Map(); // roomId -> Set of director WebSockets
    this.roomTTL = 5 * 60 * 1000; // 5 minutes TTL for empty rooms

    // Token storage
    this.tokens = new Map();           // tokenId -> TokenData
    this.tokenIndex = new Map();       // roomId -> Set of tokenIds
    this.revokedTokens = new Set();    // Revoked token IDs
  }

  /**
   * Generate a short room ID (4 characters)
   */
  generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar chars
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Create a new room
   * @param {Object} options - Room options
   * @returns {Object} Created room
   */
  createRoom(options = {}) {
    const { password = null, maxParticipants = 10, quality = '720p', codec = 'H264' } = options;

    // Generate unique room ID
    let roomId;
    do {
      roomId = this.generateRoomId();
    } while (this.rooms.has(roomId));

    const room = {
      id: roomId,
      password,
      maxParticipants,
      quality,
      codec,
      participants: new Map(), // participantId -> participant
      createdAt: new Date().toISOString(),
      emptySince: null,
      ttlTimer: null
    };

    this.rooms.set(roomId, room);
    console.log(`[RoomManager] Room created: ${roomId}`);

    return room;
  }

  /**
   * Join a room
   * @param {string} roomId - Room ID
   * @param {Object} participant - Participant info
   * @returns {Object} Join result with existing peers
   */
  joinRoom(roomId, participant) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    // Check if room is full
    if (room.participants.size >= room.maxParticipants) {
      throw new Error('Room is full');
    }

    // Check password if required
    if (room.password && room.password !== participant.password) {
      throw new Error('Invalid password');
    }

    // Generate participant ID
    const participantId = uuidv4();
    const streamName = `${roomId}_${participantId}`;

    const participantData = {
      participantId,
      roomId,
      streamName, // OME specific stream name
      name: participant.name || 'Anonymous',
      joinedAt: new Date().toISOString(),
      isSendingVideo: false,
      isSendingAudio: false,
      isMuted: false,
      isVideoOff: false,
      ws: participant.ws // WebSocket connection
    };

    room.participants.set(participantId, participantData);

    // Cancel TTL timer if room was empty
    if (room.emptySince && room.ttlTimer) {
      clearTimeout(room.ttlTimer);
      room.emptySince = null;
      room.ttlTimer = null;
    }

    // Get existing participants (peers)
    const existingPeers = Array.from(room.participants.values())
      .filter(p => p.participantId !== participantId)
      .map(p => ({
        participantId: p.participantId,
        streamName: p.streamName, // Send streamName to peers so they can WHEP it
        name: p.name,
        isSendingVideo: p.isSendingVideo,
        isSendingAudio: p.isSendingAudio
      }));

    console.log(`[RoomManager] Participant joined: ${participantId} -> ${roomId}`);

    return {
      participantId,
      room: {
        id: room.id,
        maxParticipants: room.maxParticipants,
        quality: room.quality,
        codec: room.codec
      },
      existingPeers
    };
  }

  /**
   * Join a room as a director (observer)
   * Directors don't count towards participant limit and don't have streamNames
   * @param {string} roomId - Room ID
   * @param {Object} director - Director info
   * @returns {Object} Join result with existing participants
   */
  joinRoomAsDirector(roomId, director) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    // Generate director ID (different namespace from participants)
    const directorId = `director_${uuidv4()}`;

    // Initialize directors set for this room if needed
    if (!this.directors.has(roomId)) {
      this.directors.set(roomId, new Map());
    }
    const roomDirectors = this.directors.get(roomId);

    const directorData = {
      directorId,
      roomId,
      name: director.name || 'Director',
      joinedAt: new Date().toISOString(),
      ws: director.ws
    };

    roomDirectors.set(directorId, directorData);

    // Get existing participants (excluding other directors)
    const existingParticipants = Array.from(room.participants.values()).map(p => ({
      participantId: p.participantId,
      streamName: p.streamName,
      name: p.name,
      isSendingVideo: p.isSendingVideo,
      isSendingAudio: p.isSendingAudio
    }));

    console.log(`[RoomManager] Director joined: ${directorId} -> ${roomId}`);

    return {
      directorId,
      room: {
        id: room.id,
        maxParticipants: room.maxParticipants,
        quality: room.quality,
        codec: room.codec
      },
      existingParticipants
    };
  }

  /**
   * Leave a room
   * @param {string} roomId - Room ID
   * @param {string} participantId - Participant ID
   * @returns {boolean} Success
   */
  leaveRoom(roomId, participantId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return false;
    }

    const removed = room.participants.delete(participantId);

    if (removed) {
      console.log(`[RoomManager] Participant left: ${participantId} <- ${roomId}`);

      // Start TTL timer if room is now empty (participants only, directors don't count)
      if (room.participants.size === 0 && !room.emptySince) {
        room.emptySince = new Date().toISOString();
        room.ttlTimer = setTimeout(() => {
          this.deleteRoom(roomId);
        }, this.roomTTL);
      }
    }

    return removed;
  }

  /**
   * Leave a room as director
   * @param {string} roomId - Room ID
   * @param {string} directorId - Director ID
   * @returns {boolean} Success
   */
  leaveRoomAsDirector(roomId, directorId) {
    const roomDirectors = this.directors.get(roomId);

    if (!roomDirectors) {
      return false;
    }

    const removed = roomDirectors.delete(directorId);

    if (removed) {
      console.log(`[RoomManager] Director left: ${directorId} <- ${roomId}`);

      // Clean up if no more directors
      if (roomDirectors.size === 0) {
        this.directors.delete(roomId);
      }
    }

    return removed;
  }

  /**
   * Delete a room
   * @param {string} roomId - Room ID
   * @returns {boolean} Success
   */
  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return false;
    }

    // Clear TTL timer
    if (room.ttlTimer) {
      clearTimeout(room.ttlTimer);
    }

    // Notify all participants
    for (const [participantId, participant] of room.participants.entries()) {
      if (participant.ws && participant.ws.readyState === WebSocket.OPEN) {
        participant.ws.send(JSON.stringify({
          type: 'room-closed',
          roomId
        }));
        participant.ws.close();
      }
    }

    // Notify all directors
    const roomDirectors = this.directors.get(roomId);
    if (roomDirectors) {
      for (const [directorId, director] of roomDirectors.entries()) {
        if (director.ws && director.ws.readyState === WebSocket.OPEN) {
          director.ws.send(JSON.stringify({
            type: 'room-closed',
            roomId
          }));
          director.ws.close();
        }
      }
      this.directors.delete(roomId);
    }

    this.rooms.delete(roomId);
    console.log(`[RoomManager] Room deleted: ${roomId}`);

    return true;
  }

  /**
   * Get room by ID
   * @param {string} roomId - Room ID
   * @returns {Object|null} Room or null
   */
  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Get room participants
   * @param {string} roomId - Room ID
   * @returns {Array} List of participants
   */
  getRoomParticipants(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return Array.from(room.participants.values()).map(p => ({
      participantId: p.participantId,
      name: p.name,
      joinedAt: p.joinedAt,
      isSendingVideo: p.isSendingVideo,
      isSendingAudio: p.isSendingAudio,
      isMuted: p.isMuted,
      isVideoOff: p.isVideoOff
    }));
  }

  /**
   * Get room directors
   * @param {string} roomId - Room ID
   * @returns {Array} List of directors
   */
  getRoomDirectors(roomId) {
    const roomDirectors = this.directors.get(roomId);
    if (!roomDirectors) {
      return [];
    }

    return Array.from(roomDirectors.values()).map(d => ({
      directorId: d.directorId,
      name: d.name,
      joinedAt: d.joinedAt
    }));
  }

  /**
   * Notify all directors in a room about participant events
   * @param {string} roomId - Room ID
   * @param {Object} message - Message to send
   * @param {WebSocket} excludeWs - WebSocket to exclude
   */
  notifyDirectors(roomId, message, excludeWs = null) {
    const roomDirectors = this.directors.get(roomId);
    if (!roomDirectors) {
      return;
    }

    const messageStr = JSON.stringify(message);
    for (const [directorId, director] of roomDirectors.entries()) {
      if (director.ws && director.ws.readyState === WebSocket.OPEN && director.ws !== excludeWs) {
        director.ws.send(messageStr);
      }
    }
  }

  /**
   * Update participant status
   * @param {string} roomId - Room ID
   * @param {string} participantId - Participant ID
   * @param {Object} updates - Status updates
   */
  updateParticipant(roomId, participantId, updates) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      return false;
    }

    Object.assign(participant, updates);
    return true;
  }

  /**
   * Get all rooms (for debugging)
   * @returns {Array} List of rooms
   */
  getAllRooms() {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      participantCount: room.participants.size,
      maxParticipants: room.maxParticipants,
      quality: room.quality,
      codec: room.codec,
      createdAt: room.createdAt,
      emptySince: room.emptySince,
      password: room.password
    }));
  }

  /**
   * Cleanup - delete all empty rooms
   */
  cleanup() {
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.participants.size === 0) {
        this.deleteRoom(roomId);
      }
    }
  }

  /**
   * Generate a signed token for room access or actions
   * @param {string} roomId - Room ID
   * @param {string} type - Token type (room_access, director_access, stream_access, action_token, admin_token)
   * @param {Object} options - Token options
   * @returns {string} Serialized token string
   */
  generateToken(roomId, type, options = {}) {
    const room = this.rooms.get(roomId);
    if (!room && type !== 'admin_token') {
      throw new Error('Room not found');
    }

    const tokenId = crypto.randomBytes(16).toString('hex');
    const signature = this._signToken(tokenId, roomId, type);

    const tokenData = {
      tokenId,
      signature,
      type,
      roomId,
      userId: options.userId || crypto.randomBytes(8).toString('hex'),
      permissions: this._getDefaultPermissions(type),
      expiresAt: options.expiresAt || Date.now() + 3600000,
      maxUses: options.maxUses || null,
      usedCount: 0,
      issuedBy: options.issuedBy || 'system',
      metadata: options.metadata || {},
      createdAt: Date.now()
    };

    // Store token
    this.tokens.set(tokenId, tokenData);

    // Index by room for cleanup
    if (!this.tokenIndex.has(roomId)) {
      this.tokenIndex.set(roomId, new Set());
    }
    this.tokenIndex.get(roomId).add(tokenId);

    // Return serialized token
    return this._serializeToken(tokenData);
  }

  /**
   * Validate and consume a token
   * @param {string} tokenString - Token string to validate
   * @param {string} action - Action being performed (for permission check)
   * @returns {Object} Validation result
   */
  validateToken(tokenString, action = null) {
    const tokenData = this._deserializeToken(tokenString);
    if (!tokenData) {
      return { valid: false, reason: 'invalid_format' };
    }

    // Check revocation
    if (this.revokedTokens.has(tokenData.tokenId)) {
      return { valid: false, reason: 'revoked' };
    }

    // Check existence
    const stored = this.tokens.get(tokenData.tokenId);
    if (!stored) {
      return { valid: false, reason: 'not_found' };
    }

    // Verify signature
    if (!this._verifySignature(stored)) {
      return { valid: false, reason: 'invalid_signature' };
    }

    // Check expiration
    if (stored.expiresAt && stored.expiresAt < Date.now()) {
      return { valid: false, reason: 'expired' };
    }

    // Check usage limit
    if (stored.maxUses && stored.usedCount >= stored.maxUses) {
      return { valid: false, reason: 'max_uses_reached' };
    }

    // Check action permission if specified
    if (action && !stored.permissions.includes(action)) {
      return { valid: false, reason: 'permission_denied' };
    }

    // Increment usage count
    stored.usedCount++;

    return {
      valid: true,
      payload: {
        type: stored.type,
        roomId: stored.roomId,
        permissions: stored.permissions,
        metadata: stored.metadata
      }
    };
  }

  /**
   * Revoke a token
   * @param {string} tokenId - Token ID to revoke
   * @returns {boolean} Success
   */
  revokeToken(tokenId) {
    const token = this.tokens.get(tokenId);
    if (token) {
      this.revokedTokens.add(tokenId);
      // Cleanup after 24 hours
      setTimeout(() => {
        this.revokedTokens.delete(tokenId);
        this.tokens.delete(tokenId);
      }, 86400000);
      return true;
    }
    return false;
  }

  /**
   * Cleanup expired tokens for a room
   * @param {string} roomId - Room ID
   */
  cleanupExpiredTokens(roomId) {
    const tokenIds = this.tokenIndex.get(roomId);
    if (!tokenIds) return;

    const now = Date.now();
    for (const tokenId of tokenIds) {
      const token = this.tokens.get(tokenId);
      if (token && token.expiresAt < now) {
        this.tokens.delete(tokenId);
        tokenIds.delete(tokenId);
      }
    }

    if (tokenIds.size === 0) {
      this.tokenIndex.delete(roomId);
    }
  }

  /**
   * Get default permissions by token type
   * @param {string} type - Token type
   * @returns {Array} Default permissions
   */
  _getDefaultPermissions(type) {
    switch (type) {
      case 'room_access':
        return ['join', 'send-audio', 'send-video', 'chat'];
      case 'director_access':
        return ['view-all', 'mute-participant', 'room-settings'];
      case 'stream_access':
        return ['view'];
      case 'action_token':
        return ['execute'];
      case 'admin_token':
        return ['create-room', 'delete-room', 'list-all', 'manage-users'];
      default:
        return [];
    }
  }

  /**
   * Sign token with HMAC
   * @param {string} tokenId - Token ID
   * @param {string} roomId - Room ID
   * @param {string} type - Token type
   * @returns {string} HMAC signature
   */
  _signToken(tokenId, roomId, type) {
    const secret = process.env.TOKEN_SECRET || 'default-secret-change-in-production';
    return crypto
      .createHmac('sha256', secret)
      .update(`${tokenId}:${roomId}:${type}`)
      .digest('hex');
  }

  /**
   * Verify token signature
   * @param {Object} token - Token data
   * @returns {boolean} Valid signature
   */
  _verifySignature(token) {
    const expected = this._signToken(token.tokenId, token.roomId, token.type);
    return crypto.timingSafeEqual(
      Buffer.from(token.signature),
      Buffer.from(expected)
    );
  }

  /**
   * Serialize token for transmission
   * @param {Object} token - Token data
   * @returns {string} Serialized token string
   */
  _serializeToken(token) {
    // Compact format: tokenId.signature (base64 encoded JSON)
    const payload = Buffer.from(JSON.stringify({
      tokenId: token.tokenId,
      signature: token.signature
    })).toString('base64');
    return `tok_${payload}`;
  }

  /**
   * Deserialize token from string
   * @param {string} tokenString - Token string
   * @returns {Object|null} Token data or null
   */
  _deserializeToken(tokenString) {
    try {
      if (!tokenString.startsWith('tok_')) return null;
      const payload = tokenString.slice(4);
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
      return decoded;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get all tokens for a room (for admin listing)
   * @param {string} roomId - Room ID
   * @returns {Array} List of token info (without sensitive data)
   */
  getRoomTokens(roomId) {
    const tokenIds = this.tokenIndex.get(roomId);
    if (!tokenIds) {
      return [];
    }

    const tokens = [];
    for (const tokenId of tokenIds) {
      const token = this.tokens.get(tokenId);
      if (token) {
        tokens.push({
          tokenId: token.tokenId,
          type: token.type,
          createdAt: token.createdAt,
          expiresAt: token.expiresAt,
          usedCount: token.usedCount,
          maxUses: token.maxUses,
          metadata: token.metadata
        });
      }
    }
    return tokens;
  }
}

module.exports = RoomManager;
