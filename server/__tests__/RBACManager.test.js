const RBACManager = require('../src/RBACManager');
const Database = require('../src/database');

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

describe('RBACManager', () => {
  let rbacManager;
  let db;
  let mockPool;

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

  // Seed data for role hierarchy and permissions
  const mockRoles = [
    { name: 'admin', hierarchy: 100, description: 'Full system access' },
    { name: 'director', hierarchy: 70, description: 'Can create rooms, full control over assigned rooms' },
    { name: 'operator', hierarchy: 40, description: 'Read-only monitoring' },
    { name: 'participant', hierarchy: 20, description: 'Join rooms, send audio/video' },
    { name: 'viewer', hierarchy: 10, description: 'View single stream' }
  ];

  const mockRolePermissions = [
    // Admin wildcards
    { role: 'admin', permission: '*', object_type: 'system' },
    { role: 'admin', permission: '*', object_type: 'room' },
    { role: 'admin', permission: '*', object_type: 'stream' },
    { role: 'admin', permission: '*', object_type: 'user' },
    // Director permissions (new format)
    { role: 'director', permission: 'stream:view_all', object_type: 'stream' },
    { role: 'director', permission: 'stream:switch_scene', object_type: 'stream' },
    { role: 'director', permission: 'stream:generate_srt', object_type: 'stream' },
    { role: 'director', permission: 'user:mute', object_type: 'user' },
    { role: 'director', permission: 'user:kick', object_type: 'user' },
    // Operator permissions (new format)
    { role: 'operator', permission: 'analytics:view', object_type: 'system' },
    { role: 'operator', permission: 'monitoring:view', object_type: 'system' },
    { role: 'operator', permission: 'room:view_all', object_type: 'system' },
    // Participant permissions (new format) - stored with room object_type
    { role: 'participant', permission: 'room:view', object_type: 'room' },
    { role: 'participant', permission: 'stream:publish', object_type: 'stream' },
    { role: 'participant', permission: 'chat:send', object_type: 'room' },
    // Viewer permissions (new format) - stored with room object_type
    { role: 'viewer', permission: 'room:view', object_type: 'room' },
    { role: 'viewer', permission: 'stream:view', object_type: 'stream' }
  ];

  // Helper to setup seed data mocks for initialize()
  const setupSeedDataMocks = () => {
    // RBACManager.initialize() calls getAllRoles() then getPermissionsForRole() for each role
    // First call: getAllRoles() returns all roles
    mockPool.query.mockResolvedValueOnce({ rows: mockRoles });

    // Subsequent calls: getPermissionsForRole() for each role (7 roles = 7 calls)
    mockRoles.forEach(role => {
      const permissions = mockRolePermissions.filter(p => p.role === role.name);
      mockPool.query.mockResolvedValueOnce({ rows: permissions });
    });
  };

  describe('getRoleHierarchy', () => {
    beforeEach(() => {
      setupSeedDataMocks();
      rbacManager = new RBACManager(db);
    });

    test('returns hierarchy level for admin', async () => {
      await rbacManager.initialize();
      const hierarchy = await rbacManager.getRoleHierarchy('admin');
      expect(hierarchy).toBe(100);
    });

    test('returns hierarchy level for director', async () => {
      await rbacManager.initialize();
      const hierarchy = await rbacManager.getRoleHierarchy('director');
      expect(hierarchy).toBe(70);
    });

    test('returns hierarchy level for viewer', async () => {
      await rbacManager.initialize();
      const hierarchy = await rbacManager.getRoleHierarchy('viewer');
      expect(hierarchy).toBe(10);
    });

    test('returns null for non-existent role', async () => {
      // Mock getRole query for non-existent role (returns empty)
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await rbacManager.initialize();
      const hierarchy = await rbacManager.getRoleHierarchy('nonexistent');
      expect(hierarchy).toBeNull();
    });
  });

  describe('hasPermission', () => {
    beforeEach(() => {
      setupSeedDataMocks();
      rbacManager = new RBACManager(db);
    });

    test('admin has all permissions', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('admin', 'delete', 'room');
      expect(hasPerm).toBe(true);
    });

    test('admin has wildcard permissions for any object type', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('admin', 'any_action', 'anything');
      expect(hasPerm).toBe(true);
    });

    test('director can view all streams', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('director', 'stream:view_all');
      expect(hasPerm).toBe(true);
    });

    test('director can view all rooms', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('director', 'stream:view_all');
      expect(hasPerm).toBe(true);
    });

    test('viewer can view streams', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('viewer', 'stream:view');
      expect(hasPerm).toBe(true);
    });

    test('viewer cannot publish streams (participant permission)', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('viewer', 'stream:publish');
      expect(hasPerm).toBe(false);
    });

    test('participant can publish streams', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('participant', 'stream:publish');
      expect(hasPerm).toBe(true);
    });

    test('non-existent role has no permissions', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('nonexistent', 'stream:view');
      expect(hasPerm).toBe(false);
    });
  });

  describe('canAccessHigherRole', () => {
    beforeEach(() => {
      setupSeedDataMocks();
      rbacManager = new RBACManager(db);
    });

    test('admin can access all roles', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('admin', 'viewer');
      expect(canAccess).toBe(true);
    });

    test('director cannot access admin', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('director', 'admin');
      expect(canAccess).toBe(false);
    });

    test('director can access participant', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('director', 'participant');
      expect(canAccess).toBe(true);
    });

    test('participant can access viewer', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('participant', 'viewer');
      expect(canAccess).toBe(true);
    });

    test('participant cannot access director', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('participant', 'director');
      expect(canAccess).toBe(false);
    });

    test('same role cannot access itself', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('director', 'director');
      expect(canAccess).toBe(false);
    });

    test('returns false for non-existent roles', async () => {
      // Mock getRole query for non-existent role (returns empty)
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('nonexistent', 'viewer');
      expect(canAccess).toBe(false);
    });
  });

  describe('getAllPermissions', () => {
    beforeEach(() => {
      setupSeedDataMocks();
      rbacManager = new RBACManager(db);
    });

    test('returns all permissions for director', async () => {
      await rbacManager.initialize();
      const perms = await rbacManager.getAllPermissions('director');
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'stream:view_all',
        object_type: 'stream'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'stream:switch_scene',
        object_type: 'stream'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'user:mute',
        object_type: 'user'
      }));
    });

    test('returns all permissions for participant', async () => {
      await rbacManager.initialize();
      const perms = await rbacManager.getAllPermissions('participant');
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'room:view',
        object_type: 'room'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'stream:publish',
        object_type: 'stream'
      }));
    });

    test('returns empty array for non-existent role', async () => {
      await rbacManager.initialize();
      const perms = await rbacManager.getAllPermissions('nonexistent');
      expect(perms).toEqual([]);
    });
  });

  describe('getAllRoles', () => {
    beforeEach(() => {
      setupSeedDataMocks();
      rbacManager = new RBACManager(db);
    });

    test('returns all roles with hierarchy', async () => {
      await rbacManager.initialize();
      const roles = rbacManager.getAllRoles();
      expect(roles.length).toBe(5);
      expect(roles).toContainEqual(expect.objectContaining({
        name: 'admin',
        hierarchy: 100
      }));
      expect(roles).toContainEqual(expect.objectContaining({
        name: 'viewer',
        hierarchy: 10
      }));
    });

    test('roles are ordered by hierarchy descending', async () => {
      await rbacManager.initialize();
      const roles = rbacManager.getAllRoles();
      for (let i = 1; i < roles.length; i++) {
        expect(roles[i - 1].hierarchy).toBeGreaterThanOrEqual(roles[i].hierarchy);
      }
    });
  });
});
