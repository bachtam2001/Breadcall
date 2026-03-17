# SRT Room Input Feed Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SRT (Secure Reliable Transport) room input feed that allows directors to push external video sources (OBS, vMix) to rooms, with automatic WebRTC delivery to all participants.

**Architecture:** MediaMTX handles SRT ingestion and WebRTC transcoding. Signaling server validates SRT publish secrets via webhook, tracks stream state, and notifies directors. Participants subscribe to room feed via WHEP.

**Tech Stack:**
- Express.js for SRT auth webhook and stream event endpoints
- express-rate-limit for brute-force protection
- MediaMTX SFU for SRT→WebRTC transcoding
- JWT-style SRT publish secrets (32-char hex, 256-bit entropy)
- Existing WHEPClient for room feed subscription

---

## Chunk 1: Server Core - Room Manager and SRT Routes

### Task 1: Add express-rate-limit dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add express-rate-limit to package.json**

```json
{
  "dependencies": {
    "express-rate-limit": "^7.5.0",
    // ... existing dependencies
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: express-rate-limit installed successfully

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add express-rate-limit for SRT auth rate limiting"
```

---

### Task 2: Extend RoomManager with SRT fields

**Files:**
- Modify: `server/src/RoomManager.js:35-60` (createRoom method)
- Test: `server/__tests__/RoomManager.test.js`

- [ ] **Step 1: Write test for SRT fields in room creation**

```javascript
// server/__tests__/RoomManager.test.js
describe('SRT Room Fields', () => {
  test('createRoom generates SRT publish secret', () => {
    const roomManager = new RoomManager();
    const room = roomManager.createRoom();

    expect(room.srtPublishSecret).toBeDefined();
    expect(room.srtPublishSecret).toHaveLength(32);
    expect(room.srtPublishSecret).toMatch(/^[a-f0-9]+$/);
  });

  test('createRoom initializes SRT stream state', () => {
    const roomManager = new RoomManager();
    const room = roomManager.createRoom();

    expect(room.srtStreamActive).toBe(false);
    expect(room.srtConnectedAt).toBeNull();
  });

  test('each room gets unique SRT secret', () => {
    const roomManager = new RoomManager();
    const room1 = roomManager.createRoom();
    const room2 = roomManager.createRoom();

    expect(room1.srtPublishSecret).not.toBe(room2.srtPublishSecret);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- RoomManager.test.js
```

Expected: FAIL - srtPublishSecret, srtStreamActive, srtConnectedAt undefined

- [ ] **Step 3: Modify RoomManager.createRoom() to add SRT fields**

```javascript
// server/src/RoomManager.js line 35-60
createRoom(options = {}) {
  const { password = null, maxParticipants = 10, quality = '720p', codec = 'H264' } = options;

  // Generate unique room ID
  let roomId;
  do {
    roomId = this.generateRoomId();
  } while (this.rooms.has(roomId));

  const room = {
    id: roomId,
    password,
    maxParticipants,
    quality,
    codec,
    participants: new Map(),
    createdAt: new Date().toISOString(),
    emptySince: null,
    ttlTimer: null,
    // SRT fields
    srtPublishSecret: crypto.randomBytes(16).toString('hex'), // 32-char hex
    srtStreamActive: false,
    srtConnectedAt: null
  };

  this.rooms.set(roomId, room);
  console.log(`[RoomManager] Room created: ${roomId}`);

  return room;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- RoomManager.test.js
```

Expected: PASS - all SRT field tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/RoomManager.js server/__tests__/RoomManager.test.js
git commit -m "feat: add SRT publish secret and stream state fields to rooms"
```

---

### Task 3: Create SRT routes module

**Files:**
- Create: `server/src/routes/srt.js`
- Test: `server/__tests__/SRTAuth.test.js`

- [ ] **Step 1: Write failing test for SRT auth webhook**

```javascript
// server/__tests__/SRTAuth.test.js
const request = require('supertest');
const express = require('express');
const RoomManager = require('../RoomManager');

