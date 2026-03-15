const Database = require('../src/database');
const RBACManager = require('../src/RBACManager');
const UserManager = require('../src/UserManager');

// Mock RedisClient
jest.mock('../src/RedisClient', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn().mockResolvedValue(),
    isReady: jest.fn().mockReturnValue(true),
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    invalidate: jest.fn().mockResolvedValue(0)
  }));
});

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

describe('UserManager', () => {
  let userManager;
  let db;
  let rbac;
  let mockPool;
  let mockClient;

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
  });

  afterEach(async () => {
    if (db && db.pool) {
      await db.shutdown();
    }
  });

  describe('createUser', () => {
    test('creates a new user with hashed password', async () => {
      // Set up responses for initialize() and createUser()
      // RBAC.initialize(): getAllRoles() -> getPermissionsForRole('participant')
      // UserManager.createUser(): getRole('participant'), getUserByUsername(), insertUser()
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ name: 'participant', hierarchy: 20 }] }) // getAllRoles for RBAC init
        .mockResolvedValueOnce({ rows: [] }) // getPermissionsForRole('participant')
        .mockResolvedValueOnce({ rows: [{ name: 'participant', hierarchy: 20 }] }) // getRole for createUser
        .mockResolvedValueOnce({ rows: [] }) // getUserByUsername
        .mockResolvedValueOnce({ rows: [] }); // insertUser

      rbac = new RBACManager(db, null);
      await rbac.initialize();

      userManager = new UserManager(db, rbac, null);
      await userManager.initialize();

      const user = await userManager.createUser({
        username: 'testuser',
        password: 'securepassword123',
        role: 'participant',
        displayName: 'Test User'
      });

      expect(user).toBeTruthy();
      expect(user.username).toBe('testuser');
      expect(user.role).toBe('participant');
    });

    test('throws error for duplicate username', async () => {
      // RBAC.initialize() + getRole + getUserByUsername (finds existing)
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ name: 'participant', hierarchy: 20 }] }) // getAllRoles
        .mockResolvedValueOnce({ rows: [] }) // getPermissionsForRole
        .mockResolvedValueOnce({ rows: [{ name: 'participant', hierarchy: 20 }] }) // getRole
        .mockResolvedValueOnce({ rows: [{ id: '1', username: 'duplicate' }] }); // getUserByUsername

      rbac = new RBACManager(db, null);
      await rbac.initialize();

      userManager = new UserManager(db, rbac, null);

      await expect(userManager.createUser({
        username: 'duplicate',
        password: 'password1',
        role: 'participant'
      })).rejects.toThrow('Username already exists');
    });

    test('throws error for invalid role', async () => {
      // RBAC.initialize() + getRole (returns empty)
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ name: 'participant', hierarchy: 20 }] }) // getAllRoles
        .mockResolvedValueOnce({ rows: [] }) // getPermissionsForRole
        .mockResolvedValueOnce({ rows: [] }); // getRole (not found)

      rbac = new RBACManager(db, null);
      await rbac.initialize();

      userManager = new UserManager(db, rbac, null);

      await expect(userManager.createUser({
        username: 'badrole',
        password: 'password1',
        role: 'nonexistent'
      })).rejects.toThrow('Invalid role');
    });
  });

  describe('authenticateUser', () => {
    test('authenticates valid credentials', async () => {
      const mockUser = {
        id: 'user-1',
        username: 'loginuser',
        password_hash: '$2b$12$KIXxwFoeZkNvO5W.8qWZu.dKqVzKcH1hZ0lXGZ1qK0lXGZ1qK0lXG',
        role: 'participant',
        display_name: 'Login User',
        email: null
      };

      // Mock bcrypt compare to return true
      const bcrypt = require('bcrypt');
      const originalCompare = bcrypt.compare;
      bcrypt.compare = jest.fn().mockResolvedValue(true);

      // RBAC.initialize() + getUserByUsername
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ name: 'participant', hierarchy: 20 }] }) // getAllRoles
        .mockResolvedValueOnce({ rows: [] }) // getPermissionsForRole
        .mockResolvedValueOnce({ rows: [mockUser] }); // getUserByUsername

      rbac = new RBACManager(db, null);
      await rbac.initialize();

      userManager = new UserManager(db, rbac, null);

      const result = await userManager.authenticateUser('loginuser', 'correctpassword');
      expect(result.success).toBe(true);
      expect(result.user.username).toBe('loginuser');

      // Restore bcrypt
      bcrypt.compare = originalCompare;
    });

    test('rejects wrong password', async () => {
      const mockUser = {
        id: 'user-1',
        username: 'loginuser',
        password_hash: '$2b$12$KIXxwFoeZkNvO5W.8qWZu.dKqVzKcH1hZ0lXGZ1qK0lXGZ1qK0lXG',
        role: 'participant',
        display_name: 'Login User',
        email: null
      };

      // Mock bcrypt compare to return false
      const bcrypt = require('bcrypt');
      const originalCompare = bcrypt.compare;
      bcrypt.compare = jest.fn().mockResolvedValue(false);

      // RBAC.initialize() + getUserByUsername
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ name: 'participant', hierarchy: 20 }] }) // getAllRoles
        .mockResolvedValueOnce({ rows: [] }) // getPermissionsForRole
        .mockResolvedValueOnce({ rows: [mockUser] }); // getUserByUsername

      rbac = new RBACManager(db, null);
      await rbac.initialize();

      userManager = new UserManager(db, rbac, null);

      const result = await userManager.authenticateUser('loginuser', 'wrongpassword');
      expect(result.success).toBe(false);

      // Restore bcrypt
      bcrypt.compare = originalCompare;
    });
  });
});
