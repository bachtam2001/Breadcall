# JWT Token Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from custom HMAC-signed tokens to JWT-based access/refresh token system with HttpOnly cookies, CSRF protection, and refresh token rotation.

**Architecture:** Two-token system with short-lived JWT access tokens (15 min) stored in HttpOnly cookies and long-lived refresh tokens (24h) with rotation stored in Redis+DB. All tokens auto-generated on room join.

**Tech Stack:** jsonwebtoken library, Redis for revocation cache and refresh token storage, SQLite for persistent audit trail, csrf-csrf for CSRF protection.

---

## Chunk 1: Infrastructure Setup

### Task 1: Add Dependencies

**Files:**
- Modify: `package.json`
- Test: `npm install`

- [ ] **Step 1: Add dependencies to package.json**

Add to `dependencies`:
```json
"jsonwebtoken": "^9.0.0",
"ioredis": "^5.3.0",
"csrf-csrf": "^1.3.0"
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: All packages installed successfully

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add JWT, Redis, and CSRF dependencies"
```

### Task 2: Create Redis Connection Module

**Files:**
- Create: `server/src/RedisClient.js`
- Test: `server/__tests__/RedisClient.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// server/__tests__/RedisClient.test.js
const RedisClient = require('../src/RedisClient');

describe('RedisClient', () => {
  let client;

  beforeEach(() => {
    client = new RedisClient();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  test('connects to Redis successfully', async () => {
    const isConnected = await client.connect();
    expect(isConnected).toBe(true);
  });

  test('get and set operations work', async () => {
    await client.connect();
    await client.set('test-key', 'test-value', 60);
    const value = await client.get('test-key');
    expect(value).toBe('test-value');
  });

  test('del operation works', async () => {
    await client.connect();
    await client.set('to-delete', 'value', 60);
    await client.del('to-delete');
    const value = await client.get('to-delete');
    expect(value).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- server/__tests__/RedisClient.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write RedisClient implementation**

```javascript
// server/src/RedisClient.js
const Redis = require('ioredis');

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    return new Promise((resolve, reject) => {
      this.client = new Redis(redisUrl, {
        retryStrategy: (times) => Math.min(times * 50, 2000),
        lazyConnect: true
      });

      this.client.on('connect', () => {
        this.connected = true;
        console.log('[RedisClient] Connected to Redis');
        resolve(true);
      });

      this.client.on('error', (err) => {
        console.error('[RedisClient] Redis error:', err.message);
        this.connected = false;
        reject(err);
      });

      this.client.connect().catch(reject);
    });
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
      console.log('[RedisClient] Disconnected from Redis');
    }
  }

  async get(key) {
    if (!this.connected) return null;
    return this.client.get(key);
  }

  async set(key, value, ttlSeconds = null) {
    if (!this.connected) return false;
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
    return true;
  }

  async setJson(key, jsonObject, ttlSeconds = null) {
    const jsonString = JSON.stringify(jsonObject);
    return this.set(key, jsonString, ttlSeconds);
  }

  async getJson(key) {
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  async del(key) {
    if (!this.connected) return false;
    await this.client.del(key);
    return true;
  }

  async hgetall(key) {
    if (!this.connected) return null;
    return this.client.hgetall(key);
  }

  async hset(key, field, value) {
    if (!this.connected) return false;
    await this.client.hset(key, field, value);
    return true;
  }

  async hsetObject(key, object) {
    if (!this.connected) return false;
    const entries = Object.entries(object);
    if (entries.length === 0) return false;
    await this.client.hset(key, entries.flat());
    return true;
  }

  async expire(key, seconds) {
    if (!this.connected) return false;
    await this.client.expire(key, seconds);
    return true;
  }

  isReady() {
    return this.connected;
  }
}

