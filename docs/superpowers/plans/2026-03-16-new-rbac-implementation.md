# New RBAC Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the new RBAC system with system-level and object-level roles, granular permissions (resource:action format), and guest session support.

**Architecture:** Two-tier role system: System roles (super_admin, room_admin, operator) for global permissions; Object-Level roles (director, co_director, moderator, publisher, participant, viewer) assigned per-room. Permissions use `resource:action` format. Guest sessions supported via room_participants table.

**Tech Stack:** Node.js, Express, PostgreSQL, Redis caching

---

## Chunk 1: Database Schema Updates

### Task 1: Update room_assignments table for guest support

**Files:**
- Modify: `server/database/migrations/001-postgres-schema.sql` (lines 50-66)

- [ ] **Step 1: Add room_participants table for guest sessions**

Replace the room_assignments section with two tables:

```sql
-- Room Participants (supports both registered users and guest sessions)
CREATE TABLE IF NOT EXISTS room_participants (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(4) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL for guests
  guest_session_id VARCHAR(64),  -- For non-registered users
  role VARCHAR(50) NOT NULL,  -- director, co_director, moderator, publisher, participant, viewer
  display_name VARCHAR(255),
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(room_id, user_id),  -- One active role per registered user per room
  UNIQUE(room_id, guest_session_id)  -- One active role per guest session per room
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user ON room_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_guest ON room_participants(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_active ON room_participants(room_id, is_active);

-- Room Assignments (for persistent room ownership/management)
CREATE TABLE IF NOT EXISTS room_assignments (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(4) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_role VARCHAR(50) NOT NULL,  -- director, co_director, moderator
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id);
CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments(user_id);
```

- [ ] **Step 2: Commit schema changes**

```bash
git add server/database/migrations/001-postgres-schema.sql
git commit -m "feat: add room_participants table for guest session support"
```

---

## Chunk 2: Update Seed Data with New Permissions

### Task 2: Replace old permissions with new granular format

**Files:**
- Modify: `server/database/seed/001-roles-permissions.sql`

- [ ] **Step 1: Replace entire seed file with new RBAC structure**

