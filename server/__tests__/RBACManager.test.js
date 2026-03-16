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
    { name: 'room_admin', hierarchy: 80, description: 'Create and manage own rooms' },
    { name: 'moderator', hierarchy: 60, description: 'Manage participants in assigned rooms' },
    { name: 'director', hierarchy: 50, description: 'View and control streams' },
    { name: 'operator', hierarchy: 40, description: 'Read-only monitoring' },
    { name: 'participant', hierarchy: 20, description: 'Join rooms, send audio/video' },
    { name: 'viewer', hierarchy: 10, description: 'View single stream' }
  ];

  const mockRolePermissions = [
    // Super admin wildcards
    { role: 'admin', permission: '*', object_type: 'system' },
    { role: 'admin', permission: '*', object_type: 'room' },
    { role: 'admin', permission: '*', object_type: 'stream' },
    { role: 'admin', permission: '*', object_type: 'user' },
    // Room admin permissions (new format)
    { role: 'room_admin', permission: 'room:create', object_type: 'system' },
    { role: 'room_admin', permission: 'room:delete', object_type: 'system' },
    { role: 'room_admin', permission: 'room:update', object_type: 'system' },
    { role: 'room_admin', permission: 'room:assign_director', object_type: 'system' },
    { role: 'room_admin', permission: 'user:manage_roles', object_type: 'system' },
    // Moderator permissions (new format)
    { role: 'moderator', permission: 'user:mute', object_type: 'user' },
    { role: 'moderator', permission: 'user:kick', object_type: 'user' },
    { role: 'moderator', permission: 'chat:moderate', object_type: 'room' },
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

    test('returns hierarchy level for room_admin', async () => {
      await rbacManager.initialize();
      const hierarchy = await rbacManager.getRoleHierarchy('room_admin');
      expect(hierarchy).toBe(80);
    });

    test('returns hierarchy level for moderator', async () => {
      await rbacManager.initialize();
      const hierarchy = await rbacManager.getRoleHierarchy('moderator');
      expect(hierarchy).toBe(60);
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

    test('room_admin can create rooms', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('room_admin', 'room:create');
      expect(hasPerm).toBe(true);
    });

    test('room_admin can delete rooms', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('room_admin', 'room:delete');
      expect(hasPerm).toBe(true);
    });

    test('room_admin cannot mute (moderator permission)', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('room_admin', 'user:mute');
      expect(hasPerm).toBe(false);
    });

    test('moderator can mute participants', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('moderator', 'user:mute');
      expect(hasPerm).toBe(true);
    });

    test('moderator can kick participants', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('moderator', 'user:kick');
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

    test('admin can access room_admin', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('admin', 'room_admin');
      expect(canAccess).toBe(true);
    });

    test('room_admin cannot access admin', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('room_admin', 'admin');
      expect(canAccess).toBe(false);
    });

    test('room_admin can access moderator', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('room_admin', 'moderator');
      expect(canAccess).toBe(true);
    });

    test('moderator can access viewer', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('moderator', 'viewer');
      expect(canAccess).toBe(true);
    });

    test('moderator cannot access room_admin', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('moderator', 'room_admin');
      expect(canAccess).toBe(false);
    });

    test('same role cannot access itself', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('moderator', 'moderator');
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

    test('returns all permissions for room_admin', async () => {
      await rbacManager.initialize();
      const perms = await rbacManager.getAllPermissions('room_admin');
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'room:create',
        object_type: 'system'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'room:delete',
        object_type: 'system'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'room:assign_director',
        object_type: 'system'
      }));
    });

    test('returns all permissions for moderator', async () => {
      await rbacManager.initialize();
      const perms = await rbacManager.getAllPermissions('moderator');
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'user:mute',
        object_type: 'user'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'user:kick',
        object_type: 'user'
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
      expect(roles.length).toBe(7);
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