module.exports = RedisClient;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- server/__tests__/RedisClient.test.js`
Expected: PASS

Note: You may need to start Redis first: `redis-server --daemonize yes`

- [ ] **Step 5: Commit**

```bash
git add server/src/RedisClient.js server/__tests__/RedisClient.test.js
git commit -m "feat: add Redis client wrapper with connection management"
```

### Task 3: Create SQLite Database Module

**Files:**
- Create: `server/src/database.js`
- Test: `server/__tests__/database.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// server/__tests__/database.test.js
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

  test('rotate refresh token', async () => {
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
    const newToken = await db.getRefreshToken(newTokenId);

    expect(oldToken.rotatedTo).toBe(newTokenId);
    expect(newToken.rotatedFrom).toBe(oldTokenId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- server/__tests__/database.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write database implementation**

```javascript
// server/src/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'breadcall.db');
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const fs = require('fs');
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log('[Database] Connected to SQLite');
        this._createTables().then(resolve).catch(reject);
      });
    });
  }

  async _createTables() {
    return new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          tokenId TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          roomId TEXT NOT NULL,
          userId TEXT NOT NULL,
          expiresAt INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          revokedAt INTEGER,
          revokedReason TEXT,
          rotatedTo TEXT,
          rotatedFrom TEXT,
          FOREIGN KEY (rotatedTo) REFERENCES refresh_tokens(tokenId),
          FOREIGN KEY (rotatedFrom) REFERENCES refresh_tokens(tokenId)
        )
      `, (err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log('[Database] Tables created');
        resolve();
      });
    });
  }

  async getAllTables() {
    return new Promise((resolve, reject) => {
      this.db.all(
        "SELECT name FROM sqlite_master WHERE type='table'",
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows.map(row => row.name));
        }
      );
    });
  }

  async insertRefreshToken(tokenData) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO refresh_tokens
         (tokenId, type, roomId, userId, expiresAt, createdAt, revokedAt, revokedReason, rotatedTo, rotatedFrom)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tokenData.tokenId,
          tokenData.type,
          tokenData.roomId,
          tokenData.userId,
          tokenData.expiresAt,
          tokenData.createdAt || Date.now(),
          tokenData.revokedAt || null,
          tokenData.revokedReason || null,
          tokenData.rotatedTo || null,
          tokenData.rotatedFrom || null
        ],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  async getRefreshToken(tokenId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM refresh_tokens WHERE tokenId = ?',
        [tokenId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  async revokeRefreshToken(tokenId, reason = 'revoked') {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE refresh_tokens SET revokedAt = ?, revokedReason = ? WHERE tokenId = ?',
        [Date.now(), reason, tokenId],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  async rotateRefreshToken(oldTokenId, newTokenId) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Mark old token as rotated
        this.db.run(
          'UPDATE refresh_tokens SET rotatedTo = ? WHERE tokenId = ?',
          [newTokenId, oldTokenId],
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          }
        );
      });
    });
  }

  async getTokensByRoom(roomId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM refresh_tokens WHERE roomId = ? AND revokedAt IS NULL AND rotatedTo IS NULL',
        [roomId],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  async revokeTokensByRoom(roomId, reason = 'room deleted') {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE refresh_tokens SET revokedAt = ?, revokedReason = ? WHERE roomId = ?',
        [Date.now(), reason, roomId],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve(this.changes);
        }
      );
    });
  }

  async cleanupExpiredTokens() {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM refresh_tokens WHERE expiresAt < ?',
        [Date.now()],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve(this.changes);
        }
      );
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        console.log('[Database] Closed connection');
        resolve();
      });
    });
  }
}

module.exports = Database;
```

Note: SQLite3 needs to be added to package.json dependencies:
```json
"sqlite3": "^5.1.6"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- server/__tests__/database.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/database.js server/__tests__/database.test.js package.json
git commit -m "feat: add SQLite database module for refresh token persistence"
```

---

## Chunk 2: JWT Token Manager

### Task 4: Create JWT TokenManager Module

**Files:**
- Create: `server/src/TokenManager.js`
- Test: `server/__tests__/TokenManager.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// server/__tests__/TokenManager.test.js
const TokenManager = require('../src/TokenManager');
const RedisClient = require('../src/RedisClient');
const Database = require('../src/database');

