# OLA + RBAC Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Object Level Authorization and Role-Based Access Control to replace the single-password admin system with a multi-role, object-scoped authorization system.

**Architecture:** Seven-role hierarchy (super_admin, room_admin, moderator, director, operator, participant, viewer) with JWT-based authentication. OLA claims embedded in JWT tokens for stateless authorization. Room and stream access scoped per-user via assignment tables.

**Tech Stack:** SQLite (existing), Redis (existing), jsonwebtoken, bcrypt, Express.js middleware, CSRF-protected fetch API.

---

## File Structure

### New Files to Create

| File | Responsibility |
|------|----------------|
| `server/src/RBACManager.js` | Role hierarchy, permission checks, user role validation |
| `server/src/OLAManager.js` | Room/stream assignments, scope resolution |
| `server/src/UserManager.js` | User CRUD operations, password hashing |
| `server/src/bootstrap.js` | Super Admin initialization from env var |
| `server/database/migrations/001-rbac-ola-schema.sql` | Database schema creation |
| `server/database/seed/001-roles-permissions.sql` | Initial roles and permissions data |
| `server/__tests__/RBACManager.test.js` | RBAC unit tests |
| `server/__tests__/OLAManager.test.js` | OLA unit tests |
| `server/__tests__/UserManager.test.js` | User management unit tests |
| `server/__tests__/integration/auth-integration.test.js` | Auth flow integration tests |
| `client/js/AuthService.js` | Client-side auth (login/logout/refresh) |
| `client/js/OLAAwareClient.js` | OLA-aware API client wrapper |

### Files to Modify

| File | Changes |
|------|---------|
| `server/src/database.js` | Add RBAC/OLA tables, user queries |
| `server/src/AuthMiddleware.js` | Replace session-based with JWT-based auth |
| `server/src/TokenManager.js` | Add OLA claims to JWT payload |
| `server/src/index.js` | New auth/user/assignment endpoints, remove old admin routes |
| `client/js/AdminDashboard.js` | User management UI, role assignments |
| `.env` | Add SUPER_ADMIN_PASSWORD, TOKEN_SECRET |

---

## Chunk 1: Database Schema and Migrations

### Task 1: Create Database Migration File

**Files:**
- Create: `server/database/migrations/001-rbac-ola-schema.sql`
- Test: `server/__tests__/database.test.js`

- [ ] **Step 1: Write migration SQL file**

```sql
-- Migration: 001-rbac-ola-schema
-- Date: 2026-03-14
-- Description: Create RBAC and OLA database schema

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  name VARCHAR(50) PRIMARY KEY,
  hierarchy INTEGER NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  email VARCHAR(255),
  display_name VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Role permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  object_type VARCHAR(50) NOT NULL,
  PRIMARY KEY (role, permission, object_type)
);

-- Room assignments table (OLA)
CREATE TABLE IF NOT EXISTS room_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id VARCHAR(10) NOT NULL,
  assignment_role VARCHAR(50) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  UNIQUE(user_id, room_id)
);

-- Stream access table (OLA)
CREATE TABLE IF NOT EXISTS stream_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_id VARCHAR(255) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  UNIQUE(user_id, stream_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id);
CREATE INDEX IF NOT EXISTS idx_stream_access_user ON stream_access(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_access_stream ON stream_access(stream_id);
```

- [ ] **Step 2: Commit migration file**

```bash
git add server/database/migrations/001-rbac-ola-schema.sql
git commit -m "feat: add RBAC/OLA database migration schema"
```

### Task 2: Create Seed Data File

**Files:**
- Create: `server/database/seed/001-roles-permissions.sql`

- [ ] **Step 1: Write seed SQL file**

```sql
-- Seed Data: Roles and Permissions
-- Date: 2026-03-14

-- Roles (hierarchy: higher = more privileged)
INSERT OR REPLACE INTO roles (name, hierarchy, description) VALUES
  ('super_admin', 100, 'Full system access'),
  ('room_admin', 80, 'Create and manage own rooms'),
  ('moderator', 60, 'Manage participants in assigned rooms'),
  ('director', 50, 'View and control streams, generate SRT'),
  ('operator', 40, 'Read-only monitoring'),
  ('participant', 20, 'Join rooms, send audio/video'),
  ('viewer', 10, 'View single stream, SoloView, SRT link');

-- Role Permissions
INSERT OR REPLACE INTO role_permissions (role, permission, object_type) VALUES
  -- Super Admin (all permissions)
  ('super_admin', '*', 'system'),
  ('super_admin', '*', 'room'),
  ('super_admin', '*', 'stream'),
  ('super_admin', '*', 'user'),

  -- Room Admin
  ('room_admin', 'create', 'room'),
  ('room_admin', 'delete', 'room'),
  ('room_admin', 'update', 'room'),
  ('room_admin', 'assign', 'room'),
  ('room_admin', 'promote', 'user'),

  -- Moderator
  ('moderator', 'mute', 'room'),
  ('moderator', 'kick', 'room'),
  ('moderator', 'update_settings', 'room'),

  -- Director
  ('director', 'view_all', 'room'),
  ('director', 'switch_scenes', 'room'),
  ('director', 'generate_srt', 'room'),

  -- Operator
  ('operator', 'view_analytics', 'system'),
  ('operator', 'view_monitoring', 'system'),

  -- Participant
  ('participant', 'join', 'room'),
  ('participant', 'send_audio', 'room'),
  ('participant', 'send_video', 'room'),
  ('participant', 'chat', 'room'),

  -- Viewer
  ('viewer', 'view', 'stream'),
  ('viewer', 'generate_srt', 'stream'),
  ('viewer', 'view_solo', 'stream');
```

