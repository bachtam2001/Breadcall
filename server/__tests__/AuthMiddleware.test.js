const AuthMiddleware = require('../src/AuthMiddleware');
const Database = require('../src/database');
const RBACManager = require('../src/RBACManager');
const crypto = require('crypto');

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

  beforeAll(async () => {
    db = new Database(':memory:');
    await db.initialize();

    await db.db.exec(`
      INSERT INTO roles (name, hierarchy, description) VALUES
        ('super_admin', 100, 'Full system access'),
        ('room_admin', 80, 'Create and manage own rooms'),
        ('moderator', 60, 'Manage participants in assigned rooms'),
        ('participant', 20, 'Join rooms, send audio/video');

      INSERT INTO role_permissions (role, permission, object_type) VALUES
        ('super_admin', '*', 'system'),
        ('super_admin', '*', 'room'),
        ('super_admin', '*', 'stream'),
        ('super_admin', '*', 'user'),
        ('participant', 'join', 'room'),
        ('participant', 'send_audio', 'room'),
        ('participant', 'send_video', 'room');
    `);

    // Create test users
    await db.db.exec(`
      INSERT INTO users (id, username, password_hash, role, display_name) VALUES
        ('user-super-admin', 'superadmin', 'hash', 'super_admin', 'Super Admin'),
        ('user-participant', 'participant', 'hash', 'participant', 'Participant');
    `);

    rbac = new RBACManager(db);
    await rbac.initialize();

    tokenManager = new MockTokenManager();
    await tokenManager.initialize();

    authMiddleware = new AuthMiddleware(db, rbac, tokenManager);
  });

  afterAll(async () => {
    if (db) await db.close();
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
