# SRT Room Input Feed - Design Specification

**Date:** 2026-03-17
**Status:** Draft
**Author:** Claude (with user collaboration)

---

## 1. Overview

### 1.1 Purpose

Enable external video sources (OBS, vMix, hardware encoders) to push SRT video into a BreadCall room, with the SRT feed becoming the primary/largest video tile for all participants.

### 1.2 Problem Statement

Directors need to bring professional video sources (live cameras, production switchers, pre-recorded content) into rooms. Current WebRTC-only approach requires browser-based publishing, limiting production quality and flexibility.

### 1.3 Goals

- **Auto-generate SRT input URL** for each room on creation
- **Token-secured SRT publish** - only holders of valid room SRT secret can push
- **Automatic WebRTC delivery** - MediaMTX transcodes SRT→WebRTC, no client changes
- **Primary feed display** - SRT feed occupies prominent/fixed position in participant view
- **No dashboard management** - SRT feed is always-on, no UI controls needed

### 1.4 Non-Goals

- Per-participant SRT URLs (room-level only, single feed)
- SRT read URLs for external players (WebRTC delivery only)
- Director UI controls for SRT feed (no mute/hide/toggle)
- Multiple SRT inputs per room

---

## 2. Architecture

### 2.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BreadCall System                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐                                               │
│  │  Director        │  1. Creates room                              │
│  │  Dashboard       │  2. Receives SRT URL auto-generated           │
│  └──────────────────┘                                               │
│                                                                     │
│  ┌──────────────────┐                                               │
│  │  External Source │  3. SRT Push                                  │
│  │  (OBS/vMix)      │     srt://host:8890                           │
│  │                  │     ?streamid=publish:room/ROOMID/SECRET      │
│  └────────┬─────────┘                                               │
│           │                                                         │
│           ▼                                                         │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    MediaMTX SFU                                │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐│ │
│  │  │ SRT Ingest  │──│   Path:     │──│  WebRTC Publisher       ││ │
│  │  │ port 8890   │  │ room/ROOMID │  │  (auto transcoding)     ││ │
│  │  └─────────────┘  └──────┬──────┘  └───────────┬─────────────┘│ │
│  │                          │                     │              │ │
│  │         ┌────────────────┘                     │              │ │
│  │         │ Auth Webhook                         │              │ │
│  │         ▼                                      ▼              │ │
│  │  ┌──────────────────┐                  ┌──────────────────┐   │ │
│  │  │ POST /api/srt/   │                  │ WHEP endpoint:   │   │ │
│  │  │ auth             │                  │ /whep/room/ROOMID│   │ │
│  │  └──────────────────┘                  └──────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│           │                                          │              │
│           ▼                                          ▼              │
│  ┌──────────────────┐                       ┌──────────────────┐   │
│  │  Signaling       │                       │  Participants    │   │
│  │  Server          │                       │  (Browser)       │   │
│  │  - Validates SRT │                       │  - Subscribe via │   │
│  │    secret        │                       │    WHEP          │   │
│  │  - Returns allow │                       │  - See as primary│   │
│  │    /reject       │                       │    video tile    │   │
│  └──────────────────┘                       └──────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Components

| Component | Responsibility |
|-----------|----------------|
| `RoomManager.js` | Generate `srtPublishSecret` per room, store with room data |
| `server/src/routes/srt.js` | New SRT auth webhook endpoint |
| `mediamtx.yml` | Configure SRT port, paths, auth webhook URL |
| `DirectorView.js` | Display SRT URL (copy button, status indicator) |
| `app.js` / Room view | Subscribe to room feed via WHEP, render as primary tile |
| `WHEPClient.js` | Reuse existing client for room feed subscription |

---

## 3. Data Model

### 3.1 Room Schema Extension

Add to room creation in `RoomManager.createRoom()`:

```javascript
const room = {
  id: roomId,
  // ... existing fields ...
  srtPublishSecret: crypto.randomBytes(16).toString('hex'), // 32-char hex
  srtStreamActive: false, // Track if SRT source is currently publishing
  srtConnectedAt: null // Timestamp of SRT connection
};
```

### 3.2 SRT URL Format

**Publish URL (given to director):**
```
srt://{host}:{port}?streamid=publish:room/{roomId}/{srtPublishSecret}
```

**Example:**
```
srt://192.168.1.100:8890?streamid=publish:room/ABCD/a1b2c3d4e5f6...
```

### 3.3 Codec Handling

