# PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate BreadCall from SQLite to PostgreSQL 17 with TIMESTAMPTZ timestamps and Redis caching optimization.

**Architecture:** PostgreSQL serves as the source of truth for all persistent data (users, tokens, RBAC). Redis provides caching for frequently-accessed data (users, permissions, room state). The Database class maintains the same public API while using connection pooling and parameterized queries.

**Tech Stack:** PostgreSQL 17 Alpine, Node.js `pg` package, ioredis (existing), Docker Compose

---

## Chunk 1: Foundation (Phase 1)

### Task 1: Add pg dependency to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Open package.json and locate dependencies section**

- [ ] **Step 2: Add pg dependency**

Add `"pg": "^8.11.3"` to dependencies section:

```json
{
  "dependencies": {
    "bcrypt": "^6.0.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.6",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "express-session": "^1.19.0",
    "ioredis": "^5.10.0",
    "jsonwebtoken": "^9.0.3",
    "pg": "^8.11.3",
    "qrcode": "^1.5.4",
    "sqlite3": "^6.0.1",
    "uuid": "^9.0.1",
    "ws": "^8.19.0"
  }
}
```

Note: Keep `sqlite3` for now - it will be removed after verification.

- [ ] **Step 3: Run npm install to install the new dependency**

Run: `npm install`
Expected: pg package installed successfully

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pg dependency for PostgreSQL migration"
```

---

### Task 2: Create PostgreSQL schema migration file

**Files:**
- Create: `server/database/migrations/001-postgres-schema.sql`

- [ ] **Step 1: Create the migrations directory if it doesn't exist**

Run: `mkdir -p server/database/migrations`

- [ ] **Step 2: Create the schema file with all tables, constraints, and indexes**

```sql
-- Migration: 001-postgres-schema
-- Date: 2026-03-15
-- Description: PostgreSQL schema for BreadCall RBAC/OLA

-- refresh_tokens table (created first without FK constraints)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  rotated_to TEXT,
  rotated_from TEXT
);

-- roles table
CREATE TABLE IF NOT EXISTS roles (
  name VARCHAR(50) PRIMARY KEY,
  hierarchy INTEGER NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  email VARCHAR(255),
  display_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  object_type VARCHAR(50) NOT NULL,
  PRIMARY KEY (role, permission, object_type)
);

-- room_assignments table
CREATE TABLE IF NOT EXISTS room_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id VARCHAR(10) NOT NULL,
  assignment_role VARCHAR(50) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, room_id)
);

-- stream_access table
CREATE TABLE IF NOT EXISTS stream_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_id VARCHAR(255) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, stream_id)
);

-- Add self-referential foreign keys after table exists
ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_rotated_to
  FOREIGN KEY (rotated_to) REFERENCES refresh_tokens(token_id);

ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_rotated_from
  FOREIGN KEY (rotated_from) REFERENCES refresh_tokens(token_id);

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Refresh token indexes (critical for auth performance)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_rotated ON refresh_tokens(rotated_to);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_type ON refresh_tokens(type);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked ON refresh_tokens(revoked_at);

-- Room assignment indexes
CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id);

