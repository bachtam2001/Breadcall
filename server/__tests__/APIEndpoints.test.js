/**
 * API Endpoints Tests
 * Tests for all Express REST API endpoints
 */
const request = require('supertest');
const express = require('express');

// Mock dependencies before importing the app
jest.mock('ws');

const RoomManager = require('../src/RoomManager');

// Create a test app with the routes
let app;
let roomManager;

describe('API Endpoints', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create fresh instances
    roomManager = new RoomManager();

    // Setup express app for testing
    app = express();
    app.use(express.json());

    // Mount routes (copied from index.js for testing)
    setupRoutes(app, roomManager);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  function setupRoutes(app, roomManager) {
    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Create room
    app.post('/api/rooms', async (req, res) => {
      try {
        const { password, maxParticipants = 10, quality = '720p', codec = 'H264' } = req.body;
        const room = roomManager.createRoom({
          password,
          maxParticipants,
          quality,
          codec
        });
        res.json({
          success: true,
          roomId: room.id,
          createdAt: room.createdAt
        });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Get room info
    app.get('/api/rooms/:roomId', (req, res) => {
      const room = roomManager.getRoom(req.params.roomId);
      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }
      res.json({
        success: true,
        room: {
          id: room.id,
          participantCount: room.participants.size,
          maxParticipants: room.maxParticipants,
          quality: room.quality,
          codec: room.codec,
          createdAt: room.createdAt
        }
      });
    });

    // Get room participants
    app.get('/api/rooms/:roomId/participants', (req, res) => {
      const room = roomManager.getRoom(req.params.roomId);
      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      const participants = Array.from(room.participants.values()).map(p => ({
        participantId: p.participantId,
        name: p.name,
        joinedAt: p.joinedAt,
        isSendingVideo: p.isSendingVideo,
        isSendingAudio: p.isSendingAudio
      }));

      res.json({ success: true, participants });
    });

    // Get WebRTC configuration (new endpoint)
    app.get('/api/webrtc-config', (req, res) => {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';

      res.json({
        success: true,
        webrtcUrl: `${protocol}://${host}`,
        app: '',
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
    });
  }

  describe('GET /health', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /api/rooms', () => {
    test('should create a room with default options', async () => {
      const response = await request(app)
        .post('/api/rooms')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('roomId');
      expect(response.body.roomId).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
      expect(response.body).toHaveProperty('createdAt');
    });

    test('should create a room with custom options', async () => {
      const roomData = {
        password: 'secret123',
        maxParticipants: 5,
        quality: '1080p',
        codec: 'VP9'
      };

      const response = await request(app)
        .post('/api/rooms')
        .send(roomData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('roomId');
    });

    test('should handle errors gracefully', async () => {
      // Force an error by mocking roomManager
      jest.spyOn(roomManager, 'createRoom').mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      const response = await request(app)
        .post('/api/rooms')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Test error');
    });
  });

  describe('GET /api/rooms/:roomId', () => {
    test('should return room info for existing room', async () => {
      const room = roomManager.createRoom({ maxParticipants: 5 });

      const response = await request(app)
        .get(`/api/rooms/${room.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.room).toMatchObject({
        id: room.id,
        participantCount: 0,
        maxParticipants: 5,
        quality: '720p',
        codec: 'H264'
      });
      expect(response.body.room).toHaveProperty('createdAt');
    });

    test('should return 404 for non-existent room', async () => {
      const response = await request(app)
        .get('/api/rooms/INVALID')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Room not found');
    });

    test('should return correct participant count', async () => {
      const room = roomManager.createRoom();
      await roomManager.joinRoom(room.id, { name: 'User 1' });
      await roomManager.joinRoom(room.id, { name: 'User 2' });

      const response = await request(app)
        .get(`/api/rooms/${room.id}`)
        .expect(200);

      expect(response.body.room.participantCount).toBe(2);
    });
  });

  describe('GET /api/rooms/:roomId/participants', () => {
    test('should return participants list', async () => {
      const room = roomManager.createRoom();
      await roomManager.joinRoom(room.id, { name: 'User 1' });
      await roomManager.joinRoom(room.id, { name: 'User 2' });

      const response = await request(app)
        .get(`/api/rooms/${room.id}/participants`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.participants).toHaveLength(2);
      expect(response.body.participants.map(p => p.name)).toEqual(
        expect.arrayContaining(['User 1', 'User 2'])
      );
    });

    test('should return 404 for non-existent room', async () => {
      const response = await request(app)
        .get('/api/rooms/INVALID/participants')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Room not found');
    });

    test('should return empty array for room with no participants', async () => {
      const room = roomManager.createRoom();

      const response = await request(app)
        .get(`/api/rooms/${room.id}/participants`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.participants).toEqual([]);
    });

    test('should include participant details', async () => {
      const room = roomManager.createRoom();
      const { participantId } = await roomManager.joinRoom(room.id, { name: 'Test User' });

      const response = await request(app)
        .get(`/api/rooms/${room.id}/participants`)
        .expect(200);

      const participant = response.body.participants[0];
      expect(participant).toHaveProperty('participantId', participantId);
      expect(participant).toHaveProperty('name', 'Test User');
      expect(participant).toHaveProperty('joinedAt');
      expect(participant).toHaveProperty('isSendingVideo');
      expect(participant).toHaveProperty('isSendingAudio');
    });
  });

  describe('GET /api/webrtc-config', () => {
    test('should return WebRTC configuration', async () => {
      const response = await request(app)
        .get('/api/webrtc-config')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('webrtcUrl');
      expect(response.body).toHaveProperty('app', '');
      expect(response.body).toHaveProperty('iceServers');
      expect(response.body.iceServers).toEqual([
        { urls: 'stun:stun.l.google.com:19302' }
      ]);
    });

    test('should use x-forwarded headers when present', async () => {
      const response = await request(app)
        .get('/api/webrtc-config')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'breadcall.example.com')
        .expect(200);

      expect(response.body.webrtcUrl).toBe('https://breadcall.example.com');
    });

    test('should fallback to request protocol/host when no forwarded headers', async () => {
      const response = await request(app)
        .get('/api/webrtc-config')
        .expect(200);

      // Default in test environment
      expect(response.body.webrtcUrl).toMatch(/^http:\/\//);
    });
  });
});
