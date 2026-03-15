# Room URI Optimization - Solution Options

**Date:** 2026-03-14
**Author:** Claude (Code Assistant)
**Issue:** Room-specific URIs allow direct access without validation - rooms can be accessed even if they don't exist

---

## Problem Statement

Currently, room URIs in BreadCall can be accessed directly without server-side validation:

- `#/room/ABCD` - Main room view
- `#/director/ABCD` - Director dashboard
- `#/view/ABCD` - Solo stream view

**Issues:**
1. Users can bookmark/share invalid room URLs
2. No visual feedback until WebSocket connects and join fails
3. Room validation only happens at WebSocket message time (too late)
4. Error handling is inconsistent (toast notification only)
5. No graceful degradation for expired/deleted rooms

**Current Flow:**
```
User accesses #/room/ABCD
    ↓
Client parses room ID from hash
    ↓
Client connects to WebSocket
    ↓
Client sends: { type: 'join-room', roomId: 'ABCD' }
    ↓
Server validates via RoomManager.getRoom()
    ↓
If not found: { type: 'error', message: 'Room not found' }
    ↓
Client shows toast, stays on invalid URL
```

---

## Solution Options

### Option 1: Client-Side REST Validation (Minimal Changes)

**Approach:** Add a REST API check before attempting to join the room.

#### Changes Required

| File | Change |
|------|--------|
| `server/src/index.js` | No changes - GET /api/rooms/:roomId already returns 404 |
| `client/js/app.js` | Add REST validation in handleRouteChange() |
| `client/js/DirectorView.js` | Add REST check in init() |
| `client/js/SoloView.js` | Add REST check in init() |

#### Implementation

```javascript
// client/js/app.js - handleRouteChange()
async handleRouteChange() {
  const hash = window.location.hash;
  if (!hash || hash === '#/' || hash === '') {
    this.uiManager.renderLanding();
  } else if (hash.startsWith('#/room/')) {
    this.roomId = hash.split('/')[2]?.toUpperCase();

    // NEW: Validate room exists via REST API
    try {
      const response = await fetch(`/api/rooms/${this.roomId}`);
      if (!response.ok) {
        throw new Error('Room not found');
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error('Room not found');
      }

      // Room exists - proceed normally
      this.uiManager.renderRoom(this.roomId);
      this.joinRoom(this.roomId);
    } catch (error) {
      // Room not found - redirect to join page
      console.error('[BreadCallApp] Room validation failed:', error.message);
      window.location.hash = `#/join?room=${this.roomId}&error=not_found`;
    }
  }
  // SoloView and DirectorView handled separately
}
```

```javascript
// client/js/DirectorView.js - init()
async init() {
  this.parseUrl();

  // NEW: Validate room before rendering
  try {
    const response = await fetch(`/api/rooms/${this.roomId}`);
    if (!response.ok) throw new Error('Room not found');
    const data = await response.json();
    if (!data.success) throw new Error('Room not found');

    this.render();
    this.connect();
    this.startStatsPolling();
  } catch (error) {
    console.error('[DirectorView] Room validation failed:', error.message);
    window.location.hash = `#/join?room=${this.roomId}&error=not_found`;
  }
}
```

```javascript
// client/js/SoloView.js - init()
async init() {
  this.parseUrl();

  // NEW: Validate room before rendering
  try {
    const response = await fetch(`/api/rooms/${this.roomId}`);
    if (!response.ok) throw new Error('Room not found');
    const data = await response.json();
    if (!data.success) throw new Error('Room not found');

    this.render();
    this.connect();
  } catch (error) {
    console.error('[SoloView] Room validation failed:', error.message);
    window.location.hash = `#/join?room=${this.roomId}&error=not_found`;
  }
}
```

#### Pros
- Minimal code changes (3-4 files)
- Uses existing REST endpoint
- Fast validation (single HTTP request)
- No server architecture changes

#### Cons
- Race condition: room could be deleted between validation and join
- Doesn't help users without JavaScript enabled
- No visual polish by itself - needs join page component

---

### Option 2: Server-Side Route Guard with Redirect (Full Protection)

**Approach:** Move room validation to server-side HTTP middleware that intercepts requests before serving HTML.

#### Changes Required

| File | Change |
|------|--------|
| `server/src/index.js` | Add middleware for room URL validation |
| `client/js/UIManager.js` | Handle query params for error display |
| `docker/nginx/nginx.conf` | Optional: handle redirects at proxy level |

#### Implementation

```javascript
// server/src/index.js - Add after session middleware