describe('TokenManager', () => {
  let tokenManager;
  let redisClient;
  let db;

  beforeAll(async () => {
    // Setup Redis (mock or real)
    redisClient = new RedisClient();
    try {
      await redisClient.connect();
    } catch (e) {
      // Redis not available, skip tests
      return;
    }

    // Setup Database
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

  describe('generateTokenPair', () => {
    test('generates valid access and refresh tokens', async () => {
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123',
        permissions: ['join', 'send-audio']
      });

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
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
    });

    test('rejects expired token', async () => {
      // Generate token with very short expiry
      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123',
        expiresIn: 1 // 1 second
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const validation = await tokenManager.validateAccessToken(result.accessToken);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('expired');
    });

    test('rejects invalid signature', async () => {
      const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fake';

      const validation = await tokenManager.validateAccessToken(fakeToken);
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

      // Use refresh token (this rotates it)
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

      // Old token should be invalid
      const oldValidation = await tokenManager.validateRefreshToken(oldTokenId);
      expect(oldValidation.valid).toBe(false);

      // New token should be valid
      const newValidation = await tokenManager.validateRefreshToken(rotation.tokenId);
      expect(newValidation.valid).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- server/__tests__/TokenManager.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write TokenManager implementation**

```javascript
// server/src/TokenManager.js
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

class TokenManager {
  constructor(redisClient, database) {
    this.redis = redisClient;
    this.db = database;
    this.tokenSecret = process.env.TOKEN_SECRET || 'your-secret-key-change-in-production';
    this.tokenIssuer = 'breadcall-server';
    this.tokenAudience = 'breadcall-client';
    this.accessTokenExpiry = 15 * 60; // 15 minutes
    this.refreshTokenExpiry = 24 * 60 * 60; // 24 hours
  }

  async initialize() {
    // Ensure TokenManager is ready
    if (!this.redis.isReady()) {
      throw new Error('Redis client not connected');
    }
    console.log('[TokenManager] Initialized');
  }

  /**
   * Generate a new access and refresh token pair
   */
  async generateTokenPair(options) {
    const tokenId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // Generate access token (JWT)
    const accessToken = this._generateAccessToken({
      tokenId,
      ...options
    }, now);

    // Generate refresh token data
    const refreshTokenData = {
      tokenId,
      type: options.type,
      roomId: options.roomId,
      userId: options.userId,
      expiresAt: Date.now() + (this.refreshTokenExpiry * 1000),
      revoked: false,
      rotatedTo: null
    };

    // Store in Redis
    await this.redis.setJson(
      `refresh:${tokenId}`,
      refreshTokenData,
      this.refreshTokenExpiry
    );

    // Store in Database
    await this.db.insertRefreshToken({
      tokenId,
      type: options.type,
      roomId: options.roomId,
      userId: options.userId,
      expiresAt: Date.now() + (this.refreshTokenExpiry * 1000),
      createdAt: Date.now()
    });

    return {
      accessToken,
      tokenId, // Return tokenId for cookie naming
      expiresIn: this.accessTokenExpiry
    };
  }

  /**
   * Generate JWT access token
   */
  _generateAccessToken(payload, iat) {
    const jwtPayload = {
      iss: this.tokenIssuer,
      aud: this.tokenAudience,
      tokenId: payload.tokenId,
      type: payload.type,
      roomId: payload.roomId,
      userId: payload.userId,
      permissions: payload.permissions,
      iat,
      exp: iat + this.accessTokenExpiry
    };

    return jwt.sign(jwtPayload, this.tokenSecret, { algorithm: 'HS256' });
  }

  /**
   * Validate access token (stateless - no DB lookup)
   */
  async validateAccessToken(tokenString) {
    try {
      const decoded = jwt.verify(tokenString, this.tokenSecret);
      return {
        valid: true,
        payload: {
          tokenId: decoded.tokenId,
          type: decoded.type,
          roomId: decoded.roomId,
          userId: decoded.userId,
          permissions: decoded.permissions
        }
      };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return { valid: false, reason: 'expired' };
      }
      if (error.name === 'JsonWebTokenError') {
        return { valid: false, reason: 'invalid_signature' };
      }
      return { valid: false, reason: 'invalid' };
    }
  }

  /**
   * Validate refresh token (stateful - checks Redis)
   */
  async validateRefreshToken(tokenId) {
    const tokenData = await this.redis.getJson(`refresh:${tokenId}`);

    if (!tokenData) {
      return { valid: false, reason: 'not_found' };
    }

    if (tokenData.revoked === true) {
      return { valid: false, reason: 'revoked' };
    }

    if (tokenData.rotatedTo !== null) {
      return { valid: false, reason: 'rotated' };
    }

    if (tokenData.expiresAt < Date.now()) {
      return { valid: false, reason: 'expired' };
    }

    return {
      valid: true,
      payload: {
        tokenId: tokenData.tokenId,
        type: tokenData.type,
        roomId: tokenData.roomId,
        userId: tokenData.userId
      }
    };
  }

  /**
   * Rotate refresh token - issue new pair and invalidate old
   */
  async rotateRefreshToken(oldTokenId) {
    // Get old token data
    const oldTokenData = await this.redis.getJson(`refresh:${oldTokenId}`);

    if (!oldTokenData) {
      return { success: false, error: 'not_found' };
    }

    if (oldTokenData.revoked || oldTokenData.rotatedTo) {
      return { success: false, error: 'already_used' };
    }

    // Generate new token pair
    const newResult = await this.generateTokenPair({
      type: oldTokenData.type,
      roomId: oldTokenData.roomId,
      userId: oldTokenData.userId,
      permissions: this._getDefaultPermissions(oldTokenData.type)
    });

    // Mark old token as rotated in Redis
    oldTokenData.rotatedTo = newResult.tokenId;
    await this.redis.setJson(`refresh:${oldTokenId}`, oldTokenData);

    // Update rotatedTo in database
    await this.db.rotateRefreshToken(oldTokenId, newResult.tokenId);

    return {
      success: true,
      tokenId: newResult.tokenId,
      accessToken: newResult.accessToken
    };
  }

  /**
   * Revoke a refresh token
   */
  async revokeToken(tokenId, reason = 'revoked') {
    const tokenData = await this.redis.getJson(`refresh:${tokenId}`);

    if (!tokenData) {
      return false;
    }

    // Mark as revoked in Redis
    tokenData.revoked = true;
    await this.redis.setJson(`refresh:${tokenId}`, tokenData);

    // Mark as revoked in Database
    await this.db.revokeRefreshToken(tokenId, reason);

    return true;
  }

  /**
   * Revoke all tokens for a room
   */
  async revokeTokensByRoom(roomId, reason = 'room deleted') {
    const tokenIds = await this._getTokenIdsByRoom(roomId);

    for (const tokenId of tokenIds) {
      await this.revokeToken(tokenId, reason);
    }

    return tokenIds.length;
  }

  /**
   * Get all token IDs for a room (from Redis)
   */
  async _getTokenIdsByRoom(roomId) {
    // Scan Redis for keys matching refresh:* and filter by roomId
    const tokenIds = [];
    let cursor = 0;

    do {
      const result = await this.redis.client.scan(cursor, 'MATCH', 'refresh:*', 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      for (const key of keys) {
        const tokenData = await this.redis.getJson(key);
        if (tokenData && tokenData.roomId === roomId) {
          tokenIds.push(tokenData.tokenId);
        }
      }
    } while (cursor !== 0);

    return tokenIds;
  }

  /**
   * Get default permissions by token type
   */
  _getDefaultPermissions(type) {
    switch (type) {
      case 'room_access':
        return ['join', 'send-audio', 'send-video', 'chat'];
      case 'director_access':
        return ['observe', 'chat'];
      case 'stream_access':
        return ['view'];
      case 'admin_token':
        return ['admin', 'revoke', 'delete-room'];
      default:
        return [];
    }
  }
}

module.exports = TokenManager;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- server/__tests__/TokenManager.test.js`
Expected: PASS (requires Redis running)

- [ ] **Step 5: Commit**

```bash
git add server/src/TokenManager.js server/__tests__/TokenManager.test.js
git commit -m "feat: implement JWT TokenManager with access/refresh token pairs"
```

---

## Chunk 3: Server Integration

### Task 5: Update RoomManager.js

**Files:**
- Modify: `server/src/RoomManager.js`
- Test: Existing tests

- [ ] **Step 1: Read current RoomManager.js to understand structure**

Already done - the file uses in-memory token storage with `this.tokens` Map.

- [ ] **Step 2: Modify RoomManager to use TokenManager**

The RoomManager will be simplified to delegate token operations to TokenManager.
Key changes:
1. Remove in-memory token storage (`this.tokens`, `this.tokenIndex`, `this.revokedTokens`)
2. Add TokenManager dependency
3. Update `joinRoom()` to always generate tokens (remove `autoGenerateToken` parameter)
4. Update `generateToken()` to delegate to TokenManager
5. Update `validateToken()` to delegate to TokenManager

Due to the size of this change, it will be done in the next task with full file rewrite.

### Task 6: Update index.js with JWT Routes

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Add CSRF protection middleware**

Add after session middleware:
```javascript
const { doubleCsrf } = require('csrf-csrf');

const {
  invalidCsrfTokenError,
  generateCsrfToken,
  doubleCsrfProtection,
} = doubleCsrf({
  getSecret: (req) => req.session.secret || 'fallback-secret',
  cookieName: 'csrfToken',
  cookieOptions: {
    httpOnly: false, // Must be readable by JavaScript
    sameSite: 'lax',
    secure: process.env.USE_SECURE_COOKIES === 'true',
  },
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
});

// Add CSRF token generation route
app.get('/api/csrf-token', (req, res) => {
  const { token } = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
});
```

- [ ] **Step 2: Update /api/tokens route to use JWT**

Replace the existing `/api/tokens` POST handler with JWT-based generation.

- [ ] **Step 3: Add /api/tokens/refresh endpoint**

```javascript
app.post('/api/tokens/refresh', doubleCsrfProtection, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'refresh_required',
        message: 'No refresh token provided'
      });
    }

    // Extract tokenId from cookie value (format: refresh_<tokenId>)
    const tokenId = refreshToken.replace('refresh_', '');

    // Validate and rotate refresh token
    const result = await tokenManager.rotateRefreshToken(tokenId);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error === 'already_used' ? 'session_expired' : 'refresh_required',
        message: result.error === 'already_used'
          ? 'Refresh token has been used (possible replay attack)'
          : 'Refresh token invalid or revoked'
      });
    }

    // Set new access token cookie
    res.cookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: process.env.USE_SECURE_COOKIES === 'true',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    // Set new refresh token cookie
    res.cookie('refreshToken', `refresh_${result.tokenId}`, {
      httpOnly: true,
      secure: process.env.USE_SECURE_COOKIES === 'true',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Generate new CSRF token
    const { token: newCsrfToken } = generateCsrfToken(req, res);

    res.json({
      success: true,
      accessToken: result.accessToken,
      tokenId: result.tokenId,
      expiresIn: 900,
      csrfToken: newCsrfToken
    });
  } catch (error) {
    console.error('[API] Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'refresh_failed'
    });
  }
});
```

- [ ] **Step 4: Update token validation route**

Modify `/api/tokens/validate` to use `tokenManager.validateAccessToken()`.

- [ ] **Step 5: Update token revocation route**

Modify `/api/tokens/:tokenId` DELETE to use `tokenManager.revokeToken()`.

- [ ] **Step 6: Commit**

```bash
git add server/src/index.js
git commit -m "feat: add JWT token routes with CSRF protection"
```

### Task 7: Add CSRF-protected Join Room Flow

**Files:**
- Modify: `server/src/index.js`
- Modify: `client/js/app.js`

- [ ] **Step 1: Update joinRoom API endpoint**

Add doubleCsrfProtection to the join room endpoint and set cookies in response.

- [ ] **Step 2: Update client-side to handle CSRF**

Modify client/js/app.js to:
1. Fetch CSRF token on page load
2. Include X-CSRF-Token header in mutation requests
3. Handle cookie-based authentication

---

## Chunk 4: Client-Side Changes

### Task 8: Update Client Authentication

**Files:**
- Modify: `client/js/app.js`

- [ ] **Step 1: Add CSRF token handling**

```javascript
class BreadCallApp {
  constructor() {
    this.csrfToken = null;
    this.accessToken = null;
  }

  async init() {
    // Fetch CSRF token on init
    await this.fetchCsrfToken();
    // Check for existing session
    await this.checkExistingSession();
  }

  async fetchCsrfToken() {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include'
    });
    const data = await response.json();
    this.csrfToken = data.csrfToken;
  }

  getCsrfTokenFromCookie() {
    const match = document.cookie.match(/csrfToken=([^;]+)/);
    return match ? match[1] : null;
  }

  async fetchWithAuth(url, options = {}) {
    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method?.toUpperCase());

    if (isMutation) {
      options.headers = {
        ...options.headers,
        'X-CSRF-Token': this.csrfToken || this.getCsrfTokenFromCookie()
      };
    }

    options.credentials = 'include';

    let response = await fetch(url, options);

    // Handle 401 (expired access token)
    if (response.status === 401) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        // Retry with new token
        if (isMutation) {
          options.headers['X-CSRF-Token'] = this.csrfToken || this.getCsrfTokenFromCookie();
        }
        response = await fetch(url, options);
      }
    }

    return response;
  }

  async refreshAccessToken() {
    try {
      const response = await fetch('/api/tokens/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': this.csrfToken || this.getCsrfTokenFromCookie()
        }
      });

      const data = await response.json();

      if (data.success) {
        this.csrfToken = data.csrfToken || this.getCsrfTokenFromCookie();
        return true;
      }

      // Refresh failed
      this.logout();
      return false;
    } catch (error) {
      console.error('[App] Token refresh failed:', error);
      return false;
    }
  }

  async checkExistingSession() {
    // Try to refresh to verify session is valid
    const response = await fetch('/api/admin/me', {
      credentials: 'include'
    });
    const data = await response.json();

    if (data.isAdmin) {
      console.log('[App] Admin session restored');
    }
  }

  logout() {
    // Clear state and redirect
    this.csrfToken = null;
    this.accessToken = null;
    window.location.href = '/login';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/app.js
git commit -m "feat: add CSRF-protected authentication to client"
```

---

## Chunk 5: Testing and Cleanup

### Task 9: Update Tests

**Files:**
- Modify: `server/__tests__/*.test.js`

- [ ] **Step 1: Update existing token tests**

Modify existing tests to work with JWT tokens instead of custom tokens.

- [ ] **Step 2: Add integration tests**

Add tests for:
1. Token refresh flow
2. CSRF protection
3. Token rotation
4. Revocation

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/
git commit -m "test: update tests for JWT token system"
```

### Task 10: Documentation Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add environment variables documentation**

```markdown
## Environment Variables

### Token Configuration
- `TOKEN_SECRET` - Secret key for JWT signing (required, min 32 characters)
- `REDIS_URL` - Redis connection URL (default: redis://localhost:6379)
- `USE_SECURE_COOKIES` - Set to 'true' in production (default: false)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add JWT configuration documentation"
```

---

## Testing Checklist

Before considering this implementation complete, verify:

- [ ] Redis is running and accessible
- [ ] All unit tests pass: `npm test`
- [ ] Token generation creates valid JWT
- [ ] Token refresh rotates tokens correctly
- [ ] CSRF protection blocks requests without token
- [ ] Auto-generated tokens work on room join
- [ ] Expired tokens are rejected
- [ ] Revoked tokens are rejected
- [ ] Rotated (reused) tokens are detected and rejected
- [ ] Client auto-refresh on 401 works

---

## Security Notes

1. **TOKEN_SECRET**: Must be set in production (min 32 chars, use crypto.randomBytes)
2. **HTTPS**: Required in production for cookie security
3. **Redis**: Should be password-protected in production
4. **Rate Limiting**: Should be added to `/api/tokens/refresh` endpoint (not in scope)
