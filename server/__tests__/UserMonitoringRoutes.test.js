/**
 * User and Monitoring Routes Tests
 * Tests for GET /api/user/rooms, GET /api/monitoring/status, and GET /api/monitoring/rooms
 */
const request = require('supertest');
const express = require('express');

// Mock dependencies
jest.mock('ws');

const RoomManager = require('../src/RoomManager');
const createUserRouter = require('../src/routes/user');
const createMonitoringRouter = require('../src/routes/monitoring');

describe('User and Monitoring Routes', () => {
  let app;
  let roomManager;

  // Mock auth middleware
  const mockRequireAuth = (req, res, next) => {
    req.user = {
      id: 'test-user-id',
      username: 'testuser',
      role: 'operator',
      displayName: 'Test User',
      permissions: ['view']
    };
    next();
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock RBAC manager
    const mockRbac = {
      hasPermission: jest.fn()
    };

    // Create fresh instances
    roomManager = new RoomManager();

    // Setup express app for testing
    app = express();
    app.use(express.json());

    // Attach mock RBAC manager to app.locals
    app.locals.rbacManager = mockRbac;

    // Default: allow all permission checks
    mockRbac.hasPermission.mockResolvedValue(true);

    // Mount routes with mock auth middleware
    app.use('/api/user', mockRequireAuth, createUserRouter(roomManager));
    app.use('/api/monitoring', mockRequireAuth, createMonitoringRouter(roomManager));
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('GET /api/user/rooms', () => {
    test('should return empty rooms array when user has no assignments', async () => {
      const response = await request(app)
        .get('/api/user/rooms')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        rooms: []
      });
    });

    test('should return empty rooms array (OLAManager removed)', async () => {
      const response = await request(app)
        .get('/api/user/rooms')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        rooms: []
      });
    });

    test('should return empty rooms array regardless of input', async () => {
      const response = await request(app)
        .get('/api/user/rooms')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        rooms: []
      });
    });
  });

  describe('GET /api/monitoring/status', () => {
    test('should return zero counts when no rooms exist', async () => {
      const response = await request(app)
        .get('/api/monitoring/status')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        activeRooms: 0,
        totalParticipants: 0
      });
    });

    test('should return correct room and participant counts', async () => {
      // Create rooms and add participants
      const room1 = roomManager.createRoom();
      const room2 = roomManager.createRoom();
      const room3 = roomManager.createRoom();

      await roomManager.joinRoom(room1.id, { name: 'User 1' });
      await roomManager.joinRoom(room1.id, { name: 'User 2' });
      await roomManager.joinRoom(room2.id, { name: 'User 3' });

      const response = await request(app)
        .get('/api/monitoring/status')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        activeRooms: 3,
        totalParticipants: 3
      });
    });

    test('should handle errors gracefully', async () => {
      // Force an error by mocking getAllRooms
      jest.spyOn(roomManager, 'getAllRooms').mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      const response = await request(app)
        .get('/api/monitoring/status')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to fetch monitoring status'
      });
    });
  });

  describe('GET /api/monitoring/rooms', () => {
    test('should return empty array when no rooms exist', async () => {
      const response = await request(app)
        .get('/api/monitoring/rooms')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        rooms: []
      });
    });

    test('should return room details with idle status for empty rooms', async () => {
      const room = roomManager.createRoom({ maxParticipants: 10 });

      const response = await request(app)
        .get('/api/monitoring/rooms')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.rooms).toHaveLength(1);
      expect(response.body.rooms[0]).toMatchObject({
        roomId: room.id,
        participantCount: 0,
        streamStatus: 'idle'
      });
      expect(response.body.rooms[0]).toHaveProperty('name');
    });

    test('should return live status for rooms with participants', async () => {
      const room = roomManager.createRoom();
      await roomManager.joinRoom(room.id, { name: 'User 1' });

      const response = await request(app)
        .get('/api/monitoring/rooms')
        .expect(200);

      expect(response.body.rooms[0]).toMatchObject({
        roomId: room.id,
        participantCount: 1,
        streamStatus: 'live'
      });
    });

    test('should return multiple rooms with correct statuses', async () => {
      const room1 = roomManager.createRoom();
      const room2 = roomManager.createRoom();
      const room3 = roomManager.createRoom();

      // Add participants to room1 and room2
      await roomManager.joinRoom(room1.id, { name: 'User 1' });
      await roomManager.joinRoom(room1.id, { name: 'User 2' });
      await roomManager.joinRoom(room2.id, { name: 'User 3' });
      // room3 remains empty

      const response = await request(app)
        .get('/api/monitoring/rooms')
        .expect(200);

      expect(response.body.rooms).toHaveLength(3);

      const room1Data = response.body.rooms.find(r => r.roomId === room1.id);
      const room2Data = response.body.rooms.find(r => r.roomId === room2.id);
      const room3Data = response.body.rooms.find(r => r.roomId === room3.id);

      expect(room1Data).toMatchObject({ participantCount: 2, streamStatus: 'live' });
      expect(room2Data).toMatchObject({ participantCount: 1, streamStatus: 'live' });
      expect(room3Data).toMatchObject({ participantCount: 0, streamStatus: 'idle' });
    });

    test('should handle errors gracefully', async () => {
      // Force an error by mocking getAllRooms
      jest.spyOn(roomManager, 'getAllRooms').mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      const response = await request(app)
        .get('/api/monitoring/rooms')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to fetch room monitoring data'
      });
    });
  });
});