// Room validation middleware
app.use('*', (req, res, next) => {
  const url = req.url;

  // Check for room-related URLs (including hash-based routing via query params)
  const roomMatch = url.match(/[?&]room=([A-Za-z0-9]{4})/i);
  const directorMatch = url.match(/[?&]director=([A-Za-z0-9]{4})/i);
  const viewMatch = url.match(/[?&]view=([A-Za-z0-9]{4})/i);

  const roomId = roomMatch?.[1] || directorMatch?.[1] || viewMatch?.[1];

  if (roomId) {
    const room = roomManager.getRoom(roomId.toUpperCase());
    if (!room) {
      // Redirect to join page with error
      return res.redirect(`/?room=${roomId.toUpperCase()}&error=not_found`);
    }
  }

  next();
});

// Alternative: Handle specific room routes if using server-side routing
app.get('/room/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId.toUpperCase());
  if (!room) {
    return res.redirect('/?room=' + req.params.roomId.toUpperCase() + '&error=not_found');
  }
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});
```

```javascript
// client/js/UIManager.js - renderLanding() enhancement
renderLanding() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');
  const passwordFromUrl = urlParams.get('password');
  const errorFromUrl = urlParams.get('error');

  // NEW: Handle error state
  let errorHtml = '';
  if (errorFromUrl === 'not_found' && roomIdFromUrl) {
    errorHtml = `
      <div class="error-banner glass-panel" style="margin-bottom: 24px; padding: 16px; border-left: 4px solid var(--color-error);">
        <strong style="color: var(--color-error);">Room "${this.escapeHtml(roomIdFromUrl)}" Not Found</strong>
        <p style="margin: 8px 0 0 0; color: var(--color-text-secondary);">
          This room may have expired or been deleted. Please verify the room ID and try again.
        </p>
      </div>
    `;
  }

  this.appElement.innerHTML = `
    <div class="landing animate-fade-in">
      <h1 class="landing-logo">BreadCall</h1>
      <p class="landing-description">
        Professional WebRTC platform for live production.
        Join a room to start broadcasting.
      </p>

      <div class="landing-form glass-panel">
        ${errorHtml}
        <h2>Join Room</h2>
        <!-- ... rest of form ... -->
      </div>
    </div>
  `;

  this.bindLandingEvents();
  this.currentView = 'landing';
}
```

#### Pros
- Works even without JavaScript
- Prevents invalid room access at HTTP level
- SEO-friendly redirect
- Single source of truth (server)

#### Cons
- Requires server-side rendering or dynamic HTML injection
- More invasive changes to server architecture
- Hash-based routing complicates server-side handling
- Need to handle edge cases (direct file access, CDN caching)

---

### Option 3: Hybrid Validation + Join Page Component (RECOMMENDED)

**Approach:** Combine REST validation with a dedicated join page component that handles errors gracefully.

#### Changes Required

| File | Change |
|------|--------|
| `client/js/UIManager.js` | Add renderJoinPage() method |
| `client/js/app.js` | Add #/join route, REST validation |
| `client/js/DirectorView.js` | Add REST check with redirect |
| `client/js/SoloView.js` | Add REST check with redirect |

#### Implementation

```javascript
// client/js/UIManager.js - New method
/**
 * Render join page with optional error state
 * @param {string} roomId - Pre-filled room ID
 * @param {string} error - Error type ('not_found', 'expired', etc.)
 */
