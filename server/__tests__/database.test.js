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
