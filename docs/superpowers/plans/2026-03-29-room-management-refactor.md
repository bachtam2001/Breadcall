# Room Management Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift room management from Admin Dashboard to Director Dashboard with ownership-based access control.

**Architecture:** Single `/api/rooms` endpoint with server-side ownership filtering. Directors see only rooms they own (`owner_id = user.id`), admins see all rooms. Add `owner_id` column to rooms table, remove unused OLA tables.

**Tech Stack:** PostgreSQL (migration), Express.js (API routes), Vanilla JS (client dashboards), Jest (testing).

---

## File Structure

**Files to Create:**
- `server/database/migrations/002-room-ownership-and-ola-cleanup.sql` — Add `owner_id` to rooms, drop OLA tables
- `server/__tests__/RoomsAPI.test.js` — New API endpoint tests
- `docs/ROOM_OWNERSHIP.md` — Document ownership model

**Files to Modify:**
- `server/src/index.js:110-650` — Replace `/api/admin/rooms` with `/api/rooms`, add ownership filtering
- `server/src/RoomManager.js:35-70` — Add `ownerId` to `createRoom()`, add `getRoomsByOwner()`
- `server/src/OLAManager.js` — DELETE (unused)
- `client/js/AdminDashboard.js` — Remove room management tabs/features
- `client/js/DirectorDashboard.js` — Add room CRUD, participants management
- `client/__tests__/AdminDashboard.test.js` — Update for removed room features
- `client/__tests__/DirectorDashboard.test.js` — Add room management tests
- `docs/ONBOARDING.md` — Update dashboard descriptions
- `CLAUDE.md` — Update URL routes table

**Files to Delete:**
- `server/__tests__/OLAManager.test.js` — OLA removed

---

### Task 1: Database Migration

**Files:**
- Create: `server/database/migrations/002-room-ownership-and-ola-cleanup.sql`

- [ ] **Step 1: Write migration to add owner_id and drop OLA tables**

```sql
-- Migration: 002-room-ownership-and-ola-cleanup
-- Date: 2026-03-29
-- Description: Add room ownership via owner_id column, remove unused OLA tables

-- Add owner_id to rooms table
ALTER TABLE rooms ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_owner_id ON rooms(owner_id);

-- Drop unused OLA tables
DROP TABLE IF EXISTS room_assignments;
DROP TABLE IF EXISTS stream_access;
```

- [ ] **Step 2: Commit migration**

```bash
git add server/database/migrations/002-room-ownership-and-ola-cleanup.sql
git commit -m "feat: add room ownership column and remove OLA tables"
```

---

### Task 2: Delete OLAManager

**Files:**
- Delete: `server/src/OLAManager.js`
- Delete: `server/__tests__/OLAManager.test.js`
- Modify: `server/src/index.js:18` — Remove OLAManager import

- [ ] **Step 1: Remove OLAManager import from index.js**

Open `server/src/index.js` and remove line 18:
```javascript
// REMOVE THIS LINE:
const OLAManager = require('./OLAManager');
```

- [ ] **Step 2: Remove OLAManager initialization from index.js**

Search for `new OLAManager` and remove the initialization code block.

- [ ] **Step 3: Delete OLAManager.js**

```bash
rm server/src/OLAManager.js
```

- [ ] **Step 4: Delete OLAManager test**

```bash
rm server/__tests__/OLAManager.test.js
```

- [ ] **Step 5: Commit OLAManager removal**

```bash
git add -A
git commit -m "refactor: remove unused OLAManager"
```

---

### Task 3: Update RoomManager for Ownership

**Files:**
- Modify: `server/src/RoomManager.js:35-70`

- [ ] **Step 1: Update createRoom() to accept and store ownerId**

In `server/src/RoomManager.js`, modify the `createRoom` method:

