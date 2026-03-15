# PostgreSQL Migration Design Spec

**Date:** 2026-03-15
**Author:** Claude Code
**Status:** Pending Review
**Related:** SQLite to PostgreSQL migration with Redis optimization

---

## 1. Overview

Migrate BreadCall from SQLite to PostgreSQL for production hardening, with Redis caching optimization for frequently-accessed data.

### 1.1 Motivation

- **Production hardening** - Better backup/monitoring tooling
- **Data persistence** - Container-safe storage via Docker volumes
- **Concurrent writes** - PostgreSQL handles multi-writer workloads
- **Type safety** - Stronger typing catches bugs earlier

### 1.2 Scope

- Replace SQLite with PostgreSQL 17 Alpine
- Migrate all timestamps from `INTEGER` (ms) to `TIMESTAMPTZ`
- Add Redis caching layer for users, permissions, and room state
- Maintain existing public API on Database class

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────┐ │
│  │  Signaling   │────▶│   Redis      │◀────│ PostgreSQL │ │
│  │  (Node.js)   │◀────│   (Cache)    │     │  (Source)  │ │
│  │  :3000       │     │  :6379       │     │   :5432    │ │
│  └──────────────┘     └──────────────┘     └────────────┘ │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐                                          │
│  │   MediaMTX   │                                          │
│  │   :8887      │                                          │
│  └──────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

**Token Storage Architecture:**

- **PostgreSQL**: Source of truth for all refresh tokens (persistent storage)
- **Redis**: Revocation cache only (fast lookup for revoked tokens)
- Token generation writes to PostgreSQL first, then updates Redis revocation cache if needed

**Read path (with cache):**
1. Request arrives (e.g., `getUserById`)
2. Check Redis cache first
3. On miss, query PostgreSQL
4. Populate cache with TTL
5. Return result

**Write path:**
1. Write to PostgreSQL (source of truth)
2. Invalidate related cache keys
3. Return result

---

## 3. PostgreSQL Schema

### 3.1 Tables

**Note:** Self-referential foreign keys (`rotated_to`, `rotated_from`) are added after table creation to avoid circular dependency issues during initialization.

```sql
-- refresh_tokens table (created first without FK constraints)
CREATE TABLE refresh_tokens (
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

-- Add self-referential foreign keys after table exists
ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_rotated_to
  FOREIGN KEY (rotated_to) REFERENCES refresh_tokens(token_id);

ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_rotated_from
  FOREIGN KEY (rotated_from) REFERENCES refresh_tokens(token_id);

-- roles table
CREATE TABLE roles (
  name VARCHAR(50) PRIMARY KEY,
  hierarchy INTEGER NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- users table
CREATE TABLE users (
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
CREATE TABLE role_permissions (
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  object_type VARCHAR(50) NOT NULL,
  PRIMARY KEY (role, permission, object_type)
);

-- room_assignments table
CREATE TABLE room_assignments (
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
CREATE TABLE stream_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_id VARCHAR(255) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, stream_id)
);
```

### 3.2 Indexes

```sql
-- User indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- Refresh token indexes (critical for auth performance)
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);
CREATE INDEX idx_refresh_tokens_rotated ON refresh_tokens(rotated_to);
CREATE INDEX idx_refresh_tokens_type ON refresh_tokens(type);
CREATE INDEX idx_refresh_tokens_revoked ON refresh_tokens(revoked_at);

-- Room assignment indexes
CREATE INDEX idx_room_assignments_user ON room_assignments(user_id);
CREATE INDEX idx_room_assignments_room ON room_assignments(room_id);

-- Stream access indexes
CREATE INDEX idx_stream_access_user ON stream_access(user_id);
CREATE INDEX idx_stream_access_stream ON stream_access(stream_id);
```

---

## 4. Docker Configuration

### 4.1 docker-compose.yml Changes

