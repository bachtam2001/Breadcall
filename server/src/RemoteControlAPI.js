const { EventEmitter } = require('events');
const crypto = require('crypto');

/**
 * RemoteControlAPI - HTTP/WebSocket API for external control
 * Enables stream deck, automation scripts, and third-party integrations
 */
class RemoteControlAPI extends EventEmitter {
  constructor(roomManager, signalingHandler) {
    super();
    this.roomManager = roomManager;
    this.signalingHandler = signalingHandler;
    this.apiKeys = new Map(); // apiKey -> { name, permissions }
    this.websocketClients = new Set();
  }

  /**
   * Register an API key
   * @param {string} name - Key name
   * @param {Array} permissions - Allowed actions
   * @returns {string} - Generated API key
   */
  registerApiKey(name, permissions = []) {
    // Use cryptographically secure random bytes instead of Math.random()
    const randomBytes = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now().toString(36);
    const apiKey = `breadcall_${timestamp}_${randomBytes}`;
    this.apiKeys.set(apiKey, { name, permissions, createdAt: new Date() });
    console.log(`[RemoteControlAPI] Registered API key: ${name}`);
    return apiKey;
  }

  /**
   * Validate API key
   * @param {string} apiKey - API key to validate
   * @returns {boolean}
   */
  validateApiKey(apiKey) {
    return this.apiKeys.has(apiKey);
  }

  /**
   * Check permission for API key
   * @param {string} apiKey - API key
   * @param {string} action - Action to check
   * @returns {boolean}
   */
  hasPermission(apiKey, action) {
    const keyData = this.apiKeys.get(apiKey);
    if (!keyData) return false;
    return keyData.permissions.includes('*') || keyData.permissions.includes(action);
  }

