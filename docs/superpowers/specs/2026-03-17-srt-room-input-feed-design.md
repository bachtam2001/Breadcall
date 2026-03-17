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

---

## 4. Security Architecture

### 4.1 Authentication Flow

```
1. OBS/vMix initiates SRT connection
   └─> streamid=publish:room/ABCD/a1b2c3d4e5f6...

2. MediaMTX extracts path and token
   └─> roomId = "ABCD"
   └─> secret = "a1b2c3d4e5f6..."

3. MediaMTX calls webhook
   POST https://signaling/api/srt/auth
   {
     "action": "publish",
     "path": "room/ABCD/a1b2c3d4e5f6...",
     "ip": "192.168.1.50",
     "user_agent": "OBS/29.0"
   }

4. Signaling server validates:
   - Room exists
   - Secret matches stored srtPublishSecret
   - Room not deleted
   └─> Response: {"allow": true} or {"allow": false, "reason": "..."}

5. MediaMTX accepts/rejects connection
```

### 4.2 Security Properties

| Property | Implementation |
|----------|----------------|
| Token secrecy | 32-char random hex, cryptographically secure |
| Dynamic revocation | Webhook validates on every connection |
| Audit logging | All SRT auth requests logged on signaling server |
| Room lifecycle | Secret invalidated when room deleted |
| No token reuse | Secret unique per room, rotation supported |

### 4.3 Threat Mitigation

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

### 5.2 Room Creation Response

Extend `/api/admin/rooms` POST response:

```json
{
  "success": true,
  "roomId": "ABCD",
  "room": { ... },
  "srtPublishUrl": "srt://host:8890?streamid=publish:room/ABCD/a1b2c3d4..."
}
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

    # SRT settings
    srtPublishPassphrase: ""  # Not using passphrase, using webhook

    # WebRTC settings for participant consumption
    webRTCPCUDSCTimeout: 30s

    # Run commands for stream events (optional logging)
    runOnPublish:
      cmd: curl -X POST http://signaling:3000/api/srt/stream-event \
           -H "Content-Type: application/json" \
           -d '{"room":"%path","event":"publish_start"}'
    runOnUnpublish:
      cmd: curl -X POST http://signaling:3000/api/srt/stream-event \
           -d '{"room":"%path","event":"publish_end"}'
```

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

Add WHEP subscription to room feed:

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

**UI Layout:**
```
┌─────────────────────────────────────────────┐
│           ROOM FEED (SRT)                   │
│           [Primary/Largest Tile]            │
│           [Fixed Position - Top]            │
└─────────────────────────────────────────────┘
┌─────────┬─────────┬─────────┬───────────────┐
│Participant│Participant│Participant│  ...       │
│   Grid    │   Grid    │   Grid    │            │
│  (Small)  │  (Small)  │  (Small)  │            │
└─────────┴─────────┴─────────┴───────────────┘
```

---

## 8. Error Handling

### 8.1 SRT Connection Errors

| Scenario | User Experience | System Behavior |
|----------|-----------------|-----------------|
| Invalid secret | Director sees "Rejected" toast | Webhook returns `{allow: false, reason: "invalid_secret"}` |
| Network error | OBS shows connection failed | MediaMTX logs error, webhook not called |
| Room deleted | SRT source disconnected | Webhook returns `{allow: false, reason: "room_not_found"}` |

### 8.2 Participant View Errors

| Scenario | User Experience | System Behavior |
|----------|-----------------|-----------------|
| SRT source offline | "Waiting for source" placeholder | Video tile shows static placeholder |
| MediaMTX unavailable | Video tile shows error | WHEP connection fails, retry with backoff |
| WebRTC negotiation fails | Toast error message | Retry WHEP subscription up to 3 times |

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
SRT_PORT=8890
SRT_AUTH_WEBHOOK_URL=http://localhost:3000/api/srt/auth
EXTERNAL_SRT_HOST=your-server-public-ip  # For SRT URL generation
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
3. **Server:** Deploy new `/api/srt/auth` endpoint
4. **Client:** Deploy updated DirectorView.js and room view

---

## 11. Future Enhancements (Not In Scope)

- **SRT secret rotation** - Regenerate without recreating room
- **Multiple SRT inputs** - Support backup/secondary sources
- **SRT read URLs** - External monitoring/recording setups
- **SRT analytics** - Bitrate, dropped frames dashboard
- **Auto-failover** - Switch to WebRTC screen-share if SRT drops

---

## 12. Open Questions

1. **Should SRT secret be included in room creation response by default, or require explicit request?**
   - Current design: Included by default (simpler UX)

2. **Should there be rate limiting on SRT auth webhook?**
   - Current design: Yes, implement basic rate limiting (e.g., 10 req/min per IP)

3. **Should the room feed tile be draggable/resizable by participants?**
   - Current design: Fixed position for consistency

---

## Appendix A: Stream ID Parsing

MediaMTX passes the full path to the webhook. Parse as:

```javascript
function parseSrtStreamid(streamid) {
  // Format: publish:room/ROOMID/SECRET
  const match = streamid.match(/^publish:room\/([A-Z0-9]+)\/([a-f0-9]+)$/);
  if (!match) {
    return { valid: false, reason: 'invalid_format' };
  }
  return {
    valid: true,
    roomId: match[1],
    secret: match[2]
  };
}
```

---

## Appendix B: MediaMTX Webhook Payload

Full webhook request format (from MediaMTX documentation):

```json
{
  "action": "publish",
  "ip": "192.168.1.50",
  "user_agent": "OBS/29.0",
  "id": "abc123",
  "path": "room/ABCD/a1b2c3d4e5f6...",
  "query": "streamid=publish:room/ABCD/a1b2c3d4e5f6...",
  "protocol": "srt",
  "mtls_user": ""
}
```