```yaml
services:
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

  signaling:
    # ... existing config ...
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgres://breadcall:${DB_PASSWORD:-changeme}@postgres:5432/breadcall
      - DB_POOL_MIN=2
      - DB_POOL_MAX=10

# Note: Pool tuning guidance
# - DB_POOL_MIN: Start with 2, increase if you see connection churn
# - DB_POOL_MAX: Start with 10, monitor pool.waitingCount under load
# - Typical WebRTC signaling: 2-10 is sufficient for 100-500 concurrent users
# - If pool.waitingCount > 0 consistently, increase DB_POOL_MAX
```

### 4.2 Volume Definition

```yaml
volumes:
  postgres-data:
```

---

## 5. Database Class Implementation

### 5.1 Connection Setup

```javascript
const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async initialize() {
    // Test connection with retry logic
    const maxRetries = 5;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        await client.release();
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
   * Shutdown hook - close all pool connections
   */
  async shutdown() {
    await this.pool.end();
    console.log('[Database] Pool closed');
  }
}
```

### 5.2 Query Method Pattern

```javascript
// All queries use parameterized statements with $1, $2, etc.
async query(text, params) {
  const result = await this.pool.query(text, params);
  return result.rows;
}

async queryOne(text, params) {
  const result = await this.pool.query(text, params);
  return result.rows[0] || null;
}
```

### 5.3 Method Signature Compatibility

All existing public methods maintain their signatures:

| Method | Current | New |
|--------|---------|-----|
| `getUserByUsername(username)` | `Promise<Object|null>` | `Promise<Object|null>` |
| `insertUser(user)` | `Promise<void>` | `Promise<void>` |
| `getAllUsers()` | `Promise<Array>` | `Promise<Array>` |
| `getRefreshToken(tokenId)` | `Promise<Object|null>` | `Promise<Object|null>` |

---

## 6. Timestamp Migration

### 6.1 Schema Changes

| SQLite | PostgreSQL |
|--------|------------|
| `expiresAt INTEGER` | `expires_at TIMESTAMPTZ NOT NULL` |
| `createdAt INTEGER` | `created_at TIMESTAMPTZ DEFAULT NOW()` |
| `revokedAt INTEGER` | `revoked_at TIMESTAMPTZ` |
| `grantedAt INTEGER` | `granted_at TIMESTAMPTZ DEFAULT NOW()` |

### 6.2 Code Changes

**Token generation:**
```javascript
// Before (SQLite)
const expiresAt = Date.now() + (15 * 60 * 1000);
await this.db.run('INSERT ... VALUES (?, ...)', [expiresAt, ...]);

// After (PostgreSQL)
const expiresAt = new Date(Date.now() + (15 * 60 * 1000));
await this.db.query('INSERT ... VALUES ($1, ...)', [expiresAt, ...]);
```

**Token expiry queries:**
```javascript
// Before (SQLite)
'SELECT * FROM refresh_tokens WHERE expiresAt < ?', [Date.now()]

// After (PostgreSQL)
// Option A: Use NOW() directly (no parameter needed)
'SELECT * FROM refresh_tokens WHERE expires_at < NOW()'

// Option B: Pass JavaScript Date as parameter (for custom thresholds)
'SELECT * FROM refresh_tokens WHERE expires_at < $1', [new Date()]
```

**Date comparisons in queries:**

When you need to pass a JavaScript Date object as a parameter, the `pg` driver automatically converts it to a PostgreSQL timestamp:

```javascript
// JavaScript Date object → TIMESTAMPTZ
const threshold = new Date(); // or new Date(timestamp)
await db.query('SELECT * FROM tokens WHERE expires_at > $1', [threshold]);

// For interval-based queries, use PostgreSQL INTERVAL
await db.query("SELECT * FROM tokens WHERE created_at > NOW() - INTERVAL '1 hour'");
```

---

## 7. Redis Caching Layer

### 7.1 Cache Keys

```javascript
// User cache (5 min TTL)
user:{userId}

// Role permissions cache (1 hour TTL)
role:permissions:{roleName}

// Active room participants (30 sec TTL)
room:{roomId}:participants

// Token revocation (existing)
revoked:{tokenId}
```

### 7.2 Cache Strategy

**Note:** Use existing `RedisClient` helper methods (`getJson`, `setJson`) rather than raw `get()`/`setex()` calls.

