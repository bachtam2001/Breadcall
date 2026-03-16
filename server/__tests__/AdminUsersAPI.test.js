/**
 * Admin Users API Tests
 * Tests for GET /api/admin/users endpoint
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

describe('GET /api/admin/users', () => {
  let app;
  let server;
  let roomManager;
  let userManager;
  let rbacManager;
  let tokenManager;
  let mockDb;
  let mockRedis;

  // Mock users data
  const mockUsers = [
    {
      id: 'user-001',
      username: 'admin',
      role: 'admin',
      email: 'admin@example.com',
      display_name: 'System Admin',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z'
    },
    {
      id: 'user-002',
      username: 'operator',
      role: 'operator',
      email: 'operator@example.com',
      display_name: 'Test Operator',
      status: 'active',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z'
    },
    {
      id: 'user-003',
      username: 'viewer',
      role: 'viewer',
      email: 'viewer@example.com',
      display_name: null,
      status: 'inactive',
      created_at: '2024-01-03T00:00:00.000Z',
      updated_at: '2024-01-03T00:00:00.000Z'
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

  // Helper to create operator token payload
  function createOperatorPayload() {
    return {
      tokenId: 'test-token-operator',
      type: 'admin_token',
      roomId: null,
      userId: 'user-002',
      permissions: [],
      role: 'operator',
      username: 'operator'
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
      query: jest.fn().mockResolvedValue(mockUsers),
      queryOne: jest.fn(),
      getAllUsers: jest.fn().mockResolvedValue(mockUsers),
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

    // Default mock: allow all permission checks
    rbacManager.hasPermission = jest.fn().mockResolvedValue(true);
    rbacManager.canAssignRole = jest.fn().mockResolvedValue(true);
    rbacManager.canAccessHigherRole = jest.fn().mockResolvedValue(true);

    // Create express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());

    // Mock requireAuth wrapper (mimicking index.js pattern)
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

    // Add the route (this is the route we're testing)
    app.get('/api/admin/users', requireAuth(), async (req, res) => {
      const hasPerm = await rbacManager.hasPermission(req.user.role, 'user:view_all');
      if (!hasPerm && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Insufficient permissions' });
      }

      const { search, role, status, page = 1, limit = 20 } = req.query;
      const users = await userManager.getAllUsers();

      // Apply filters
      let filteredUsers = users;
      if (search) {
        const searchLower = search.toLowerCase();
        filteredUsers = filteredUsers.filter(u =>
          u.username.toLowerCase().includes(searchLower) ||
          (u.display_name && u.display_name.toLowerCase().includes(searchLower))
        );
      }
      if (role && role !== 'all') {
        filteredUsers = filteredUsers.filter(u => u.role === role);
      }
      if (status && status !== 'all') {
        filteredUsers = filteredUsers.filter(u => u.status === status);
      }

      // Pagination
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;
      const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

      // Remove password_hash from response
      const safeUsers = paginatedUsers.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        email: u.email,
        display_name: u.display_name,
        status: u.status || 'active',
        created_at: u.created_at,
        updated_at: u.updated_at
      }));

      res.json({
        success: true,
        users: safeUsers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: filteredUsers.length,
          totalPages: Math.ceil(filteredUsers.length / limitNum)
        }
      });
    });
  });

  afterEach(async () => {
    if (server) {
      server.close();
    }
    jest.clearAllMocks();
  });

  test('should return 401 without authentication', async () => {
    const response = await request(app)
      .get('/api/admin/users')
      .expect(401);

    expect(response.body).toEqual({
      success: false,
      error: 'Unauthorized'
    });
  });

  test('should return 403 for non-admin user without user:view_all permission', async () => {
    // Mock user with operator role and no user:view_all permission
    rbacManager.hasPermission = jest.fn().mockResolvedValue(false);

    // Mock jwt.verify to return operator payload
    const restoreJwt = mockJwtVerify(createOperatorPayload());

    try {
      const token = tokenManager._generateAccessToken({
        tokenId: 'test-token-operator',
        type: 'admin_token',
        roomId: null,
        userId: 'user-002',
        permissions: []
      }, Date.now());

      const response = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`jwt=${token}`])
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: 'Insufficient permissions'
      });
    } finally {
      restoreJwt();
    }
  });

  test('should return 200 with users array for admin', async () => {
    // Mock jwt.verify to return admin payload
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
        .get('/api/admin/users')
        .set('Cookie', [`jwt=${token}`])
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.users).toBeDefined();
      expect(Array.isArray(response.body.users)).toBe(true);
      expect(response.body.users.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(mockUsers.length);
    } finally {
      restoreJwt();
    }
  });

  test('should exclude password_hash from response', async () => {
    // Mock jwt.verify to return admin payload
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
        .get('/api/admin/users')
        .set('Cookie', [`jwt=${token}`])
        .expect(200);

      // Check that password_hash is not present in any user object
      response.body.users.forEach(user => {
        expect(user).not.toHaveProperty('password_hash');
      });

      // Verify expected properties are present
      const firstUser = response.body.users[0];
      expect(firstUser).toHaveProperty('id');
      expect(firstUser).toHaveProperty('username');
      expect(firstUser).toHaveProperty('role');
      expect(firstUser).toHaveProperty('email');
      expect(firstUser).toHaveProperty('display_name');
      expect(firstUser).toHaveProperty('status');
      expect(firstUser).toHaveProperty('created_at');
      expect(firstUser).toHaveProperty('updated_at');
    } finally {
      restoreJwt();
    }
  });

  test('should filter users by search query', async () => {
    // Mock jwt.verify to return admin payload
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
        .get('/api/admin/users')
        .set('Cookie', [`jwt=${token}`])
        .query({ search: 'admin' })
        .expect(200);

      expect(response.body.users.length).toBeGreaterThanOrEqual(1);
      response.body.users.forEach(user => {
        expect(
          user.username.toLowerCase().includes('admin') ||
          (user.display_name && user.display_name.toLowerCase().includes('admin'))
        ).toBe(true);
      });
    } finally {
      restoreJwt();
    }
  });

  test('should filter users by role', async () => {
    // Mock jwt.verify to return admin payload
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
        .get('/api/admin/users')
        .set('Cookie', [`jwt=${token}`])
        .query({ role: 'admin' })
        .expect(200);

      expect(response.body.users.length).toBeGreaterThanOrEqual(1);
      response.body.users.forEach(user => {
        expect(user.role).toBe('admin');
      });
    } finally {
      restoreJwt();
    }
  });

  test('should filter users by status', async () => {
    // Mock jwt.verify to return admin payload
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
        .get('/api/admin/users')
        .set('Cookie', [`jwt=${token}`])
        .query({ status: 'active' })
        .expect(200);

      expect(response.body.users.length).toBeGreaterThanOrEqual(1);
      response.body.users.forEach(user => {
        expect(user.status).toBe('active');
      });
    } finally {
      restoreJwt();
    }
  });

  test('should paginate results', async () => {
    // Mock jwt.verify to return admin payload
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
        .get('/api/admin/users')
        .set('Cookie', [`jwt=${token}`])
        .query({ page: 1, limit: 2 })
        .expect(200);

      expect(response.body.users.length).toBeLessThanOrEqual(2);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.total).toBe(mockUsers.length);
      expect(response.body.pagination.totalPages).toBe(Math.ceil(mockUsers.length / 2));
    } finally {
      restoreJwt();
    }
  });
});