MediaMTX handles codec transcoding automatically:

| Input/Output | Video Codecs | Audio Codecs |
|--------------|--------------|--------------|
| SRT Input | H264 (recommended), H265, VP9 | Opus, AAC, MP3 |
| WebRTC Output | H264 (default), VP8, VP9 | Opus (required) |

**Director Configuration:**
- SRT sources (OBS, vMix) should output **H264 video** and **AAC/Opus audio** for best compatibility
- MediaMTX transcodes as needed for WebRTC client compatibility
- No application-level codec handling required

---

## 4. Security Architecture

### 4.1 Authentication Flow

**Important:** MediaMTX SRT authentication uses a webhook that receives the full request details including the `query` parameter containing the streamid. The path field contains only the base path (without the secret).

```
1. OBS/vMix initiates SRT connection
   └─> streamid=publish:room/ABCD/a1b2c3d4e5f6...

2. MediaMTX extracts path and query
   └─> path = "room/ABCD"
   └─> query = "streamid=publish:room/ABCD/a1b2c3d4e5f6..."

3. MediaMTX calls webhook
   POST https://signaling/api/srt/auth
   {
     "action": "publish",
     "path": "room/ABCD",
     "query": "streamid=publish:room/ABCD/a1b2c3d4e5f6...",
     "ip": "192.168.1.50",
     "user_agent": "OBS/29.0",
     "protocol": "srt"
   }

4. Signaling server validates:
   - Extract secret from query.streamid
   - Room exists
   - Secret matches stored srtPublishSecret
   - Room not deleted
   └─> Response: {"allow": true} or {"allow": false, "reason": "..."}

5. MediaMTX accepts/rejects connection
```

**Path Parsing Implementation:**

```javascript
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
```

### 4.2 Security Properties

| Property | Implementation |
|----------|----------------|
| Token secrecy | 32-char random hex, cryptographically secure (256-bit entropy) |
| Dynamic revocation | Webhook validates on every connection |
| Audit logging | All SRT auth requests logged on signaling server |
| Room lifecycle | Secret invalidated when room deleted |
| No token reuse | Secret unique per room, rotation supported |
| Rate limiting | 10 requests/minute per IP on auth webhook |

### 4.3 Rate Limiting

Implement rate limiting on the SRT auth webhook to prevent brute-force attacks:

```javascript
// server/src/routes/srt.js
const rateLimit = require('express-rate-limit');

const srtAuthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: { allow: false, reason: 'rate_limit_exceeded' },
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/srt/auth', srtAuthLimiter, handleSrtAuth);
```

**Add to reason codes (Section 5.1):**
- `rate_limit_exceeded` - Too many auth requests from same IP

### 4.4 Audit Logging

All SRT authentication attempts are logged for security auditing:

```javascript
function logSrtAuthAttempt({ roomId, ip, userAgent, result, reason }) {
  console.log(JSON.stringify({
    event: 'srt_auth_attempt',
    roomId,
    ip,
    userAgent,
    result, // 'allowed' | 'rejected'
    reason, // e.g., 'invalid_secret', 'room_not_found'
    timestamp: new Date().toISOString()
  }));
}
```

**Log Retention:** Logs are retained for 30 days (standard application log policy).

### 4.5 Secret Rotation (Manual)

**Current Limitation:** SRT secrets cannot be rotated without recreating the room.

**Mitigation:** If an SRT secret is compromised:
1. Delete the current room via `/api/admin/rooms/:roomId`
2. Create a new room (new secret auto-generated)
3. Distribute new SRT URL to authorized sources

**Future Enhancement:** Add secret rotation endpoint to director dashboard.

### 4.6 Threat Mitigation

| Threat | Mitigation |
|--------|------------|
| Brute-force token guessing | 256-bit secret space, rate limiting on webhook |
| Replay attacks | Secret validated against current room state |
| Unauthorized room access | Secret required, logged on every attempt |
| Secret leakage | Rotate via director dashboard (future enhancement) |

---

## 5. API Design

### 5.1 SRT Auth Webhook

**Endpoint:** `POST /api/srt/auth`

**Request (from MediaMTX):**
```json
{
  "action": "publish",
  "path": "room/ABCD/a1b2c3d4e5f6...",
  "ip": "192.168.1.50",
  "user_agent": "OBS/29.0"
}
```

**Response - Success:**
```json
{
  "allow": true
}
```

**Response - Rejected:**
```json
{
  "allow": false,
  "reason": "invalid_secret"
}
```