  /**
   * Get Express middleware for API authentication
   * @returns {Function}
   */
  authMiddleware() {
    return (req, res, next) => {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;

      if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
      }

      if (!this.validateApiKey(apiKey)) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      req.apiKey = apiKey;
      req.apiPermissions = this.apiKeys.get(apiKey).permissions;
      next();
    };
  }

  /**
   * Get REST API routes for Express
   * @returns {Object} - Routes object
   */
  getRoutes() {
    const auth = this.authMiddleware();

    return {
      // Room management
      'POST /api/remote/rooms': [auth, this.createRoom.bind(this)],
      'GET /api/remote/rooms/:roomId': [auth, this.getRoom.bind(this)],
      'DELETE /api/remote/rooms/:roomId': [auth, this.deleteRoom.bind(this)],
      'GET /api/remote/rooms': [auth, this.listRooms.bind(this)],

      // Participant control
      'GET /api/remote/rooms/:roomId/participants': [auth, this.getParticipants.bind(this)],
      'POST /api/remote/rooms/:roomId/participants/:participantId/kick': [auth, this.kickParticipant.bind(this)],
      'POST /api/remote/rooms/:roomId/participants/:participantId/mute': [auth, this.muteParticipant.bind(this)],

      // Broadcast control
      'POST /api/remote/broadcast': [auth, this.broadcastMessage.bind(this)],

      // Stats
      'GET /api/remote/stats': [auth, this.getStats.bind(this)]
    };
  }

  /**
   * Create a new room
   */
  async createRoom(req, res) {
    if (!this.hasPermission(req.apiKey, 'rooms:create')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    try {
      const { password, maxParticipants, ttl } = req.body;
      const room = this.roomManager.createRoom({
        password,
        maxParticipants,
        ttl
      });

      this.emit('room-created', { room });
      res.json({ success: true, room });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get room info
   */
  async getRoom(req, res) {
    if (!this.hasPermission(req.apiKey, 'rooms:read')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const room = this.roomManager.getRoom(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({ success: true, room });
  }

  /**
   * Delete a room
   */
  async deleteRoom(req, res) {
    if (!this.hasPermission(req.apiKey, 'rooms:delete')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const deleted = this.roomManager.deleteRoom(req.params.roomId);
    if (!deleted) {
      return res.status(404).json({ error: 'Room not found' });
    }

    this.emit('room-deleted', { roomId: req.params.roomId });
    res.json({ success: true });
  }

  /**
   * List all rooms
   */
  async listRooms(req, res) {
    if (!this.hasPermission(req.apiKey, 'rooms:read')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const rooms = this.roomManager.getAllRooms();
    res.json({ success: true, rooms });
  }

  /**
   * Get room participants
   */
  async getParticipants(req, res) {
    if (!this.hasPermission(req.apiKey, 'participants:read')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const participants = this.roomManager.getRoomParticipants(req.params.roomId);
    res.json({ success: true, participants: participants || [] });
  }

  /**
   * Kick a participant
   */
  async kickParticipant(req, res) {
    if (!this.hasPermission(req.apiKey, 'participants:kick')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { roomId, participantId } = req.params;
    this.signalingHandler.kickParticipant(roomId, participantId);

    this.emit('participant-kicked', { roomId, participantId });
    res.json({ success: true });
  }

  /**
   * Mute a participant (send signal to client)
   */
  async muteParticipant(req, res) {
    if (!this.hasPermission(req.apiKey, 'participants:mute')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { roomId, participantId } = req.params;
    const { muted, videoOff } = req.body;

    this.signalingHandler.sendMuteStatus(roomId, participantId, muted, videoOff);

    this.emit('participant-muted', { roomId, participantId, muted, videoOff });
    res.json({ success: true });
  }

  /**
   * Broadcast message to all rooms
   */
  async broadcastMessage(req, res) {
    if (!this.hasPermission(req.apiKey, 'broadcast')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { message, type = 'notification' } = req.body;

    const rooms = this.roomManager.getAllRooms();
    rooms.forEach(room => {
      this.signalingHandler.broadcastToRoom(room.id, {
        type,
        message
      });
    });

    this.emit('broadcast', { message, type, roomCount: rooms.length });
    res.json({ success: true, roomCount: rooms.length });
  }

  /**
   * Get system stats
   */
  async getStats(req, res) {
    if (!this.hasPermission(req.apiKey, 'stats:read')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const rooms = this.roomManager.getAllRooms();
    const totalParticipants = rooms.reduce((sum, room) => {
      const participants = this.roomManager.getRoomParticipants(room.id);
      return sum + (participants?.length || 0);
    }, 0);

    const stats = {
      totalRooms: rooms.length,
      totalParticipants,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      apiKeys: this.apiKeys.size
    };

    res.json({ success: true, stats });
  }

  /**
   * Handle WebSocket connection for real-time updates
   * @param {WebSocket} ws
   */
  handleWebSocket(ws) {
    const client = {
      ws,
      authenticated: false,
      subscriptions: new Set()
    };

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleWebSocketMessage(client, message);
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      this.websocketClients.delete(client);
    });

    this.websocketClients.add(client);
  }

  /**
   * Handle WebSocket message
   */
  handleWebSocketMessage(client, message) {
    const { type, payload } = message;

    switch (type) {
      case 'auth':
        if (this.validateApiKey(payload.apiKey)) {
          client.authenticated = true;
          client.apiKey = payload.apiKey;
          ws.send(JSON.stringify({ type: 'auth-success' }));
        } else {
          ws.send(JSON.stringify({ type: 'auth-failed' }));
        }
        break;

      case 'subscribe':
        if (client.authenticated) {
          client.subscriptions.add(payload.event);
          ws.send(JSON.stringify({ type: 'subscribed', event: payload.event }));
        }
        break;

      case 'unsubscribe':
        client.subscriptions.delete(payload.event);
        break;
    }
  }

  /**
   * Emit event to subscribed WebSocket clients
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  emitToSubscribers(event, data) {
    this.websocketClients.forEach(client => {
      if (client.authenticated && client.subscriptions.has(event)) {
        client.ws.send(JSON.stringify({ type: event, data }));
      }
    });
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.websocketClients.forEach(client => {
      client.ws.close();
    });
    this.websocketClients.clear();
    this.apiKeys.clear();
  }
}

module.exports = { RemoteControlAPI };
