const RBACManager = require('../src/RBACManager');
const Database = require('../src/database');

describe('RBACManager', () => {
  let rbacManager;
  let db;

  beforeAll(async () => {
    db = new Database(':memory:');
    await db.initialize();

    // Apply seed data
    const seedData = `
      INSERT INTO roles (name, hierarchy, description) VALUES
        ('super_admin', 100, 'Full system access'),
        ('room_admin', 80, 'Create and manage own rooms'),
        ('moderator', 60, 'Manage participants in assigned rooms'),
        ('director', 50, 'View and control streams'),
        ('operator', 40, 'Read-only monitoring'),
        ('participant', 20, 'Join rooms, send audio/video'),
        ('viewer', 10, 'View single stream');

      INSERT INTO role_permissions (role, permission, object_type) VALUES
        ('super_admin', '*', 'system'),
        ('super_admin', '*', 'room'),
        ('super_admin', '*', 'stream'),
        ('super_admin', '*', 'user'),
        ('room_admin', 'create', 'room'),
        ('room_admin', 'delete', 'room'),
        ('room_admin', 'update', 'room'),
        ('room_admin', 'assign', 'room'),
        ('room_admin', 'promote', 'user'),
        ('moderator', 'mute', 'room'),
        ('moderator', 'kick', 'room'),
        ('moderator', 'update_settings', 'room'),
        ('director', 'view_all', 'room'),
        ('director', 'switch_scenes', 'room'),
        ('director', 'generate_srt', 'room'),
        ('operator', 'view_analytics', 'system'),
        ('operator', 'view_monitoring', 'system'),
        ('participant', 'join', 'room'),
        ('participant', 'send_audio', 'room'),
        ('participant', 'send_video', 'room'),
        ('participant', 'chat', 'room'),
        ('viewer', 'view', 'stream'),
        ('viewer', 'generate_srt', 'stream'),
        ('viewer', 'view_solo', 'stream');
    `;
    await db.db.exec(seedData);

    rbacManager = new RBACManager(db);
    await rbacManager.initialize();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe('getRoleHierarchy', () => {
    test('returns hierarchy level for role', async () => {
      const hierarchy = await rbacManager.getRoleHierarchy('super_admin');
      expect(hierarchy).toBe(100);
    });

    test('returns hierarchy level for room_admin', async () => {
      const hierarchy = await rbacManager.getRoleHierarchy('room_admin');
      expect(hierarchy).toBe(80);
    });

    test('returns hierarchy level for moderator', async () => {
      const hierarchy = await rbacManager.getRoleHierarchy('moderator');
      expect(hierarchy).toBe(60);
    });

    test('returns hierarchy level for viewer', async () => {
      const hierarchy = await rbacManager.getRoleHierarchy('viewer');
      expect(hierarchy).toBe(10);
    });

    test('returns null for non-existent role', async () => {
      const hierarchy = await rbacManager.getRoleHierarchy('nonexistent');
      expect(hierarchy).toBeNull();
    });
  });

  describe('hasPermission', () => {
    test('super_admin has all permissions', async () => {
      const hasPerm = await rbacManager.hasPermission('super_admin', 'delete', 'room');
      expect(hasPerm).toBe(true);
    });

    test('super_admin has wildcard permissions for any object type', async () => {
      const hasPerm = await rbacManager.hasPermission('super_admin', 'any_action', 'anything');
      expect(hasPerm).toBe(true);
    });

    test('room_admin can create rooms', async () => {
      const hasPerm = await rbacManager.hasPermission('room_admin', 'create', 'room');
      expect(hasPerm).toBe(true);
    });

    test('room_admin can delete rooms', async () => {
      const hasPerm = await rbacManager.hasPermission('room_admin', 'delete', 'room');
      expect(hasPerm).toBe(true);
    });

    test('room_admin cannot mute (moderator permission)', async () => {
      const hasPerm = await rbacManager.hasPermission('room_admin', 'mute', 'room');
      expect(hasPerm).toBe(false);
    });

    test('moderator can mute participants', async () => {
      const hasPerm = await rbacManager.hasPermission('moderator', 'mute', 'room');
      expect(hasPerm).toBe(true);
    });

    test('moderator can kick participants', async () => {
      const hasPerm = await rbacManager.hasPermission('moderator', 'kick', 'room');
      expect(hasPerm).toBe(true);
    });

    test('director can view all rooms', async () => {
      const hasPerm = await rbacManager.hasPermission('director', 'view_all', 'room');
      expect(hasPerm).toBe(true);
    });

    test('viewer can view streams', async () => {
      const hasPerm = await rbacManager.hasPermission('viewer', 'view', 'stream');
      expect(hasPerm).toBe(true);
    });

    test('viewer cannot join rooms (participant permission)', async () => {
      const hasPerm = await rbacManager.hasPermission('viewer', 'join', 'room');
      expect(hasPerm).toBe(false);
    });

    test('participant can join rooms', async () => {
      const hasPerm = await rbacManager.hasPermission('participant', 'join', 'room');
      expect(hasPerm).toBe(true);
    });

    test('non-existent role has no permissions', async () => {
      const hasPerm = await rbacManager.hasPermission('nonexistent', 'view', 'stream');
      expect(hasPerm).toBe(false);
    });
  });

  describe('canAccessHigherRole', () => {
    test('super_admin can access all roles', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('super_admin', 'viewer');
      expect(canAccess).toBe(true);
    });

    test('super_admin can access room_admin', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('super_admin', 'room_admin');
      expect(canAccess).toBe(true);
    });

    test('room_admin cannot access super_admin', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('room_admin', 'super_admin');
      expect(canAccess).toBe(false);
    });

    test('room_admin can access moderator', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('room_admin', 'moderator');
      expect(canAccess).toBe(true);
    });

    test('moderator can access viewer', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('moderator', 'viewer');
      expect(canAccess).toBe(true);
    });

    test('moderator cannot access room_admin', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('moderator', 'room_admin');
      expect(canAccess).toBe(false);
    });

    test('same role cannot access itself', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('moderator', 'moderator');
      expect(canAccess).toBe(false);
    });

    test('returns false for non-existent roles', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('nonexistent', 'viewer');
      expect(canAccess).toBe(false);
    });
  });

  describe('getAllPermissions', () => {
    test('returns all permissions for room_admin', async () => {
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
      const perms = await rbacManager.getAllPermissions('nonexistent');
      expect(perms).toEqual([]);
    });
  });

  describe('getAllRoles', () => {
    test('returns all roles with hierarchy', async () => {
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
      const roles = rbacManager.getAllRoles();
      for (let i = 1; i < roles.length; i++) {
        expect(roles[i - 1].hierarchy).toBeGreaterThanOrEqual(roles[i].hierarchy);
      }
    });
  });
});