**Reason codes:**
- `invalid_format` - Stream ID doesn't match expected pattern
- `room_not_found` - Room doesn't exist
- `invalid_secret` - Secret doesn't match stored value
- `room_deleted` - Room was deleted (TTL expired)
- `rate_limit_exceeded` - Too many auth requests from same IP

### 5.2 Room Creation Response

Extend `/api/admin/rooms` POST response to include SRT URL:

```javascript
// In server/src/index.js or routes/admin.js
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
    srtPublishSecret: room.srtPublishSecret // Include for admin reference
  },
  srtPublishUrl,
  createdAt: room.createdAt
});
```

**Note:** The `srtPublishSecret` is included in the response for debugging/logging purposes. The full `srtPublishUrl` is the recommended way to use it.

### 5.3 SRT Stream Event Webhook

**Endpoint:** `POST /api/srt/stream-event`

MediaMTX calls this webhook when SRT streams start/stop (via `runOnPublish`/`runOnUnpublish`).

**Request:**
```json
{
  "room": "room/ABCD",
  "event": "publish_start" | "publish_end",
  "timestamp": "2026-03-17T10:00:00Z"
}
```

**Response:**
```json
{
  "success": true
}
```

**Handler Implementation:**

```javascript
app.post('/api/srt/stream-event', async (req, res) => {
  const { room, event } = req.body;
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
  } else if (event === 'publish_end') {
    roomData.srtStreamActive = false;
    roomData.srtConnectedAt = null;

    // Notify all directors in this room
    roomManager.notifyDirectors(roomId, {
      type: 'srt-feed-updated',
      active: false,
      connectedAt: null
    });
  }

  res.json({ success: true });
});
```

---

## 6. MediaMTX Configuration

### 6.1 Path Configuration

Add to `mediamtx.yml`:

```yaml
# SRT authentication webhook
auth:
  http:
    address: http://signaling:3000/api/srt/auth
    timeout: 5s

paths:
  room/*:
    source: publisher
    sourceFingerprint: ""

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
```

**Note:** `srtPublishPassphrase` is not configured because we use webhook-based authentication instead of static passphrases.

### 6.2 Port Configuration

Ensure SRT port is exposed (already configured in docker-compose.yml):
```yaml
ports:
  - "8890:8890/udp"  # SRT
```

---

## 7. Client Implementation

### 7.1 Director Dashboard Changes

**Location:** `client/js/DirectorView.js`

Add SRT URL display to dashboard:

```javascript
// In render() method, add after header:
<div class="srt-input-section glass-panel" style="padding: 16px; margin-bottom: 24px;">
  <h2 style="margin: 0 0 12px 0; font-size: 18px;">SRT Input Feed</h2>
  <p style="color: var(--color-text-secondary); margin-bottom: 12px;">
    Use this URL to push external video sources (OBS, vMix) to the room
  </p>
  <div style="display: flex; gap: 8px; align-items: center;">
    <code id="srt-url" style="flex: 1; background: var(--color-bg-secondary); padding: 8px; border-radius: 4px; font-family: monospace;">
      ${this.srtPublishUrl || 'Generating...'}
    </code>
    <button class="btn btn-secondary" onclick="window.directorView.copySrtUrl()">
      Copy
    </button>
  </div>
  <div id="srt-status" style="margin-top: 8px; font-size: 12px;">
    ${this.srtStreamActive ? '<span style="color: var(--color-success);">● Active</span>' : '<span style="color: var(--color-text-tertiary);">○ Waiting for source</span>'}
  </div>
</div>
```

### 7.2 Room View Changes

**Location:** `client/js/app.js` or dedicated RoomView

**WHEP Subscription:**

```javascript
// In room join flow, after receiving room info:
async subscribeToRoomFeed(roomId) {
  const webrtcConfig = await fetch('/api/webrtc-config').then(r => r.json());

  this.roomFeedPlayer = new WHEPClient({
    endpoint: `${webrtcConfig.webrtcUrl}/whep/room/${roomId}`,
    videoElement: document.getElementById('room-feed-video'),
    autoPlay: true,
    muted: false  // Room feed should have audio by default
  });

  await this.roomFeedPlayer.play();
}
```

**SRT Feed Status Detection:**

The signaling server tracks SRT stream state and notifies clients:

