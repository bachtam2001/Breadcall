/**
 * SRT Configuration API Integration Tests
 */
const request = require('supertest');
const express = require('express');
const RoomManager = require('../src/RoomManager');
const MediaMTXClient = require('../src/MediaMTXClient');
const createSRTRouter = require('../src/routes/srt');

// Mock MediaMTXClient
jest.mock('../src/MediaMTXClient');

describe('SRT Configuration API', () => {
  let app;
  let roomManager;
  let mockMediaMTX;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh instances
    roomManager = new RoomManager();
    mockMediaMTX = new MediaMTXClient();

    // Setup express app
    app = express();
    app.use(express.json());

    // Mount SRT router
    app.use('/api', createSRTRouter(mockMediaMTX, roomManager));
  });

  describe('POST /api/:roomId/srt/configure', () => {
    test('should configure push mode successfully', async () => {
      const room = roomManager.createRoom();

      const response = await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'push' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('push');
      expect(response.body.pullUrl).toBeNull();

      // Verify room state updated
      const updatedRoom = roomManager.getRoom(room.id);
      expect(updatedRoom.srtMode).toBe('push');
      expect(updatedRoom.srtPullUrl).toBeNull();
    });

    test('should configure pull mode successfully', async () => {
      const room = roomManager.createRoom();
      const pullUrl = 'srt://remote-server:8890?mode=caller&streamid=mystream';

      // Mock MediaMTX addPath
      mockMediaMTX.addPath.mockResolvedValue({ success: true });

      const response = await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'pull', pullUrl })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('pull');
      expect(response.body.pullUrl).toBe(pullUrl);
      expect(response.body.streamActive).toBe(true);

      // Verify MediaMTX was called correctly
      expect(mockMediaMTX.addPath).toHaveBeenCalledWith({
        path: `room/${room.id}`,
        sourceUrl: pullUrl
      });

      // Verify room state updated
      const updatedRoom = roomManager.getRoom(room.id);
      expect(updatedRoom.srtMode).toBe('pull');
      expect(updatedRoom.srtPullUrl).toBe(pullUrl);
    });

    test('should reject invalid mode', async () => {
      const room = roomManager.createRoom();

      const response = await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'invalid' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid mode');
    });

    test('should reject pull mode without pullUrl', async () => {
      const room = roomManager.createRoom();

      const response = await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'pull' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('pullUrl is required');
    });

    test('should reject invalid pullUrl format', async () => {
      const room = roomManager.createRoom();

      const response = await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'pull', pullUrl: 'rtmp://invalid' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid pullUrl format');
    });

    test('should return 404 for non-existent room', async () => {
      const response = await request(app)
        .post('/api/INVALID/srt/configure')
        .send({ mode: 'push' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Room not found');
    });

    test('should stop current stream when switching modes', async () => {
      const room = roomManager.createRoom();

      // First set to pull mode
      mockMediaMTX.addPath.mockResolvedValue({ success: true });
      await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'pull', pullUrl: 'srt://server1:8890' });

      // Clear mock to verify new calls
      mockMediaMTX.addPath.mockClear();
      mockMediaMTX.stopPath.mockResolvedValue({ success: true });

      // Switch to push mode
      const response = await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'push' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('push');

      // Verify stopPath was called
      expect(mockMediaMTX.stopPath).toHaveBeenCalledWith(`room/${room.id}`);
    });

    test('should handle MediaMTX errors gracefully', async () => {
      const room = roomManager.createRoom();
      const pullUrl = 'srt://unreachable:8890';

      // Mock MediaMTX error
      mockMediaMTX.addPath.mockRejectedValue(new Error('Connection refused'));

      const response = await request(app)
        .post(`/api/${room.id}/srt/configure`)
        .send({ mode: 'pull', pullUrl })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Failed to configure pull mode');
    });
  });

  describe('GET /api/:roomId/srt/config', () => {
    test('should return SRT configuration', async () => {
      const room = roomManager.createRoom();

      // Set SRT mode
      room.srtMode = 'pull';
      room.srtPullUrl = 'srt://server:8890';
      room.srtStreamActive = true;
      room.srtConnectedAt = new Date().toISOString();

      const response = await request(app)
        .get(`/api/${room.id}/srt/config`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBe('pull');
      expect(response.body.pullUrl).toBe('srt://server:8890');
      expect(response.body.streamActive).toBe(true);
      expect(response.body.connectedAt).toBeDefined();
    });

    test('should return null for unset fields', async () => {
      const room = roomManager.createRoom();

      const response = await request(app)
        .get(`/api/${room.id}/srt/config`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.mode).toBeNull();
      expect(response.body.pullUrl).toBeNull();
      expect(response.body.streamActive).toBe(false);
    });

    test('should return 404 for non-existent room', async () => {
      const response = await request(app)
        .get('/api/INVALID/srt/config')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Room not found');
    });
  });
});