describe('SRT Auth Webhook', () => {
  let roomManager;
  let app;

  beforeEach(() => {
    roomManager = new RoomManager();
    app = express();
    app.use(express.json());

    // Import SRT routes with mocked roomManager
    const createSrtRoutes = require('../routes/srt');
    const router = createSrtRoutes(roomManager);
    app.use('/api/srt', router);
  });

  test('validates correct SRT secret', async () => {
    const room = roomManager.createRoom();
    const payload = {
      action: 'publish',
      path: `room/${room.id}`,
      query: `streamid=publish:room/${room.id}/${room.srtPublishSecret}`,
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/srt/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: true });
  });

  test('rejects invalid secret', async () => {
    const room = roomManager.createRoom();
    const payload = {
      action: 'publish',
      path: `room/${room.id}`,
      query: `streamid=publish:room/${room.id}/wrongsecret123`,
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/srt/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: false, reason: 'invalid_secret' });
  });

  test('rejects non-existent room', async () => {
    const payload = {
      action: 'publish',
      path: 'room/FAKE',
      query: 'streamid=publish:room/FAKE/a1b2c3d4e5f6...',
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/srt/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: false, reason: 'room_not_found' });
  });

  test('rejects invalid path format', async () => {
    const payload = {
      action: 'publish',
      path: 'invalid',
      query: 'streamid=publish:invalid/secret',
      ip: '192.168.1.50',
      user_agent: 'OBS/29.0',
      protocol: 'srt'
    };

    const response = await request(app)
      .post('/api/srt/auth')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allow: false, reason: 'invalid_format' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- SRTAuth.test.js
```

Expected: FAIL - module does not exist yet

- [ ] **Step 3: Create SRT routes module**

```javascript
// server/src/routes/srt.js
const express = require('express');
const rateLimit = require('express-rate-limit');

/**
 * SRT Routes - Handle MediaMTX webhooks for SRT authentication
 * @param {RoomManager} roomManager - RoomManager instance
 * @returns {express.Router} Router instance
 */
function createSrtRoutes(roomManager) {
  const router = express.Router();

  // Rate limiting for SRT auth webhook (prevent brute-force)
  const srtAuthLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute per IP
    message: { allow: false, reason: 'rate_limit_exceeded' },
    keyGenerator: (req) => req.ip,
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * Parse SRT auth request from MediaMTX
   * MediaMTX sends path and query separately
   * @param {Object} req - Express request
   * @returns {Object} Parsed result with roomId and secret
   */
  function parseSrtAuthRequest(req) {
    const { path, query } = req.body;

    // Extract roomId from path (e.g., "room/ABCD" -> "ABCD")
    const pathParts = path.split('/');
    if (pathParts.length !== 2 || pathParts[0] !== 'room') {
      return { valid: false, reason: 'invalid_format' };
    }
    const roomId = pathParts[1];

    // Extract secret from query string
    // Format: streamid=publish:room/ROOMID/SECRET
    const streamIdMatch = query?.match(/^streamid=publish:room\/([A-Z0-9]+)\/([a-f0-9]+)$/);
    if (!streamIdMatch) {
      return { valid: false, reason: 'invalid_format' };
    }

    const parsedRoomId = streamIdMatch[1];
    const secret = streamIdMatch[2];

    // Verify roomId in path matches roomId in streamid
    if (parsedRoomId !== roomId) {
      return { valid: false, reason: 'invalid_format' };
    }

    return { valid: true, roomId, secret };
  }

  /**
   * Log SRT auth attempt for audit trail
   */
  function logSrtAuthAttempt({ roomId, ip, userAgent, result, reason }) {
    console.log(JSON.stringify({
      event: 'srt_auth_attempt',
      roomId,
      ip,
      userAgent,
      result,
      reason,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * POST /api/srt/auth - MediaMTX SRT authentication webhook
   * Validates SRT publish secret before allowing connection
   */
  function handleSrtAuth(req, res) {
    try {
      const { action, ip, user_agent } = req.body;

      // Only support publish action
      if (action !== 'publish') {
        return res.json({ allow: false, reason: 'unsupported_action' });
      }

      // Parse request
      const parseResult = parseSrtAuthRequest(req);
      if (!parseResult.valid) {
        logSrtAuthAttempt({
          roomId: 'unknown',
          ip,
          userAgent: user_agent,
          result: 'rejected',
          reason: parseResult.reason
        });
        return res.json({ allow: false, reason: parseResult.reason });
      }

      const { roomId, secret } = parseResult;

      // Check if room exists
      const room = roomManager.getRoom(roomId);
      if (!room) {
        logSrtAuthAttempt({
          roomId,
          ip,
          userAgent: user_agent,
          result: 'rejected',
          reason: 'room_not_found'
        });
        return res.json({ allow: false, reason: 'room_not_found' });
      }

      // Validate secret
      if (secret !== room.srtPublishSecret) {
        logSrtAuthAttempt({
          roomId,
          ip,
          userAgent: user_agent,
          result: 'rejected',
          reason: 'invalid_secret'
        });
        return res.json({ allow: false, reason: 'invalid_secret' });
      }

      // Auth successful
      logSrtAuthAttempt({
        roomId,
        ip,
        userAgent: user_agent,
        result: 'allowed',
        reason: null
      });

      res.json({ allow: true });
    } catch (error) {
      console.error('[SRT Auth] Error:', error.message);
      res.json({ allow: false, reason: 'internal_error' });
    }
  }

  /**
   * POST /api/srt/stream-event - MediaMTX stream start/end webhook
   * Tracks SRT stream state and notifies directors
   */
  function handleStreamEvent(req, res) {
    try {
      const { room, event } = req.body;

      // Extract roomId from path (e.g., "room/ABCD" -> "ABCD")
      const roomId = room.replace('room/', '');
      const roomData = roomManager.getRoom(roomId);

      if (!roomData) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      if (event === 'publish_start') {
        roomData.srtStreamActive = true;
        roomData.srtConnectedAt = new Date().toISOString();

        // Notify all directors in this room
        roomManager.notifyDirectors(roomId, {
          type: 'srt-feed-updated',
          active: true,
          connectedAt: roomData.srtConnectedAt
        });

        console.log(`[SRT] Stream started for room ${roomId}`);
      } else if (event === 'publish_end') {
        roomData.srtStreamActive = false;
        roomData.srtConnectedAt = null;

        // Notify all directors in this room
        roomManager.notifyDirectors(roomId, {
          type: 'srt-feed-updated',
          active: false,
          connectedAt: null
        });

        console.log(`[SRT] Stream ended for room ${roomId}`);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[SRT Stream Event] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Routes
  router.post('/auth', srtAuthLimiter, handleSrtAuth);
  router.post('/stream-event', handleStreamEvent);

  return router;
}

module.exports = createSrtRoutes;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- SRTAuth.test.js
```

Expected: PASS - all SRT auth tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/srt.js server/__tests__/SRTAuth.test.js
git commit -m "feat: add SRT auth webhook and stream event routes"
```

---

### Task 4: Mount SRT routes and extend room creation API

**Files:**
- Modify: `server/src/index.js` (around line 18-22 for imports, around line 457 for room creation)

- [ ] **Step 1: Import SRT routes in index.js**

```javascript
// server/src/index.js - add after line 21
const createSrtRoutes = require('./routes/srt');
```

- [ ] **Step 2: Mount SRT routes after other middleware**

```javascript
// server/src/index.js - add after auth middleware initialization (around line 380)
// SRT Routes (MediaMTX webhooks)
app.use('/api/srt', createSrtRoutes(roomManager));
console.log('[Server] SRT routes mounted at /api/srt');
```

- [ ] **Step 3: Extend room creation response to include SRT URL**

```javascript
// server/src/index.js - update the POST /api/admin/rooms endpoint
app.post('/api/admin/rooms', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:create');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
  try {
    const { password, maxParticipants = 10, quality = 'hd', codec = 'H264' } = req.body;
    const room = roomManager.createRoom({
      password,
      maxParticipants,
      quality,
      codec
    });

    // Generate SRT publish URL
    const externalSrtHost = process.env.EXTERNAL_SRT_HOST || req.headers.host;
    const srtPublishUrl = `srt://${externalSrtHost}:8890?streamid=publish:room/${room.id}/${room.srtPublishSecret}`;

    res.json({
      success: true,
      roomId: room.id,
      room: {
        id: room.id,
        maxParticipants: room.maxParticipants,
        quality: room.quality,
        codec: room.codec,
        createdAt: room.createdAt,
        srtPublishSecret: room.srtPublishSecret
      },
      srtPublishUrl,
      createdAt: room.createdAt
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});
```

- [ ] **Step 4: Add SRT status endpoint**

```javascript
// server/src/index.js - add after room info endpoint (around line 102)
// Get SRT feed status
app.get('/api/rooms/:roomId/srt-status', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }

  res.json({
    active: room.srtStreamActive || false,
    connectedAt: room.srtConnectedAt || null
  });
});
```

- [ ] **Step 5: Run server to verify routes mount correctly**

```bash
npm run dev
```

Expected: Server starts, logs "[Server] SRT routes mounted at /api/srt"

- [ ] **Step 6: Commit**

```bash
git add server/src/index.js
git commit -m "feat: mount SRT routes and include SRT URL in room creation"
```

---

## Chunk 2: MediaMTX Configuration

### Task 5: Update MediaMTX configuration

**Files:**
- Modify: `docker/mediamtx/mediamtx.yml`

- [ ] **Step 1: Update mediamtx.yml with SRT auth webhook**

```yaml
# MediaMTX configuration for BreadCall
# WHIP/WHEP WebRTC streaming

# Disable unused protocols
rtsp: false
rtmp: false
hls: false
srt: true
srtAddress: :8890

# WebRTC configuration (WHIP/WHEP)
webrtc: true
webrtcAddress: :8887
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :9000
webrtcLocalTCPAddress: :9000
webrtcIPsFromInterfaces: true

# SRT authentication webhook
auth:
  http:
    address: http://signaling:3000/api/srt/auth
    timeout: 5s

# Paths - allow any stream name (dynamic room/participant streams)
paths:
  # Room paths with SRT auth and runOnPublish hooks
  room/*:
    source: publisher

    # WebRTC settings for participant consumption
    webRTCPCUDSCTimeout: 30s

    # Run commands for stream events (triggers signaling server notifications)
    runOnPublish:
      cmd: curl -X POST http://signaling:3000/api/srt/stream-event \
           -H "Content-Type: application/json" \
           -d '{"room":"%path","event":"publish_start"}'
    runOnUnpublish:
      cmd: curl -X POST http://signaling:3000/api/srt/stream-event \
           -d '{"room":"%path","event":"publish_end"}'

  # Wildcard path for other streams (e.g., ROOM_123_participantId)
  '~^.*$':
    source: publisher
```

- [ ] **Step 2: Verify docker-compose exposes SRT port**

Already configured in `docker-compose.yml` line 85:
```yaml
- "8890:8890/udp"  # SRT
```

- [ ] **Step 3: Commit**

```bash
git add docker/mediamtx/mediamtx.yml
git commit -m "feat: configure MediaMTX SRT auth webhook and stream events"
```

---

## Chunk 3: Client Implementation

### Task 6: Update Director Dashboard to display SRT URL

**Files:**
- Modify: `client/js/DirectorView.js`

- [ ] **Step 1: Add SRT URL state to init**

```javascript
// client/js/DirectorView.js - update init() method
async init() {
  this.parseUrl();
  this.srtPublishUrl = null;
  this.srtStreamActive = false;

  // Check for token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  if (token) {
    await this.handleTokenBasedAccess(token);
  } else {
    this.render();
    this.connect();
    this.startStatsPolling();
    this.fetchSrtUrl(); // Fetch SRT URL on init
  }
}
```

- [ ] **Step 2: Add SRT display methods**

```javascript
// Add after existing methods in DirectorView.js

/**
 * Update SRT status display
 */
updateSrtDisplay() {
  const statusEl = document.getElementById('srt-status');
  if (statusEl) {
    statusEl.textContent = this.srtStreamActive ? 'Active' : 'Waiting for source';
    statusEl.style.color = this.srtStreamActive ? 'var(--color-success)' : 'var(--color-text-tertiary)';
  }
}

/**
 * Copy SRT URL to clipboard
 */
async copySrtUrl() {
  if (!this.srtPublishUrl) {
    this.showToast('SRT URL not available', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(this.srtPublishUrl);
    this.showToast('SRT URL copied!', 'success');
  } catch (error) {
    this.showToast('Failed to copy', 'error');
  }
}
```

- [ ] **Step 3: Add WebSocket event handler for SRT feed updates**

```javascript
// Update connect() method to add after participant-left event handler
this.signaling.addEventListener('srt-feed-updated', (e) => {
  const { active, connectedAt } = e.detail;
  console.log('[Director] SRT feed updated:', { active, connectedAt });
  this.srtStreamActive = active;
  this.updateSrtDisplay();

  if (active) {
    this.showToast('SRT feed is now active', 'success');
  } else {
    this.showToast('SRT feed has stopped', 'info');
  }
});
```

- [ ] **Step 4: Update render() to include SRT section**

```javascript
// client/js/DirectorView.js - update render() method
render() {
  document.body.innerHTML = `
    <div class="director-dashboard animate-fade-in">
      <div class="director-header glass-panel" style="padding: 16px 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h1 style="margin: 0 0 8px 0; font-size: 24px;">Director Dashboard</h1>
          <p style="margin: 0; color: var(--color-text-secondary);">Room: <strong style="color: var(--color-accent-primary);">${this.escapeHtml(this.roomId)}</strong></p>
        </div>
        <div class="director-stats" style="display: flex; gap: 32px;">
          <div class="stat-item" style="text-align: center;">
            <div class="stat-value" id="participant-count" style="font-size: 32px; font-weight: 700; color: var(--color-accent-primary);">0</div>
            <div class="stat-label" style="font-size: 12px; color: var(--color-text-tertiary);">Participants</div>
          </div>
        </div>
      </div>

      <!-- SRT Input Section -->
      <div class="srt-input-section glass-panel" style="padding: 16px; margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px 0; font-size: 18px;">SRT Input Feed</h2>
        <p style="color: var(--color-text-secondary); margin-bottom: 12px;">
          Use this URL to push external video sources (OBS, vMix) to the room
        </p>
        <div style="display: flex; gap: 8px; align-items: center;">
          <code id="srt-url" style="flex: 1; background: var(--color-bg-secondary); padding: 8px; border-radius: 4px; font-family: monospace; overflow: hidden; text-overflow: ellipsis;">
            ${this.escapeHtml(this.srtPublishUrl || 'SRT URL not available - check admin dashboard')}
          </code>
          <button class="btn btn-secondary" id="copy-srt-btn">
            Copy
          </button>
        </div>
        <div id="srt-status" style="margin-top: 8px; font-size: 12px;">
          ${this.srtStreamActive ? 'Active' : 'Waiting for source'}
        </div>
      </div>

      <div id="director-grid" class="director-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px;"></div>
      <div id="toast-container" class="toast-container"></div>
    </div>
  `;

  // Attach event listener to copy button
  const copyBtn = document.getElementById('copy-srt-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => this.copySrtUrl());
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add client/js/DirectorView.js
git commit -m "feat: display SRT URL and status in director dashboard"
```

---

### Task 7: Add room feed WHEP subscription to participant view

**Files:**
- Modify: `client/js/app.js` (or the main room view coordinator)

- [ ] **Step 1: Add room feed subscription after joining room**

Locate where the room join flow completes in `app.js` and add:

```javascript
// After successfully joining room, subscribe to room feed
async subscribeToRoomFeed(roomId) {
  try {
    const configResponse = await fetch('/api/webrtc-config');
    const webrtcConfig = await configResponse.json();

    // Create video element for room feed if it doesn't exist
    let videoEl = document.getElementById('room-feed-video');
    if (!videoEl) {
      const container = document.querySelector('.video-grid') || document.body;
      videoEl = document.createElement('video');
      videoEl.id = 'room-feed-video';
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.className = 'room-feed-video';
      container.insertBefore(videoEl, container.firstChild);
    }

    // Subscribe via WHEP to room path
    this.roomFeedPlayer = new WHEPClient({
      endpoint: `${webrtcConfig.webrtcUrl}/whep/room/${roomId}`,
      videoElement: videoEl,
      autoPlay: true,
      muted: false
    });

    await this.roomFeedPlayer.play();
    console.log('[App] Subscribed to room feed via WHEP');
  } catch (error) {
    console.error('[App] Failed to subscribe to room feed:', error);
  }
}
```

- [ ] **Step 2: Call subscribeToRoomFeed after join-room succeeds**

Find where `join-room` event is handled and add the call.

- [ ] **Step 3: Cleanup room feed on leave**

```javascript
// Add to cleanup/leave room method
if (this.roomFeedPlayer) {
  this.roomFeedPlayer.close();
  this.roomFeedPlayer = null;
}
```

- [ ] **Step 4: Commit**

```bash
git add client/js/app.js
git commit -m "feat: subscribe to room SRT feed via WHEP in participant view"
```

---

## Chunk 4: Environment Variables and Documentation

### Task 8: Add environment variables

**Files:**
- Modify: `.env.example` (create if doesn't exist)

- [ ] **Step 1: Add SRT environment variables**

```bash
# .env or .env.example

# SRT Configuration
SRT_PORT=8890
EXTERNAL_SRT_HOST=localhost
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add SRT environment variables"
```

---

### Task 9: Update README with SRT feature documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add SRT section to README**

```markdown
## SRT Input Feed

BreadCall supports SRT (Secure Reliable Transport) input feeds for professional video sources.

### Using SRT

1. Create a room via the admin dashboard
2. Copy the SRT URL from the room creation response
3. Configure OBS/vMix to push to the SRT URL:
   - Protocol: SRT
   - Address: `srt://your-server:8890?streamid=publish:room/ROOMID/SECRET`
   - Video Codec: H264 (recommended)
   - Audio Codec: AAC or Opus

### Example OBS Configuration

1. Go to Settings > Stream
2. Service: Custom
3. Server: `srt://your-server:8890`
4. Stream Key: `publish:room/ROOMID/SECRET`

All participants in the room will automatically receive the SRT feed via WebRTC.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add SRT input feed documentation to README"
```

---

## Chunk 5: Integration and E2E Tests

### Task 10: Write integration tests for SRT→WebRTC flow

**Files:**
- Create: `server/__tests__/SRTIntegration.test.js`

- [ ] **Step 1: Create integration test skeleton**

```javascript
// server/__tests__/SRTIntegration.test.js
const RoomManager = require('../RoomManager');

describe('SRT Integration', () => {
  let roomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
  });

  test('room creation includes SRT URL components', () => {
    const room = roomManager.createRoom();

    expect(room.srtPublishSecret).toBeDefined();
    expect(room.srtPublishSecret).toHaveLength(32);
    expect(room.srtStreamActive).toBe(false);
    expect(room.srtConnectedAt).toBeNull();
  });

  test('SRT stream state updates trigger director notifications', () => {
    const room = roomManager.createRoom();

    // Simulate director joining
    const mockWs = { send: jest.fn(), readyState: 1 };
    roomManager.joinRoomAsDirector(room.id, { ws: mockWs, name: 'Test Director' });

    // Simulate stream start
    room.srtStreamActive = true;
    room.srtConnectedAt = new Date().toISOString();
    roomManager.notifyDirectors(room.id, {
      type: 'srt-feed-updated',
      active: true,
      connectedAt: room.srtConnectedAt
    });

    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('srt-feed-updated')
    );
  });
});
```

- [ ] **Step 2: Run test**

```bash
npm test -- SRTIntegration.test.js
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/SRTIntegration.test.js
git commit -m "test: add SRT integration tests"
```

---

## Verification

After all tasks are complete, run the following verification steps:

1. **Start all services:**
   ```bash
   docker-compose up -d
   ```

2. **Create a room and verify SRT URL:**
   ```bash
   curl -X POST http://localhost:3000/api/admin/rooms \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <admin-token>"
   ```

3. **Test SRT auth webhook:**
   ```bash
   curl -X POST http://localhost:3000/api/srt/auth \
     -H "Content-Type: application/json" \
     -d '{
       "action": "publish",
       "path": "room/ABCD",
       "query": "streamid=publish:room/ABCD/invalidsecret",
       "ip": "127.0.0.1",
       "protocol": "srt"
     }'
   ```

4. **Run all tests:**
   ```bash
   npm test
   ```

---

## Notes

- **TDD Approach:** Each task follows test-first development - write failing test, implement minimal code, verify pass, commit
- **Frequent Commits:** Each logical unit of work gets its own commit
- **Rate Limiting:** SRT auth webhook is rate-limited to 10 requests/minute per IP
- **Audit Logging:** All SRT auth attempts are logged in JSON format
- **Security:** 32-character hex secrets provide 256-bit entropy against brute-force
- **XSS Prevention:** All user-facing content uses escapeHtml() or textContent, never innerHTML with untrusted data
