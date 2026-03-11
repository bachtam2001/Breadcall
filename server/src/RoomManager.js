const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.directors = new Map(); // roomId -> Set of director WebSockets
    this.roomTTL = 5 * 60 * 1000; // 5 minutes TTL for empty rooms
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
    const { password = null, maxParticipants = 10, quality = 'hd', codec = 'H264' } = options;

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
      emptySince: room.emptySince
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
}

module.exports = RoomManager;
