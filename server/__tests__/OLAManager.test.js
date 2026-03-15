const OLAManager = require('../src/OLAManager');
const Database = require('../src/database');
const RBACManager = require('../src/RBACManager');

describe('OLAManager', () => {
  let olaManager;
  let db;
  let rbac;

  beforeAll(async () => {
    db = new Database(':memory:');
    await db.initialize();

    // Apply seed data for roles and permissions
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

    // Create test users
    const users = [
      { id: 'user-super-admin', username: 'superadmin', password_hash: 'hash', role: 'super_admin' },
      { id: 'user-moderator', username: 'moderator', password_hash: 'hash', role: 'moderator' },
      { id: 'user-viewer', username: 'viewer', password_hash: 'hash', role: 'viewer' },
      { id: 'user-room-admin', username: 'roomadmin', password_hash: 'hash', role: 'room_admin' }
    ];
    for (const user of users) {
      await db.insertUser(user);
    }

    rbac = new RBACManager(db);
    await rbac.initialize();

    olaManager = new OLAManager(db, rbac);
    await olaManager.initialize();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe('assignRoom', () => {
    test('assigns user to room with specified role', async () => {
      const assignment = await olaManager.assignRoom(
        'user-moderator',
        'ROOM123',
        'moderator',
        'user-super-admin'
      );

      expect(assignment).toBeTruthy();
      expect(assignment.user_id).toBe('user-moderator');
      expect(assignment.room_id).toBe('ROOM123');
      expect(assignment.assignment_role).toBe('moderator');
      expect(assignment.granted_by).toBe('user-super-admin');
    });

    test('assigns user with expiration date', async () => {
      const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24 hours
      const assignment = await olaManager.assignRoom(
        'user-viewer',
        'ROOM456',
        'participant',
        'user-room-admin',
        expiresAt
      );

      expect(assignment).toBeTruthy();
      expect(assignment.expires_at).toBe(expiresAt);
    });
  });

  describe('removeRoomAssignment', () => {
    test('removes room assignment', async () => {
      // First create an assignment
      await olaManager.assignRoom(
        'user-viewer',
        'ROOM-REMOVE',
        'participant',
        'user-super-admin'
      );

      // Verify it exists
      let assignments = await olaManager.getUserRoomAssignments('user-viewer');
      expect(assignments.length).toBeGreaterThan(0);

      // Remove it
      await olaManager.removeRoomAssignment('user-viewer', 'ROOM-REMOVE');

      // Verify it's gone
      assignments = await olaManager.getUserRoomAssignments('user-viewer');
      const roomAssignments = assignments.filter(a => a.room_id === 'ROOM-REMOVE');
      expect(roomAssignments.length).toBe(0);
    });
  });

  describe('getUserRoomAssignments', () => {
    test('returns all room assignments for user', async () => {
      // Create multiple assignments for a user
      await olaManager.assignRoom('user-moderator', 'ROOM-A', 'moderator', 'user-super-admin');
      await olaManager.assignRoom('user-moderator', 'ROOM-B', 'moderator', 'user-super-admin');

      const assignments = await olaManager.getUserRoomAssignments('user-moderator');
      const roomAMatch = assignments.some(a => a.room_id === 'ROOM-A');
      const roomBMatch = assignments.some(a => a.room_id === 'ROOM-B');

      expect(roomAMatch).toBe(true);
      expect(roomBMatch).toBe(true);
    });

    test('excludes expired assignments', async () => {
      const expiredDate = new Date(Date.now() - 10000).toISOString(); // 10 seconds ago
      await olaManager.assignRoom(
        'user-viewer',
        'ROOM-EXPIRED',
        'participant',
        'user-super-admin',
        expiredDate
      );

      const assignments = await olaManager.getUserRoomAssignments('user-viewer');
      const expiredAssignment = assignments.find(a => a.room_id === 'ROOM-EXPIRED');

      expect(expiredAssignment).toBeUndefined();
    });
  });

  describe('getRoomAssignments', () => {
    test('returns all assignments for a room', async () => {
      const roomId = 'ROOM-MULTI-USERS';

      await olaManager.assignRoom('user-moderator', roomId, 'moderator', 'user-super-admin');
      await olaManager.assignRoom('user-viewer', roomId, 'participant', 'user-super-admin');

      const assignments = await olaManager.getRoomAssignments(roomId);
      expect(assignments.length).toBe(2);

      const userIds = assignments.map(a => a.user_id);
      expect(userIds).toContain('user-moderator');
      expect(userIds).toContain('user-viewer');
    });
  });

  describe('canAccessRoom', () => {
    test('super_admin can access any room', async () => {
      const canAccess = await olaManager.canAccessRoom('user-super-admin', 'ANY-ROOM');
      expect(canAccess).toBe(true);
    });

    test('assigned user can access room', async () => {
      const roomId = 'ROOM-ACCESS-TEST';
      await olaManager.assignRoom('user-moderator', roomId, 'moderator', 'user-super-admin');

      const canAccess = await olaManager.canAccessRoom('user-moderator', roomId);
      expect(canAccess).toBe(true);
    });

    test('non-assigned user cannot access room', async () => {
      const roomId = 'ROOM-NO-ACCESS';
      const canAccess = await olaManager.canAccessRoom('user-viewer', roomId);
      expect(canAccess).toBe(false);
    });
  });

  describe('grantStreamAccess', () => {
    test('grants user access to stream', async () => {
      const streamId = 'ROOM789_user1';
      const access = await olaManager.grantStreamAccess(
        'user-moderator',
        streamId,
        'user-super-admin'
      );

      expect(access).toBeTruthy();
      expect(access.user_id).toBe('user-moderator');
      expect(access.stream_id).toBe(streamId);
      expect(access.granted_by).toBe('user-super-admin');
    });

    test('grants stream access with expiration', async () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour
      const streamId = 'ROOM789_user2';
      const access = await olaManager.grantStreamAccess(
        'user-viewer',
        streamId,
        'user-super-admin',
        expiresAt
      );

      expect(access.expires_at).toBe(expiresAt);
    });
  });

  describe('canAccessStream', () => {
    test('user with stream access can access stream', async () => {
      const streamId = 'STREAM-ACCESS-TEST';
      await olaManager.grantStreamAccess('user-moderator', streamId, 'user-super-admin');

      const canAccess = await olaManager.canAccessStream('user-moderator', streamId);
      expect(canAccess).toBe(true);
    });

    test('user without stream access cannot access stream', async () => {
      const canAccess = await olaManager.canAccessStream('user-viewer', 'STREAM-NO-ACCESS');
      expect(canAccess).toBe(false);
    });

    test('expired stream access is denied', async () => {
      const expiredDate = new Date(Date.now() - 10000).toISOString();
      const streamId = 'STREAM-EXPIRED';
      await olaManager.grantStreamAccess(
        'user-viewer',
        streamId,
        'user-super-admin',
        expiredDate
      );

      const canAccess = await olaManager.canAccessStream('user-viewer', streamId);
      expect(canAccess).toBe(false);
    });
  });

  describe('revokeStreamAccess', () => {
    test('revokes stream access', async () => {
      const streamId = 'STREAM-REVOKE';
      await olaManager.grantStreamAccess('user-moderator', streamId, 'user-super-admin');

      // Verify access exists
      let canAccess = await olaManager.canAccessStream('user-moderator', streamId);
      expect(canAccess).toBe(true);

      // Revoke access
      await olaManager.revokeStreamAccess('user-moderator', streamId);

      // Verify access is revoked
      canAccess = await olaManager.canAccessStream('user-moderator', streamId);
      expect(canAccess).toBe(false);
    });
  });
});