renderJoinPage(roomId = '', error = null) {
  const urlParams = new URLSearchParams(window.location.search);
  const passwordFromUrl = urlParams.get('password');

  // Error banner HTML
  let errorHtml = '';
  if (error === 'not_found' && roomId) {
    errorHtml = `
      <div class="error-banner glass-panel" style="margin-bottom: 24px; padding: 20px; border-left: 4px solid var(--color-error); background: rgba(239, 68, 68, 0.1);">
        <div style="display: flex; align-items: start; gap: 12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0;">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  stroke="var(--color-error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <h3 style="margin: 0 0 8px 0; color: var(--color-error);">Room "${this.escapeHtml(roomId)}" Not Found</h3>
            <p style="margin: 0; color: var(--color-text-secondary); font-size: 14px;">
              This room may have expired (empty rooms are deleted after 5 minutes) or been deleted by an admin.
              Please verify the room ID or create a new room from the Admin Panel.
            </p>
          </div>
        </div>
      </div>
    `;
  } else if (error === 'expired') {
    errorHtml = `
      <div class="error-banner glass-panel" style="margin-bottom: 24px; padding: 20px; border-left: 4px solid var(--color-warning);">
        <strong style="color: var(--color-warning);">Room Expired</strong>
        <p style="margin: 8px 0 0 0; color: var(--color-text-secondary);">
          Empty rooms are automatically deleted after 5 minutes.
        </p>
      </div>
    `;
  }

  this.appElement.innerHTML = `
    <div class="join-page animate-fade-in">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 class="landing-logo" style="font-size: 48px; margin-bottom: 8px;">BreadCall</h1>
        <p style="color: var(--color-text-secondary);">Live Production Platform</p>
      </div>

      <div class="landing-form glass-panel" style="max-width: 480px; margin: 0 auto;">
        ${errorHtml}

        <form id="join-room-form">
          <div class="form-group">
            <label for="join-name">Your Name</label>
            <input type="text" id="join-name" placeholder="Enter your name" required
                   value="${this.escapeHtml(urlParams.get('name') || '')}">
          </div>

          <div class="form-group">
            <label for="join-room-id">Room ID</label>
            <input type="text" id="join-room-id" placeholder="4-letter code" maxlength="4"
                   style="text-transform: uppercase; letter-spacing: 4px; text-align: center; font-size: 20px;"
                   value="${this.escapeHtml(roomId)}" required>
          </div>

          <div class="form-group">
            <label for="join-password">Password (optional)</label>
            <input type="password" id="join-password" placeholder="Room password"
                   value="${this.escapeHtml(passwordFromUrl || '')}">
          </div>

          <div class="form-actions" style="display: flex; flex-direction: column; gap: 12px;">
            <button type="submit" class="btn btn-primary btn-block">
              Join Room
            </button>
            <a href="#/" class="btn btn-secondary" style="text-align: center; text-decoration: none;">
              ← Back to Home
            </a>
          </div>
        </form>

        <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--color-border);">
          <p style="text-align: center; color: var(--color-text-tertiary); font-size: 14px;">
            Need to create a room?
            <a href="/admin" style="color: var(--color-accent-primary);">Go to Admin Panel</a>
          </p>
        </div>
      </div>

      <div id="toast-container" class="toast-container"></div>
    </div>
  `;

  this.bindLandingEvents(); // Reuse existing form binding
  this.currentView = 'join';
}
```

```javascript
// client/js/app.js - handleRouteChange()
async handleRouteChange() {
  const hash = window.location.hash;

  if (!hash || hash === '#/' || hash === '') {
    this.uiManager.renderLanding();
  } else if (hash.startsWith('#/join')) {
    // NEW: Handle join page route
    const roomId = this.extractRoomIdFromHash(hash);
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    this.uiManager.renderJoinPage(roomId, error);
  } else if (hash.startsWith('#/room/')) {
    this.roomId = hash.split('/')[2]?.toUpperCase();

    // Validate room exists via REST API before joining
    try {
      const response = await fetch(`/api/rooms/${this.roomId}`);
      if (!response.ok) {
        throw new Error('Room not found');
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error('Room not found');
      }

      // Room exists - proceed normally
      this.uiManager.renderRoom(this.roomId);
      this.joinRoom(this.roomId);
    } catch (error) {
      console.error('[BreadCallApp] Room validation failed:', error.message);
      window.location.hash = `#/join?room=${this.roomId}&error=not_found`;
    }
  }
  // Handle director and solo views with validation
  else if (hash.startsWith('#/director/')) {
    const roomId = hash.split('/')[2]?.toUpperCase();
    // Validate before DirectorView initializes
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      if (!response.ok) throw new Error('Room not found');
      const data = await response.json();
      if (!data.success) throw new Error('Room not found');
      // Valid - let DirectorView self-initialize
    } catch (error) {
      window.location.hash = `#/join?room=${roomId}&error=not_found`;
    }
  } else if (hash.startsWith('#/view/')) {
    const roomId = hash.split('/')[2]?.toUpperCase();
    // Validate before SoloView initializes
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      if (!response.ok) throw new Error('Room not found');
      const data = await response.json();
      if (!data.success) throw new Error('Room not found');
      // Valid - let SoloView self-initialize
    } catch (error) {
      window.location.hash = `#/join?room=${roomId}&error=not_found`;
    }
  }
}

