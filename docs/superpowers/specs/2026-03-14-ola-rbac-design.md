# OLA + RBAC Implementation Design Specification

**Date:** 2026-03-14
**Author:** Claude Code
**Status:** Approved

---

## 1. Overview

This specification defines the implementation of Object Level Authorization (OLA) and Role-Based Access Control (RBAC) for the BreadCall WebRTC platform. The system replaces the existing single-password admin authentication with a multi-role, object-scoped authorization system.

### 1.1 Goals

- **Fine-grained access control** - Users can only access rooms and streams they're explicitly granted
- **Role hierarchy** - Seven roles with increasing privilege levels
- **Object scoping** - Permissions apply to specific rooms/streams, not globally
- **JWT-based auth** - Access tokens include OLA claims for stateless authorization
- **Clean migration** - No backward compatibility; new system replaces old entirely

### 1.2 Non-Goals

- SSO/OAuth integration (future enhancement)
- Multi-tenant organization support
- Audit logging (future enhancement)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  - Login (username/password) → JWT tokens                       │
│  - OLA-aware API calls (credentials: 'include')                 │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ HTTP + WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Authorization Layer                         │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │   RBACMiddleware    │    │   OLAMiddleware     │            │
│  │ - Check role level  │    │ - Check object scope│            │
│  │ - Check permission  │    │ - Room assignment   │            │
│  │ - Hierarchy access  │    │ - Stream assignment │            │
│  └─────────────────────┘    └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                         │
│  - users, roles, role_permissions                               │
│  - room_assignments, stream_access                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Redis (session)                            │
│  - refresh tokens, revocation list                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema

### 3.1 Roles Table

```sql
CREATE TABLE roles (
  name VARCHAR(50) PRIMARY KEY,
  hierarchy INTEGER NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Users Table

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  email VARCHAR(255),
  display_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.3 Role Permissions Table

```sql
CREATE TABLE role_permissions (
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  object_type VARCHAR(50) NOT NULL, -- 'room', 'stream', 'system', 'user'
  PRIMARY KEY (role, permission, object_type)
);
```

### 3.4 Room Assignments Table (OLA)

```sql
CREATE TABLE room_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id VARCHAR(10) NOT NULL,
  assignment_role VARCHAR(50) NOT NULL, -- 'moderator', 'director'
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, room_id)
);

CREATE INDEX idx_room_assignments_user ON room_assignments(user_id);
CREATE INDEX idx_room_assignments_room ON room_assignments(room_id);
```

### 3.5 Stream Access Table (OLA)

```sql
CREATE TABLE stream_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_id VARCHAR(255) NOT NULL, -- format: roomId_participantId
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, stream_id)
);

CREATE INDEX idx_stream_access_user ON stream_access(user_id);
CREATE INDEX idx_stream_access_stream ON stream_access(stream_id);
```

### 3.6 Initial Seed Data

```sql
-- Roles (hierarchy: higher = more privileged)
INSERT INTO roles (name, hierarchy, description) VALUES
  ('super_admin', 100, 'Full system access'),
  ('room_admin', 80, 'Create and manage own rooms'),
  ('moderator', 60, 'Manage participants in assigned rooms'),
  ('director', 50, 'View and control streams, generate SRT'),
  ('operator', 40, 'Read-only monitoring'),
  ('participant', 20, 'Join rooms, send audio/video'),
  ('viewer', 10, 'View single stream, SoloView, SRT link');

-- Role Permissions
INSERT INTO role_permissions (role, permission, object_type) VALUES
  -- Super Admin (all)
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

---

## 4. Role Hierarchy & Permissions

### 4.1 Permission Matrix

