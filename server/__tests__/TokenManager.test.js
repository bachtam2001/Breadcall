const TokenManager = require('../src/TokenManager');
const RedisClient = require('../src/RedisClient');
const Database = require('../src/database');

describe('TokenManager', () => {
  let tokenManager;
  let redisClient;
  let db;

  beforeAll(async () => {
    // Setup Redis
    redisClient = new RedisClient();
    await redisClient.connect();

    // Setup Database (in-memory)
    db = new Database(':memory:');
    await db.initialize();

    // Setup TokenManager
    tokenManager = new TokenManager(redisClient, db);
    await tokenManager.initialize();
  });

  afterAll(async () => {
    if (redisClient) await redisClient.disconnect();
    if (db) await db.close();
  });

  beforeEach(async () => {
    // Clear Redis before each test
    const keys = await redisClient.client.keys('refresh:*');
    if (keys.length > 0) {
      await redisClient.client.del(keys);
    }
  });

  describe('generateTokenPair', () => {
    test('generates valid access and refresh tokens', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123',
        permissions: ['join', 'send_audio']
      });

      expect(result.accessToken).toBeTruthy();
      expect(result.tokenId).toBeTruthy();
      expect(result.expiresIn).toBe(900); // 15 minutes
    });

    test('access token is valid JWT format', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      const parts = result.accessToken.split('.');
      expect(parts.length).toBe(3);
    });

    test('refresh token is stored in Redis', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      const stored = await redisClient.getJson(`refresh:${result.tokenId}`);
      expect(stored).toBeTruthy();
      expect(stored.tokenId).toBe(result.tokenId);
      expect(stored.revoked).toBe(false);
      expect(stored.roomId).toBe('ABC123');
    });

    test('refresh token is stored in Database', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      const stored = await db.getRefreshToken(result.tokenId);
      expect(stored).toBeTruthy();
      expect(stored.tokenId).toBe(result.tokenId);
    });
  });

  describe('validateAccessToken', () => {
    test('validates valid access token', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      const validation = await tokenManager.validateAccessToken(result.accessToken);
      expect(validation.valid).toBe(true);
      expect(validation.payload.roomId).toBe('ABC123');
      expect(validation.payload.userId).toBe('user-123');
    });

    test('rejects expired token', async () => {
      // Generate token with very short expiry (1 second)
      const originalExpiry = tokenManager.accessTokenExpiry;
      tokenManager.accessTokenExpiry = 1;

      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const validation = await tokenManager.validateAccessToken(result.accessToken);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('expired');

      // Restore original expiry
      tokenManager.accessTokenExpiry = originalExpiry;
    });

    test('rejects invalid signature', async () => {
      const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fake_signature';

      const validation = await tokenManager.validateAccessToken(fakeToken);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('invalid_signature');
    });

    test('rejects malformed token', async () => {
      const validation = await tokenManager.validateAccessToken('not-a-jwt');
      expect(validation.valid).toBe(false);
    });
  });

  describe('validateRefreshToken', () => {
    test('validates valid refresh token', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      const validation = await tokenManager.validateRefreshToken(result.tokenId);
      expect(validation.valid).toBe(true);
      expect(validation.payload.tokenId).toBe(result.tokenId);
    });

    test('rejects non-existent refresh token', async () => {
      const validation = await tokenManager.validateRefreshToken('non-existent-token');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('not_found');
    });

    test('rejects revoked refresh token', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      await tokenManager.revokeToken(result.tokenId, 'testing');

      const validation = await tokenManager.validateRefreshToken(result.tokenId);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('revoked');
    });

    test('rejects rotated (used) refresh token', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      // Rotate token
      await tokenManager.rotateRefreshToken(result.tokenId);

      const validation = await tokenManager.validateRefreshToken(result.tokenId);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('rotated');
    });
  });

  describe('rotateRefreshToken', () => {
    test('issues new token pair and invalidates old', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      const oldTokenId = result.tokenId;

      // Rotate token
      const rotation = await tokenManager.rotateRefreshToken(oldTokenId);

      expect(rotation.success).toBe(true);
      expect(rotation.tokenId).not.toBe(oldTokenId);
      expect(rotation.accessToken).toBeTruthy();

      // Old token should be invalid
      const oldValidation = await tokenManager.validateRefreshToken(oldTokenId);
      expect(oldValidation.valid).toBe(false);
      expect(oldValidation.reason).toBe('rotated');

      // New token should be valid
      const newValidation = await tokenManager.validateRefreshToken(rotation.tokenId);
      expect(newValidation.valid).toBe(true);
    });

    test('fails to rotate non-existent token', async () => {
      const rotation = await tokenManager.rotateRefreshToken('non-existent');
      expect(rotation.success).toBe(false);
      expect(rotation.error).toBe('not_found');
    });

    test('fails to rotate already rotated token', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      // First rotation succeeds
      const rotation1 = await tokenManager.rotateRefreshToken(result.tokenId);
      expect(rotation1.success).toBe(true);

      // Second rotation fails
      const rotation2 = await tokenManager.rotateRefreshToken(result.tokenId);
      expect(rotation2.success).toBe(false);
      expect(rotation2.error).toBe('already_used');
    });
  });

  describe('revokeToken', () => {
    test('revokes valid token', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });

      const revokeResult = await tokenManager.revokeToken(result.tokenId, 'test revocation');
      expect(revokeResult).toBe(true);

      const validation = await tokenManager.validateRefreshToken(result.tokenId);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('revoked');
    });

    test('returns false for non-existent token', async () => {
      const revokeResult = await tokenManager.revokeToken('non-existent');
      expect(revokeResult).toBe(false);
    });
  });

  describe('_getDefaultPermissions', () => {
    test('returns correct permissions for room_access', () => {
      const permissions = tokenManager._getDefaultPermissions('room_access');
      expect(permissions).toEqual(['join', 'send_audio', 'send_video', 'chat']);
    });

    test('returns correct permissions for director_access', () => {
      const permissions = tokenManager._getDefaultPermissions('director_access');
      expect(permissions).toEqual(['view_all', 'mute', 'room_settings']);
    });

    test('returns correct permissions for admin_token', () => {
      const permissions = tokenManager._getDefaultPermissions('admin_token');
      expect(permissions).toEqual(['create', 'delete', 'update', 'assign']);
    });

    test('returns empty array for unknown type', () => {
      const permissions = tokenManager._getDefaultPermissions('unknown');
      expect(permissions).toEqual([]);
    });
  });
});
