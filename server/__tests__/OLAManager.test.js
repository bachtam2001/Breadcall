const OLAManager = require('../src/OLAManager');
const Database = require('../src/database');
const RBACManager = require('../src/RBACManager');

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

describe('OLAManager', () => {
  let olaManager;
  let db;
  let rbac;
  let mockPool;

  // Mock data for roles and permissions
  const mockRoles = [
    { name: 'admin', hierarchy: 100, description: 'Full system access' },
    { name: 'director', hierarchy: 70, description: 'Can create rooms, full control over assigned rooms' },
    { name: 'operator', hierarchy: 40, description: 'Read-only monitoring' },
    { name: 'participant', hierarchy: 20, description: 'Join rooms, send audio/video' },
    { name: 'viewer', hierarchy: 10, description: 'View single stream' }
  ];

  const mockRolePermissions = [
    { role: 'admin', permission: '*', object_type: 'system' },
    { role: 'admin', permission: '*', object_type: 'room' },
    { role: 'admin', permission: '*', object_type: 'stream' },
    { role: 'admin', permission: '*', object_type: 'user' },
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

  // Mock users
  const mockUsers = [
    { id: 'user-super-admin', username: 'superadmin', password_hash: 'hash', role: 'admin', display_name: 'Super Admin', email: null },
    { id: 'user-director', username: 'director', password_hash: 'hash', role: 'director', display_name: 'Director', email: null },
    { id: 'user-viewer', username: 'viewer', password_hash: 'hash', role: 'viewer', display_name: 'Viewer', email: null }
  ];

  // In-memory storage for OLAManager data (room_assignments and stream_access tables)
  const mockRoomAssignments = new Map();
  const mockStreamAccess = new Map();

  beforeEach(async () => {
    // Reset all mocks and in-memory storage
    jest.clearAllMocks();
    mockRoomAssignments.clear();
    mockStreamAccess.clear();

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

    // Mock database queries for OLAManager operations
    mockPool.query.mockImplementation((query, params) => {
      const queryLower = query.toLowerCase();

      // getUserById
      if (queryLower.includes('select * from users where id =')) {
        const userId = params[0];
        const user = mockUsers.find(u => u.id === userId);
        return Promise.resolve({ rows: user ? [user] : [] });
      }

      // getRole
      if (queryLower.includes('select * from roles where name =') && !queryLower.includes('role_permissions')) {
        const roleName = params[0];
        const role = mockRoles.find(r => r.name === roleName);
        return Promise.resolve({ rows: role ? [role] : [] });
      }

      // INSERT into room_assignments
      if (queryLower.includes('insert into room_assignments')) {
        const assignment = {
          id: params[0],
          user_id: params[1],
          room_id: params[2],
          assignment_role: params[3],
          granted_by: params[4],
          granted_at: params[5],
          expires_at: params[6]
        };
        const key = `${assignment.user_id}:${assignment.room_id}`;
        mockRoomAssignments.set(key, assignment);
        return Promise.resolve({ rows: [assignment] });
      }

      // SELECT from room_assignments by user_id (getRoomAssignmentsForUser)
      if (queryLower.includes('select') && queryLower.includes('room_assignments') && queryLower.includes('where user_id =')) {
        const userId = params[0];
        const results = [];
        for (const [key, assignment] of mockRoomAssignments.entries()) {
          if (assignment.user_id === userId) {
            // Check expiration
            if (assignment.expires_at && new Date(assignment.expires_at) < new Date()) {
              continue; // Skip expired
            }
            results.push(assignment);
          }
        }
        return Promise.resolve({ rows: results });
      }

      // SELECT from room_assignments by room_id (getRoomAssignments)
      if (queryLower.includes('select') && queryLower.includes('room_assignments') && queryLower.includes('where ra.room_id =')) {
        const roomId = params[0];
        const results = [];
        for (const [key, assignment] of mockRoomAssignments.entries()) {
          if (assignment.room_id === roomId) {
            if (assignment.expires_at && new Date(assignment.expires_at) < new Date()) {
              continue; // Skip expired
            }
            results.push(assignment);
          }
        }
        return Promise.resolve({ rows: results });
      }

      // DELETE from room_assignments
      if (queryLower.includes('delete from room_assignments')) {
        const userId = params[0];
        const roomId = params[1];
        const key = `${userId}:${roomId}`;
        const deleted = mockRoomAssignments.delete(key);
        return Promise.resolve({ rows: [], rowCount: deleted ? 1 : 0 });
      }

      // INSERT into stream_access
      if (queryLower.includes('insert into stream_access')) {
        const access = {
          id: params[0],
          user_id: params[1],
          stream_id: params[2],
          granted_by: params[3],
          granted_at: params[4],
          expires_at: params[5]
        };
        const key = `${access.user_id}:${access.stream_id}`;
        mockStreamAccess.set(key, access);
        return Promise.resolve({ rows: [access] });
      }

      // SELECT from stream_access (getStreamAccessForUser)
      if (queryLower.includes('select') && queryLower.includes('stream_access') && queryLower.includes('where user_id =')) {
        const userId = params[0];
        const results = [];
        for (const [key, access] of mockStreamAccess.entries()) {
          if (access.user_id === userId) {
            // Check expiration
            if (access.expires_at && new Date(access.expires_at) < new Date()) {
              continue; // Skip expired
            }
            results.push(access);
          }
        }
        return Promise.resolve({ rows: results });
      }

      // DELETE from stream_access
      if (queryLower.includes('delete from stream_access')) {
        const userId = params[0];
        const streamId = params[1];
        const key = `${userId}:${streamId}`;
        const deleted = mockStreamAccess.delete(key);
        return Promise.resolve({ rows: [], rowCount: deleted ? 1 : 0 });
      }

      return Promise.resolve({ rows: [] });
    });

    rbac = new RBACManager(db);
    await rbac.initialize();

    olaManager = new OLAManager(db, rbac);
    await olaManager.initialize();
  });

  afterEach(async () => {
    if (db && db.pool) {
      await db.shutdown();
    }
  });

  describe('assignRoom', () => {
    test('assigns user to room with specified role', async () => {
      const assignment = await olaManager.assignRoom(
        'user-director',
        'ROOM123',
        'director',
        'user-super-admin'
      );

      expect(assignment).toBeTruthy();
      expect(assignment.user_id).toBe('user-director');
      expect(assignment.room_id).toBe('ROOM123');
      expect(assignment.assignment_role).toBe('director');
      expect(assignment.granted_by).toBe('user-super-admin');
    });

    test('assigns user with expiration date', async () => {
      const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24 hours
      const assignment = await olaManager.assignRoom(
        'user-viewer',
        'ROOM456',
        'participant',
        'user-director',
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
      await olaManager.assignRoom('user-director', 'ROOM-A', 'director', 'user-super-admin');
      await olaManager.assignRoom('user-director', 'ROOM-B', 'director', 'user-super-admin');

      const assignments = await olaManager.getUserRoomAssignments('user-director');
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

      await olaManager.assignRoom('user-director', roomId, 'director', 'user-super-admin');
      await olaManager.assignRoom('user-viewer', roomId, 'participant', 'user-super-admin');

      const assignments = await olaManager.getRoomAssignments(roomId);
      expect(assignments.length).toBe(2);

      const userIds = assignments.map(a => a.user_id);
      expect(userIds).toContain('user-director');
      expect(userIds).toContain('user-viewer');
    });
  });

  describe('canAccessRoom', () => {
    test('admin can access any room', async () => {
      const canAccess = await olaManager.canAccessRoom('user-super-admin', 'ANY-ROOM');
      expect(canAccess).toBe(true);
    });

    test('assigned user can access room', async () => {
      const roomId = 'ROOM-ACCESS-TEST';
      await olaManager.assignRoom('user-director', roomId, 'director', 'user-super-admin');

      const canAccess = await olaManager.canAccessRoom('user-director', roomId);
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
        'user-director',
        streamId,
        'user-super-admin'
      );

      expect(access).toBeTruthy();
      expect(access.user_id).toBe('user-director');
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
      await olaManager.grantStreamAccess('user-director', streamId, 'user-super-admin');

      const canAccess = await olaManager.canAccessStream('user-director', streamId);
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
      await olaManager.grantStreamAccess('user-director', streamId, 'user-super-admin');

      // Verify access exists
      let canAccess = await olaManager.canAccessStream('user-director', streamId);
      expect(canAccess).toBe(true);

      // Revoke access
      await olaManager.revokeStreamAccess('user-director', streamId);

      // Verify access is revoked
      canAccess = await olaManager.canAccessStream('user-director', streamId);
      expect(canAccess).toBe(false);
    });
  });
});