```javascript
// UserManager.js - getUserById
async getUserById(userId) {
  // Check cache first
  const cached = await this.redis.getJson(`user:${userId}`);
  if (cached) {
    return cached;
  }

  // Query database
  const user = await this.db.queryOne(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );

  // Populate cache (5 min TTL)
  if (user) {
    await this.redis.setJson(`user:${userId}`, user, 300);
  }

  return user;
}

// RBACManager.js - getPermissionsForRole
async getPermissionsForRole(role) {
  // Check cache first (1 hour TTL)
  const cached = await this.redis.getJson(`role:permissions:${role}`);
  if (cached) {
    return cached;
  }

  // Query database
  const permissions = await this.db.query(
    'SELECT * FROM role_permissions WHERE role = $1',
    [role]
  );

  // Populate cache
  if (permissions.length > 0) {
    await this.redis.setJson(`role:permissions:${role}`, permissions, 3600);
  }

  return permissions;
}
```

### 7.3 Cache Invalidation

| Event | Invalidate Keys |
|-------|-----------------|
| User created/updated | `user:{userId}` |
| User role changed | `user:{userId}`, `role:permissions:{oldRole}`, `role:permissions:{newRole}` |
| Permission added/removed | `role:permissions:{roleName}` |
| User joins room | `room:{roomId}:participants` |
| User leaves room | `room:{roomId}:participants` |
| Token revoked | `revoked:{tokenId}` |

**Note:** Use existing `RedisClient` helper methods (`getJson`, `setJson`) rather than raw `JSON.parse` on `get()` results. See Section 9.2 for `RedisClient.js` updates.

### 7.4 RoomManager Caching Strategy

**Cache keys for room state:**

```javascript
// Active rooms set (for listing)
active_rooms

// Room participants list (30 sec TTL - high churn)
room:{roomId}:participants

// Room metadata (5 min TTL)
room:{roomId}:meta
```

**Cache methods:**

```javascript
// RoomManager.js - getRoom (with caching)
async getRoom(roomId) {
  // Check cache first
  const cached = await this.redis.getJson(`room:${roomId}:meta`);
  if (cached) {
    return cached;
  }

  // Fallback to in-memory storage (RoomManager stores rooms in memory)
  const room = this.rooms.get(roomId);
  if (room) {
    await this.redis.setJson(`room:${roomId}:meta`, room, 300);
  }
  return room;
}

// RoomManager.js - getRoomParticipants (with caching)
async getRoomParticipants(roomId) {
  // Check cache first
  const cached = await this.redis.getJson(`room:${roomId}:participants`);
  if (cached) {
    return cached;
  }

  // Get from in-memory storage
  const room = this.rooms.get(roomId);
  if (!room) return [];

  const participants = Array.from(room.participants.values());

  // Populate cache (30 sec TTL)
  await this.redis.setJson(`room:${roomId}:participants`, participants, 30);
  return participants;
}

// RoomManager.js - invalidate room cache on changes
async invalidateRoomCache(roomId) {
  await this.redis.del(`room:${roomId}:meta`);
  await this.redis.del(`room:${roomId}:participants`);
  // Also remove from active rooms set
  await this.redis.srem('active_rooms', roomId);
}
```

**Invalidation triggers:**
- Room created → Add to `active_rooms`, populate `room:{roomId}:meta`
- Room deleted → Remove from `active_rooms`, delete all `room:{roomId}:*` keys
- Participant joined → Invalidate `room:{roomId}:participants`
- Participant left → Invalidate `room:{roomId}:participants`

---

## 8. Environment Variables

### 8.1 Required Variables

```bash
# PostgreSQL
DATABASE_URL=postgres://breadcall:changeme@postgres:5432/breadcall
DB_PASSWORD=changeme
DB_POOL_MIN=2
DB_POOL_MAX=10

# Redis (existing)
REDIS_URL=redis://redis:6379
```

### 8.2 .env.example Updates

Add the above to `.env.example` for documentation.

---

## 9. Files to Create/Modify

### 9.1 Create