| Permission | super_admin | room_admin | moderator | director | operator | participant | viewer |
|------------|-------------|------------|-----------|----------|----------|-------------|--------|
| Create room | ✓ | ✓ | - | - | - | - | - |
| Delete any room | ✓ | - | - | - | - | - | - |
| Delete own room | ✓ | ✓ | - | - | - | - | - |
| Assign moderator | ✓ | ✓ | - | - | - | - | - |
| Assign director | ✓ | ✓ | - | - | - | - | - |
| Promote user | ✓ | ✓ | - | - | - | - | - |
| Mute participant | ✓ | ✓ | ✓ | - | - | - | - |
| Kick participant | ✓ | ✓ | ✓ | - | - | - | - |
| Update room settings | ✓ | ✓ | ✓ | - | - | - | - |
| View all streams | ✓ | ✓ | - | ✓ | - | - | - |
| Switch scenes | ✓ | ✓ | - | ✓ | - | - | - |
| Generate SRT (room) | ✓ | ✓ | - | ✓ | - | - | - |
| Generate SRT (stream) | ✓ | ✓ | - | ✓ | - | - | ✓ |
| View analytics | ✓ | ✓ | - | - | ✓ | - | - |
| Join room | ✓ | ✓ | ✓ | ✓ | - | ✓ | - |
| Send audio/video | ✓ | ✓ | - | - | - | ✓ | - |
| View stream (assigned) | ✓ | ✓ | - | ✓ | - | - | ✓ |
| View SoloView | ✓ | ✓ | - | ✓ | - | - | ✓ |

### 4.2 Object Scoping Rules

- **super_admin**: Global scope (all objects)
- **room_admin**: Scope = rooms they created
- **moderator**: Scope = rooms they're assigned to
- **director**: Scope = rooms they're assigned to
- **operator**: Global read-only scope
- **participant**: Scope = room they joined
- **viewer**: Scope = single stream they're granted

---

## 5. API Design

### 5.1 Authentication Endpoints

```
POST /api/auth/login
  Body: { username, password }
  Response: { success, accessToken, refreshToken, user: { id, username, role } }

POST /api/auth/logout
  Headers: Authorization: Bearer <accessToken>
  Response: { success }

POST /api/auth/refresh
  Body: { refreshToken }
  Response: { success, accessToken, refreshToken }

GET /api/auth/me
  Headers: Authorization: Bearer <accessToken>
  Response: { success, user: { id, username, role, displayName }, permissions: [...] }
```

### 5.2 User Management (Super Admin + Room Admin)

```
POST /api/users
  Headers: Authorization, X-CSRF-Token
  Body: { username, password, role, displayName?, email? }
  Response: { success, user }

GET /api/users
  Headers: Authorization
  Response: { success, users: [{ id, username, role, createdAt }] }

GET /api/users/:id
  Headers: Authorization
  Response: { success, user }

PUT /api/users/:id/role
  Headers: Authorization, X-CSRF-Token
  Body: { role }
  Response: { success, user }

DELETE /api/users/:id
  Headers: Authorization, X-CSRF-Token
  Response: { success }
```

### 5.3 Room Assignments (OLA)

```
POST /api/rooms/:roomId/assign
  Headers: Authorization, X-CSRF-Token
  Body: { userId, assignmentRole: 'moderator'|'director', expiresAt? }
  Response: { success, assignment }

DELETE /api/rooms/:roomId/assign/:userId
  Headers: Authorization, X-CSRF-Token
  Response: { success }

GET /api/rooms/:roomId/assignments
  Headers: Authorization
  Response: { success, assignments: [{ userId, username, assignmentRole, grantedAt, expiresAt }] }
```

### 5.4 Stream Access (OLA - Viewer)

```
POST /api/streams/:streamId/access
  Headers: Authorization, X-CSRF-Token
  Body: { userId, expiresAt? }
  Response: { success, grant }

DELETE /api/streams/:streamId/access/:userId
  Headers: Authorization, X-CSRF-Token
  Response: { success }

GET /api/streams/:streamId/access
  Headers: Authorization
  Response: { success, grants: [{ userId, username, grantedAt, expiresAt }] }
```

### 5.5 OLA-Protected Room Operations

```
# List rooms - filtered by user's OLA scope
GET /api/rooms
  Headers: Authorization
  Response: { success, rooms: [{ id, ...metadata, userRole }] }

# Get room details - requires OLA permission
GET /api/rooms/:roomId
  Headers: Authorization
  Response: { success, room }

# Update room - requires Moderator+ on room
PUT /api/rooms/:roomId/settings
  Headers: Authorization, X-CSRF-Token
  Body: { quality?, codec?, maxParticipants? }
  Response: { success, room }

# Delete room - requires Room Admin (owner) or Super Admin
DELETE /api/rooms/:roomId
  Headers: Authorization, X-CSRF-Token
  Response: { success }
```