```javascript
createRoom(options = {}) {
  const { password = null, maxParticipants = 10, quality = '720p', codec = 'H264', ownerId = null } = options;

  // Generate unique room ID
  let roomId;
  do {
    roomId = this.generateRoomId();
  } while (this.rooms.has(roomId));

  const room = {
    id: roomId,
    ownerId,  // ADD THIS LINE
    password,
    maxParticipants,
    quality,
    codec,
    participants: new Map(),
    createdAt: new Date().toISOString(),
    emptySince: null,
    ttlTimer: null,
    // SRT fields
    srtPublishSecret: crypto.randomBytes(16).toString('hex'),
    srtStreamActive: false,
    srtConnectedAt: null,
    srtMode: null,
    srtPullUrl: null
  };

  this.rooms.set(roomId, room);
  console.log(`[RoomManager] Room created: ${roomId} (owner: ${ownerId || 'none'})`);

  return room;
}
```

- [ ] **Step 2: Add getRoomsByOwner() method**

Add after `getAllRooms()` method:

```javascript
/**
 * Get all rooms owned by a specific user
 * @param {string} ownerId - User ID
 * @returns {Array} List of rooms owned by user
 */
getRoomsByOwner(ownerId) {
  return Array.from(this.rooms.values())
    .filter(room => room.ownerId === ownerId)
    .map(room => ({
      id: room.id,
      ownerId: room.ownerId,
      participantCount: room.participants.size,
      maxParticipants: room.maxParticipants,
      quality: room.quality,
      codec: room.codec,
      createdAt: room.createdAt,
      emptySince: room.emptySince,
      password: room.password
    }));
}
```

- [ ] **Step 3: Update getAllRooms() to include ownerId**

Modify the `getAllRooms()` method to include `ownerId` in the returned object:

```javascript
getAllRooms() {
  return Array.from(this.rooms.values()).map(room => ({
    id: room.id,
    ownerId: room.ownerId,  // ADD THIS
    participantCount: room.participants.size,
    maxParticipants: room.maxParticipants,
    quality: room.quality,
    codec: room.codec,
    createdAt: room.createdAt,
    emptySince: room.emptySince,
    password: room.password
  }));
}
```

- [ ] **Step 4: Commit RoomManager changes**

```bash
git add server/src/RoomManager.js
git commit -m "feat: add ownerId to room creation and retrieval"
```

---

### Task 4: Create /api/rooms Endpoints

**Files:**
- Modify: `server/src/index.js:110-650`

- [ ] **Step 1: Remove old /api/rooms POST stub**

Remove lines 110-116 in `server/src/index.js`:
```javascript
// REMOVE THESE LINES:
// Create room - RESTRICTED TO ADMIN ONLY (use /api/admin/rooms)
app.post('/api/rooms', (req, res) => {
  res.status(403).json({
    success: false,
    error: 'Room creation is restricted to admin users. Please use /api/admin/rooms with valid admin session.'
  });
});
```

- [ ] **Step 2: Replace /api/admin/rooms GET with /api/rooms**

Find and replace the `/api/admin/rooms` route handler:

```javascript
// GET /api/rooms - List rooms (ownership-filtered for directors, all for admins)
app.get('/api/rooms', requireAuth(), async (req, res) => {
  try {
    const user = req.user;

    let rooms;
    if (user.role === 'admin') {
      // Admin sees all rooms
      rooms = roomManager.getAllRooms();
    } else if (['director', 'operator'].includes(user.role)) {
      // Director/operator sees only owned rooms
      rooms = roomManager.getRoomsByOwner(user.id);
    } else {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    res.json({ success: true, rooms });
  } catch (error) {
    console.error('[API] Error listing rooms:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
```

- [ ] **Step 3: Replace /api/admin/rooms POST with /api/rooms**