/**
 * Extract room ID from various hash formats
 * @param {string} hash - URL hash
 * @returns {string} Room ID
 */
extractRoomIdFromHash(hash) {
  const parts = hash.split('/');
  return parts[2]?.toUpperCase() || '';
}
```

```javascript
// client/js/DirectorView.js - init()
async init() {
  this.parseUrl();

  // Validate room exists before rendering
  try {
    const response = await fetch(`/api/rooms/${this.roomId}`);
    if (!response.ok) throw new Error('Room not found');
    const data = await response.json();
    if (!data.success) throw new Error('Room not found');

    this.render();
    this.connect();
    this.startStatsPolling();
  } catch (error) {
    console.error('[DirectorView] Room validation failed:', error.message);
    window.location.hash = `#/join?room=${this.roomId}&error=not_found`;
  }
}
```

```javascript
// client/js/SoloView.js - init()
async init() {
  this.parseUrl();

  // Validate room exists before rendering
  try {
    const response = await fetch(`/api/rooms/${this.roomId}`);
    if (!response.ok) throw new Error('Room not found');
    const data = await response.json();
    if (!data.success) throw new Error('Room not found');

    this.render();
    this.connect();
  } catch (error) {
    console.error('[SoloView] Room validation failed:', error.message);
    window.location.hash = `#/join?room=${this.roomId}&error=not_found`;
  }
}
```

#### UI Mockup

```
+------------------------------------------------------------+
|                                                            |
|                    BreadCall                               |
|              Live Production Platform                      |
|                                                            |
|   +----------------------------------------------------+   |
|   |                                                    |   |
|   |  [!] Room "ABCD" Not Found                        |   |
|   |                                                    |   |
|   |  This room may have expired (empty rooms are      |   |
|   |  deleted after 5 minutes) or been deleted by      |   |
|   |  an admin. Please verify the room ID or create    |   |
|   |  a new room from the Admin Panel.                 |   |
|   |                                                    |   |
|   +----------------------------------------------------+   |
|                                                            |
|   +----------------------------------------------------+   |
|   |              Join Room                             |   |
|   |                                                    |   |
|   |  Your Name                                         |   |
|   |  +---------------------------------------------+   |   |
|   |  |                                             |   |   |
|   |  +---------------------------------------------+   |   |
|   |                                                    |   |
|   |  Room ID                                           |   |
|   |  +---------------------------------------------+   |   |
|   |  |              A B C D                          |   |   |
|   |  +---------------------------------------------+   |   |
|   |                                                    |   |
|   |  Password (optional)                               |   |
|   |  +---------------------------------------------+   |   |
|   |  |                                             |   |   |
|   |  +---------------------------------------------+   |   |
|   |                                                    |   |
|   |  +---------------------------------------------+   |   |
|   |  |           Join Room                         |   |   |
|   |  +---------------------------------------------+   |   |
|   |                                                    |   |
|   |  +---------------------------------------------+   |   |
|   |  |      <- Back to Home                         |   |   |
|   |  +---------------------------------------------+   |   |
|   |                                                    |   |
|   |  Need to create a room? Go to Admin Panel          |   |
|   +----------------------------------------------------+   |
|                                                            |
+------------------------------------------------------------+
```

#### Pros
- Clean UX with clear error messaging
- Pre-filled room ID saves user effort
- Works with current SPA architecture
- No server-side rendering required
- Consistent pattern across all views
- Foundation for future enhancements

#### Cons
- Requires new join page component
- Multiple files to modify
- Client-side validation can have race conditions

---

### Option 4: WebSocket Pre-Flight Check (Architecturally Clean)

**Approach:** Use existing WebSocket connection for room validation before attempting to join.

#### Protocol Extension

```
Client -> Server: { type: 'check-room', payload: { roomId: 'ABCD' } }
Server -> Client: { type: 'room-status', payload: { exists: true, hasPassword: false } }
Server -> Client: { type: 'room-status', payload: { exists: false, reason: 'not_found' } }
```

#### Changes Required

| File | Change |
|------|--------|
| `server/src/SignalingHandler.js` | Add handleCheckRoom() method |
| `server/src/RoomManager.js` | Add checkRoom() method |
| `client/js/SignalingClient.js` | Add checkRoom() method |
| `client/js/app.js` | Use pre-flight check before join |

#### Implementation

```javascript
// server/src/RoomManager.js - New method
/**
 * Check if a room exists and get its status
 * @param {string} roomId - Room ID
 * @returns {Object|null} Room status or null
 */