### 5.6 SRT Link Generation

```
POST /api/srt/generate
  Headers: Authorization, X-CSRF-Token
  Body: { roomId, streamId?, type: 'room'|'stream' }
  Response: { success, srtUrl, expiresAt }
```

---

## 6. JWT Token Structure

### 6.1 Access Token Payload

```json
{
  "iss": "breadcall-server",
  "aud": "breadcall-client",
  "sub": "user-uuid",
  "username": "admin",
  "role": "super_admin",
  "hierarchy": 100,
  "permissions": ["*", "*", "*"],
  "ola": {
    "rooms": {
      "ABC1": { role: "owner" },
      "XYZ9": { role: "moderator" }
    },
    "streams": ["ABC1_user123"]
  },
  "iat": 1234567890,
  "exp": 1234568790
}
```

### 6.2 Refresh Token Storage (Redis)

```
Key: refresh:<tokenId>
Value: {
  tokenId,
  userId,
  type: 'user',
  expiresAt,
  revoked,
  rotatedTo
}
```

---

## 7. Implementation Components

### 7.1 Server-Side

| File | Responsibility |
|------|----------------|
| `database/migrations/001-create-rbac-ola-schema.sql` | Database schema |
| `database/seed/001-roles-permissions.sql` | Initial seed data |
| `bootstrap.js` | Create Super Admin from env var |
| `RBACManager.js` | Role/permission queries, hierarchy checks |
| `OLAManager.js` | Object assignments, scope checks |
| `AuthMiddleware.js` | JWT verification, RBAC/OLA guards |
| `TokenManager.js` | JWT generation with OLA claims |
| `UserManager.js` | User CRUD operations |
| `index.js` | Updated endpoints with guards |

### 7.2 Client-Side

| File | Responsibility |
|------|----------------|
| `AuthService.js` | Login/logout, token refresh |
| `OLAAwareClient.js` | API client with OLA scope handling |
| `AdminDashboard.js` | User management, assignments UI |

---

## 8. Security Considerations

### 8.1 Password Hashing

- Use bcrypt with cost factor 12
- Never transmit passwords in plain text (always HTTPS)

### 8.2 Token Security

- Access tokens: 15 minute expiry, HTTP-only cookie
- Refresh tokens: 24 hour expiry, rotation on use
- Revocation list stored in Redis

### 8.3 OLA Enforcement

- All room/stream operations must pass OLA check
- Super Admin bypasses OLA (global scope)
- OLA claims embedded in JWT for stateless checks

---

## 9. Testing Requirements

### 9.1 Unit Tests

- RBACManager: role hierarchy, permission checks
- OLAManager: assignment CRUD, scope resolution
- TokenManager: JWT generation/validation with OLA claims

### 9.2 Integration Tests

- Login → JWT contains correct OLA claims
- Room creation → creator has owner assignment
- Moderator assignment → can mute/kick in room
- Viewer assignment → can only view assigned stream

### 9.3 E2E Tests

- Super Admin creates user, assigns as Moderator
- Moderator logs in, manages participants
- Viewer logs in, accesses only assigned stream

---

## 10. Migration Checklist

- [ ] Create database migration files
- [ ] Implement RBACManager, OLAManager
- [ ] Replace AuthMiddleware
- [ ] Update TokenManager for OLA claims
- [ ] Add bootstrap script
- [ ] Implement new API endpoints
- [ ] Update AdminDashboard with user management
- [ ] Add client-side AuthService
- [ ] Write tests
- [ ] Update documentation
- [ ] Deploy with initial Super Admin bootstrap

---

## 11. Future Enhancements

- Audit logging for all RBAC/OLA operations
- Custom role creation (dynamic permissions)
- Multi-tenant organization support
- SSO/OAuth2 integration
- API keys for service accounts