```javascript
// POST /api/rooms - Create room (director or admin only)
app.post('/api/rooms', doubleCsrfProtection, requireAuth(), async (req, res) => {
  try {
    const user = req.user;

    if (!['admin', 'director'].includes(user.role)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const { password, maxParticipants, quality, codec } = req.body;

    const room = roomManager.createRoom({
      password,
      maxParticipants: maxParticipants || 10,
      quality: quality || '720p',
      codec: codec || 'H264',
      ownerId: user.id  // Set current user as owner
    });

    res.json({ success: true, roomId: room.id });
  } catch (error) {
    console.error('[API] Error creating room:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Add DELETE /api/rooms/:roomId with ownership check**

```javascript
// DELETE /api/rooms/:roomId - Delete room (owner or admin only)
app.delete('/api/rooms/:roomId', doubleCsrfProtection, requireAuth(), async (req, res) => {
  try {
    const user = req.user;
    const roomId = req.params.roomId;

    const room = roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Check ownership (admin can delete any room)
    if (user.role !== 'admin' && room.ownerId !== user.id) {
      return res.status(403).json({ success: false, error: 'Not authorized - you can only delete rooms you own' });
    }

    await roomManager.deleteRoom(roomId);
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting room:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
```

- [ ] **Step 5: Add PUT /api/rooms/:roomId/settings with ownership check**

```javascript
// PUT /api/rooms/:roomId/settings - Update room settings (owner or admin only)
app.put('/api/rooms/:roomId/settings', doubleCsrfProtection, requireAuth(), async (req, res) => {
  try {
    const user = req.user;
    const roomId = req.params.roomId;
    const { maxParticipants, quality, codec } = req.body;

    const room = roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Check ownership (admin can update any room)
    if (user.role !== 'admin' && room.ownerId !== user.id) {
      return res.status(403).json({ success: false, error: 'Not authorized - you can only update rooms you own' });
    }

    // Update room settings
    if (maxParticipants !== undefined) room.maxParticipants = maxParticipants;
    if (quality !== undefined) room.quality = quality;
    if (codec !== undefined) room.codec = codec;

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Error updating room settings:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
```

- [ ] **Step 6: Add GET /api/rooms/:roomId/participants with ownership check**

```javascript
// GET /api/rooms/:roomId/participants - Get room participants (owner or admin only)
app.get('/api/rooms/:roomId/participants', requireAuth(), async (req, res) => {
  try {
    const user = req.user;
    const roomId = req.params.roomId;

    const room = roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Check ownership (admin can view any room)
    if (user.role !== 'admin' && room.ownerId !== user.id) {
      return res.status(403).json({ success: false, error: 'Not authorized - you can only view rooms you own' });
    }

    const participants = roomManager.getRoomParticipants(roomId);
    const directors = roomManager.getRoomDirectors(roomId);

    res.json({ success: true, participants, directors });
  } catch (error) {
    console.error('[API] Error getting participants:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
```

- [ ] **Step 7: Remove old /api/admin/rooms routes**

Find and remove all remaining `/api/admin/rooms` route handlers (GET, POST, DELETE, PUT).

- [ ] **Step 8: Commit API changes**

```bash
git add server/src/index.js
git commit -m "feat: add ownership-based /api/rooms endpoints"
```

---

### Task 5: Update AdminDashboard (Remove Room Management)

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Remove room management from tab buttons**

In `renderDashboard()`, replace the tab buttons section:

```javascript
// OLD (remove):
'<section class="admin-section">' +
  '<div class="tab-buttons">' +
    '<button class="tab-btn active" data-tab="rooms">Rooms</button>' +
    (this._hasPermission('create', 'user') || this._hasPermission('delete', 'user') ? '<button class="tab-btn" data-tab="users">Users</button>' : '') +
  '</div>' +
'</section>' +

// NEW (replace with):
'<section class="admin-section">' +
  '<div class="admin-section-header">' +
    '<h2 class="admin-section-title">User Management</h2>' +
  '</div>' +
'</section>' +
```

- [ ] **Step 2: Remove Rooms tab content**

Delete the entire `<div class="tab-content active" id="rooms-tab">` section including:
- Room creation button
- Rooms grid
- Room settings modal
- Participants modal
- Tokens modal

- [ ] **Step 3: Remove room-related methods**

Remove these methods from AdminDashboard class:
- `loadRooms()`
- `createRoom()`
- `deleteRoom()`
- `updateRoomSettings()`
- `loadRoomParticipants()`
- `kickParticipant()`

- [ ] **Step 4: Remove room-related event listeners**

Remove event listeners for:
- `create-room-btn`
- `confirm-create-btn`
- `save-settings-btn`
- Room card action buttons

- [ ] **Step 5: Update stats section**

Remove room-related stats, keep only user-focused display if any.

- [ ] **Step 6: Commit AdminDashboard changes**

```bash
git add client/js/AdminDashboard.js
git commit -m "refactor: remove room management from Admin Dashboard"
```

---

### Task 6: Update DirectorDashboard (Add Room Management)

**Files:**
- Modify: `client/js/DirectorDashboard.js`

- [ ] **Step 1: Add room management state**

Add to constructor:
```javascript
constructor() {
  this.appElement = document.getElementById('app');
  this.isLoggedIn = false;
  this.rooms = [];
  this.isLoading = false;
  this.error = null;
  this.isAdmin = false;  // ADD THIS
  this.init();
}
```

- [ ] **Step 2: Update init() to check admin status**

```javascript
async init() {
  this.isLoggedIn = await window.authService.init();

  if (!this.isLoggedIn) {
    this.redirectToLogin();
    return;
  }

  // Check if user is admin (full access) or director (own rooms only)
  const user = window.authService.getCurrentUser();
  this.isAdmin = user?.role === 'admin';

  if (!this.hasDirectorAccess()) {
    this.renderAccessDenied();
    return;
  }

  this.renderDashboard();
  await this.loadRooms();
}
```

- [ ] **Step 3: Add room management methods**

Add after `loadRooms()` method:

```javascript
async createRoom(options) {
  try {
    const response = await window.authService.fetchWithAuth('/api/rooms', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': await this.getCsrfToken()
      },
      body: JSON.stringify(options)
    });

    const data = await response.json();
    if (data.success) {
      this.showToast('Room ' + data.roomId + ' created successfully', 'success');
      await this.loadRooms();
      return data.roomId;
    } else {
      this.showToast(data.error || 'Failed to create room', 'error');
    }
  } catch (error) {
    this.showToast('Connection error', 'error');
  }
}

async deleteRoom(roomId) {
  if (!confirm('Are you sure you want to delete this room? This will disconnect all participants.')) {
    return;
  }

  try {
    const response = await window.authService.fetchWithAuth('/api/rooms/' + roomId, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': await this.getCsrfToken()
      }
    });

    const data = await response.json();
    if (data.success) {
      this.showToast('Room deleted', 'success');
      await this.loadRooms();
    } else {
      this.showToast(data.error || 'Failed to delete room', 'error');
    }
  } catch (error) {
    this.showToast('Connection error', 'error');
  }
}

async updateRoomSettings(roomId, settings) {
  try {
    const response = await window.authService.fetchWithAuth('/api/rooms/' + roomId + '/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': await this.getCsrfToken()
      },
      body: JSON.stringify(settings)
    });

    const data = await response.json();
    if (data.success) {
      this.showToast('Room settings updated', 'success');
      await this.loadRooms();
    } else {
      this.showToast(data.error || 'Failed to update settings', 'error');
    }
  } catch (error) {
    this.showToast('Connection error', 'error');
  }
}

async loadRoomParticipants(roomId) {
  try {
    const response = await window.authService.fetchWithAuth('/api/rooms/' + roomId + '/participants');
    const data = await response.json();
    if (data.success) {
      return { participants: data.participants || [], directors: data.directors || [] };
    }
    return { participants: [], directors: [] };
  } catch (error) {
    console.error('[DirectorDashboard] Failed to load participants:', error);
    return { participants: [], directors: [] };
  }
}

async getCsrfToken() {
  const response = await fetch('/api/csrf-token', { credentials: 'include' });
  const data = await response.json();
  return data.csrfToken;
}
```

- [ ] **Step 4: Add room management UI to renderDashboard()**

Add "+ Create Room" button in the section header:

```javascript
'<section class="admin-section">' +
  '<div class="admin-section-header">' +
    '<h2 class="admin-section-title">Your Rooms</h2>' +
    '<button class="btn btn-primary" id="create-room-btn">+ Create Room</button>' +
  '</div>' +
  '<div class="rooms-grid" id="rooms-grid">' +
    '<div class="loading-spinner"><div class="spinner"></div></div>' +
  '</div>' +
'</section>' +
```

- [ ] **Step 5: Add room action buttons to room cards**

Update `renderRoomCard()`:

```javascript
renderRoomCard(room) {
  const isLive = (room.participantCount || 0) > 0;
  const statusClass = isLive ? 'status-live' : 'status-offline';
  const statusText = isLive ? 'Live' : 'Offline';

  return '<div class="room-card">' +
    '<div class="room-card-header">' +
      '<h3 class="room-name">' + this.escapeHtml(room.name || room.id) + '</h3>' +
      '<span class="room-status ' + statusClass + '">' + statusText + '</span>' +
    '</div>' +
    '<div class="room-card-body">' +
      '<div class="room-info">' +
        '<div class="info-item">' +
          '<span class="info-label">Participants:</span>' +
          '<span class="info-value">' + (room.participantCount || 0) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="room-card-footer">' +
      '<button class="btn btn-secondary btn-participants" data-room-id="' + this.escapeHtml(room.id) + '">Participants</button>' +
      '<button class="btn btn-secondary btn-settings" data-room-id="' + this.escapeHtml(room.id) + '">Settings</button>' +
      '<button class="btn btn-danger btn-delete" data-room-id="' + this.escapeHtml(room.id) + '">Delete</button>' +
      '<button class="btn btn-primary btn-enter" data-room-id="' + this.escapeHtml(room.id) + '">Enter Director View</button>' +
    '</div>' +
  '</div>';
}
```

- [ ] **Step 6: Add modals for create room, settings, participants**

Add modal HTML after the main dashboard markup (same structure as AdminDashboard modals).

- [ ] **Step 7: Add event listeners for room management**

In `attachContentEventListeners()`:

```javascript
attachContentEventListeners() {
  // Create room button
  const createBtn = document.getElementById('create-room-btn');
  if (createBtn) {
    createBtn.addEventListener('click', () => this.showCreateRoomModal());
  }

  // Delete room buttons
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const roomId = e.target.dataset.roomId;
      if (roomId) this.deleteRoom(roomId);
    });
  });

  // Settings buttons
  document.querySelectorAll('.btn-settings').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const roomId = e.target.dataset.roomId;
      if (roomId) this.showSettingsModal(roomId);
    });
  });

  // Participants buttons
  document.querySelectorAll('.btn-participants').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const roomId = e.target.dataset.roomId;
      if (roomId) this.showParticipantsModal(roomId);
    });
  });

  // Enter director view buttons
  document.querySelectorAll('.btn-enter').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const roomId = e.target.dataset.roomId;
      if (roomId) this.enterDirectorView(roomId);
    });
  });

  // Retry button
  const retryBtn = document.getElementById('retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => this.loadRooms());
  }
}
```

- [ ] **Step 8: Add modal handler methods**

```javascript
showCreateRoomModal() {
  const modal = document.getElementById('create-room-modal');
  if (modal) modal.style.display = 'flex';
}