checkRoom(roomId) {
  const room = this.rooms.get(roomId);
  if (!room) {
    return { exists: false, reason: 'not_found' };
  }

  return {
    exists: true,
    hasPassword: !!room.password,
    participantCount: room.participants.size,
    maxParticipants: room.maxParticipants,
    isFull: room.participants.size >= room.maxParticipants
  };
}
```

```javascript
// server/src/SignalingHandler.js - New handler
handleCheckRoom(ws, payload) {
  const { roomId } = payload || {};

  if (!roomId) {
    this.sendError(ws, 'Room ID is required');
    return;
  }

  if (!isValidRoomId(roomId)) {
    this.sendError(ws, 'Invalid room ID format');
    return;
  }

  const status = this.roomManager.checkRoom(roomId);
  this.send(ws, {
    type: 'room-status',
    payload: status
  });
}

// Add to handleMessage switch
case 'check-room':
  this.handleCheckRoom(ws, payload);
  break;
```

```javascript
// client/js/SignalingClient.js - New method
/**
 * Check if a room exists
 * @param {string} roomId - Room ID to check
 * @returns {Promise<Object>} Room status
 */
async checkRoom(roomId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.removeEventListener('room-status', handler);
      reject(new Error('Room check timeout'));
    }, 5000);

    const handler = (e) => {
      clearTimeout(timeout);
      this.removeEventListener('room-status', handler);
      resolve(e.detail);
    };

    this.addEventListener('room-status', handler, { once: true });

    this.send('check-room', { roomId });

    // If not connected, connect first
    if (!this.isConnected()) {
      // Connection handling...
    }
  });
}
```

```javascript
// client/js/app.js - Modified join flow
async joinRoom(roomId, name = 'password', password = '') {
  // Prevent multiple concurrent join attempts
  if (this.isJoining) return;
  this.isJoining = true;

  // NEW: Pre-flight room check
  try {
    const roomStatus = await this.signaling.checkRoom(roomId);
    if (!roomStatus.exists) {
      this.isJoining = false;
      window.location.hash = `#/join?room=${roomId}&error=not_found`;
      return;
    }
    if (roomStatus.isFull) {
      this.isJoining = false;
      this.uiManager.showToast('Room is full', 'error');
      return;
    }
  } catch (error) {
    console.error('[BreadCallApp] Room check failed:', error.message);
    // Fallback to REST validation
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      if (!response.ok) throw new Error('Room not found');
    } catch (restError) {
      this.isJoining = false;
      window.location.hash = `#/join?room=${roomId}&error=not_found`;
      return;
    }
  }

  // ... continue with normal join flow
}
```

#### Pros
- Uses existing WebSocket infrastructure
- Single connection for all operations
- Can return rich room info (capacity, password, etc.)
- No extra HTTP requests

#### Cons
- Requires WebSocket connection first (adds latency)
- More complex protocol changes
- Doesn't help SEO or no-JS scenarios
- Need to handle connection failures

---

### Option 5: Room URI with Token (Future-Proof)

**Approach:** Generate room invite tokens for secure sharing and access control.

#### Changes Required

| File | Change |
|------|--------|
| `server/src/RoomManager.js` | Add token generation/validation |
| `server/src/index.js` | Add token-based auth endpoints |
| `client/js/UIManager.js` | Handle token URLs |
| `client/js/app.js` | Validate tokens before join |

#### Implementation

```javascript
// server/src/RoomManager.js - Token methods
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * Generate an invite token for a room
 * @param {string} roomId - Room ID
 * @param {Object} options - Token options
 * @returns {string} Invite token
 */
generateInviteToken(roomId, options = {}) {
  const { expiresAt = null, maxUses = null } = options;

  const tokenId = crypto.randomBytes(16).toString('hex');
  const token = `${roomId}_${tokenId}`;

  // Store token metadata
  const tokens = this.inviteTokens.get(roomId) || new Map();
  tokens.set(token, {
    tokenId,
    roomId,
    createdAt: new Date().toISOString(),
    expiresAt,
    maxUses,
    usedCount: 0
  });
  this.inviteTokens.set(roomId, tokens);

  return token;
}

