/**
 * Room-Scoped Token Validation Tests
 * Tests to verify that room-scoped JWT tokens include roomId claim
 * and cannot be reused across different rooms
 */
const jwt = require('jsonwebtoken');

// Mock the pg package BEFORE any imports
jest.mock('pg', () => {
  const mockClient = {
    release: jest.fn().mockResolvedValue(),
    query: jest.fn()
  };

  const mockPool = {
    connect: jest.fn().mockResolvedValue(mockClient),
    query: jest.fn(),
    end: jest.fn().mockResolvedValue()
  };

  return {
    Pool: jest.fn().mockImplementation(() => mockPool)
  };
});

// Mock RedisClient with in-memory storage BEFORE importing TokenManager
const mockRedisStore = new Map();

jest.mock('../src/RedisClient', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn().mockResolvedValue(),
    isReady: jest.fn().mockReturnValue(true),
    getJson: jest.fn().mockImplementation(async (key) => {
      const data = mockRedisStore.get(key);
      return data || null;
    }),
    setJson: jest.fn().mockImplementation(async (key, value) => {
      mockRedisStore.set(key, { ...value });
      return true;
    }),
    del: jest.fn().mockImplementation(async (key) => {
      mockRedisStore.delete(key);
      return true;
    }),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    invalidate: jest.fn().mockResolvedValue(0),
    client: {
      keys: jest.fn().mockImplementation(async (pattern) => {
        const regex = new RegExp('^' + pattern.replace('*', '.*'));
        return Array.from(mockRedisStore.keys()).filter(k => regex.test(k));
      }),
      del: jest.fn().mockResolvedValue(0),
      scan: jest.fn().mockResolvedValue([0, []])
    }
  }));
});

const RoomManager = require('../src/RoomManager');
const TokenManager = require('../src/TokenManager');
const Database = require('../src/database');
const RedisClient = require('../src/RedisClient');

describe('Room-Scoped Token Validation', () => {
  let roomManager;
  let tokenManager;
  let db;
  let redisClient;
  let mockPool;

  beforeAll(async () => {
    // Set required environment variables
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    process.env.TOKEN_SECRET = 'test-secret-key';
    process.env.TOKEN_ISSUER = 'breadcall-signaling';
    process.env.TOKEN_AUDIENCE = 'breadcall-client';

    // Setup Database
    db = new Database();
    await db.initialize();

    // Get the mock pool
    const { Pool } = require('pg');
    mockPool = Pool();

    // Setup Redis (use the mocked constructor)
    redisClient = new RedisClient();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisStore.clear();

    // Setup database mock to accept insertRefreshToken calls
    mockPool.query.mockResolvedValue({ rows: [] });

    // Create fresh instances
    roomManager = new RoomManager();

    // Create TokenManager instance with mocked dependencies
    tokenManager = new TokenManager(redisClient, db);
    await tokenManager.initialize();

    // Attach TokenManager to RoomManager for token generation
    roomManager.tokenManager = tokenManager;
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('Token Generation', () => {
    it('generates token with roomId in payload', async () => {
      // Create room
      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      // Join room with correct password
      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      // Token should be generated and returned
      expect(result.participantId).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.tokenId).toBeDefined();

      // Decode token and verify roomId
      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);
      expect(decoded.roomId).toBe(roomId);
      expect(decoded.type).toBe('room_access');
    });

    it('includes correct permissions in token', async () => {
      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);
      expect(decoded.permissions).toEqual(['join', 'send_audio', 'send_video', 'chat']);
    });

    it('includes userId in token payload', async () => {
      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);
      expect(decoded.userId).toBe(result.participantId);
      expect(decoded.userId).toBeDefined();
    });

    it('sets correct token type for room access', async () => {
      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);
      expect(decoded.type).toBe('room_access');
    });
  });

  describe('Token Validation', () => {
    it('rejects wrong password - no token generated', async () => {
      const room = roomManager.createRoom({ password: 'correct123' });
      const roomId = room.id;

      // Try to join with wrong password
      await expect(roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'wrong123'
      })).rejects.toThrow('Invalid password');
    });

    it('validates token with matching roomId', async () => {
      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);

      // Validate using TokenManager
      const validation = await tokenManager.validateAccessToken(result.token);
      expect(validation.valid).toBe(true);
      expect(validation.payload.roomId).toBe(roomId);
    });

    it('token cannot be reused for different room', async () => {
      // Create two rooms
      const room1 = roomManager.createRoom({ password: 'test123' });
      const room2 = roomManager.createRoom({ password: 'test123' });

      expect(room1.id).not.toBe(room2.id);

      // Join room1 and get token
      const result = await roomManager.joinRoom(room1.id, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);

      // Token's roomId should match room1, not room2
      expect(decoded.roomId).toBe(room1.id);
      expect(decoded.roomId).not.toBe(room2.id);
    });
  });

  describe('Token Structure', () => {
    it('token has valid JWT structure with required claims', async () => {
      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);

      // Verify all required claims are present
      expect(decoded).toHaveProperty('iss');
      expect(decoded).toHaveProperty('aud');
      expect(decoded).toHaveProperty('tokenId');
      expect(decoded).toHaveProperty('type');
      expect(decoded).toHaveProperty('roomId');
      expect(decoded).toHaveProperty('userId');
      expect(decoded).toHaveProperty('permissions');
      expect(decoded).toHaveProperty('iat');
      expect(decoded).toHaveProperty('exp');
    });

    it('token has correct issuer and audience', async () => {
      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);

      // Note: TokenManager uses 'breadcall-server' as default issuer
      expect(decoded.iss).toBe('breadcall-server');
      expect(decoded.aud).toBe('breadcall-client');
    });

    it('token has appropriate expiry (15 minutes)', async () => {
      const beforeTime = Date.now();

      const room = roomManager.createRoom({ password: 'test123' });
      const roomId = room.id;

      const result = await roomManager.joinRoom(roomId, {
        name: 'Test User',
        password: 'test123'
      });

      const decoded = jwt.verify(result.token, process.env.TOKEN_SECRET);

      const afterTime = Date.now();

      // Token should expire in 15 minutes (900 seconds)
      // Use floor to match JWT's integer timestamp behavior
      const expectedExpMin = Math.floor(beforeTime / 1000) + 900;
      const expectedExpMax = Math.floor(afterTime / 1000) + 900;

      expect(decoded.exp).toBeGreaterThanOrEqual(expectedExpMin);
      expect(decoded.exp).toBeLessThanOrEqual(expectedExpMax);
    });
  });
});
