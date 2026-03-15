const Database = require('../src/database');

describe('Database', () => {
  let db;

  beforeAll(async () => {
    db = new Database(':memory:');
    await db.initialize();
  });

  afterAll(async () => {
    await db.close();
  });

  test('creates refresh_tokens table on init', async () => {
    const tables = await db.getAllTables();
    expect(tables).toContain('refresh_tokens');
  });

  test('insert and retrieve refresh token', async () => {
    const tokenData = {
      tokenId: 'test-token-id',
      type: 'room_access',
      roomId: 'ABC123',
      userId: 'user-123',
      expiresAt: Date.now() + 86400000
    };

    await db.insertRefreshToken(tokenData);
    const retrieved = await db.getRefreshToken(tokenData.tokenId);

    expect(retrieved).toBeTruthy();
    expect(retrieved.tokenId).toBe(tokenData.tokenId);
    expect(retrieved.type).toBe(tokenData.type);
    expect(retrieved.roomId).toBe(tokenData.roomId);
    expect(retrieved.revokedAt).toBeNull();
  });

  test('revoke refresh token', async () => {
    const tokenId = 'revoke-test';
    await db.insertRefreshToken({
      tokenId,
      type: 'room_access',
      roomId: 'ABC123',
      userId: 'user-123',
      expiresAt: Date.now() + 86400000
    });

    await db.revokeRefreshToken(tokenId, 'admin revoked');
    const token = await db.getRefreshToken(tokenId);

    expect(token.revokedAt).toBeTruthy();
    expect(token.revokedReason).toBe('admin revoked');
  });

  test('rotate refresh token marks old token', async () => {
    const oldTokenId = 'old-token';
    const newTokenId = 'new-token';

    await db.insertRefreshToken({
      tokenId: oldTokenId,
      type: 'room_access',
      roomId: 'ABC123',
      userId: 'user-123',
      expiresAt: Date.now() + 86400000
    });

    await db.rotateRefreshToken(oldTokenId, newTokenId);

    const oldToken = await db.getRefreshToken(oldTokenId);
    expect(oldToken.rotatedTo).toBe(newTokenId);
  });

  test('get tokens by room', async () => {
    const roomId = 'ROOM1';

    await db.insertRefreshToken({
      tokenId: 'room1-token1',
      type: 'room_access',
      roomId,
      userId: 'user-1',
      expiresAt: Date.now() + 86400000
    });

    await db.insertRefreshToken({
      tokenId: 'room1-token2',
      type: 'room_access',
      roomId,
      userId: 'user-2',
      expiresAt: Date.now() + 86400000
    });

    const tokens = await db.getTokensByRoom(roomId);
    expect(tokens.length).toBe(2);
    expect(tokens.map(t => t.tokenId)).toContain('room1-token1');
    expect(tokens.map(t => t.tokenId)).toContain('room1-token2');
  });

  test('revoke tokens by room', async () => {
    const roomId = 'ROOM2';

    await db.insertRefreshToken({
      tokenId: 'room2-token1',
      type: 'room_access',
      roomId,
      userId: 'user-1',
      expiresAt: Date.now() + 86400000
    });

    const count = await db.revokeTokensByRoom(roomId, 'test revocation');
    expect(count).toBe(1);

    const token = await db.getRefreshToken('room2-token1');
    expect(token.revokedAt).toBeTruthy();
    expect(token.revokedReason).toBe('test revocation');
  });

  test('cleanup expired tokens', async () => {
    const expiredTokenId = 'expired-token';
    const validTokenId = 'valid-token';
    const now = Date.now();

    // Insert expired token
    await db.insertRefreshToken({
      tokenId: expiredTokenId,
      type: 'room_access',
      roomId: 'ABC123',
      userId: 'user-123',
      expiresAt: now - 10000 // 10 seconds ago
    });

    // Insert valid token
    await db.insertRefreshToken({
      tokenId: validTokenId,
      type: 'room_access',
      roomId: 'ABC123',
      userId: 'user-123',
      expiresAt: now + 86400000 // 24 hours from now
    });

    const deleted = await db.cleanupExpiredTokens();
    expect(deleted).toBe(1);

    const expiredToken = await db.getRefreshToken(expiredTokenId);
    expect(expiredToken).toBeNull();

    const validToken = await db.getRefreshToken(validTokenId);
    expect(validToken).toBeTruthy();
  });
});