```javascript
// Poll for SRT feed status (optional, for placeholder UI)
async checkRoomFeedStatus(roomId) {
  const response = await fetch(`/api/rooms/${roomId}/srt-status`);
  const { active, connectedAt } = await response.json();

  if (active) {
    this.showFeedActive();
  } else {
    this.showWaitingForSource();
  }
}
```

**New API Endpoint:**

```javascript
app.get('/api/rooms/:roomId/srt-status', async (req, res) => {
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

**UI Layout:**
```
┌─────────────────────────────────────────────┐
│           ROOM FEED (SRT)                   │
│           [Primary/Largest Tile]            │
│           [Fixed Position - Top]            │
│           [Shows "Waiting for source"       │
│            when SRT offline]                │
└─────────────────────────────────────────────┘
┌─────────┬─────────┬─────────┬───────────────┐
│Participant│Participant│Participant│  ...       │
│   Grid    │   Grid    │   Grid    │            │
│  (Small)  │  (Small)  │  (Small)  │            │
└─────────┴─────────┴─────────┴───────────────┘
```

**WHEP Path Clarification:**
- SRT publishes to: `srt://host:8890?streamid=publish:room/ABCD/SECRET`
- MediaMTX registers path as: `room/ABCD` (secret is auth-only, not part of path)
- WHEP subscribes to: `/whep/room/ABCD` (no secret needed)

---

## 8. Error Handling

### 8.1 SRT Connection Errors

| Scenario | User Experience | System Behavior |
|----------|-----------------|-----------------|
| Invalid secret | Director sees "Rejected" toast | Webhook returns `{allow: false, reason: "invalid_secret"}` |
| Network error | OBS shows connection failed | MediaMTX logs error, webhook not called |
| Room deleted | SRT source disconnected | Webhook returns `{allow: false, reason: "room_not_found"}` |
| Rate limit exceeded | OBS connection rejected | Webhook returns `{allow: false, reason: "rate_limit_exceeded"}` |

### 8.2 Participant View Errors

| Scenario | User Experience | System Behavior |
|----------|-----------------|-----------------|
| SRT source offline | "Waiting for source" placeholder | Video tile shows static placeholder |
| MediaMTX unavailable | Video tile shows error | WHEP connection fails, retry with backoff |
| WebRTC negotiation fails | Toast error message | Retry WHEP subscription up to 3 times |

### 8.3 Edge Cases

| Scenario | Behavior | Notes |
|----------|----------|-------|
| Multiple SRT publishers | Last publisher wins, first is rejected | MediaMTX handles automatically |
| SRT source disconnect/reconnect | Video freezes, auto-resumes on reconnect | WebRTC connection maintained |
| Room deletion during active stream | SRT stream terminated immediately | `runOnUnpublish` triggered |
| Network partition (MediaMTX ↔ signaling) | Auth webhook times out, new connections rejected | Existing streams unaffected |

---

## 9. Testing

### 9.1 Unit Tests

**File:** `server/__tests__/SRTAuth.test.js`

```javascript
describe('SRT Auth Webhook', () => {
  test('validates correct secret', async () => {
    // Create room with known secret
    // Call webhook with valid streamid
    // Expect {allow: true}
  });

  test('rejects invalid secret', async () => {
    // Call webhook with wrong secret
    // Expect {allow: false, reason: 'invalid_secret'}
  });

  test('rejects non-existent room', async () => {
    // Call webhook with fake roomId
    // Expect {allow: false, reason: 'room_not_found'}
  });
});
```

### 9.2 Integration Tests

**File:** `server/__tests__/SRTIntegration.test.js`

```javascript
describe('SRT → WebRTC Flow', () => {
  test('end-to-end SRT publish and WHEP playback', async () => {
    // 1. Create room
    // 2. Get SRT URL
    // 3. Push test video via SRT (using ffmpeg/obs-cli)
    // 4. Subscribe via WHEP
    // 5. Verify video frames received
  });
});
```

### 9.3 E2E Tests

**File:** `e2e/tests/srt-input.spec.js`

```javascript
test('Director can display SRT URL and participants can view feed', async ({ page }) => {
  // 1. Login as director
  // 2. Create room, verify SRT URL displayed
  // 3. Copy SRT URL
  // 4. Open participant view in another browser
  // 5. Verify participant sees room feed tile
});
```

---

## 10. Deployment

### 10.1 Environment Variables

Add to `.env`:

