const AuthMiddleware = require('../src/AuthMiddleware');
const Database = require('../src/database');
const RBACManager = require('../src/RBACManager');
const crypto = require('crypto');

// Mock the pg package
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

// Mock TokenManager to avoid Redis dependency in tests
class MockTokenManager {
  constructor() {
    this.tokens = new Map();
  }

  async initialize() {
    console.log('[MockTokenManager] Initialized');
  }

  _generateAccessToken(payload, expiresAt) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(expiresAt / 1000) })).toString('base64url');
    const signature = crypto.createHmac('sha256', 'test-secret').update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  async validateAccessToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, reason: 'invalid format' };
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return { valid: false, reason: 'expired' };
      }
      return { valid: true, payload };
    } catch (e) {
      return { valid: false, reason: 'invalid token' };
    }
  }
}

describe('AuthMiddleware', () => {
  let authMiddleware;
  let db;
  let rbac;
  let tokenManager;
  let mockPool;

  // Mock data for roles and permissions
  const mockRoles = [
    { name: 'super_admin', hierarchy: 100, description: 'Full system access' },
    { name: 'room_admin', hierarchy: 80, description: 'Create and manage own rooms' },
    { name: 'moderator', hierarchy: 60, description: 'Manage participants in assigned rooms' },
    { name: 'participant', hierarchy: 20, description: 'Join rooms, send audio/video' }
  ];

  const mockRolePermissions = [
    { role: 'super_admin', permission: '*', object_type: 'system' },
    { role: 'super_admin', permission: '*', object_type: 'room' },
    { role: 'super_admin', permission: '*', object_type: 'stream' },
    { role: 'super_admin', permission: '*', object_type: 'user' },
    { role: 'participant', permission: 'join', object_type: 'room' },
    { role: 'participant', permission: 'send_audio', object_type: 'room' },
    { role: 'participant', permission: 'send_video', object_type: 'room' }
  ];

  // Mock users
  const mockUsers = [
    { id: 'user-super-admin', username: 'superadmin', password_hash: 'hash', role: 'super_admin', display_name: 'Super Admin', email: null },
    { id: 'user-participant', username: 'participant', password_hash: 'hash', role: 'participant', display_name: 'Participant', email: null }
  ];

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set DATABASE_URL for initialization
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

    // Create Database instance and initialize it
    db = new Database();
    await db.initialize();

    // Get the mock pool from the Pool constructor
    const { Pool } = require('pg');
    mockPool = Pool();

    // Setup RBAC seed data mocks
    // RBAC.initialize() calls getAllRoles() then getPermissionsForRole() for each role
    mockPool.query.mockResolvedValueOnce({ rows: mockRoles });
    mockRoles.forEach(role => {
      const permissions = mockRolePermissions.filter(p => p.role === role.name);
      mockPool.query.mockResolvedValueOnce({ rows: permissions });
    });

    // Mock getUserByUsername and getUserById calls - return appropriate user based on query
    mockPool.query.mockImplementation((query, params) => {
      if (query && query.includes('SELECT * FROM users WHERE username =')) {
        const username = params[0];
        const user = mockUsers.find(u => u.username === username);
        return Promise.resolve({ rows: user ? [user] : [] });
      }
      if (query && query.includes('SELECT * FROM users WHERE id =')) {
        const userId = params[0];
        const user = mockUsers.find(u => u.id === userId);
        return Promise.resolve({ rows: user ? [user] : [] });
      }
      return Promise.resolve({ rows: [] });
    });

    rbac = new RBACManager(db);
    await rbac.initialize();

    tokenManager = new MockTokenManager();
    await tokenManager.initialize();

    authMiddleware = new AuthMiddleware(db, rbac, tokenManager);
  });

  afterEach(async () => {
    if (db && db.pool) {
      await db.shutdown();
    }
  });

  describe('authenticate', () => {
    test('returns not authenticated when no token provided', async () => {
      const req = { headers: {} };
      const result = await authMiddleware.authenticate(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('No token provided');
    });

    test('returns not authenticated when token format is invalid', async () => {
      const req = { headers: { authorization: 'InvalidFormat' } };
      const result = await authMiddleware.authenticate(req);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('No token provided');
    });

    test('returns not authenticated when token is expired', async () => {
      const token = tokenManager._generateAccessToken({
        tokenId: 'expired_token',
        type: 'admin_token',
        roomId: 'ROOM1',
        userId: 'user1',
        permissions: ['*']
      }, Date.now() - 10000);

      const req = { headers: { authorization: `Bearer ${token}` } };
      const result = await authMiddleware.authenticate(req);
      expect(result.authenticated).toBe(false);
    });

    test('authenticates valid token', async () => {
      const token = tokenManager._generateAccessToken({
        tokenId: 'valid_token',
        type: 'admin_token',
        roomId: 'ROOM1',
        userId: 'user-super-admin',
        permissions: ['*']
      }, Date.now());

      const req = { headers: { authorization: `Bearer ${token}` } };
      const result = await authMiddleware.authenticate(req);
      expect(result.authenticated).toBe(true);
      expect(result.user).toBeTruthy();
    });
  });

  describe('requireAuth', () => {
    test('returns 401 when not authenticated', async () => {
      const middleware = authMiddleware.requireAuth();
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('Unauthorized')
      }));
    });

    test('calls next when authenticated', async () => {
      const token = tokenManager._generateAccessToken({
        tokenId: 'valid_token_2',
        type: 'admin_token',
        roomId: 'ROOM1',
        userId: 'user-super-admin',
        permissions: ['*']
      }, Date.now());

      const middleware = authMiddleware.requireAuth();
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await middleware(req, res, next);

      expect(req.user).toBeTruthy();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('requirePermission', () => {
    test('returns 401 when user not authenticated', async () => {
      const middleware = authMiddleware.requirePermission('create', 'room');
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('returns 403 when user lacks permission', async () => {
      const middleware = authMiddleware.requirePermission('delete', 'room');
      const req = {
        headers: {},
        user: { role: 'participant' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('Forbidden')
      }));
    });

    test('calls next when user has permission', async () => {
      const middleware = authMiddleware.requirePermission('join', 'room');
      const req = {
        headers: {},
        user: { role: 'participant' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