describe('RBAC/OLA Tables', () => {
  let db;

  beforeAll(async () => {
    db = new Database(':memory:');
    await db.initialize();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  test('creates roles table', async () => {
    const tables = await db.getAllTables();
    expect(tables).toContain('roles');
  });

  test('creates users table', async () => {
    const tables = await db.getAllTables();
    expect(tables).toContain('users');
  });

  test('creates role_permissions table', async () => {
    const tables = await db.getAllTables();
    expect(tables).toContain('role_permissions');
  });

  test('creates room_assignments table', async () => {
    const tables = await db.getAllTables();
    expect(tables).toContain('room_assignments');
  });

  test('creates stream_access table', async () => {
    const tables = await db.getAllTables();
    expect(tables).toContain('stream_access');
  });

  test('inserts and retrieves user', async () => {
    const user = {
      id: 'test-user-123',
      username: 'testuser',
      password_hash: 'hashed-password',
      role: 'super_admin',
      display_name: 'Test User'
    };
    await db.insertUser(user);
    const retrieved = await db.getUserById('test-user-123');
    expect(retrieved).toBeTruthy();
    expect(retrieved.username).toBe('testuser');
  });

  test('gets user by username', async () => {
    const user = {
      id: 'test-user-456',
      username: 'findme',
      password_hash: 'hashed-password',
      role: 'participant'
    };
    await db.insertUser(user);
    const retrieved = await db.getUserByUsername('findme');
    expect(retrieved).toBeTruthy();
    expect(retrieved.id).toBe('test-user-456');
  });

  test('gets all users', async () => {
    await db.insertUser({
      id: 'user1',
      username: 'user1',
      password_hash: 'hash1',
      role: 'participant'
    });
    await db.insertUser({
      id: 'user2',
      username: 'user2',
      password_hash: 'hash2',
      role: 'moderator'
    });

    const users = await db.getAllUsers();
    expect(users.length).toBeGreaterThanOrEqual(2);
  });

  test('updates user role', async () => {
    await db.insertUser({
      id: 'user-promote',
      username: 'promoteme',
      password_hash: 'hash',
      role: 'participant'
    });

    await db.updateUserRole('user-promote', 'moderator');
    const user = await db.getUserById('user-promote');
    expect(user.role).toBe('moderator');
  });

  test('deletes user', async () => {
    await db.insertUser({
      id: 'user-delete',
      username: 'deleteme',
      password_hash: 'hash',
      role: 'participant'
    });

    await db.deleteUser('user-delete');
    const user = await db.getUserById('user-delete');
    expect(user).toBeNull();
  });

  test('gets all roles', async () => {
    const roles = await db.getAllRoles();
    // Roles table is empty in test DB, just verify method returns array
    expect(Array.isArray(roles)).toBe(true);
  });

  test('gets permissions for role', async () => {
    const permissions = await db.getPermissionsForRole('super_admin');
    // Permissions table is empty in test DB, just verify method returns array
    expect(Array.isArray(permissions)).toBe(true);
  });

  test('inserts and retrieves room assignment', async () => {
    const assignment = {
      id: 'assignment-1',
      user_id: 'test-user-123',
      room_id: 'ABC123',
      assignment_role: 'moderator'
    };
    await db.insertRoomAssignment(assignment);
    const assignments = await db.getRoomAssignmentsForUser('test-user-123');
    expect(assignments.length).toBe(1);
    expect(assignments[0].room_id).toBe('ABC123');
  });

  test('gets room assignments for room', async () => {
    const assignments = await db.getRoomAssignments('ABC123');
    expect(assignments.length).toBe(1);
  });

  test('removes room assignment', async () => {
    await db.removeRoomAssignment('test-user-123', 'ABC123');
    const assignments = await db.getRoomAssignmentsForUser('test-user-123');
    expect(assignments.length).toBe(0);
  });

  test('grants and retrieves stream access', async () => {
    const access = {
      id: 'stream-access-1',
      user_id: 'test-user-456',
      stream_id: 'ABC123_user1'
    };
    await db.grantStreamAccess(access);
    const streams = await db.getStreamAccessForUser('test-user-456');
    expect(streams.length).toBe(1);
    expect(streams[0].stream_id).toBe('ABC123_user1');
  });

  test('revokes stream access', async () => {
    await db.revokeStreamAccess('test-user-456', 'ABC123_user1');
    const streams = await db.getStreamAccessForUser('test-user-456');
    expect(streams.length).toBe(0);
  });
});