/**
 * Validate an invite token
 * @param {string} token - Invite token
 * @returns {Object} Validation result
 */
validateInviteToken(token) {
  const parts = token.split('_');
  if (parts.length < 2) {
    return { valid: false, reason: 'invalid_format' };
  }

  const roomId = parts[0];
  const room = this.rooms.get(roomId);

  if (!room) {
    return { valid: false, reason: 'room_not_found' };
  }

  const tokens = this.inviteTokens.get(roomId);
  if (!tokens || !tokens.has(token)) {
    return { valid: false, reason: 'invalid_token' };
  }

  const tokenData = tokens.get(token);

  // Check expiration
  if (tokenData.expiresAt && new Date(tokenData.expiresAt) < new Date()) {
    return { valid: false, reason: 'expired' };
  }

  // Check usage limit
  if (tokenData.maxUses && tokenData.usedCount >= tokenData.maxUses) {
    return { valid: false, reason: 'max_uses_reached' };
  }

  // Increment usage count
  tokenData.usedCount++;

  return { valid: true, roomId };
}
```

```javascript
// server/src/index.js - Token endpoints
// Validate token and get room info
app.get('/api/rooms/validate-token', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, error: 'Token required' });
  }

  const result = roomManager.validateInviteToken(token);

  if (!result.valid) {
    return res.status(403).json({
      success: false,
      error: result.reason,
      message: getTokenErrorMessage(result.reason)
    });
  }

  const room = roomManager.getRoom(result.roomId);
  res.json({
    success: true,
    roomId: result.roomId,
    room: {
      id: room.id,
      hasPassword: !!room.password
    }
  });
});

function getTokenErrorMessage(reason) {
  switch (reason) {
    case 'expired': return 'This invite link has expired';
    case 'max_uses_reached': return 'This invite link has reached its usage limit';
    case 'room_not_found': return 'The room for this token no longer exists';
    default: return 'Invalid or expired invite token';
  }
}
```

```javascript
// client/js/app.js - Token-based join
async handleRouteChange() {
  const hash = window.location.hash;
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  if (token) {
    // Token-based room access
    try {
      const response = await fetch(`/api/rooms/validate-token?token=${token}`);
      const data = await response.json();

      if (!data.success) {
        // Token invalid - show error with recovery options
        window.location.hash = `#/join?error=token_${data.error}&message=${encodeURIComponent(data.message)}`;
        return;
      }

      // Token valid - auto-join room
      this.roomId = data.roomId;
      this.uiManager.renderRoom(this.roomId);
      this.joinRoom(this.roomId);
    } catch (error) {
      window.location.hash = '#/join?error=network';
    }
    return;
  }

  // ... normal routing
}
```

#### URL Formats

| Format | Description |
|--------|-------------|
| `#/room/ABCD?token=xyz123` | Token-protected room |
| `#/join?error=token_expired` | Expired token error |
| `#/room/ABCD` | Standard room (no token) |

#### Pros
- Prevents brute-force room access
- Enables passwordless room sharing
- Audit trail for room access
- Time-limited and usage-limited invites
- Professional feature for broadcast workflows

#### Cons
- Requires token generation/validation infrastructure
- Changes room discovery model significantly
- More complex data model
- Need token cleanup/expiration handling

---

## Comparison Matrix

| Criteria | Option 1 | Option 2 | Option 3 | Option 4 | Option 5 |
|----------|----------|----------|----------|----------|----------|
| **Code Changes** | Minimal (3 files) | Moderate (3 files) | Moderate (4 files) | Moderate (4 files) | Major (5+ files) |
| **UX Quality** | Fair | Good | Best | Good | Best |
| **Works Without JS** | No | Yes | No | No | No |
| **Prevents Invalid Access** | No | Yes | Partial | Partial | Yes |
| **Extensibility** | Low | Low | Medium | High | High |
| **Implementation Time** | < 1 hour | 2-3 hours | 2-3 hours | 3-4 hours | 1-2 days |
| **Risk Level** | Low | Medium | Low | Medium | High |
| **SEO Friendly** | No | Yes | No | No | No |