| File | Purpose |
|------|---------|
| `server/database/migrations/001-postgres-schema.sql` | Full PostgreSQL schema with indexes |
| `docs/superpowers/specs/2026-03-15-postgres-migration-design.md` | This spec document |

### 9.2 Modify

| File | Changes |
|------|---------|
| `docker-compose.yml` | Add postgres service, update signaling depends_on |
| `server/src/database.js` | Complete rewrite for PostgreSQL with pg package |
| `server/src/TokenManager.js` | TIMESTAMPTZ date handling |
| `server/src/UserManager.js` | TIMESTAMPTZ + Redis caching |
| `server/src/RBACManager.js` | TIMESTAMPTZ + Redis caching |
| `server/src/RoomManager.js` | Redis caching for room state |
| `server/src/RedisClient.js` | Add caching helper methods |
| `server/src/index.js` | DATABASE_URL initialization |
| `package.json` | Add pg, remove sqlite3 |
| `.env.example` | Add DATABASE_URL, DB_POOL_* variables |

---

## 10. Testing Checklist

### 10.1 Infrastructure

- [ ] PostgreSQL container starts successfully
- [ ] PostgreSQL healthcheck passes
- [ ] Signaling server connects to PostgreSQL
- [ ] Connection pool initializes correctly

### 10.2 Authentication

- [ ] User registration creates record in PostgreSQL
- [ ] User login validates against PostgreSQL
- [ ] JWT token generation works
- [ ] Token rotation works (recursive FK)
- [ ] Token expiry queries work with TIMESTAMPTZ

### 10.3 RBAC/OLA

- [ ] Role permissions load correctly
- [ ] User role assignments work
- [ ] Room assignments work
- [ ] Stream access grants work

### 10.4 Redis Caching

- [ ] User lookups use cache
- [ ] Permission lookups use cache
- [ ] Cache invalidation works on updates
- [ ] Token revocation cache works

### 10.5 Existing Tests

- [ ] All Jest unit tests pass
- [ ] All integration tests pass
- [ ] E2E tests pass (if applicable)

### 10.6 Rollback Verification

- [ ] Rollback procedure tested and verified
- [ ] SQLite fallback works correctly
- [ ] Data integrity verified after rollback

---

## 11. Rollback Plan

If issues arise during migration:

1. **Revert docker-compose.yml** - Comment out postgres service
2. **Restore sqlite3** - Reinstall if already removed
3. **Revert database.js** - Use git to restore SQLite version
4. **Data** - SQLite file remains untouched (fresh setup, no data loss)

---

## 12. Implementation Order

**Phase 1: Foundation**
1. Update `package.json` - Add `pg` dependency (required before database.js rewrite)
2. Create PostgreSQL schema file (`server/database/migrations/001-postgres-schema.sql`)
3. Update `docker-compose.yml` - Add postgres service
4. Update `.env.example` - Add DATABASE_URL, DB_POOL_* variables

**Phase 2: Database Layer**
5. Rewrite `database.js` for PostgreSQL (includes startup connectivity check)
6. Update `server/src/index.js` - DATABASE_URL initialization, startup verification

**Phase 3: TIMESTAMPTZ Migration**
7. Update `TokenManager.js` - TIMESTAMPTZ date handling
8. Update `UserManager.js` - TIMESTAMPTZ dates
9. Update `RBACManager.js` - TIMESTAMPTZ dates

**Phase 4: Redis Caching**
10. Update `RedisClient.js` - Add caching helper methods (`getJson`, `setJson`, `invalidate`)
11. Update `UserManager.js` - Add Redis caching for user lookups
12. Update `RBACManager.js` - Add Redis caching for permissions
13. Update `RoomManager.js` - Add Redis caching for room state (see Section 14)

**Phase 5: Verification**
14. Run Jest unit tests
15. Verify in Docker Compose stack
16. Test rollback procedure

---

## 13. Success Criteria

- PostgreSQL container runs stably with healthcheck passing
- All existing functionality works unchanged from user perspective
- Redis caching reduces database load for frequent queries
- All automated tests pass
- No data migration required (fresh setup)