```sql
-- Seed Data: Roles and Permissions (New RBAC Design)
-- Date: 2026-03-16

-- ============================================================================
-- SYSTEM ROLES (Global permissions)
-- ============================================================================
INSERT INTO roles (name, hierarchy, description) VALUES
  ('super_admin', 100, 'Full system access - can do everything'),
  ('room_admin', 80, 'Can create and manage rooms, assign directors'),
  ('operator', 40, 'Read-only monitoring and analytics access')
ON CONFLICT (name) DO UPDATE SET
  hierarchy = EXCLUDED.hierarchy,
  description = EXCLUDED.description;

-- ============================================================================
-- OBJECT-LEVEL ROLES (Assigned per-room)
-- ============================================================================
INSERT INTO roles (name, hierarchy, description) VALUES
  ('director', 60, 'Full control over assigned rooms - scenes, SRT, mute/kick'),
  ('co_director', 50, 'Can assist director - switch scenes, moderate chat'),
  ('moderator', 40, 'Can mute/kick participants, manage chat'),
  ('publisher', 30, 'Can publish audio/video streams'),
  ('participant', 20, 'Can join room, send audio/video, chat'),
  ('viewer', 10, 'View-only access to streams')
ON CONFLICT (name) DO UPDATE SET
  hierarchy = EXCLUDED.hierarchy,
  description = EXCLUDED.description;

-- ============================================================================
-- SYSTEM ROLE PERMISSIONS (resource:action format)
-- ============================================================================

-- Super Admin: Has wildcard permission on everything
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('super_admin', '*', 'system'),
  ('super_admin', '*', 'room'),
  ('super_admin', '*', 'user'),
  ('super_admin', '*', 'stream'),
  ('super_admin', '*', 'analytics')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Room Admin: Can manage rooms and assign directors
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('room_admin', 'room:create', 'system'),
  ('room_admin', 'room:delete', 'system'),
  ('room_admin', 'room:update', 'system'),
  ('room_admin', 'room:view_all', 'system'),
  ('room_admin', 'room:assign_director', 'system'),
  ('room_admin', 'user:view', 'system'),
  ('room_admin', 'user:manage_roles', 'system')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Operator: Read-only system access
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('operator', 'analytics:view', 'system'),
  ('operator', 'monitoring:view', 'system'),
  ('operator', 'room:view_all', 'system')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- ============================================================================
-- OBJECT-LEVEL ROLE PERMISSIONS (for room-specific operations)
-- ============================================================================

-- Director: Full room control
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('director', 'room:view', 'room'),
  ('director', 'room:manage_settings', 'room'),
  ('director', 'user:kick', 'room'),
  ('director', 'user:mute', 'room'),
  ('director', 'stream:switch_scene', 'room'),
  ('director', 'stream:generate_srt', 'room'),
  ('director', 'stream:view_all', 'room'),
  ('director', 'chat:moderate', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Co-Director: Can assist with scenes and chat
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('co_director', 'room:view', 'room'),
  ('co_director', 'user:mute', 'room'),
  ('co_director', 'stream:switch_scene', 'room'),
  ('co_director', 'stream:view_all', 'room'),
  ('co_director', 'chat:moderate', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Moderator: Chat and participant management
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('moderator', 'room:view', 'room'),
  ('moderator', 'user:kick', 'room'),
  ('moderator', 'user:mute', 'room'),
  ('moderator', 'chat:moderate', 'room'),
  ('moderator', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Publisher: Can publish media
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('publisher', 'room:view', 'room'),
  ('publisher', 'stream:publish', 'room'),
  ('publisher', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Participant: Join and participate
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('participant', 'room:view', 'room'),
  ('participant', 'stream:publish', 'room'),
  ('participant', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Viewer: View-only
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('viewer', 'room:view', 'room'),
  ('viewer', 'stream:view', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- ============================================================================
-- DELETE OLD PERMISSIONS (cleanup)
-- ============================================================================
DELETE FROM role_permissions WHERE permission IN (
  'create', 'delete', 'update', 'assign', 'promote', 'mute', 'kick',
  'view_all', 'switch_scenes', 'generate_srt', 'view_analytics',
  'view_monitoring', 'join', 'send_audio', 'send_video', 'chat', 'view_solo'
);
```

- [ ] **Step 2: Commit seed changes**

```bash
git add server/database/seed/001-roles-permissions.sql
git commit -m "feat: implement new RBAC permissions with resource:action format"
```

---

## Chunk 3: Update RBACManager

### Task 3: Update RBACManager to support new permission format

**Files:**
- Modify: `server/src/RBACManager.js`

- [ ] **Step 1: Update hasPermission to support resource:action format**

Replace the hasPermission method (lines 109-126):

```javascript
  /**
   * Check if a role has a specific permission
   * Supports both legacy format (permission, objectType) and new format (resource:action)
   * @param {string} roleName - The role name
   * @param {string} permission - The permission to check (e.g., 'room:create', 'user:kick')
   * @param {string} objectType - Optional object type for legacy compatibility
   * @returns {Promise<boolean>} - True if the role has the permission
   */
  async hasPermission(roleName, permission, objectType = null) {
    const role = this.roleCache.get(roleName);
    if (!role) return false;

    // Super admin has all permissions
    if (roleName === 'super_admin') return true;

    // Parse permission if in resource:action format
    let resource, action;
    if (permission.includes(':')) {
      [resource, action] = permission.split(':');
    } else {
      // Legacy format fallback
      resource = objectType || 'system';
      action = permission;
    }

    // Check for wildcard permissions
    const hasWildcard = role.permissions.some(
      p => p.permission === '*' && (p.object_type === resource || p.object_type === 'system')
    );
    if (hasWildcard) return true;

    // Check for specific resource:action permission
    const hasSpecific = role.permissions.some(
      p => p.permission === `${resource}:${action}` &&
           (p.object_type === resource || p.object_type === 'system')
    );
    if (hasSpecific) return true;

    // Check for resource:* wildcard (all actions on this resource)
    const hasResourceWildcard = role.permissions.some(
      p => p.permission === `${resource}:*` &&
           (p.object_type === resource || p.object_type === 'system')
    );
    if (hasResourceWildcard) return true;

    return false;
  }
```