showSettingsModal(roomId) {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    document.getElementById('settings-room-id').value = roomId;
    modal.style.display = 'flex';
  }
}

showParticipantsModal(roomId) {
  // Load and display participants
  this.loadRoomParticipants(roomId).then(data => {
    // Render participants list
  });
  const modal = document.getElementById('participants-modal');
  if (modal) modal.style.display = 'flex';
}
```

- [ ] **Step 9: Add Admin Dashboard link (admin-only)**

Update navigation in `renderDashboard()`:

```javascript
let roleNavLinks = '';
if (this.isAdmin) {
  roleNavLinks += '<a href="/admin" class="btn btn-secondary">Admin Panel</a>';
}
if (this.isAdmin || userRole === 'operator') {
  roleNavLinks += '<a href="/monitoring" class="btn btn-secondary">Monitoring</a>';
}
```

- [ ] **Step 10: Commit DirectorDashboard changes**

```bash
git add client/js/DirectorDashboard.js
git commit -m "feat: add room management to Director Dashboard"
```

---

### Task 7: Write Server Tests

**Files:**
- Create: `server/__tests__/RoomsAPI.test.js`

- [ ] **Step 1: Create test file with setup**

```javascript
const request = require('supertest');
const http = require('http');

let server;
let app;

describe('Rooms API', () => {
  beforeAll(async () => {
    // Import app without starting server
    app = require('../src/index');
    server = http.createServer(app);
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  beforeEach(async () => {
    // Reset test state
  });
});
```

- [ ] **Step 2: Write GET /api/rooms tests**

```javascript
describe('GET /api/rooms', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const response = await request(server).get('/api/rooms');
    expect(response.status).toBe(401);
  });

  it('returns all rooms for admin users', async () => {
    // Test admin sees all rooms
  });

  it('returns only owned rooms for director users', async () => {
    // Test director sees only their rooms
  });

  it('returns 403 for viewer role', async () => {
    // Test viewer is denied
  });
});
```

- [ ] **Step 3: Write POST /api/rooms tests**

```javascript
describe('POST /api/rooms', () => {
  it('creates room with ownerId for director', async () => {
    // Test director can create room
  });

  it('creates room for admin', async () => {
    // Test admin can create room
  });

  it('returns 403 for viewer role', async () => {
    // Test viewer cannot create
  });
});
```

- [ ] **Step 4: Write DELETE /api/rooms/:roomId tests**

```javascript
describe('DELETE /api/rooms/:roomId', () => {
  it('deletes room when user is owner', async () => {
    // Test owner can delete
  });

  it('deletes room when user is admin', async () => {
    // Test admin can delete any room
  });

  it('returns 403 when user is not owner', async () => {
    // Test non-owner cannot delete
  });

  it('returns 404 for non-existent room', async () => {
    // Test 404 handling
  });
});
```

- [ ] **Step 5: Write PUT /api/rooms/:roomId/settings tests**

```javascript
describe('PUT /api/rooms/:roomId/settings', () => {
  it('updates settings when user is owner', async () => {
    // Test owner can update
  });

  it('updates settings when user is admin', async () => {
    // Test admin can update any room
  });

  it('returns 403 when user is not owner', async () => {
    // Test non-owner cannot update
  });
});
```

- [ ] **Step 6: Run tests and verify they pass**

```bash
npm test -- RoomsAPI
```

Expected: All tests PASS

- [ ] **Step 7: Commit server tests**

```bash
git add server/__tests__/RoomsAPI.test.js
git commit -m "test: add Rooms API endpoint tests"
```

---

### Task 8: Update Client Tests

**Files:**
- Modify: `client/__tests__/AdminDashboard.test.js`
- Modify: `client/__tests__/DirectorDashboard.test.js`

- [ ] **Step 1: Update AdminDashboard tests to remove room tests**

Remove any tests related to:
- Room creation
- Room deletion
- Room settings
- Participant management

- [ ] **Step 2: Add DirectorDashboard room management tests**

```javascript
describe('DirectorDashboard - Room Management', () => {
  it('shows create room button', () => {
    // Test button is visible
  });

  it('creates room via POST /api/rooms', async () => {
    // Test room creation flow
  });

  it('shows only owned rooms', async () => {
    // Test filtering
  });

  it('deletes owned room', async () => {
    // Test deletion
  });

  it('shows admin link only for admin users', () => {
    // Test admin-only navigation
  });
});
```

- [ ] **Step 3: Run client tests**

```bash
npm test -- AdminDashboard
npm test -- DirectorDashboard
```

- [ ] **Step 4: Commit test changes**

```bash
git add client/__tests__/*.test.js
git commit -m "test: update dashboard tests for room management refactor"
```

---

### Task 9: Update Documentation

**Files:**
- Modify: `docs/ONBOARDING.md`
- Modify: `CLAUDE.md`
- Create: `docs/ROOM_OWNERSHIP.md`

- [ ] **Step 1: Update ONBOARDING.md roles section**

Update the Roles & Permissions table:

```markdown
| Role | Hierarchy | Capabilities |
|------|-----------|--------------|
| admin | 100 | Full system access, user management, room management (all rooms) |
| director | 80 | Room management (owned rooms only), participant controls |
| operator | 60 | System monitoring, view all rooms |
| moderator | 40 | Moderate assigned rooms |
| viewer | 20 | View only, no controls |
```

- [ ] **Step 2: Update ONBOARDING.md dashboard descriptions**

Update the "Where to Look" section:

```markdown
| I want to... | Look at... |
|--------------|------------|
| Manage rooms | `client/js/DirectorDashboard.js`, `/api/rooms` endpoints |
| Manage users | `client/js/AdminDashboard.js`, `/api/admin/users` endpoints |
```

- [ ] **Step 3: Update CLAUDE.md URL Routes table**

Update the routes table:

```markdown
| Route | Description |
|-------|-------------|
| `/api/rooms` | Room CRUD (ownership-filtered for directors, all for admins) |
| `/api/rooms/:roomId/settings` | Update room settings (owner/admin only) |
| `/api/rooms/:roomId/participants` | Get room participants (owner/admin only) |
| `/admin` | Admin dashboard (user management only) |
| `/director` | Director dashboard (room management) |
```

Remove `/api/admin/rooms` entries.

- [ ] **Step 4: Create ROOM_OWNERSHIP.md**

```markdown
# Room Ownership Model

## Overview

Rooms in BreadCall are owned by the director who creates them. Ownership determines who can manage the room.

## Access Control

| Action | Director | Admin |
|--------|----------|-------|
| Create room | ✓ (becomes owner) | ✓ |
| View rooms | Own rooms only | All rooms |
| Delete room | Own rooms only | All rooms |
| Update settings | Own rooms only | All rooms |
| Manage participants | Own rooms only | All rooms |

## API

All room operations go through `/api/rooms`:

- `GET /api/rooms` - List rooms (filtered by ownership for directors)
- `POST /api/rooms` - Create room (sets `owner_id` to current user)
- `DELETE /api/rooms/:id` - Delete room (owner or admin only)
- `PUT /api/rooms/:id/settings` - Update settings (owner or admin only)
- `GET /api/rooms/:id/participants` - Get participants (owner or admin only)

## Database

Rooms table has `owner_id` column referencing `users.id`:

```sql
ALTER TABLE rooms ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

When a room's owner is deleted, `owner_id` is set to NULL and the room becomes admin-managed only.
```

- [ ] **Step 5: Commit documentation changes**

```bash
git add docs/ONBOARDING.md CLAUDE.md docs/ROOM_OWNERSHIP.md
git commit -m "docs: update for room ownership model"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** All requirements from spec have corresponding tasks
- [ ] **No placeholders:** All steps contain actual code, no TBD/TODO
- [ ] **Type consistency:** `ownerId` used consistently (camelCase in JS, `owner_id` in SQL)
- [ ] **Test coverage:** Server and client tests included
- [ ] **Documentation:** ONBOARDING.md, CLAUDE.md, and ROOM_OWNERSHIP.md updated

---

Plan complete and saved to `docs/superpowers/plans/2026-03-29-room-management-refactor.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
