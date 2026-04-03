# Room Management Refactor Design

**Date:** 2026-03-29
**Status:** Approved
**Author:** Claude (Superpowers Brainstorming)

---

## Overview

Refactor room management workflow to shift room creation and coordination from Admin Dashboard to Director Dashboard, with ownership-based access control.

### Goals

1. **Admin Dashboard** — Scope reduced to User Management only
2. **Director Dashboard** — Handles room creation and full management (migrated from Admin)
3. **Access Control** — Directors can only manage their own rooms (no cross-access)
4. **Admin Override** — Admins accessing Director Dashboard retain full visibility and management rights over all rooms

### Non-Goals

- Token management UI (removed from both dashboards)
- OLA (Operator-Level Access) Manager (removed as unused)

---

## Architecture

### Database Changes

**New Column:**
```sql
ALTER TABLE rooms ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

**Dropped Tables (OLA cleanup):**
```sql
DROP TABLE IF EXISTS room_assignments;
DROP TABLE IF EXISTS stream_access;
```

### API Changes

**New Endpoint:** `/api/rooms`

| Method | Director | Admin |
|--------|----------|-------|
| `GET /api/rooms` | Own rooms only | All rooms |
| `POST /api/rooms` | Create (auto-set owner) | Create |
| `PUT /api/rooms/:id` | Own rooms only | All rooms |
| `DELETE /api/rooms/:id` | Own rooms only | All rooms |
| `GET /api/rooms/:id/participants` | Own rooms only | All rooms |

**Removed Endpoints:**
- `/api/admin/rooms` (replaced by `/api/rooms`)

### Access Control Matrix

| Action | Viewer | Director | Admin |
|--------|--------|----------|-------|
| Create room | ✗ | ✓ (owner) | ✓ |
| View rooms | ✗ | Own only | All |
| Delete room | ✗ | Own only | All |
| Update settings | ✗ | Own only | All |
| Manage participants | ✗ | Own only | All |
| Manage tokens | ✗ | ✗ | ✓ |
| Manage users | ✗ | ✗ | ✓ |

---

## Components

### Client-Side Changes

#### `client/js/AdminDashboard.js`

**Remove:**
- Room creation modal
- Room grid/management tab
- Room settings modal
- Participant management modals
- Token management modal
- `/api/admin/rooms` API calls

**Retain:**
- User management tab (full functionality)
- User CRUD operations
- Role assignment
- Bulk user actions

#### `client/js/DirectorDashboard.js`

**Add:**
- Room creation button (header, mirrors Admin pattern)
- Room creation modal (password, maxParticipants, quality, codec)
- Room card actions: Delete, Settings, Participants
- Room settings modal
- Participants list modal with kick functionality
- `/api/rooms` API integration

**Modify:**
- `loadRooms()` — Filter to `owner_id = currentUser.id` (unless admin)
- `hasRoomDirectorAssignment()` — Replace with ownership check
- Navigation links — Add Admin link (admin-only)

**Retain:**
- Stats display (rooms, live, participants)
- Room card display
- Enter Director View button

### Server-Side Changes

#### `server/src/index.js`

**Add:**
```javascript
// Room management for directors (ownership-based)
app.get('/api/rooms', requireAuth(), async (req, res) => {
  const user = req.user;
  const rooms = user.role === 'admin'
    ? await roomManager.getAllRooms()
    : await roomManager.getRoomsByOwner(user.id);
  res.json({ success: true, rooms });
});

app.post('/api/rooms', doubleCsrfProtection, requireAuth(), async (req, res) => {
  const user = req.user;
  if (!['admin', 'director'].includes(user.role)) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }
  const room = roomManager.createRoom({ ...req.body, ownerId: user.id });
  res.json({ success: true, roomId: room.id });
});

app.delete('/api/rooms/:roomId', doubleCsrfProtection, requireAuth(), async (req, res) => {
  const user = req.user;
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
  if (user.role !== 'admin' && room.ownerId !== user.id) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }
  await roomManager.deleteRoom(req.params.roomId);
  res.json({ success: true });
});

// ... similar for PUT /api/rooms/:roomId/settings, GET participants
```

**Remove:**
- `/api/admin/rooms` routes (all methods)

#### `server/src/RoomManager.js`

**Add:**
```javascript
createRoom(options = {}) {
  // ... existing code
  const room = {
    // ... existing fields
    ownerId: options.ownerId, // NEW
  };
  // ...
}