- [ ] **Step 2: Add method to check room-specific permissions**

Add new method after hasPermission (after line 145):

```javascript
  /**
   * Check if a user has a specific permission in a room context
   * Combines system role permissions with room assignment permissions
   * @param {string} userRole - User's system role
   * @param {string} roomRole - User's role in the specific room (or null)
   * @param {string} permission - Permission to check (resource:action)
   * @returns {Promise<boolean>} - True if allowed
   */
  async hasRoomPermission(userRole, roomRole, permission) {
    // First check system role (global permissions)
    const hasSystemPerm = await this.hasPermission(userRole, permission);
    if (hasSystemPerm) return true;

    // If no room role, deny
    if (!roomRole) return false;

    // Check room-specific role permissions
    return await this.hasPermission(roomRole, permission);
  }

  /**
   * Get all permissions for a role in a formatted way
   * @param {string} roleName - The role name
   * @returns {Promise<Array>} - Array of permission strings in resource:action format
   */
  async getFormattedPermissions(roleName) {
    const role = this.roleCache.get(roleName);
    if (!role) return [];

    return role.permissions.map(p => {
      if (p.permission === '*') return `${p.object_type}:*`;
      return p.permission;
    });
  }
```

- [ ] **Step 3: Update canAssignRole to use new permission format**

Replace canAssignRole method (lines 148-156):

```javascript
  /**
   * Check if an actor role can assign a target role to someone
   * @param {string} actorRole - The actor's system role
   * @param {string} targetRole - The role being assigned
   * @returns {Promise<boolean>} - True if actor can assign the target role
   */
  async canAssignRole(actorRole, targetRole) {
    // Must have room:assign_director permission
    const hasAssignPerm = await this.hasPermission(actorRole, 'room:assign_director');
    if (!hasAssignPerm) return false;

    // Can only assign roles lower than their own
    const canAccess = await this.canAccessHigherRole(actorRole, targetRole);
    return canAccess;
  }
```

- [ ] **Step 4: Commit RBACManager changes**

```bash
git add server/src/RBACManager.js
git commit -m "feat: update RBACManager for new permission format and room context"
```

---

## Chunk 4: Update API Routes

### Task 4: Update monitoring routes with new permissions

**Files:**
- Modify: `server/src/routes/monitoring.js`

- [ ] **Step 1: Update permission checks to use new format**

Replace lines 16-21 and 51-56:

```javascript
  router.get('/status', async (req, res) => {
    const rbacManager = req.app.locals.rbacManager;
    const hasPermission = await rbacManager.hasPermission(req.user.role, 'analytics:view') ||
                          await rbacManager.hasPermission(req.user.role, 'monitoring:view');
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
```

```javascript
  router.get('/rooms', async (req, res) => {
    const rbacManager = req.app.locals.rbacManager;
    const hasPermission = await rbacManager.hasPermission(req.user.role, 'room:view_all') ||
                          await rbacManager.hasPermission(req.user.role, 'monitoring:view');
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
```

- [ ] **Step 2: Commit monitoring route changes**

```bash
git add server/src/routes/monitoring.js
git commit -m "refactor: update monitoring routes to use new permission format"
```

### Task 5: Update user routes with new permissions

**Files:**
- Modify: `server/src/routes/user.js`

- [ ] **Step 1: Update permission check to use new format**

Replace lines 22-26:

```javascript
    const rbacManager = req.app.locals.rbacManager;
    const hasPermission = await rbacManager.hasPermission(req.user.role, 'room:view') ||
                          await rbacManager.hasPermission(req.user.role, 'room:view_all');
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
```

- [ ] **Step 2: Commit user route changes**

```bash
git add server/src/routes/user.js
git commit -m "refactor: update user routes to use new permission format"
```

---

