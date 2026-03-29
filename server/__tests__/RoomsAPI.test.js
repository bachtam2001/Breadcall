/**
 * Rooms API Tests
 * Tests for /api/rooms endpoints
 */
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

// Mock dependencies
jest.mock('ws');
jest.mock('../src/RedisClient');

const RoomManager = require('../src/RoomManager');
const RBACManager = require('../src/RBACManager');
const UserManager = require('../src/UserManager');
const TokenManager = require('../src/TokenManager');
const Database = require('../src/database');

describe('Rooms API', () => {
  describe('GET /api/rooms', () => {
    let app;
    let roomManager;
    let userManager;
    let rbacManager;
    let tokenManager;
    let mockDb;
    let mockRedis;

    // Mock rooms data
    const mockRooms = [
      {
        id: 'abc-defg-hij',
        ownerId: 'user-001',
        participantCount: 2,
        maxParticipants: 10,
        quality: '720p',
        codec: 'H264',
        createdAt: '2024-01-01T00:00:00.000Z',
        emptySince: null,
        password: null
      },
      {
        id: 'xyz-1234-uvw',
        ownerId: 'user-002',
        participantCount: 0,
        maxParticipants: 5,
        quality: '1080p',
        codec: 'VP9',
        createdAt: '2024-01-02T00:00:00.000Z',
        emptySince: null,
        password: 'secret'
      }
    ];

    // Helper to create a mock jwt.verify that returns a specific payload
    function mockJwtVerify(payload) {
      const originalVerify = jwt.verify;
      jwt.verify = jest.fn().mockReturnValue(payload);
      return () => { jwt.verify = originalVerify; };
    }

    // Helper to create admin token payload
    function createAdminPayload() {
      return {
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        permissions: ['*'],
        role: 'admin',
        username: 'admin'
      };
    }

    // Helper to create director token payload
    function createDirectorPayload() {
      return {
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        permissions: [],
        role: 'director',
        username: 'director'
      };
    }

    // Helper to create viewer token payload
    function createViewerPayload() {
      return {
        tokenId: 'test-token-viewer',
        type: 'room_access',
        roomId: 'abc-defg-hij',
        userId: 'user-003',
        permissions: ['join', 'chat'],
        role: 'viewer',
        username: 'viewer'
      };
    }

    beforeEach(async () => {
      jest.clearAllMocks();

      // Set required environment variables
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
      process.env.TOKEN_SECRET = 'test-secret';
      process.env.CSRF_SECRET = 'csrf-secret';
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

      // Create mock database
      mockDb = {
        initialize: jest.fn().mockResolvedValue(),
        shutdown: jest.fn().mockResolvedValue(),
        query: jest.fn().mockResolvedValue([]),
        queryOne: jest.fn(),
        getAllUsers: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn(),
        getUserByUsername: jest.fn(),
        getRole: jest.fn().mockResolvedValue({ name: 'admin', hierarchy: 100 }),
        getRolePermissions: jest.fn().mockResolvedValue([]),
        insertUser: jest.fn(),
        updateUserRole: jest.fn(),
        deleteUser: jest.fn()
      };

      // Create mock Redis
      mockRedis = {
        connect: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
        isReady: jest.fn().mockReturnValue(false),
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(),
        del: jest.fn().mockResolvedValue(),
        invalidate: jest.fn().mockResolvedValue()
      };

      // Mock RedisClient constructor
      const RedisClient = require('../src/RedisClient');
      RedisClient.mockImplementation(() => mockRedis);

      // Create instances
      roomManager = new RoomManager();

      // Create rooms with proper structure (participants as Map)
      mockRooms.forEach(room => {
        const participantsMap = new Map();
        roomManager.rooms.set(room.id, {
          ...room,
          participants: participantsMap
        });
      });

      rbacManager = new RBACManager(mockDb, mockRedis);
      userManager = new UserManager(mockDb, rbacManager, mockRedis);
      tokenManager = new TokenManager(mockRedis, mockDb);

      // Default mock: allow all permission checks
      rbacManager.hasPermission = jest.fn().mockResolvedValue(true);

      // Create express app
      app = express();
      app.use(express.json());
      app.use(cookieParser());

      // Mock requireAuth wrapper
      const requireAuth = () => {
        return (req, res, next) => {
          const token = req.cookies.jwt;
          if (!token) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
          }

          try {
            const decoded = jwt.verify(token, 'test-secret');
            req.user = decoded;
            next();
          } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
          }
        };
      };

      // Attach managers to app.locals
      app.locals.rbacManager = rbacManager;
      app.locals.userManager = userManager;
      app.locals.roomManager = roomManager;

      // Add the route
      app.get('/api/rooms', requireAuth(), async (req, res) => {
        const user = req.user;
        let rooms;
        if (user.role === 'admin') {
          rooms = roomManager.getAllRooms();
        } else if (['director', 'operator'].includes(user.role)) {
          rooms = roomManager.getRoomsByOwner(user.id);
        } else {
          return res.status(403).json({ success: false, error: 'Not authorized' });
        }
        res.json({ success: true, rooms });
      });
    });

    afterEach(async () => {
      jest.clearAllMocks();
    });

    test('should return 401 for unauthenticated requests', async () => {
      const response = await request(app)
        .get('/api/rooms')
        .expect(401);

      expect(response.body).toEqual({
        success: false,
        error: 'Unauthorized'
      });
    });

    test('should return all rooms for admin users', async () => {
      const restoreJwt = mockJwtVerify(createAdminPayload());

      try {
        const token = tokenManager._generateAccessToken({
          tokenId: 'test-token-admin',
          type: 'admin_token',
          roomId: null,
          userId: 'user-001',
          permissions: ['*']
        }, Date.now());

        const response = await request(app)
          .get('/api/rooms')
          .set('Cookie', [`jwt=${token}`])
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.rooms).toBeDefined();
        expect(Array.isArray(response.body.rooms)).toBe(true);
        expect(response.body.rooms.length).toBe(2);
      } finally {
        restoreJwt();
      }
    });

    test('should return only owned rooms for director users', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        id: 'user-002',  // Required for route's user.id check
        permissions: [],
        role: 'director',
        username: 'director',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .get('/api/rooms')
        .set('Cookie', [`jwt=${token}`])
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.rooms).toBeDefined();
      expect(Array.isArray(response.body.rooms)).toBe(true);
      expect(response.body.rooms.length).toBe(1);
      expect(response.body.rooms[0].id).toBe('xyz-1234-uvw');
      expect(response.body.rooms[0].ownerId).toBe('user-002');
    });

    test('should return 403 for viewer role', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-viewer',
        type: 'room_access',
        roomId: 'abc-defg-hij',
        userId: 'user-003',
        id: 'user-003',
        permissions: ['join', 'chat'],
        role: 'viewer',
        username: 'viewer',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .get('/api/rooms')
        .set('Cookie', [`jwt=${token}`])
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: 'Not authorized'
      });
    });
  });

  describe('POST /api/rooms', () => {
    let app;
    let roomManager;
    let userManager;
    let rbacManager;
    let tokenManager;
    let mockDb;
    let mockRedis;

    // Helper to create a mock jwt.verify that returns a specific payload
    function mockJwtVerify(payload) {
      const originalVerify = jwt.verify;
      jwt.verify = jest.fn().mockReturnValue(payload);
      return () => { jwt.verify = originalVerify; };
    }

    // Helper to create admin token payload
    function createAdminPayload() {
      return {
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        permissions: ['*'],
        role: 'admin',
        username: 'admin'
      };
    }

    // Helper to create director token payload
    function createDirectorPayload() {
      return {
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        permissions: [],
        role: 'director',
        username: 'director'
      };
    }

    // Helper to create viewer token payload
    function createViewerPayload() {
      return {
        tokenId: 'test-token-viewer',
        type: 'room_access',
        roomId: 'abc-defg-hij',
        userId: 'user-003',
        permissions: ['join', 'chat'],
        role: 'viewer',
        username: 'viewer'
      };
    }

    beforeEach(async () => {
      jest.clearAllMocks();

      // Set required environment variables
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
      process.env.TOKEN_SECRET = 'test-secret';
      process.env.CSRF_SECRET = 'csrf-secret';
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

      // Create mock database
      mockDb = {
        initialize: jest.fn().mockResolvedValue(),
        shutdown: jest.fn().mockResolvedValue(),
        query: jest.fn().mockResolvedValue([]),
        queryOne: jest.fn(),
        getAllUsers: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn(),
        getUserByUsername: jest.fn(),
        getRole: jest.fn().mockResolvedValue({ name: 'admin', hierarchy: 100 }),
        getRolePermissions: jest.fn().mockResolvedValue([]),
        insertUser: jest.fn(),
        updateUserRole: jest.fn(),
        deleteUser: jest.fn()
      };

      // Create mock Redis
      mockRedis = {
        connect: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
        isReady: jest.fn().mockReturnValue(false),
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(),
        del: jest.fn().mockResolvedValue(),
        invalidate: jest.fn().mockResolvedValue()
      };

      // Mock RedisClient constructor
      const RedisClient = require('../src/RedisClient');
      RedisClient.mockImplementation(() => mockRedis);

      // Create instances
      roomManager = new RoomManager();
      rbacManager = new RBACManager(mockDb, mockRedis);
      userManager = new UserManager(mockDb, rbacManager, mockRedis);
      tokenManager = new TokenManager(mockDb, mockRedis);

      // Create express app
      app = express();
      app.use(express.json());
      app.use(cookieParser());

      // Mock CSRF protection (bypass for testing)
      const doubleCsrfProtection = (req, res, next) => {
        next();
      };

      // Mock requireAuth wrapper
      const requireAuth = () => {
        return (req, res, next) => {
          const token = req.cookies.jwt;
          if (!token) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
          }

          try {
            const decoded = jwt.verify(token, 'test-secret');
            req.user = decoded;
            next();
          } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
          }
        };
      };

      // Attach managers to app.locals
      app.locals.rbacManager = rbacManager;
      app.locals.userManager = userManager;
      app.locals.roomManager = roomManager;

      // Add the route
      app.post('/api/rooms', doubleCsrfProtection, requireAuth(), async (req, res) => {
        const user = req.user;
        if (!['admin', 'director'].includes(user.role)) {
          return res.status(403).json({ success: false, error: 'Not authorized' });
        }
        const { password, maxParticipants, quality, codec } = req.body;
        const room = roomManager.createRoom({
          password,
          maxParticipants: maxParticipants || 10,
          quality: quality || '720p',
          codec: codec || 'H264',
          ownerId: user.id
        });
        res.json({ success: true, roomId: room.id });
      });
    });

    afterEach(async () => {
      jest.clearAllMocks();
    });

    test('should return 401 for unauthenticated requests', async () => {
      const response = await request(app)
        .post('/api/rooms')
        .send({})
        .expect(401);

      expect(response.body).toEqual({
        success: false,
        error: 'Unauthorized'
      });
    });

    test('should create room with ownerId for director', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        id: 'user-002',  // Required for route's user.id check
        permissions: [],
        role: 'director',
        username: 'director',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .post('/api/rooms')
        .set('Cookie', [`jwt=${token}`])
        .send({
          password: 'test123',
          maxParticipants: 5
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.roomId).toBeDefined();
      expect(response.body.roomId).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

      // Verify room was created with correct ownerId
      const createdRoom = roomManager.getRoom(response.body.roomId);
      expect(createdRoom).toBeDefined();
      expect(createdRoom.ownerId).toBe('user-002');
      expect(createdRoom.password).toBe('test123');
      expect(createdRoom.maxParticipants).toBe(5);
    });

    test('should create room for admin', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        id: 'user-001',  // Required for route's user.id check
        permissions: ['*'],
        role: 'admin',
        username: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .post('/api/rooms')
        .set('Cookie', [`jwt=${token}`])
        .send({
          quality: '1080p',
          codec: 'VP9'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.roomId).toBeDefined();

      // Verify room was created with correct ownerId
      const createdRoom = roomManager.getRoom(response.body.roomId);
      expect(createdRoom).toBeDefined();
      expect(createdRoom.ownerId).toBe('user-001');
      expect(createdRoom.quality).toBe('1080p');
      expect(createdRoom.codec).toBe('VP9');
    });

    test('should return 403 for viewer role', async () => {
      const restoreJwt = mockJwtVerify(createViewerPayload());

      try {
        // Use jwt.sign directly since tokenManager requires proper initialization
        const token = jwt.sign({
          tokenId: 'test-token-viewer',
          type: 'room_access',
          roomId: 'abc-defg-hij',
          userId: 'user-003',
          id: 'user-003',
          permissions: ['join', 'chat'],
          role: 'viewer',
          username: 'viewer',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 900
        }, 'test-secret');

        const response = await request(app)
          .post('/api/rooms')
          .set('Cookie', [`jwt=${token}`])
          .send({})
          .expect(403);

        expect(response.body).toEqual({
          success: false,
          error: 'Not authorized'
        });
      } finally {
        restoreJwt();
      }
    });
  });

  describe('DELETE /api/rooms/:roomId', () => {
    let app;
    let roomManager;
    let userManager;
    let rbacManager;
    let tokenManager;
    let mockDb;
    let mockRedis;
    let testRoomId;

    // Helper to create a mock jwt.verify that returns a specific payload
    function mockJwtVerify(payload) {
      const originalVerify = jwt.verify;
      jwt.verify = jest.fn().mockReturnValue(payload);
      return () => { jwt.verify = originalVerify; };
    }

    // Helper to create admin token payload
    function createAdminPayload() {
      return {
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        permissions: ['*'],
        role: 'admin',
        username: 'admin'
      };
    }

    // Helper to create director token payload (room owner)
    function createDirectorPayload() {
      return {
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        permissions: [],
        role: 'director',
        username: 'director'
      };
    }

    // Helper to create non-owner user payload
    function createNonOwnerPayload() {
      return {
        tokenId: 'test-token-nonowner',
        type: 'admin_token',
        roomId: null,
        userId: 'user-003',
        permissions: [],
        role: 'director',
        username: 'nonowner'
      };
    }

    beforeEach(async () => {
      jest.clearAllMocks();

      // Set required environment variables
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
      process.env.TOKEN_SECRET = 'test-secret';
      process.env.CSRF_SECRET = 'csrf-secret';
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

      // Create mock database
      mockDb = {
        initialize: jest.fn().mockResolvedValue(),
        shutdown: jest.fn().mockResolvedValue(),
        query: jest.fn().mockResolvedValue([]),
        queryOne: jest.fn(),
        getAllUsers: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn(),
        getUserByUsername: jest.fn(),
        getRole: jest.fn().mockResolvedValue({ name: 'admin', hierarchy: 100 }),
        getRolePermissions: jest.fn().mockResolvedValue([]),
        insertUser: jest.fn(),
        updateUserRole: jest.fn(),
        deleteUser: jest.fn()
      };

      // Create mock Redis
      mockRedis = {
        connect: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
        isReady: jest.fn().mockReturnValue(false),
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(),
        del: jest.fn().mockResolvedValue(),
        invalidate: jest.fn().mockResolvedValue()
      };

      // Mock RedisClient constructor
      const RedisClient = require('../src/RedisClient');
      RedisClient.mockImplementation(() => mockRedis);

      // Create instances
      roomManager = new RoomManager();
      rbacManager = new RBACManager(mockDb, mockRedis);
      userManager = new UserManager(mockDb, rbacManager, mockRedis);
      tokenManager = new TokenManager(mockDb, mockRedis);

      // Create test room owned by user-002
      const testRoom = roomManager.createRoom({
        password: null,
        maxParticipants: 10,
        quality: '720p',
        codec: 'H264',
        ownerId: 'user-002'
      });
      testRoomId = testRoom.id;

      // Create express app
      app = express();
      app.use(express.json());
      app.use(cookieParser());

      // Mock CSRF protection (bypass for testing)
      const doubleCsrfProtection = (req, res, next) => {
        next();
      };

      // Mock requireAuth wrapper
      const requireAuth = () => {
        return (req, res, next) => {
          const token = req.cookies.jwt;
          if (!token) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
          }

          try {
            const decoded = jwt.verify(token, 'test-secret');
            req.user = decoded;
            next();
          } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
          }
        };
      };

      // Attach managers to app.locals
      app.locals.rbacManager = rbacManager;
      app.locals.userManager = userManager;
      app.locals.roomManager = roomManager;

      // Add the route
      app.delete('/api/rooms/:roomId', doubleCsrfProtection, requireAuth(), async (req, res) => {
        const user = req.user;
        const { roomId } = req.params;

        const room = roomManager.getRoom(roomId);
        if (!room) {
          return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Check ownership or admin
        if (user.role !== 'admin' && room.ownerId !== user.id) {
          return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        const deleted = roomManager.deleteRoom(roomId);
        if (!deleted) {
          return res.status(404).json({ success: false, error: 'Room not found' });
        }
        res.json({ success: true });
      });
    });

    afterEach(async () => {
      jest.clearAllMocks();
    });

    test('should return 401 for unauthenticated requests', async () => {
      const response = await request(app)
        .delete(`/api/rooms/${testRoomId}`)
        .expect(401);

      expect(response.body).toEqual({
        success: false,
        error: 'Unauthorized'
      });
    });

    test('should delete room when user is owner', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        id: 'user-002',  // Required for route's user.id check
        permissions: [],
        role: 'director',
        username: 'director',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .delete(`/api/rooms/${testRoomId}`)
        .set('Cookie', [`jwt=${token}`])
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify room was deleted
      const deletedRoom = roomManager.getRoom(testRoomId);
      expect(deletedRoom).toBeNull();
    });

    test('should delete room when user is admin', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        id: 'user-001',  // Required for route's user.id check
        permissions: ['*'],
        role: 'admin',
        username: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .delete(`/api/rooms/${testRoomId}`)
        .set('Cookie', [`jwt=${token}`])
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify room was deleted
      const deletedRoom = roomManager.getRoom(testRoomId);
      expect(deletedRoom).toBeNull();
    });

    test('should return 403 when user is not owner', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-nonowner',
        type: 'admin_token',
        roomId: null,
        userId: 'user-003',
        id: 'user-003',  // Required for route's user.id check
        permissions: [],
        role: 'director',
        username: 'nonowner',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .delete(`/api/rooms/${testRoomId}`)
        .set('Cookie', [`jwt=${token}`])
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: 'Not authorized'
      });

      // Verify room still exists
      const room = roomManager.getRoom(testRoomId);
      expect(room).toBeDefined();
    });

    test('should return 404 for non-existent room', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        id: 'user-001',  // Required for route's user.id check
        permissions: ['*'],
        role: 'admin',
        username: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .delete('/api/rooms/non-existent-room')
        .set('Cookie', [`jwt=${token}`])
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Room not found'
      });
    });
  });

  describe('PUT /api/rooms/:roomId/settings', () => {
    let app;
    let roomManager;
    let userManager;
    let rbacManager;
    let tokenManager;
    let mockDb;
    let mockRedis;
    let testRoomId;
    let mockSignalingHandler;

    // Helper to create a mock jwt.verify that returns a specific payload
    function mockJwtVerify(payload) {
      const originalVerify = jwt.verify;
      jwt.verify = jest.fn().mockReturnValue(payload);
      return () => { jwt.verify = originalVerify; };
    }

    // Helper to create admin token payload
    function createAdminPayload() {
      return {
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        permissions: ['*'],
        role: 'admin',
        username: 'admin'
      };
    }

    // Helper to create director token payload (room owner)
    function createDirectorPayload() {
      return {
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        permissions: [],
        role: 'director',
        username: 'director'
      };
    }

    // Helper to create non-owner user payload
    function createNonOwnerPayload() {
      return {
        tokenId: 'test-token-nonowner',
        type: 'admin_token',
        roomId: null,
        userId: 'user-003',
        permissions: [],
        role: 'director',
        username: 'nonowner'
      };
    }

    beforeEach(async () => {
      jest.clearAllMocks();

      // Set required environment variables
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
      process.env.TOKEN_SECRET = 'test-secret';
      process.env.CSRF_SECRET = 'csrf-secret';
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

      // Create mock database
      mockDb = {
        initialize: jest.fn().mockResolvedValue(),
        shutdown: jest.fn().mockResolvedValue(),
        query: jest.fn().mockResolvedValue([]),
        queryOne: jest.fn(),
        getAllUsers: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn(),
        getUserByUsername: jest.fn(),
        getRole: jest.fn().mockResolvedValue({ name: 'admin', hierarchy: 100 }),
        getRolePermissions: jest.fn().mockResolvedValue([]),
        insertUser: jest.fn(),
        updateUserRole: jest.fn(),
        deleteUser: jest.fn()
      };

      // Create mock Redis
      mockRedis = {
        connect: jest.fn().mockResolvedValue(),
        disconnect: jest.fn().mockResolvedValue(),
        isReady: jest.fn().mockReturnValue(false),
        getJson: jest.fn().mockResolvedValue(null),
        setJson: jest.fn().mockResolvedValue(),
        del: jest.fn().mockResolvedValue(),
        invalidate: jest.fn().mockResolvedValue()
      };

      // Mock RedisClient constructor
      const RedisClient = require('../src/RedisClient');
      RedisClient.mockImplementation(() => mockRedis);

      // Create instances
      roomManager = new RoomManager();
      rbacManager = new RBACManager(mockDb, mockRedis);
      userManager = new UserManager(mockDb, rbacManager, mockRedis);
      tokenManager = new TokenManager(mockDb, mockRedis);

      // Create test room owned by user-002
      const testRoom = roomManager.createRoom({
        password: null,
        maxParticipants: 10,
        quality: '720p',
        codec: 'H264',
        ownerId: 'user-002'
      });
      testRoomId = testRoom.id;

      // Mock signaling handler
      mockSignalingHandler = {
        broadcastRoomSettings: jest.fn()
      };

      // Create express app
      app = express();
      app.use(express.json());
      app.use(cookieParser());

      // Mock CSRF protection (bypass for testing)
      const doubleCsrfProtection = (req, res, next) => {
        next();
      };

      // Mock requireAuth wrapper
      const requireAuth = () => {
        return (req, res, next) => {
          const token = req.cookies.jwt;
          if (!token) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
          }

          try {
            const decoded = jwt.verify(token, 'test-secret');
            req.user = decoded;
            next();
          } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
          }
        };
      };

      // Attach managers to app.locals
      app.locals.rbacManager = rbacManager;
      app.locals.userManager = userManager;
      app.locals.roomManager = roomManager;
      app.locals.signalingHandler = mockSignalingHandler;

      // Add the route
      app.put('/api/rooms/:roomId/settings', doubleCsrfProtection, requireAuth(), async (req, res) => {
        const user = req.user;
        const { roomId } = req.params;

        const room = roomManager.getRoom(roomId);
        if (!room) {
          return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Check ownership or admin
        if (user.role !== 'admin' && room.ownerId !== user.id) {
          return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        const { quality, codec, maxParticipants } = req.body;
        const updates = {};

        if (quality && ['720p', '1080p', 'original'].includes(quality)) {
          updates.quality = quality;
        }
        if (codec && ['H264', 'H265', 'VP8', 'VP9'].includes(codec)) {
          updates.codec = codec;
        }
        if (maxParticipants && typeof maxParticipants === 'number' && maxParticipants > 0) {
          updates.maxParticipants = maxParticipants;
        }

        // Update room settings
        Object.assign(room, updates);

        // Notify all participants in the room about settings change
        mockSignalingHandler.broadcastRoomSettings(roomId, {
          quality: room.quality,
          codec: room.codec,
          maxParticipants: room.maxParticipants
        });

        res.json({
          success: true,
          room: {
            id: room.id,
            quality: room.quality,
            codec: room.codec,
            maxParticipants: room.maxParticipants
          }
        });
      });
    });

    afterEach(async () => {
      jest.clearAllMocks();
    });

    test('should return 401 for unauthenticated requests', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRoomId}/settings`)
        .send({ quality: '1080p' })
        .expect(401);

      expect(response.body).toEqual({
        success: false,
        error: 'Unauthorized'
      });
    });

    test('should update settings when user is owner', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-director',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        id: 'user-002',  // Required for route's user.id check
        permissions: [],
        role: 'director',
        username: 'director',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .put(`/api/rooms/${testRoomId}/settings`)
        .set('Cookie', [`jwt=${token}`])
        .send({
          quality: '1080p',
          codec: 'VP9',
          maxParticipants: 15
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.room.quality).toBe('1080p');
      expect(response.body.room.codec).toBe('VP9');
      expect(response.body.room.maxParticipants).toBe(15);

      // Verify room was updated
      const updatedRoom = roomManager.getRoom(testRoomId);
      expect(updatedRoom.quality).toBe('1080p');
      expect(updatedRoom.codec).toBe('VP9');
      expect(updatedRoom.maxParticipants).toBe(15);

      // Verify broadcast was called
      expect(mockSignalingHandler.broadcastRoomSettings).toHaveBeenCalledWith(testRoomId, expect.any(Object));
    });

    test('should update settings when user is admin', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        id: 'user-001',  // Required for route's user.id check
        permissions: ['*'],
        role: 'admin',
        username: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .put(`/api/rooms/${testRoomId}/settings`)
        .set('Cookie', [`jwt=${token}`])
        .send({
          quality: 'original',
          codec: 'H265'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.room.quality).toBe('original');
      expect(response.body.room.codec).toBe('H265');

      // Verify room was updated
      const updatedRoom = roomManager.getRoom(testRoomId);
      expect(updatedRoom.quality).toBe('original');
      expect(updatedRoom.codec).toBe('H265');
    });

    test('should return 403 when user is not owner', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-nonowner',
        type: 'admin_token',
        roomId: null,
        userId: 'user-003',
        id: 'user-003',  // Required for route's user.id check
        permissions: [],
        role: 'director',
        username: 'nonowner',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .put(`/api/rooms/${testRoomId}/settings`)
        .set('Cookie', [`jwt=${token}`])
        .send({ quality: '1080p' })
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: 'Not authorized'
      });

      // Verify room was not updated
      const room = roomManager.getRoom(testRoomId);
      expect(room.quality).toBe('720p');
    });

    test('should return 404 for non-existent room', async () => {
      // Use jwt.sign directly - jwt.verify will decode the token properly
      const token = jwt.sign({
        tokenId: 'test-token-admin',
        type: 'admin_token',
        roomId: null,
        userId: 'user-001',
        id: 'user-001',  // Required for route's user.id check
        permissions: ['*'],
        role: 'admin',
        username: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, 'test-secret');

      const response = await request(app)
        .put('/api/rooms/non-existent-room/settings')
        .set('Cookie', [`jwt=${token}`])
        .send({ quality: '1080p' })
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'Room not found'
      });
    });
  });
});