getRoomsByOwner(ownerId) {
  return Array.from(this.rooms.values())
    .filter(r => r.ownerId === ownerId)
    .map(room => this._serializeRoom(room));
}
```

#### `server/src/OLAManager.js`

**Action:** Delete file (unused)

#### `server/src/RBACManager.js`

**Update:** Remove references to `room:assign_director` permission if no longer needed.

### Migration

**File:** `server/database/migrations/YYYYMMDDHHMMSS-room-ownership.js`

```sql
-- Add owner_id to rooms
ALTER TABLE rooms ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_rooms_owner_id ON rooms(owner_id);

-- Drop OLA tables
DROP TABLE IF EXISTS room_assignments;
DROP TABLE IF EXISTS stream_access;
```

---

## Data Flow

### Director Creates Room

```
1. Director clicks "+ Create Room" on Director Dashboard
2. Modal opens with form (password, maxParticipants, quality, codec)
3. POST /api/rooms with CSRF token
4. Server validates:
   - User is authenticated
   - User has 'director' or 'admin' role
   - Sets ownerId = req.user.id
5. RoomManager.createRoom() with ownerId
6. Return roomId to client
7. Dashboard refreshes room list
```

### Director Views Rooms

```
1. Director Dashboard loads
2. GET /api/rooms
3. Server checks user.role:
   - If 'admin': return all rooms
   - If 'director': return rooms where ownerId = user.id
4. Client renders room grid
```

### Admin Views Director Dashboard

```
1. Admin navigates to /director
2. DirectorDashboard.js loads
3. hasDirectorAccess() returns true (admin in allowed roles)
4. loadRooms() calls GET /api/rooms
5. Server returns ALL rooms (admin bypass)
6. Admin sees full management UI including all rooms
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Director tries to view another's room | 403 Forbidden |
| Director tries to delete another's room | 403 Forbidden |
| Non-director tries to create room | 403 Forbidden |
| Room not found | 404 Not Found |
| Invalid CSRF token | 403 Forbidden |

---

## Testing

### Server Tests

**File:** `server/__tests__/RoomsAPI.test.js` (new)

- `GET /api/rooms` — Director sees only owned rooms
- `GET /api/rooms` — Admin sees all rooms
- `POST /api/rooms` — Director creates room with ownerId
- `DELETE /api/rooms/:id` — Director cannot delete another's room
- `DELETE /api/rooms/:id` — Admin can delete any room
- `PUT /api/rooms/:id/settings` — Ownership check

**File:** `server/__tests__/OLAManager.test.js` (delete)

### Client Tests

**File:** `client/__tests__/DirectorDashboard.test.js` (update)

- Room creation flow
- Room filtering (owner-only)
- Admin override behavior
- Room management actions (delete, settings, participants)

**File:** `client/__tests__/AdminDashboard.test.js` (update)

- User management retained
- Room management removed

---

## Documentation Updates

**File:** `docs/ONBOARDING.md`

- Update Admin Dashboard description (user management only)
- Update Director Dashboard description (room management)
- Add room ownership concept
- Update access control documentation

**File:** `CLAUDE.md`

- Update URL Routes table
- Update Admin Dashboard responsibility
- Update Director Dashboard responsibility

---

## Implementation Checklist

- [ ] Database migration (owner_id + OLA cleanup)
- [ ] Server: `/api/rooms` endpoints
- [ ] Server: Remove `/api/admin/rooms` endpoints
- [ ] Server: RoomManager updates (ownerId, getRoomsByOwner)
- [ ] Server: Delete OLAManager.js
- [ ] Client: AdminDashboard — remove room management
- [ ] Client: DirectorDashboard — add room management
- [ ] Client: Navigation updates (role-conditioned links)
- [ ] Tests: Server RoomsAPI tests
- [ ] Tests: Client DirectorDashboard tests
- [ ] Tests: Client AdminDashboard tests
- [ ] Docs: ONBOARDING.md updates
- [ ] Docs: CLAUDE.md updates

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Existing rooms have no owner_id | Migration sets NULL; admins can manage NULL-owner rooms |
| Directors lose access to existing rooms | Admin reassignment via direct DB update if needed |
| OLA removal breaks something | Verify no code paths reference OLAManager before deletion |