```bash
# SRT Configuration
SRT_PORT=8890                          # Default: 8890
SRT_AUTH_WEBHOOK_URL=http://localhost:3000/api/srt/auth
SRT_AUTH_WEBHOOK_TIMEOUT=5s            # MediaMTX webhook timeout
EXTERNAL_SRT_HOST=your-server-public-ip # Required for URL generation
```

### 10.2 Docker Compose

Already configured in `docker-compose.yml`:
```yaml
mediamtx:
  ports:
    - "8890:8890/udp"  # SRT
```

### 10.3 Migration Steps

1. **Database:** No migration needed (in-memory room extension)
2. **MediaMTX:** Update `mediamtx.yml` with auth webhook config
3. **Server:** Deploy new `/api/srt/auth` and `/api/srt/stream-event` endpoints
4. **Client:** Deploy updated DirectorView.js and room view

### 10.4 Health Monitoring

**Endpoint:** `GET /api/health/mediamtx`

Optional health check to monitor MediaMTX connectivity:

```javascript
app.get('/api/health/mediamtx', async (req, res) => {
  try {
    // Check MediaMTX API health
    const response = await fetch('http://mediamtx:9997/v2/paths/list', {
      method: 'GET',
      timeout: 5000
    });

    if (!response.ok) {
      throw new Error('MediaMTX API unreachable');
    }

    res.json({
      connected: true,
      lastCheck: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      connected: false,
      error: error.message,
      lastCheck: new Date().toISOString()
    });
  }
});
```

**MediaMTX Stats API:** The endpoint `http://mediamtx:9997/v2/paths/list` returns active paths and publisher info.

---

## 11. Future Enhancements (Not In Scope)

- **SRT secret rotation** - Regenerate without recreating room
- **Multiple SRT inputs** - Support backup/secondary sources
- **SRT read URLs** - External monitoring/recording setups
- **SRT analytics** - Bitrate, dropped frames dashboard
- **Auto-failover** - Switch to WebRTC screen-share if SRT drops

---

## 12. Open Questions (Resolved)

1. **Should SRT secret be included in room creation response by default, or require explicit request?**
   - **Resolved:** Included by default (simpler UX)

2. **Should there be rate limiting on SRT auth webhook?**
   - **Resolved:** Yes, 10 requests/minute per IP

3. **Should the room feed tile be draggable/resizable by participants?**
   - **Resolved:** Fixed position for consistency

---

## Appendix A: Stream ID Parsing

MediaMTX passes the full request to the webhook via HTTP POST. The streamid is in the `query` field, not the `path` field.

**Correct Parsing:**

```javascript
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
```

---

## Appendix B: MediaMTX Webhook Payload

Full webhook request format from MediaMTX for SRT publish requests:

```json
{
  "action": "publish",
  "ip": "192.168.1.50",
  "user_agent": "",
  "id": "abc123",
  "path": "room/ABCD",
  "query": "streamid=publish:room/ABCD/a1b2c3d4e5f6...",
  "protocol": "srt",
  "mtls_user": ""
}
```

**Key Fields:**
- `path`: The base path without the streamid query parameter (`room/ABCD`)
- `query`: The full query string from the SRT streamid parameter
- `protocol`: Always `"srt"` for SRT connections
- `user_agent`: Empty for SRT (used for RTSP/HTTP sources)

---

## Appendix C: API Changes Summary

### RoomManager.createRoom() - Additions

```javascript
const room = {
  id: roomId,
  srtPublishSecret: crypto.randomBytes(16).toString('hex'), // 32-char hex
  srtStreamActive: false, // Track if SRT source is currently publishing
  srtConnectedAt: null, // Timestamp of SRT connection
  // ... existing fields ...
};
```

### /api/admin/rooms (POST) - Response Extension

```javascript
// After room creation
const externalSrtHost = process.env.EXTERNAL_SRT_HOST || req.headers.host;
const srtPublishUrl = `srt://${externalSrtHost}:8890?streamid=publish:room/${room.id}/${room.srtPublishSecret}`;

res.json({
  success: true,
  roomId: room.id,
  room: {
    id: room.id,
    // ... existing room fields ...
    srtPublishSecret: room.srtPublishSecret
  },
  srtPublishUrl,
  createdAt: room.createdAt
});
```

### New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/srt/auth` | POST | MediaMTX webhook for SRT authentication |
| `/api/srt/stream-event` | POST | MediaMTX webhook for stream start/end events |
| `/api/rooms/:roomId/srt-status` | GET | Client polling for SRT feed status |
| `/api/health/mediamtx` | GET | Optional: MediaMTX connectivity health check |