-- Stream access indexes
CREATE INDEX IF NOT EXISTS idx_stream_access_user ON stream_access(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_access_stream ON stream_access(stream_id);
```

- [ ] **Step 3: Commit**

```bash
git add server/database/migrations/001-postgres-schema.sql
git commit -m "feat: add PostgreSQL schema migration for RBAC/OLA tables"
```

---

### Task 3: Update docker-compose.yml to add PostgreSQL service

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read current docker-compose.yml**

- [ ] **Step 2: Add postgres service before the signaling service**

```yaml
services:
  # PostgreSQL Database
  postgres:
    image: postgres:17-alpine
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./server/database/migrations/001-postgres-schema.sql:/docker-entrypoint-initdb.d/001-schema.sql
    environment:
      POSTGRES_DB: breadcall
      POSTGRES_USER: breadcall
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
    networks:
      - breadcall-network
    healthcheck:
      test: pg_isready -U breadcall -d breadcall
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  # Signaling Server (Node.js)
  signaling:
    build:
      context: .
      dockerfile: Dockerfile
    env_file:
      - ./.env
    environment:
      - PORT=3000
      - DATABASE_URL=postgres://breadcall:${DB_PASSWORD:-changeme}@postgres:5432/breadcall
      - DB_POOL_MIN=2
      - DB_POOL_MAX=10
    volumes:
      - ./logs:/app/logs
      - breadcall-public:/app/public
    networks:
      - breadcall-network
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy

  # ... rest of existing services (web, mediamtx) ...
```

- [ ] **Step 3: Add postgres-data volume to the volumes section**

```yaml
volumes:
  breadcall-public:
  postgres-data:
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add PostgreSQL service to docker-compose"
```

---

### Task 4: Update .env.example with database variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add PostgreSQL and Redis environment variables**

```bash
# Signaling Server
PORT=3000
NODE_ENV=production

# Admin Panel
ADMIN_PASSWORD=admin
SESSION_SECRET=your-session-secret-here
USE_SECURE_COOKIES=true
ALLOWED_ORIGINS=http://localhost,https://localhost

# PostgreSQL Database
DATABASE_URL=postgres://breadcall:changeme@postgres:5432/breadcall
DB_PASSWORD=changeme
DB_POOL_MIN=2
DB_POOL_MAX=10

# Redis
REDIS_URL=redis://redis:6379

# Authentication
TOKEN_SECRET=your-jwt-secret-key-minimum-32-characters
CSRF_SECRET=your-csrf-secret-key
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add PostgreSQL and Redis environment variables to .env.example"
```

---

## Chunk 2: Database Layer (Phase 2)

### Task 5: Rewrite database.js for PostgreSQL

**Files:**
- Modify: `server/src/database.js` (complete rewrite)

- [ ] **Step 1: Create test for database connection**

Create: `server/__tests__/PostgresDatabase.test.js`

```javascript
const { Pool } = require('pg');

// Mock the pg package
jest.mock('pg');

const Database = require('../src/database');

describe('PostgresDatabase', () => {
  let db;
  let mockPool;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      connect: jest.fn().mockResolvedValue(),
      release: jest.fn().mockResolvedValue(),
      query: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      end: jest.fn().mockResolvedValue()
    };

    Pool.mockImplementation(() => mockPool);
    db = new Database();
  });

  afterEach(async () => {
    await db.shutdown();
  });

  describe('initialize', () => {
    it('should connect to PostgreSQL successfully', async () => {
      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

      await db.initialize();

      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        connectionString: 'postgres://test:test@localhost:5432/test',
        min: 2,
        max: 10
      }));
    });

    it('should retry connection on failure', async () => {
      mockClient.connect.mockRejectedValueOnce(new Error('Connection refused'));
      mockClient.connect.mockRejectedValueOnce(new Error('Connection refused'));
      mockClient.connect.mockResolvedValueOnce();

      process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

      await expect(db.initialize()).resolves.not.toThrow();
      expect(mockClient.connect).toHaveBeenCalledTimes(3);
    });
  });

  describe('query', () => {
    it('should execute parameterized query and return rows', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1, name: 'test' }] });

      const result = await db.query('SELECT * FROM users WHERE id = $1', [1]);

      expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
      expect(result).toEqual([{ id: 1, name: 'test' }]);
    });
  });

  describe('queryOne', () => {
    it('should return first row or null', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1, name: 'test' }] });

      const result = await db.queryOne('SELECT * FROM users WHERE id = $1', [1]);

      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should return null when no rows found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await db.queryOne('SELECT * FROM users WHERE id = $1', [999]);

      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PostgresDatabase`
Expected: FAIL (database.js not yet rewritten)

- [ ] **Step 3: Rewrite database.js for PostgreSQL**

Replace entire file content:

```javascript
const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  async initialize() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable not set');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connection with retry logic
    const maxRetries = 5;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        await client.release();
        this.connected = true;
        console.log('[Database] Connected to PostgreSQL');
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          console.error('[Database] Failed to connect after', maxRetries, 'attempts');
          throw error;
        }
        console.warn(`[Database] Connection attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Execute parameterized query and return all rows
   */
  async query(text, params = []) {
    const result = await this.pool.query(text, params);
    return result.rows;
  }

  /**
   * Execute parameterized query and return single row or null
   */
  async queryOne(text, params = []) {
    const result = await this.pool.query(text, params);
    return result.rows[0] || null;
  }

  /**
   * Shutdown hook - close all pool connections
   */
  async shutdown() {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
      console.log('[Database] Pool closed');
    }
  }

  // ===========================================================================
  // Refresh Token Methods
  // ===========================================================================

  async insertRefreshToken(tokenData) {
    await this.query(
      `INSERT INTO refresh_tokens
       (token_id, type, room_id, user_id, expires_at, created_at, revoked_at, revoked_reason, rotated_to, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (token_id) DO UPDATE SET
         type = EXCLUDED.type,
         room_id = EXCLUDED.room_id,
         user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at,
         created_at = EXCLUDED.created_at,
         revoked_at = EXCLUDED.revoked_at,
         revoked_reason = EXCLUDED.revoked_reason,
         rotated_to = EXCLUDED.rotated_to,
         rotated_from = EXCLUDED.rotated_from`,
      [
        tokenData.tokenId,
        tokenData.type,
        tokenData.roomId,
        tokenData.userId,
        new Date(tokenData.expiresAt),
        new Date(tokenData.createdAt || Date.now()),
        tokenData.revokedAt ? new Date(tokenData.revokedAt) : null,
        tokenData.revokedReason || null,
        tokenData.rotatedTo || null,
        tokenData.rotatedFrom || null
      ]
    );
  }

  async getRefreshToken(tokenId) {
    return await this.queryOne(
      'SELECT * FROM refresh_tokens WHERE token_id = $1',
      [tokenId]
    );
  }

  async revokeRefreshToken(tokenId, reason = 'revoked') {
    await this.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = $1 WHERE token_id = $2',
      [reason, tokenId]
    );
  }

  async rotateRefreshToken(oldTokenId, newTokenId) {
    await this.query(
      'UPDATE refresh_tokens SET rotated_to = $1 WHERE token_id = $2',
      [newTokenId, oldTokenId]
    );
  }

  async getTokensByRoom(roomId) {
    return await this.query(
      `SELECT * FROM refresh_tokens
       WHERE room_id = $1 AND revoked_at IS NULL AND rotated_to IS NULL`,
      [roomId]
    );
  }

  async revokeTokensByRoom(roomId, reason = 'room deleted') {
    const result = await this.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = $1 WHERE room_id = $2',
      [reason, roomId]
    );
    return result.rowCount;
  }

  async cleanupExpiredTokens() {
    const result = await this.query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
    );
    return result.rowCount;
  }

  // ===========================================================================
  // User Methods
  // ===========================================================================

  async insertUser(user) {
    await this.query(
      `INSERT INTO users
       (id, username, password_hash, role, email, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         updated_at = NOW()`,
      [
        user.id,
        user.username,
        user.password_hash,
        user.role,
        user.email || null,
        user.display_name || null,
        user.created_at ? new Date(user.created_at) : new Date(),
        user.updated_at ? new Date(user.updated_at) : new Date()
      ]
    );
  }

  async getUserById(id) {
    return await this.queryOne(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
  }

  async getUserByUsername(username) {
    return await this.queryOne(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
  }

  async getAllUsers() {
    return await this.query(
      'SELECT id, username, role, email, display_name, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
  }

  async updateUserRole(userId, newRole) {
    await this.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
      [newRole, userId]
    );
  }

  async deleteUser(userId) {
    await this.query(
      'DELETE FROM users WHERE id = $1',
      [userId]
    );
  }

  // ===========================================================================
  // Role Methods
  // ===========================================================================

  async getRole(name) {
    return await this.queryOne(
      'SELECT * FROM roles WHERE name = $1',
      [name]
    );
  }

  async getAllRoles() {
    return await this.query(
      'SELECT * FROM roles ORDER BY hierarchy DESC'
    );
  }

  async getPermissionsForRole(role) {
    return await this.query(
      'SELECT * FROM role_permissions WHERE role = $1',
      [role]
    );
  }

  // ===========================================================================
  // Room Assignment Methods
  // ===========================================================================

  async insertRoomAssignment(assignment) {
    await this.query(
      `INSERT INTO room_assignments
       (id, user_id, room_id, assignment_role, granted_by, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, room_id) DO UPDATE SET
         assignment_role = EXCLUDED.assignment_role,
         granted_by = EXCLUDED.granted_by,
         granted_at = EXCLUDED.granted_at,
         expires_at = EXCLUDED.expires_at`,
      [
        assignment.id,
        assignment.user_id,
        assignment.room_id,
        assignment.assignment_role,
        assignment.granted_by || null,
        assignment.granted_at ? new Date(assignment.granted_at) : new Date(),
        assignment.expires_at ? new Date(assignment.expires_at) : null
      ]
    );
  }

  async getRoomAssignmentsForUser(userId) {
    return await this.query(
      `SELECT * FROM room_assignments
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
  }

  async getRoomAssignments(roomId) {
    return await this.query(
      `SELECT ra.*, u.username FROM room_assignments ra
       JOIN users u ON ra.user_id = u.id
       WHERE ra.room_id = $1`,
      [roomId]
    );
  }

  async removeRoomAssignment(userId, roomId) {
    await this.query(
      'DELETE FROM room_assignments WHERE user_id = $1 AND room_id = $2',
      [userId, roomId]
    );
  }

  // ===========================================================================
  // Stream Access Methods
  // ===========================================================================

  async grantStreamAccess(access) {
    await this.query(
      `INSERT INTO stream_access
       (id, user_id, stream_id, granted_by, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, stream_id) DO UPDATE SET
         granted_by = EXCLUDED.granted_by,
         granted_at = EXCLUDED.granted_at,
         expires_at = EXCLUDED.expires_at`,
      [
        access.id,
        access.user_id,
        access.stream_id,
        access.granted_by || null,
        access.granted_at ? new Date(access.granted_at) : new Date(),
        access.expires_at ? new Date(access.expires_at) : null
      ]
    );
  }

  async getStreamAccessForUser(userId) {
    return await this.query(
      `SELECT * FROM stream_access
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
  }

  async getStreamAccess(streamId) {
    return await this.query(
      `SELECT sa.*, u.username FROM stream_access sa
       JOIN users u ON sa.user_id = u.id
       WHERE sa.stream_id = $1`,
      [streamId]
    );
  }

  async revokeStreamAccess(userId, streamId) {
    await this.query(
      'DELETE FROM stream_access WHERE user_id = $1 AND stream_id = $2',
      [userId, streamId]
    );
  }

  // ===========================================================================
  // Seed Data
  // ===========================================================================

  async loadSeedData(seedFilePath) {
    const fs = require('fs');
    const sql = fs.readFileSync(seedFilePath, 'utf8');
    await this.query(sql);
    console.log('[Database] Seed data loaded from', seedFilePath);
  }

  // ===========================================================================
  // Legacy SQLite Methods (for backward compatibility - throw error if called)
  // ===========================================================================

  async getAllTables() {
    throw new Error('getAllTables not implemented for PostgreSQL');
  }

  async close() {
    console.warn('[Database] close() is deprecated, use shutdown() instead');
    await this.shutdown();
  }
}

module.exports = Database;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PostgresDatabase -t "should connect to PostgreSQL successfully"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/database.js server/__tests__/PostgresDatabase.test.js
git commit -m "feat: rewrite database.js for PostgreSQL with connection pooling"
```

---

### Task 6: Update index.js for DATABASE_URL initialization

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Locate the database initialization in startServer()**

- [ ] **Step 2: Update initialization to use new Database API**

The existing code already creates `const db = new Database();` and calls `await db.initialize();` - this should work with the rewritten database.js.

Add shutdown handler for database:

```javascript
// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Closed out remaining connections');

    // Shutdown database pool
    if (db && typeof db.shutdown === 'function') {
      db.shutdown().then(() => {
        console.log('[Database] Pool closed');
        process.exit(0);
      }).catch((err) => {
        console.error('[Database] Error closing pool:', err);
        process.exit(1);
      });
    } else {
      process.exit(0);
    }
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});
```

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "feat: add database pool shutdown handler"
```

---

## Chunk 3: TIMESTAMPTZ Migration (Phase 3)

### Task 7: Update TokenManager.js for TIMESTAMPTZ

**Files:**
- Modify: `server/src/TokenManager.js`

- [ ] **Step 1: Create test for TIMESTAMPTZ token generation**

Create: `server/__tests__/TokenManagerPostgres.test.js`

```javascript
const TokenManager = require('../src/TokenManager');

describe('TokenManager TIMESTAMPTZ', () => {
  let tokenManager;
  let mockRedis;
  let mockDb;

  beforeEach(() => {
    mockRedis = {
      isReady: () => true,
      setJson: jest.fn().mockResolvedValue(true),
      getJson: jest.fn().mockResolvedValue(null)
    };

    mockDb = {
      insertRefreshToken: jest.fn().mockResolvedValue(),
      getRefreshToken: jest.fn().mockResolvedValue(null),
      revokeRefreshToken: jest.fn().mockResolvedValue(),
      rotateRefreshToken: jest.fn().mockResolvedValue()
    };

    process.env.TOKEN_SECRET = 'test-secret-for-testing-only';
    tokenManager = new TokenManager(mockRedis, mockDb);
  });

  describe('generateTokenPair', () => {
    it('should use Date objects for TIMESTAMPTZ columns', async () => {
      await tokenManager.initialize();

      const result = await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'TEST',
        userId: 'user-123'
      });

      expect(mockDb.insertRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
          createdAt: expect.any(Date)
        })
      );
    });

    it('should set correct expiry times', async () => {
      await tokenManager.initialize();

      const now = Date.now();
      await tokenManager.generateTokenPair({
        type: 'room_access',
        roomId: 'TEST',
        userId: 'user-123'
      });

      const call = mockDb.insertRefreshToken.mock.calls[0][0];
      const expectedRefreshExpiry = now + (24 * 60 * 60 * 1000);

      // Allow 1 second tolerance
      expect(call.expiresAt.getTime()).toBeCloseTo(expectedRefreshExpiry, -3);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- TokenManagerPostgres`
Expected: FAIL

- [ ] **Step 3: Update TokenManager.js to use Date objects**

Modify the `generateTokenPair` method:

```javascript
async generateTokenPair(options) {
  const tokenId = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  // Generate access token (JWT)
  const accessToken = this._generateAccessToken({
    tokenId,
    ...options
  }, now);

  // Generate refresh token data with Date objects for TIMESTAMPTZ
  const refreshTokenExpiryMs = Date.now() + (this.refreshTokenExpiry * 1000);
  const refreshTokenData = {
    tokenId,
    type: options.type,
    roomId: options.roomId,
    userId: options.userId,
    expiresAt: new Date(refreshTokenExpiryMs),
    revoked: false,
    rotatedTo: null
  };

  // Store in Redis
  await this.redis.setJson(
    `refresh:${tokenId}`,
    refreshTokenData,
    this.refreshTokenExpiry
  );

  // Store in Database with Date objects
  await this.db.insertRefreshToken({
    tokenId,
    type: options.type,
    roomId: options.roomId,
    userId: options.userId,
    expiresAt: new Date(refreshTokenExpiryMs),
    createdAt: new Date()
  });

  return {
    accessToken,
    tokenId,
    expiresIn: this.accessTokenExpiry
  };
}
```

Update `revokeRefreshToken` call to use `new Date()`:

```javascript
// In revokeToken method - the database method now handles NOW() internally
await this.db.revokeRefreshToken(tokenId, reason);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- TokenManagerPostgres -t "should use Date objects"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/TokenManager.js server/__tests__/TokenManagerPostgres.test.js
git commit -m "feat: update TokenManager for TIMESTAMPTZ with Date objects"
```

---

### Task 8: Update UserManager.js for TIMESTAMPTZ

**Files:**
- Modify: `server/src/UserManager.js`

- [ ] **Step 1: Update createUser to use Date objects**

The current code creates timestamps like this:

```javascript
// Current (line ~54)
return {
  id: userId,
  username,
  role,
  displayName: displayName || null,
  email: email || null,
  createdAt: new Date().toISOString()
};
```

The database.js now handles the timestamp internally with `DEFAULT NOW()`, so we don't need to pass `created_at` in `insertUser`. Update the `insertUser` call in `createUser`:

```javascript
await this.db.insertUser({
  id: userId,
  username,
  password_hash: passwordHash,
  role,
  display_name: displayName || null,
  email: email || null
  // created_at and updated_at use DEFAULT NOW()
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/UserManager.js
git commit -m "feat: update UserManager to use PostgreSQL DEFAULT NOW() for timestamps"
```

---

### Task 9: Update RBACManager.js for TIMESTAMPTZ

**Files:**
- Modify: `server/src/RBACManager.js`

- [ ] **Step 1: Read current RBACManager.js to find timestamp usage**

- [ ] **Step 2: Update any date/time handling to use Date objects**

Similar pattern to UserManager - let PostgreSQL handle defaults. Update any explicit timestamp assignments to use `new Date()` or let PostgreSQL defaults handle it.

- [ ] **Step 3: Commit**

```bash
git add server/src/RBACManager.js
git commit -m "feat: update RBACManager for TIMESTAMPTZ"
```

---

## Chunk 4: Redis Caching (Phase 4)

### Task 10: Update RedisClient.js with additional caching helpers

**Files:**
- Modify: `server/src/RedisClient.js`

- [ ] **Step 1: Add invalidate method for cache invalidation**

Add to RedisClient.js:

```javascript
async invalidate(keys) {
  if (!this.connected) return false;

  const keyList = Array.isArray(keys) ? keys : [keys];
  if (keyList.length === 0) return false;

  await this.client.del(...keyList);
  return true;
}

async sadd(key, members) {
  if (!this.connected) return false;
  await this.client.sadd(key, ...members);
  return true;
}

async srem(key, members) {
  if (!this.connected) return false;
  await this.client.srem(key, ...members);
  return true;
}

async smembers(key) {
  if (!this.connected) return [];
  return this.client.smembers(key);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/RedisClient.js
git commit -m "feat: add Redis caching helper methods for cache invalidation"
```

---

### Task 11: Add Redis caching to UserManager.js

**Files:**
- Modify: `server/src/UserManager.js`

- [ ] **Step 1: Add getUserById with caching**

Add after the existing `getUserById` method:

```javascript
async getUserById(userId) {
  // Check cache first (5 min TTL)
  const cached = await this.redis.getJson(`user:${userId}`);
  if (cached) {
    return cached;
  }

  // Query database
  const user = await this.db.getUserById(userId);

  // Populate cache if found
  if (user) {
    await this.redis.setJson(`user:${userId}`, user, 300);
  }

  return user;
}
```

- [ ] **Step 2: Add cache invalidation for user updates**

Update `updateUserRole` to invalidate cache:

```javascript
async updateUserRole(userId, newRole, actorId) {
  // ... existing code ...

  await this.db.updateUserRole(userId, newRole);

  // Invalidate user cache
  await this.redis.del(`user:${userId}`);

  // Invalidate role permissions cache
  await this.redis.del(`role:permissions:${newRole}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/UserManager.js
git commit -m "feat: add Redis caching for user lookups in UserManager"
```

---

### Task 12: Add Redis caching to RBACManager.js

**Files:**
- Modify: `server/src/RBACManager.js`

- [ ] **Step 1: Read RBACManager.js to find getPermissionsForRole method**

- [ ] **Step 2: Add caching to getPermissionsForRole**

```javascript
async getPermissionsForRole(role) {
  // Check cache first (1 hour TTL)
  const cached = await this.redis.getJson(`role:permissions:${role}`);
  if (cached) {
    return cached;
  }

  // Query database
  const permissions = await this.db.getPermissionsForRole(role);

  // Populate cache if found
  if (permissions.length > 0) {
    await this.redis.setJson(`role:permissions:${role}`, permissions, 3600);
  }

  return permissions;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/RBACManager.js
git commit -m "feat: add Redis caching for role permissions in RBACManager"
```

---

### Task 13: Add Redis caching to RoomManager.js

**Files:**
- Modify: `server/src/RoomManager.js`

- [ ] **Step 1: Add Redis client to constructor**

```javascript
constructor(tokenManager = null, redisClient = null) {
  this.rooms = new Map();
  this.directors = new Map();
  this.roomTTL = 5 * 60 * 1000;
  this.tokenManager = tokenManager;
  this.redis = redisClient; // Add Redis client
  // ... existing code ...
}
```

- [ ] **Step 2: Add getRoom with caching**

```javascript
async getRoom(roomId) {
  // Check cache first (5 min TTL)
  if (this.redis) {
    const cached = await this.redis.getJson(`room:${roomId}:meta`);
    if (cached) {
      return cached;
    }
  }

  // Fallback to in-memory storage
  const room = this.rooms.get(roomId);

  // Populate cache if found
  if (room && this.redis) {
    await this.redis.setJson(`room:${roomId}:meta`, room, 300);
  }

  return room;
}
```

- [ ] **Step 3: Add getRoomParticipants with caching**

```javascript
async getRoomParticipants(roomId) {
  // Check cache first (30 sec TTL)
  if (this.redis) {
    const cached = await this.redis.getJson(`room:${roomId}:participants`);
    if (cached) {
      return cached;
    }
  }

  // Get from in-memory storage
  const room = this.rooms.get(roomId);
  if (!room) return [];

  const participants = Array.from(room.participants.values());

  // Populate cache
  if (this.redis) {
    await this.redis.setJson(`room:${roomId}:participants`, participants, 30);
  }

  return participants;
}
```

- [ ] **Step 4: Add invalidateRoomCache method**

```javascript
async invalidateRoomCache(roomId) {
  if (!this.redis) return;

  await this.redis.del(`room:${roomId}:meta`);
  await this.redis.del(`room:${roomId}:participants`);
  await this.redis.srem('active_rooms', [roomId]);
}
```

- [ ] **Step 5: Call invalidateRoomCache when rooms change**

Find where rooms are created/deleted and add cache invalidation calls.

- [ ] **Step 6: Commit**

```bash
git add server/src/RoomManager.js
git commit -m "feat: add Redis caching for room state in RoomManager"
```

---

## Chunk 5: Verification (Phase 5)

### Task 14: Remove sqlite3 dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove sqlite3 from dependencies**

```json
{
  "dependencies": {
    "bcrypt": "^6.0.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.6",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "express-session": "^1.19.0",
    "ioredis": "^5.10.0",
    "jsonwebtoken": "^9.0.3",
    "pg": "^8.11.3",
    "qrcode": "^1.5.4",
    "uuid": "^9.0.1",
    "ws": "^8.19.0"
  }
}
```

- [ ] **Step 2: Run npm install**

Run: `npm install`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove sqlite3 dependency after PostgreSQL migration"
```

---

### Task 15: Run all Jest unit tests

**Files:**
- All test files

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: If tests fail, fix issues**

Common issues to check:
- Mock the new Database query methods correctly
- Ensure Date objects are used consistently

- [ ] **Step 3: Commit when all tests pass**

```bash
git commit -am "fix: resolve test failures for PostgreSQL migration"
```

---

### Task 16: Docker Compose verification

**Files:**
- `docker-compose.yml`

- [ ] **Step 1: Start the full stack**

Run: `docker-compose up -d`
Expected: All containers start, postgres healthcheck passes

- [ ] **Step 2: Check PostgreSQL is healthy**

Run: `docker-compose ps`
Expected: postgres shows "(healthy)"

- [ ] **Step 3: Check signaling server logs**

Run: `docker-compose logs signaling`
Expected: "[Database] Connected to PostgreSQL"

- [ ] **Step 4: Verify database tables exist**

Run: `docker-compose exec postgres psql -U breadcall -c "\dt"`
Expected: All 6 tables listed

---

### Task 17: Test rollback procedure

**Files:**
- N/A

- [ ] **Step 1: Document rollback steps**

Create: `docs/rollback-postgres-migration.md`

```markdown
# Rollback Procedure: PostgreSQL Migration

## When to Rollback

Rollback if:
- PostgreSQL container won't start
- Signaling server can't connect to database
- Critical functionality broken after migration

## Steps

1. Stop the stack:
   ```bash
   docker-compose down
   ```

2. Comment out postgres service in docker-compose.yml

3. Revert database.js to SQLite version from git:
   ```bash
   git checkout HEAD~10 -- server/src/database.js
   ```

4. Reinstall sqlite3:
   ```bash
   npm install sqlite3@^6.0.1
   ```

5. Restart:
   ```bash
   docker-compose up -d
   ```

## Verification

- [ ] Signaling server starts successfully
- [ ] Login/auth works
- [ ] Room creation works
```

- [ ] **Step 2: Commit**

```bash
git add docs/rollback-postgres-migration.md
git commit -m "docs: add PostgreSQL migration rollback procedure"
```

---

## Post-Plan Checklist

- [ ] All chunks implemented and tested
- [ ] All unit tests passing
- [ ] Docker Compose stack running with PostgreSQL
- [ ] Redis caching verified working
- [ ] Rollback procedure documented