---

## Recommendation

### Primary: Option 3 (Hybrid Validation + Join Page)

**Rationale:**
1. **Best UX**: Clear error messaging with easy recovery path
2. **Architecture Fit**: Works with existing SPA + hash routing
3. **Incremental**: Can be implemented piecemeal, tested independently
4. **Foundation**: Sets up Option 5 (tokens) for future enhancement
5. **Low Risk**: No server architecture changes required

### Secondary: Option 1 (Quick Win)

If time is constrained, Option 1 provides basic validation with minimal changes. Can be upgraded to Option 3 later.

### Future: Option 5 (Token-Based Access)

For production deployments requiring secure room sharing, Option 5 provides professional-grade access control.

---

## Implementation Checklist (Option 3)

### Phase 1: Core Validation
- [ ] Add renderJoinPage() to UIManager.js
- [ ] Update app.js:handleRouteChange() with REST validation
- [ ] Test: valid room, invalid room, network error

### Phase 2: View Components
- [ ] Update DirectorView.js:init() with validation
- [ ] Update SoloView.js:init() with validation
- [ ] Test: all view types with invalid rooms

### Phase 3: Polish
- [ ] Add loading state during validation
- [ ] Add retry logic for network errors
- [ ] Add error banner styles to CSS
- [ ] Test: edge cases (concurrent joins, room expiry during validation)

### Phase 4: Documentation
- [ ] Update README with new error flows
- [ ] Document query parameters for join page
- [ ] Add error message catalog

---

## Error Message Catalog

| Error Code | Display Message | Recovery Action |
|------------|-----------------|-----------------|
| not_found | Room "ABCD" not found. This room may have expired or been deleted. | Pre-fill room ID, suggest Admin Panel |
| expired | This room has expired. Empty rooms are deleted after 5 minutes. | Suggest creating new room |
| token_expired | This invite link has expired. | Offer to generate new invite |
| token_max_uses | This invite link has reached its usage limit. | Contact room creator |
| invalid_format | Invalid room ID format. Must be 4 alphanumeric characters. | Clear form, show format hint |
| network | Unable to connect to server. Please check your connection. | Retry button |

---

## Testing Scenarios

1. **Valid Room**: User accesses #/room/ABCD (room exists) -> joins normally
2. **Invalid Room ID**: User accesses #/room/INVALID123 -> redirect to join page
3. **Expired Room**: User accesses #/room/ABCD (room deleted) -> redirect with error
4. **Network Error**: Server unreachable during validation -> show network error
5. **Director View**: #/director/ABCD with invalid room -> redirect
6. **Solo View**: #/view/ABCD with invalid room -> redirect
7. **Password Room**: Valid room with password -> proceed to join form
8. **Concurrent Join**: Room deleted during validation -> handle gracefully

---

## Files Modified Summary

| File | Lines Changed | Type |
|------|---------------|------|
| client/js/UIManager.js | +80 | New method |
| client/js/app.js | +40 | Modified |
| client/js/DirectorView.js | +15 | Modified |
| client/js/SoloView.js | +15 | Modified |
| public/css/index.min.css | +30 | New styles |

**Total:** ~180 lines added/modified

---

## Security Considerations

### XSS Prevention

All user-provided content MUST be escaped before inserting into HTML:

```javascript
// ALWAYS use escapeHtml() for dynamic content
errorHtml = `
  <h3>${this.escapeHtml(roomId)}</h3>  <!-- Safe -->
  <p>${this.escapeHtml(errorMessage)}</p>  <!-- Safe -->
</div>
`;

// NEVER insert untrusted content directly
// this.appElement.innerHTML = `<div>${userInput}</div>`;  // UNSAFE!
```

The `escapeHtml()` method in UIManager.js (line 508-512) converts:
- `&` to `&amp;`
- `<` to `&lt;`
- `>` to `&gt;`
- `"` to `&quot;`
- `'` to `&#x27;`
- `/` to `&#x2F;`

### Additional Security Notes

1. **Room ID Validation**: Server-side `isValidRoomId()` regex ensures only `^[A-Z0-9]{4}$` format
2. **Password Handling**: Passwords passed via WebSocket, never logged
3. **URL Sanitization**: Query params parsed via `URLSearchParams`, not manual string parsing

---

*Document generated as part of Room URI Optimization brainstorming session.*