## Chunk 5: Update AuthMiddleware

### Task 6: Enhance requirePermission middleware

**Files:**
- Modify: `server/src/AuthMiddleware.js`

- [ ] **Step 1: Update requirePermission to support both formats**

Replace the requirePermission method (lines 87-107):

```javascript
  /**
   * Express middleware function that requires a specific permission
   * Supports both legacy format and new resource:action format
   * @param {string} permission - The permission required (e.g., 'room:create', 'user:kick')
   * @param {string} objectType - Optional object type for legacy compatibility
   * @returns {Function} - Express middleware function
   */
  requirePermission(permission, objectType = null) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const hasPermission = await this.rbac.hasPermission(req.user.role, permission, objectType);

      if (!hasPermission) {
        const permString = permission.includes(':') ? permission : `${objectType}:${permission}`;
        return res.status(403).json({
          success: false,
          error: `Forbidden - ${req.user.role} role does not have ${permString} permission`
        });
      }

      next();
    };
  }
```

- [ ] **Step 2: Add requireRoomPermission middleware for room context**

Add new method after requirePermission:

```javascript
  /**
   * Express middleware for room-specific permissions
   * Checks both system role and room assignment permissions
   * @param {string} permission - The permission required
   * @returns {Function} - Express middleware function
   */
  requireRoomPermission(permission) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Get room role from request (set by previous middleware or from body/params)
      const roomRole = req.roomRole || req.user.roomRole;

      const hasPermission = await this.rbac.hasRoomPermission(
        req.user.role,
        roomRole,
        permission
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: `Forbidden - insufficient permissions for this room`
        });
      }

      next();
    };
  }
```

- [ ] **Step 3: Commit AuthMiddleware changes**

```bash
git add server/src/AuthMiddleware.js
git commit -m "feat: enhance AuthMiddleware with new permission formats and room context"
```

---

## Chunk 6: Update Main Server File

### Task 7: Update index.js to use new permission format

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Update admin route permission checks**

Add proper permission checks to admin endpoints. After line 335, change:

```javascript
// List all rooms (admin with room:view_all permission)
app.get('/api/admin/rooms', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:view_all');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
  const rooms = roomManager.getAllRooms();
  res.json({ success: true, rooms });
});

// Create room (admin with room:create permission)
app.post('/api/admin/rooms', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:create');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
  // ... rest of existing code ...
});

// Delete room (admin with room:delete permission)
app.delete('/api/admin/rooms/:roomId', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:delete');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
  // ... rest of existing code ...
});

// Update room settings (admin with room:update permission)
app.put('/api/admin/rooms/:roomId/settings', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:update');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
  // ... rest of existing code ...
});
```

- [ ] **Step 2: Commit index.js changes**

```bash
git add server/src/index.js
git commit -m "feat: add proper RBAC permission checks to admin endpoints"
```

---

## Chunk 7: Testing

### Task 8: Test the new RBAC implementation

**Files:**
- Test: `server/__tests__/RBACManager.test.js`

- [ ] **Step 1: Run existing tests to ensure nothing broken**

```bash
npm test -- RBACManager 2>&1 | head -50
```

Expected: Tests pass with new permission format

- [ ] **Step 2: Test permission format manually**

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c /tmp/cookies.txt

curl -X GET http://localhost:3000/api/admin/me \
  -b /tmp/cookies.txt | jq
```

Expected: Returns user with permissions in new format

- [ ] **Step 3: Commit test verification**

```bash
git commit --allow-empty -m "test: verify new RBAC implementation"
```

---

## Summary

This plan implements:

1. **New database schema** with `room_participants` table supporting guest sessions
2. **New permission format** using `resource:action` (e.g., `room:create`, `user:kick`)
3. **Two-tier role system**: System roles (global) + Object-level roles (room-specific)
4. **Enhanced RBACManager** with room context support
5. **Updated middleware** for both system and room-specific permissions
6. **Proper permission checks** on all admin endpoints

**Cleanup:** Old permissions like `create`, `delete`, `mute`, `kick` (without resource prefix) are removed from the seed file.