- [ ] **Step 2: Commit seed file**

```bash
git add server/database/seed/001-roles-permissions.sql
git commit -m "feat: add initial roles and permissions seed data"
```

### Task 3: Update Database Class

**Files:**
- Modify: `server/src/database.js:30-55`
- Test: `server/__tests__/database.test.js`

- [ ] **Step 1: Write failing test for RBAC tables**

Add to `server/__tests__/database.test.js`:

```javascript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- database.test.js
```
Expected: FAIL with method not defined errors

- [ ] **Step 3: Update database.js with RBAC tables in _createTables**

Modify `server/src/database.js:30-55`:

```javascript
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
      if (err) { reject(err); return; }

      // RBAC/OLA Tables
      this.db.run(`
        CREATE TABLE IF NOT EXISTS roles (
          name VARCHAR(50) PRIMARY KEY,
          hierarchy INTEGER NOT NULL UNIQUE,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err2) => {
        if (err2) { reject(err2); return; }

        this.db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
            email VARCHAR(255),
            display_name VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err3) => {
          if (err3) { reject(err3); return; }

          this.db.run(`
            CREATE TABLE IF NOT EXISTS role_permissions (
              role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
              permission VARCHAR(100) NOT NULL,
              object_type VARCHAR(50) NOT NULL,
              PRIMARY KEY (role, permission, object_type)
            )
          `, (err4) => {
            if (err4) { reject(err4); return; }

            this.db.run(`
              CREATE TABLE IF NOT EXISTS room_assignments (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                room_id VARCHAR(10) NOT NULL,
                assignment_role VARCHAR(50) NOT NULL,
                granted_by TEXT REFERENCES users(id),
                granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                UNIQUE(user_id, room_id)
              )
            `, (err5) => {
              if (err5) { reject(err5); return; }

              this.db.run(`
                CREATE TABLE IF NOT EXISTS stream_access (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  stream_id VARCHAR(255) NOT NULL,
                  granted_by TEXT REFERENCES users(id),
                  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  expires_at DATETIME,
                  UNIQUE(user_id, stream_id)
                )
              `, (err6) => {
                if (err6) { reject(err6); return; }

                // Create indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`, (err7) => {
                  if (err7) { reject(err7); return; }
                  this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`, (err8) => {
                    if (err8) { reject(err8); return; }
                    this.db.run(`CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments(user_id)`, (err9) => {
                      if (err9) { reject(err9); return; }
                      this.db.run(`CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id)`, (err10) => {
                        if (err10) { reject(err10); return; }
                        this.db.run(`CREATE INDEX IF NOT EXISTS idx_stream_access_user ON stream_access(user_id)`, (err11) => {
                          if (err11) { reject(err11); return; }
                          this.db.run(`CREATE INDEX IF NOT EXISTS idx_stream_access_stream ON stream_access(stream_id)`, (err12) => {
                            if (err12) { reject(err12); return; }
                            console.log('[Database] RBAC/OLA tables and indexes created');
                            resolve();
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}
```

- [ ] **Step 4: Add user CRUD methods to Database class**

Add to end of `server/src/database.js` before `module.exports`:

```javascript
async insertUser(userData) {
  return new Promise((resolve, reject) => {
    this.db.run(
      `INSERT INTO users (id, username, password_hash, role, email, display_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userData.id,
        userData.username,
        userData.password_hash,
        userData.role,
        userData.email || null,
        userData.display_name || null
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

async getUserById(id) {
  return new Promise((resolve, reject) => {
    this.db.get(
      'SELECT id, username, role, email, display_name, created_at, updated_at FROM users WHERE id = ?',
      [id],
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

async getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    this.db.get(
      'SELECT * FROM users WHERE username = ?',
      [username],
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

async getAllUsers() {
  return new Promise((resolve, reject) => {
    this.db.all(
      'SELECT id, username, role, email, display_name, created_at, updated_at FROM users',
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

async updateUserRole(userId, newRole) {
  return new Promise((resolve, reject) => {
    this.db.run(
      'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newRole, userId],
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

async deleteUser(userId) {
  return new Promise((resolve, reject) => {
    this.db.run(
      'DELETE FROM users WHERE id = ?',
      [userId],
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

async getRole(name) {
  return new Promise((resolve, reject) => {
    this.db.get(
      'SELECT * FROM roles WHERE name = ?',
      [name],
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

async getAllRoles() {
  return new Promise((resolve, reject) => {
    this.db.all(
      'SELECT * FROM roles ORDER BY hierarchy DESC',
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

async getRolePermissions(role) {
  return new Promise((resolve, reject) => {
    this.db.all(
      'SELECT permission, object_type FROM role_permissions WHERE role = ? OR role = ?',
      [role, 'super_admin'],
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- database.test.js
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/database.js server/__tests__/database.test.js
git commit -m "feat: add RBAC/OLA tables and user CRUD methods to database"
```

### Task 4: Apply Seed Data on Startup

**Files:**
- Modify: `server/src/index.js:108-128`

- [ ] **Step 1: Update index.js to apply seed data**

Modify `initializeDependencies` function in `server/src/index.js`:

```javascript
async function initializeDependencies() {
  try {
    await redisClient.connect();
    console.log('[Index] Redis client connected');

    await database.initialize();
    console.log('[Index] Database initialized');

    // Apply seed data if roles table is empty
    const roles = await database.getAllRoles();
    if (roles.length === 0) {
      console.log('[Index] Seeding initial roles and permissions...');
      const seedPath = path.join(__dirname, '../database/seed/001-roles-permissions.sql');
      const seedData = fs.readFileSync(seedPath, 'utf8');
      await database.db.exec(seedData);
      console.log('[Index] Seed data applied');
    }

    await tokenManager.initialize();
    console.log('[Index] TokenManager initialized');

    roomManager.setTokenManager(tokenManager);
    console.log('[Index] RoomManager initialized with TokenManager');
  } catch (error) {
    console.error('[Index] Failed to initialize dependencies:', error.message);
  }
}
```

Note: Add `const fs = require('fs');` at top of index.js if not present.

- [ ] **Step 2: Commit**

```bash
git add server/src/index.js
git commit -m "feat: apply seed data on server startup"
```

---

## Chunk 2: RBACManager and OLAManager Core Logic

### Task 5: Implement RBACManager

**Files:**
- Create: `server/src/RBACManager.js`
- Test: `server/__tests__/RBACManager.test.js`

- [ ] **Step 1: Write failing tests for RBACManager**

Create `server/__tests__/RBACManager.test.js`:

```javascript
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
        ('viewer', 10, 'View single stream');

      INSERT INTO role_permissions (role, permission, object_type) VALUES
        ('super_admin', '*', 'system'),
        ('super_admin', '*', 'room'),
        ('room_admin', 'create', 'room'),
        ('room_admin', 'delete', 'room'),
        ('moderator', 'mute', 'room'),
        ('director', 'view_all', 'room'),
        ('viewer', 'view', 'stream');
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

    test('room_admin can create rooms', async () => {
      const hasPerm = await rbacManager.hasPermission('room_admin', 'create', 'room');
      expect(hasPerm).toBe(true);
    });

    test('room_admin cannot mute (moderator permission)', async () => {
      const hasPerm = await rbacManager.hasPermission('room_admin', 'mute', 'room');
      expect(hasPerm).toBe(false);
    });

    test('viewer can view streams', async () => {
      const hasPerm = await rbacManager.hasPermission('viewer', 'view', 'stream');
      expect(hasPerm).toBe(true);
    });
  });

  describe('canAccessHigherRole', () => {
    test('super_admin can access all roles', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('super_admin', 'viewer');
      expect(canAccess).toBe(true);
    });

    test('room_admin cannot access super_admin', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('room_admin', 'super_admin');
      expect(canAccess).toBe(false);
    });

    test('moderator can access viewer', async () => {
      const canAccess = await rbacManager.canAccessHigherRole('moderator', 'viewer');
      expect(canAccess).toBe(true);
    });
  });

  describe('getAllPermissions', () => {
    test('returns all permissions for a role', async () => {
      const perms = await rbacManager.getAllPermissions('room_admin');
      expect(perms).toContainEqual({ permission: 'create', object_type: 'room' });
      expect(perms).toContainEqual({ permission: 'delete', object_type: 'room' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- RBACManager.test.js
```
Expected: FAIL - module not found

- [ ] **Step 3: Implement RBACManager**

Create `server/src/RBACManager.js`:

```javascript
const { v4: uuidv4 } = require('uuid');

class RBACManager {
  constructor(database) {
    this.db = database;
    this.roleCache = new Map();
  }

  async initialize() {
    const roles = await this.db.getAllRoles();
    for (const role of roles) {
      const permissions = await this.db.getRolePermissions(role.name);
      this.roleCache.set(role.name, {
        ...role,
        permissions
      });
    }
    console.log(`[RBACManager] Initialized with ${this.roleCache.size} roles`);
  }

  async getRoleHierarchy(roleName) {
    const role = this.roleCache.get(roleName);
    if (!role) {
      const dbRole = await this.db.getRole(roleName);
      if (dbRole) {
        this.roleCache.set(roleName, dbRole);
        return dbRole.hierarchy;
      }
      return null;
    }
    return role.hierarchy;
  }

  async hasPermission(roleName, permission, objectType) {
    const role = this.roleCache.get(roleName);
    if (!role) return false;

    if (roleName === 'super_admin') return true;

    const hasWildcard = role.permissions.some(
      p => p.permission === '*' && (p.object_type === objectType || p.object_type === 'system')
    );
    if (hasWildcard) return true;

    return role.permissions.some(
      p => p.permission === permission && (p.object_type === objectType || p.object_type === 'system')
    );
  }

  async canAccessHigherRole(actorRole, targetRole) {
    const actorHierarchy = await this.getRoleHierarchy(actorRole);
    const targetHierarchy = await this.getRoleHierarchy(targetRole);

    if (actorHierarchy === null || targetHierarchy === null) return false;

    return actorHierarchy > targetHierarchy;
  }

  async canAssignRole(actorRole, targetRole) {
    const hasAssignPerm = await this.hasPermission(actorRole, 'assign', 'room');
    const canPromote = await this.hasPermission(actorRole, 'promote', 'user');
    const canAccess = await this.canAccessHigherRole(actorRole, targetRole);

    return (hasAssignPerm || canPromote) && canAccess;
  }

  async getAllPermissions(roleName) {
    const role = this.roleCache.get(roleName);
    if (!role) return [];
    return role.permissions;
  }

  getAllRoles() {
    return Array.from(this.roleCache.values()).map(r => ({
      name: r.name,
      hierarchy: r.hierarchy,
      description: r.description
    }));
  }

  async invalidateCache(roleName = null) {
    if (roleName) {
      this.roleCache.delete(roleName);
      const role = await this.db.getRole(roleName);
      if (role) {
        const permissions = await this.db.getRolePermissions(roleName);
        this.roleCache.set(roleName, { ...role, permissions });
      }
    } else {
      this.roleCache.clear();
      const roles = await this.db.getAllRoles();
      for (const role of roles) {
        const permissions = await this.db.getRolePermissions(role.name);
        this.roleCache.set(role.name, { ...role, permissions });
      }
    }
  }
}

module.exports = RBACManager;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- RBACManager.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/RBACManager.js server/__tests__/RBACManager.test.js
git commit -m "feat: implement RBACManager with role hierarchy and permission checks"
```

### Task 6: Implement OLAManager

**Files:**
- Create: `server/src/OLAManager.js`
- Test: `server/__tests__/OLAManager.test.js`

- [ ] **Step 1: Write failing tests for OLAManager**

Create `server/__tests__/OLAManager.test.js`:

```javascript
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

    await db.db.exec(`
      INSERT INTO users (id, username, password_hash, role) VALUES
        ('user-1', 'admin', 'hash1', 'super_admin'),
        ('user-2', 'mod1', 'hash2', 'moderator'),
        ('user-3', 'viewer1', 'hash3', 'viewer');
    `);

    rbac = new RBACManager(db);
    await rbac.initialize();

    olaManager = new OLAManager(db, rbac);
    await olaManager.initialize();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe('assignRoom', () => {
    test('assigns user to room', async () => {
      const assignment = await olaManager.assignRoom('user-2', 'ABC123', 'moderator', 'user-1');
      expect(assignment).toBeTruthy();
      expect(assignment.user_id).toBe('user-2');
      expect(assignment.room_id).toBe('ABC123');
    });
  });

  describe('removeRoomAssignment', () => {
    test('removes room assignment', async () => {
      await olaManager.assignRoom('user-3', 'XYZ789', 'viewer', 'user-1');
      const removed = await olaManager.removeRoomAssignment('user-3', 'XYZ789');
      expect(removed).toBe(true);
    });
  });

  describe('getUserRoomAssignments', () => {
    test('returns all room assignments for user', async () => {
      await olaManager.assignRoom('user-2', 'ROOM1', 'moderator', 'user-1');
      await olaManager.assignRoom('user-2', 'ROOM2', 'director', 'user-1');

      const assignments = await olaManager.getUserRoomAssignments('user-2');
      expect(assignments.length).toBe(2);
    });
  });

  describe('canAccessRoom', () => {
    test('super_admin can access any room', async () => {
      const canAccess = await olaManager.canAccessRoom('user-1', 'ANYROOM');
      expect(canAccess.canAccess).toBe(true);
    });

    test('user with assignment can access room', async () => {
      const canAccess = await olaManager.canAccessRoom('user-2', 'ABC123');
      expect(canAccess.canAccess).toBe(true);
    });

    test('user without assignment cannot access room', async () => {
      const canAccess = await olaManager.canAccessRoom('user-3', 'ABC123');
      expect(canAccess.canAccess).toBe(false);
    });
  });

  describe('grantStreamAccess', () => {
    test('grants user access to stream', async () => {
      const grant = await olaManager.grantStreamAccess('user-3', 'ABC123_user1', 'user-1');
      expect(grant).toBeTruthy();
      expect(grant.stream_id).toBe('ABC123_user1');
    });
  });

  describe('canAccessStream', () => {
    test('user with stream access can view stream', async () => {
      await olaManager.grantStreamAccess('user-3', 'STREAM1', 'user-1');
      const canAccess = await olaManager.canAccessStream('user-3', 'STREAM1');
      expect(canAccess).toBe(true);
    });

    test('super_admin can access any stream', async () => {
      const canAccess = await olaManager.canAccessStream('user-1', 'ANYSTREAM');
      expect(canAccess).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- OLAManager.test.js
```
Expected: FAIL - module not found

- [ ] **Step 3: Implement OLAManager**

Create `server/src/OLAManager.js`:

```javascript
const { v4: uuidv4 } = require('uuid');

class OLAManager {
  constructor(database, rbacManager) {
    this.db = database;
    this.rbac = rbacManager;
  }

  async initialize() {
    console.log('[OLAManager] Initialized');
  }

  async assignRoom(userId, roomId, assignmentRole, grantedBy, expiresAt = null) {
    const id = uuidv4();

    return new Promise((resolve, reject) => {
      this.db.db.run(`
        INSERT OR REPLACE INTO room_assignments
        (id, user_id, room_id, assignment_role, granted_by, granted_at, expires_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `, [id, userId, roomId, assignmentRole, grantedBy, expiresAt], (err) => {
        if (err) reject(err);
        else resolve({
          id,
          user_id: userId,
          room_id: roomId,
          assignment_role: assignmentRole,
          granted_by: grantedBy,
          expires_at: expiresAt
        });
      });
    });
  }

  async removeRoomAssignment(userId, roomId) {
    return new Promise((resolve, reject) => {
      this.db.db.run(
        'DELETE FROM room_assignments WHERE user_id = ? AND room_id = ?',
        [userId, roomId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  async getUserRoomAssignments(userId) {
    return new Promise((resolve, reject) => {
      this.db.db.all(
        `SELECT ra.*, u.username as grantedByUsername
         FROM room_assignments ra
         LEFT JOIN users u ON ra.granted_by = u.id
         WHERE ra.user_id = ? AND (ra.expires_at IS NULL OR ra.expires_at > CURRENT_TIMESTAMP)`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async getRoomAssignments(roomId) {
    return new Promise((resolve, reject) => {
      this.db.db.all(
        `SELECT ra.*, u.username, u.role
         FROM room_assignments ra
         JOIN users u ON ra.user_id = u.id
         WHERE ra.room_id = ? AND (ra.expires_at IS NULL OR ra.expires_at > CURRENT_TIMESTAMP)`,
        [roomId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async canAccessRoom(userId, roomId) {
    const user = await this.db.getUserById(userId);
    if (!user) return { canAccess: false, role: null };
    if (user.role === 'super_admin') return { canAccess: true, role: 'super_admin' };

    const assignments = await this.getUserRoomAssignments(userId);
    const roomAssignment = assignments.find(a => a.room_id === roomId);

    if (roomAssignment) {
      return {
        canAccess: true,
        role: roomAssignment.assignment_role
      };
    }

    return { canAccess: false, role: null };
  }

  async getUserRoomRole(userId, roomId) {
    const result = await this.canAccessRoom(userId, roomId);
    return result.role;
  }

  async grantStreamAccess(userId, streamId, grantedBy, expiresAt = null) {
    const id = uuidv4();

    return new Promise((resolve, reject) => {
      this.db.db.run(`
        INSERT OR REPLACE INTO stream_access
        (id, user_id, stream_id, granted_by, granted_at, expires_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `, [id, userId, streamId, grantedBy, expiresAt], (err) => {
        if (err) reject(err);
        else resolve({
          id,
          user_id: userId,
          stream_id: streamId,
          granted_by: grantedBy,
          expires_at: expiresAt
        });
      });
    });
  }

  async revokeStreamAccess(userId, streamId) {
    return new Promise((resolve, reject) => {
      this.db.db.run(
        'DELETE FROM stream_access WHERE user_id = ? AND stream_id = ?',
        [userId, streamId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  async getUserStreamAccess(userId) {
    return new Promise((resolve, reject) => {
      this.db.db.all(
        `SELECT sa.*, u.username as grantedByUsername
         FROM stream_access sa
         LEFT JOIN users u ON sa.granted_by = u.id
         WHERE sa.user_id = ? AND (sa.expires_at IS NULL OR sa.expires_at > CURRENT_TIMESTAMP)`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async getStreamAccess(streamId) {
    return new Promise((resolve, reject) => {
      this.db.db.all(
        `SELECT sa.*, u.username, u.role
         FROM stream_access sa
         JOIN users u ON sa.user_id = u.id
         WHERE sa.stream_id = ? AND (sa.expires_at IS NULL OR sa.expires_at > CURRENT_TIMESTAMP)`,
        [streamId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async canAccessStream(userId, streamId) {
    const user = await this.db.getUserById(userId);
    if (!user) return false;
    if (['super_admin', 'room_admin'].includes(user.role)) return true;

    const access = await this.getUserStreamAccess(userId);
    return access.some(a => a.stream_id === streamId);
  }

  async getOLAClaims(userId) {
    const roomAssignments = await this.getUserRoomAssignments(userId);
    const streamAccess = await this.getUserStreamAccess(userId);

    const rooms = {};
    for (const assignment of roomAssignments) {
      rooms[assignment.room_id] = {
        role: assignment.assignment_role,
        expiresAt: assignment.expires_at
      };
    }

    const streams = streamAccess.map(s => s.stream_id);

    return { rooms, streams };
  }
}

module.exports = OLAManager;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- OLAManager.test.js
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/OLAManager.js server/__tests__/OLAManager.test.js
git commit -m "feat: implement OLAManager for room and stream access control"
```

---

## Chunk 3: Authentication and User Management

### Task 7: Implement UserManager

**Files:**
- Create: `server/src/UserManager.js`
- Test: `server/__tests__/UserManager.test.js`

- [ ] **Step 1: Write failing tests for UserManager**

Create `server/__tests__/UserManager.test.js`:

```javascript
const UserManager = require('../src/UserManager');
const Database = require('../src/database');
const RBACManager = require('../src/RBACManager');

describe('UserManager', () => {
  let userManager;
  let db;
  let rbac;

  beforeAll(async () => {
    db = new Database(':memory:');
    await db.initialize();

    await db.db.exec(`
      INSERT INTO roles (name, hierarchy, description) VALUES
        ('super_admin', 100, 'Full system access'),
        ('room_admin', 80, 'Create and manage own rooms'),
        ('moderator', 60, 'Manage participants in assigned rooms'),
        ('participant', 20, 'Join rooms, send audio/video');
    `);

    rbac = new RBACManager(db);
    await rbac.initialize();

    userManager = new UserManager(db, rbac);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe('createUser', () => {
    test('creates a new user with hashed password', async () => {
      const user = await userManager.createUser({
        username: 'testuser',
        password: 'securepassword123',
        role: 'participant',
        displayName: 'Test User'
      });

      expect(user).toBeTruthy();
      expect(user.username).toBe('testuser');
      expect(user.role).toBe('participant');
    });

    test('throws error for duplicate username', async () => {
      await userManager.createUser({
        username: 'duplicate',
        password: 'password1',
        role: 'participant'
      });

      await expect(userManager.createUser({
        username: 'duplicate',
        password: 'password2',
        role: 'participant'
      })).rejects.toThrow('Username already exists');
    });

    test('throws error for invalid role', async () => {
      await expect(userManager.createUser({
        username: 'badrole',
        password: 'password1',
        role: 'nonexistent'
      })).rejects.toThrow('Invalid role');
    });
  });

  describe('authenticateUser', () => {
    test('authenticates valid credentials', async () => {
      await userManager.createUser({
        username: 'loginuser',
        password: 'correctpassword',
        role: 'participant'
      });

      const result = await userManager.authenticateUser('loginuser', 'correctpassword');
      expect(result.success).toBe(true);
      expect(result.user.username).toBe('loginuser');
    });

    test('rejects wrong password', async () => {
      const result = await userManager.authenticateUser('loginuser', 'wrongpassword');
      expect(result.success).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- UserManager.test.js
```
Expected: FAIL - module not found

- [ ] **Step 3: Implement UserManager**

Create `server/src/UserManager.js`:

```javascript
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

class UserManager {
  constructor(database, rbacManager) {
    this.db = database;
    this.rbac = rbacManager;
    this.passwordCost = 12;
  }

  async initialize() {
    console.log('[UserManager] Initialized');
  }

  async hashPassword(password) {
    return bcrypt.hash(password, this.passwordCost);
  }

  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  async createUser(userData) {
    const { username, password, role, displayName, email } = userData;

    const roleData = await this.db.getRole(role);
    if (!roleData) {
      throw new Error('Invalid role');
    }

    const existingUser = await this.db.getUserByUsername(username);
    if (existingUser) {
      throw new Error('Username already exists');
    }

    const passwordHash = await this.hashPassword(password);
    const userId = uuidv4();

    await this.db.insertUser({
      id: userId,
      username,
      password_hash: passwordHash,
      role,
      display_name: displayName || null,
      email: email || null
    });

    return {
      id: userId,
      username,
      role,
      displayName: displayName || null,
      email: email || null,
      createdAt: new Date().toISOString()
    };
  }

  async authenticateUser(username, password) {
    const user = await this.db.getUserByUsername(username);

    if (!user) {
      return { success: false, error: 'Invalid credentials' };
    }

    const valid = await this.verifyPassword(password, user.password_hash);

    if (!valid) {
      return { success: false, error: 'Invalid credentials' };
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        email: user.email
      }
    };
  }

  async getUserById(userId) {
    return this.db.getUserById(userId);
  }

  async getAllUsers() {
    return this.db.getAllUsers();
  }

  async updateUserRole(userId, newRole, actorId) {
    const actor = await this.db.getUserById(actorId);
    if (!actor) {
      throw new Error('Actor not found');
    }

    const canAssign = await this.rbac.canAssignRole(actor.role, newRole);
    if (!canAssign && actor.role !== 'super_admin') {
      throw new Error('Insufficient permissions to change role');
    }

    const roleData = await this.db.getRole(newRole);
    if (!roleData) {
      throw new Error('Invalid role');
    }

    await this.db.updateUserRole(userId, newRole);

    return {
      id: userId,
      role: newRole,
      updatedAt: new Date().toISOString()
    };
  }

  async deleteUser(userId, actorId = null) {
    if (actorId) {
      const actor = await this.db.getUserById(actorId);
      const target = await this.db.getUserById(userId);

      if (!actor || !target) {
        throw new Error('User not found');
      }

      const canDelete = await this.rbac.canAccessHigherRole(actor.role, target.role);
      if (!canDelete && actor.role !== 'super_admin') {
        throw new Error('Insufficient permissions to delete this user');
      }
    }

    await this.db.deleteUser(userId);
    return true;
  }

  async createBootstrapAdmin(username, password) {
    const existingAdmin = await this.db.getUserByUsername(username);
    if (existingAdmin) {
      return { exists: true, user: existingAdmin };
    }

    return {
      exists: false,
      user: await this.createUser({
        username,
        password,
        role: 'super_admin',
        displayName: 'System Administrator'
      })
    };
  }
}

module.exports = UserManager;
```

- [ ] **Step 4: Install bcrypt dependency**

```bash
npm install bcrypt
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- UserManager.test.js
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/UserManager.js server/__tests__/UserManager.test.js
git commit -m "feat: implement UserManager with bcrypt password hashing"
```

### Task 8: Update AuthMiddleware for JWT Auth

**Files:**
- Modify: `server/src/AuthMiddleware.js`
- Test: `server/__tests__/AuthMiddleware.test.js`

- [ ] **Step 1: Rewrite AuthMiddleware.js**

Replace contents of `server/src/AuthMiddleware.js`:

```javascript
class AuthMiddleware {
  constructor(database, rbacManager, tokenManager) {
    this.db = database;
    this.rbac = rbacManager;
    this.tokenManager = tokenManager;
  }

  async authenticate(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { authenticated: false, error: 'No token provided' };
    }

    const token = authHeader.substring(7);
    const validation = await this.tokenManager.validateAccessToken(token);

    if (!validation.valid) {
      return {
        authenticated: false,
        error: `Token ${validation.reason}`
      };
    }

    const user = await this.db.getUserById(validation.payload.userId);
    if (!user) {
      return { authenticated: false, error: 'User not found' };
    }

    return {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        permissions: validation.payload.permissions
      },
      tokenPayload: validation.payload
    };
  }

  requireAuth() {
    return async (req, res, next) => {
      const result = await this.authenticate(req);

      if (!result.authenticated) {
        return res.status(401).json({
          success: false,
          error: `Unauthorized - ${result.error}`
        });
      }

      req.user = result.user;
      req.tokenPayload = result.tokenPayload;
      next();
    };
  }

  requirePermission(permission, objectType) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const hasPerm = await this.rbac.hasPermission(req.user.role, permission, objectType);

      if (!hasPerm) {
        return res.status(403).json({
          success: false,
          error: `Forbidden - ${req.user.role} role does not have ${permission} permission for ${objectType}`
        });
      }

      next();
    };
  }
}

module.exports = AuthMiddleware;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/AuthMiddleware.js
git commit -m "feat: replace session auth with JWT-based AuthMiddleware"
```

### Task 9: Update TokenManager for OLA Claims

**Files:**
- Modify: `server/src/TokenManager.js:73-87`

- [ ] **Step 1: Update _generateAccessToken method**

Modify `server/src/TokenManager.js`:

```javascript
_generateAccessToken(payload, iat) {
  const jwtPayload = {
    iss: this.tokenIssuer,
    aud: this.tokenAudience,
    sub: payload.userId,
    tokenId: payload.tokenId,
    type: payload.type,
    roomId: payload.roomId,
    userId: payload.userId,
    permissions: payload.permissions,
    iat,
    exp: iat + this.accessTokenExpiry
  };

  if (payload.olaClaims) {
    jwtPayload.ola = payload.olaClaims;
  }

  return jwt.sign(jwtPayload, this.tokenSecret, { algorithm: 'HS256' });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/TokenManager.js
git commit -m "feat: add OLA claims support to JWT tokens"
```

### Task 10: Implement Bootstrap Script

**Files:**
- Create: `server/src/bootstrap.js`

- [ ] **Step 1: Create bootstrap.js**

Create `server/src/bootstrap.js`:

```javascript
const Database = require('./database');
const RBACManager = require('./RBACManager');
const UserManager = require('./UserManager');

async function bootstrap() {
  const db = new Database();

  try {
    await db.initialize();
    console.log('[Bootstrap] Database initialized');

    const rbac = new RBACManager(db);
    await rbac.initialize();

    const userManager = new UserManager(db, rbac);
    await userManager.initialize();

    const adminUsername = process.env.SUPER_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.warn('[Bootstrap] WARNING: No SUPER_ADMIN_PASSWORD or ADMIN_PASSWORD set');
      console.warn('[Bootstrap] Please set these environment variables for security!');
      return null;
    }

    const result = await userManager.createBootstrapAdmin(adminUsername, adminPassword);

    if (result.exists) {
      console.log(`[Bootstrap] Super admin user '${adminUsername}' already exists`);
    } else {
      console.log(`[Bootstrap] Created super admin user '${adminUsername}'`);
    }

    return { username: adminUsername, exists: result.exists };
  } catch (error) {
    console.error('[Bootstrap] Error:', error.message);
    throw error;
  }
}

module.exports = bootstrap;
```

- [ ] **Step 2: Update index.js to call bootstrap**

Add at top of `server/src/index.js`:
```javascript
const bootstrap = require('./bootstrap');
```

Modify `initializeDependencies` to call `await bootstrap();` after seed data is applied.

- [ ] **Step 3: Commit**

```bash
git add server/src/bootstrap.js server/src/index.js
git commit -m "feat: add bootstrap script for super admin initialization"
```

---

## Chunk 4: API Endpoints

### Task 11: Implement Auth Endpoints

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Add auth endpoints to index.js**

Add after CSRF middleware setup in `server/src/index.js`:

```javascript
// Initialize managers
const rbacManager = new RBACManager(database);
const olaManager = new OLAManager(database, rbacManager);
const userManager = new UserManager(database, rbacManager);

// Initialize RBAC managers after dependencies
async function initializeDependencies() {
  // ... existing code ...
  await rbacManager.initialize();
  await olaManager.initialize();
  await userManager.initialize();
  await bootstrap();
  // ... rest of code ...
}
```

Add auth endpoints (replace old admin routes section):

```javascript
// =============================================================================
// Authentication Endpoints
// =============================================================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password required'
      });
    }

    const authResult = await userManager.authenticateUser(username, password);

    if (!authResult.success) {
      return res.status(401).json({
        success: false,
        error: authResult.error || 'Invalid credentials'
      });
    }

    const olaClaims = await olaManager.getOLAClaims(authResult.user.id);

    const tokenPair = await tokenManager.generateTokenPair({
      type: 'user_token',
      userId: authResult.user.id,
      roomId: null,
      permissions: await rbacManager.getAllPermissions(authResult.user.role),
      includeOLAClaims: true,
      olaClaims
    });

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.USE_SECURE_COOKIES === 'true',
      sameSite: 'lax',
      path: '/',
      maxAge: 900 * 1000
    };

    res.cookie('accessToken', tokenPair.accessToken, cookieOptions);
    res.cookie('refreshToken', tokenPair.tokenId, {
      httpOnly: true,
      secure: process.env.USE_SECURE_COOKIES === 'true',
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.tokenId,
      expiresIn: tokenPair.expiresIn,
      user: authResult.user
    });
  } catch (error) {
    console.error('[API] Login error:', error.message);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.post('/api/auth/logout', authMiddleware.requireAuth(), async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await tokenManager.revokeToken(refreshToken, 'logout');
    }
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.json({ success: true, message: 'Logout successful' });
  } catch (error) {
    console.error('[API] Logout error:', error.message);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

app.get('/api/auth/me', authMiddleware.requireAuth(), async (req, res) => {
  try {
    const user = await userManager.getUserById(req.user.id);
    const permissions = await rbacManager.getAllPermissions(req.user.role);
    const olaClaims = await olaManager.getOLAClaims(req.user.id);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        email: user.email
      },
      permissions,
      ola: olaClaims
    });
  } catch (error) {
    console.error('[API] Get user error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to get user info' });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/index.js
git commit -m "feat: add JWT-based auth endpoints (/api/auth/*)"
```

---

## Chunk 5: Frontend Updates

### Task 12: Create AuthService

**Files:**
- Create: `client/js/AuthService.js`

- [ ] **Step 1: Create AuthService**

Create `client/js/AuthService.js` (full implementation in plan document - see earlier chunk for complete code).

- [ ] **Step 2: Commit**

```bash
git add client/js/AuthService.js
git commit -m "feat: create AuthService for client-side authentication"
```

### Task 13: Update AdminDashboard

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add user management UI**

Add user management tab and methods to `AdminDashboard.js`.

- [ ] **Step 2: Commit**

```bash
git add client/js/AdminDashboard.js
git commit -m "feat: add user management UI to AdminDashboard"
```

---

## Testing Summary

### Unit Tests
- [ ] RBACManager.test.js
- [ ] OLAManager.test.js
- [ ] UserManager.test.js
- [ ] AuthMiddleware.test.js
- [ ] TokenManager.test.js (updated)

### Integration Tests
- [ ] auth-endpoints.test.js
- [ ] user-management-endpoints.test.js
- [ ] room-assignment-endpoints.test.js
- [ ] stream-access-endpoints.test.js

### E2E Tests (Manual)
- [ ] Super Admin login and dashboard access
- [ ] Create new user with participant role
- [ ] Promote user to moderator
- [ ] Assign moderator to room
- [ ] Moderator can mute/kick in assigned room
- [ ] Viewer can only access assigned stream
- [ ] Token refresh works seamlessly
- [ ] Logout revokes tokens

---

## Environment Variables

Update `.env`:

```bash
# RBAC/OLA Configuration
SUPER_ADMIN_USERNAME=admin
SUPER_ADMIN_PASSWORD=B@chtam2001
TOKEN_SECRET=your-jwt-secret-change-in-production

# Keep existing
ADMIN_PASSWORD=B@chtam2001
SESSION_SECRET=...
CSRF_SECRET=...
```

---

## Execution Notes

**After completing all tasks:**

1. Update `.env` with `SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD`
2. Restart server to apply migrations and bootstrap admin
3. Test login at `/admin` with bootstrap credentials
4. Verify user management works
5. Test room assignments and OLA enforcement

**Files Modified Summary:**
- `server/src/database.js`
- `server/src/AuthMiddleware.js`
- `server/src/TokenManager.js`
- `server/src/index.js`
- `client/js/AdminDashboard.js`

**Files Created Summary:**
- `server/database/migrations/001-rbac-ola-schema.sql`
- `server/database/seed/001-roles-permissions.sql`
- `server/src/RBACManager.js`
- `server/src/OLAManager.js`
- `server/src/UserManager.js`
- `server/src/bootstrap.js`
- `client/js/AuthService.js`
- Test files
