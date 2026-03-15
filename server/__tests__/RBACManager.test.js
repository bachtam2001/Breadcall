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
    { name: 'super_admin', hierarchy: 100, description: 'Full system access' },
    { name: 'room_admin', hierarchy: 80, description: 'Create and manage own rooms' },
    { name: 'moderator', hierarchy: 60, description: 'Manage participants in assigned rooms' },
    { name: 'director', hierarchy: 50, description: 'View and control streams' },
    { name: 'operator', hierarchy: 40, description: 'Read-only monitoring' },
    { name: 'participant', hierarchy: 20, description: 'Join rooms, send audio/video' },
    { name: 'viewer', hierarchy: 10, description: 'View single stream' }
  ];

  const mockRolePermissions = [
    { role: 'super_admin', permission: '*', object_type: 'system' },
    { role: 'super_admin', permission: '*', object_type: 'room' },
    { role: 'super_admin', permission: '*', object_type: 'stream' },
    { role: 'super_admin', permission: '*', object_type: 'user' },
    { role: 'room_admin', permission: 'create', object_type: 'room' },
    { role: 'room_admin', permission: 'delete', object_type: 'room' },
    { role: 'room_admin', permission: 'update', object_type: 'room' },
    { role: 'room_admin', permission: 'assign', object_type: 'room' },
    { role: 'room_admin', permission: 'promote', object_type: 'user' },
    { role: 'moderator', permission: 'mute', object_type: 'room' },
    { role: 'moderator', permission: 'kick', object_type: 'room' },
    { role: 'moderator', permission: 'update_settings', object_type: 'room' },
    { role: 'director', permission: 'view_all', object_type: 'room' },
    { role: 'director', permission: 'switch_scenes', object_type: 'room' },
    { role: 'director', permission: 'generate_srt', object_type: 'room' },
    { role: 'operator', permission: 'view_analytics', object_type: 'system' },
    { role: 'operator', permission: 'view_monitoring', object_type: 'system' },
    { role: 'participant', permission: 'join', object_type: 'room' },
    { role: 'participant', permission: 'send_audio', object_type: 'room' },
    { role: 'participant', permission: 'send_video', object_type: 'room' },
    { role: 'participant', permission: 'chat', object_type: 'room' },
    { role: 'viewer', permission: 'view', object_type: 'stream' },
    { role: 'viewer', permission: 'generate_srt', object_type: 'stream' },
    { role: 'viewer', permission: 'view_solo', object_type: 'stream' }
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

    test('returns hierarchy level for super_admin', async () => {
      await rbacManager.initialize();
      const hierarchy = await rbacManager.getRoleHierarchy('super_admin');
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

    test('super_admin has all permissions', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('super_admin', 'delete', 'room');
      expect(hasPerm).toBe(true);
    });

    test('super_admin has wildcard permissions for any object type', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('super_admin', 'any_action', 'anything');
      expect(hasPerm).toBe(true);
    });

    test('room_admin can create rooms', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('room_admin', 'create', 'room');
      expect(hasPerm).toBe(true);
    });

    test('room_admin can delete rooms', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('room_admin', 'delete', 'room');
      expect(hasPerm).toBe(true);
    });

    test('room_admin cannot mute (moderator permission)', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('room_admin', 'mute', 'room');
      expect(hasPerm).toBe(false);
    });

    test('moderator can mute participants', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('moderator', 'mute', 'room');
      expect(hasPerm).toBe(true);
    });

    test('moderator can kick participants', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('moderator', 'kick', 'room');
      expect(hasPerm).toBe(true);
    });

    test('director can view all rooms', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('director', 'view_all', 'room');
      expect(hasPerm).toBe(true);
    });

    test('viewer can view streams', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('viewer', 'view', 'stream');
      expect(hasPerm).toBe(true);
    });

    test('viewer cannot join rooms (participant permission)', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('viewer', 'join', 'room');
      expect(hasPerm).toBe(false);
    });

    test('participant can join rooms', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('participant', 'join', 'room');
      expect(hasPerm).toBe(true);
    });

    test('non-existent role has no permissions', async () => {
      await rbacManager.initialize();
      const hasPerm = await rbacManager.hasPermission('nonexistent', 'view', 'stream');
      expect(hasPerm).toBe(false);
    });
  });

  describe('canAccessHigherRole', () => {
    beforeEach(() => {
      setupSeedDataMocks();
      rbacManager = new RBACManager(db);
    });

    test('super_admin can access all roles', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('super_admin', 'viewer');
      expect(canAccess).toBe(true);
    });

    test('super_admin can access room_admin', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('super_admin', 'room_admin');
      expect(canAccess).toBe(true);
    });

    test('room_admin cannot access super_admin', async () => {
      await rbacManager.initialize();
      const canAccess = await rbacManager.canAccessHigherRole('room_admin', 'super_admin');
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
        permission: 'create',
        object_type: 'room'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'delete',
        object_type: 'room'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'assign',
        object_type: 'room'
      }));
    });

    test('returns all permissions for moderator', async () => {
      await rbacManager.initialize();
      const perms = await rbacManager.getAllPermissions('moderator');
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'mute',
        object_type: 'room'
      }));
      expect(perms).toContainEqual(expect.objectContaining({
        permission: 'kick',
        object_type: 'room'
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
        name: 'super_admin',
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
