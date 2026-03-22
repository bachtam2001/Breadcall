# SRT Pull Mode - Design Specification

**Date:** 2026-03-22
**Status:** Draft
**Author:** Claude (with user collaboration)

---

## 1. Overview

### 1.1 Purpose

Extend the existing SRT Input feature to support **Pull Mode** - allowing directors to pull video from remote SRT sources - while retaining the existing **Push Mode** where external sources push to the room. Directors select one mode at a time.

### 1.2 Problem Statement

Directors need flexibility in how they bring external SRT video into rooms:
- **Push Mode** (existing): External sources (OBS, vMix) push SRT video to the room
- **Pull Mode** (new): Director specifies an SRT URL to pull from (e.g., remote encoder, another MediaMTX server)

Current implementation only supports Push Mode, limiting scenarios where the BreadCall system needs to initiate the connection.

### 1.3 Goals

- **Add Pull Mode** alongside existing Push Mode
- **Mode selection UI** in director dashboard (radio toggle)
- **Mutually exclusive** - only one mode active at a time
- **Dynamic configuration** via MediaMTX HTTP API
- **Switching modes** disconnects current stream immediately
- **Maintain existing Push Mode** functionality unchanged

### 1.4 Non-Goals

- Simultaneous push and pull (only one mode at a time)
- Multiple SRT inputs per room
- SRT read URLs for external players
- Director UI controls for SRT feed (mute/hide/toggle)
- Secret rotation for pull mode

---

## 2. Architecture

### 2.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Director Dashboard                                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  SRT Input Mode                                              │   │
│  │  ● Push Mode (external sources push to this room)           │   │
│  │  ○ Pull Mode (pull from external SRT source)                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Push Mode Display:                                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  srt://host:8890?streamid=publish:room/ABCD/secret          │   │
│  │  [Copy]                                                      │   │
│  │  Status: ○ Waiting for source / ● Active                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Pull Mode Display:                                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  SRT URL to pull:                                            │   │
│  │  [srt://remote-server:8890?streamid=read:mystream       ]   │   │
│  │  [Connect] [Disconnect]                                      │   │
│  │  Status: ● Connected / ○ Disconnected                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ POST /api/rooms/:roomId/srt/configure
         │ { mode: 'pull', pullUrl: 'srt://...' }
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Signaling Server                                  │
│                                                                      │
│  Room Data Extension:                                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  srtMode: 'push' | 'pull' | null                            │   │
│  │  srtPullUrl: string | null                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  New Endpoint: POST /api/rooms/:roomId/srt/configure                │
│  - Validates room exists                                            │
│  │- Validates director has permission                               │
│  │- Updates room.srtMode and room.srtPullUrl                       │
│  │- If pull mode: calls MediaMTX API to configure path             │
│  │- If switching: stops current stream first                        │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ POST /v2/paths/add (MediaMTX HTTP API)
         │ { name: 'room/ABCD', sourceUrl: 'srt://...' }
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MediaMTX SFU                                      │
│                                                                      │
│  Push Mode (existing):                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  External OBS/vMix ──SRT push──> srt://host:8890           │   │
│  │  Auth webhook validates secret                              │   │
│  │  Path: room/{roomId}                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Pull Mode (new):                                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  MediaMTX ──SRT pull──> srt://remote-server:port           │   │
│  │  Configured via HTTP API:                                   │   │
│  │  POST /v2/paths/add                                         │   │
│  │  { name: 'room/ABCD', sourceUrl: 'srt://...' }             │   │
│  │  Path: room/{roomId}                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Components

| Component | Responsibility |
|-----------|----------------|
| `RoomManager.js` | Store `srtMode` and `srtPullUrl` per room |
| `server/src/routes/rooms.js` | New `POST /api/rooms/:roomId/srt/configure` endpoint |
| `server/src/MediaMTXClient.js` | New client wrapper for MediaMTX HTTP API calls |
| `DirectorView.js` | Mode selection UI, pull URL input, connect/disconnect controls |
| `mediamtx.yml` | Enable HTTP API (`api: yes`) |

---

## 3. Data Model

### 3.1 Room Schema Extension

Add to `RoomManager.createRoom()` and room data structure:

```javascript
const room = {
  id: roomId,
  // ... existing fields ...

  // SRT fields (existing)
  srtPublishSecret: crypto.randomBytes(16).toString('hex'),
  srtStreamActive: false,
  srtConnectedAt: null,

  // SRT fields (new)
  srtMode: null,        // 'push' | 'pull' | null - selected mode
  srtPullUrl: null      // string | null - SRT URL for pull mode
};
```

### 3.2 SRT URL Formats

**Push Mode URL (existing):**
```
srt://{host}:{port}?streamid=publish:room/{roomId}/{srtPublishSecret}
```

**Pull Mode URL (user-provided):**
```
srt://{remote-host}:{port}?mode=caller&streamid={stream-id}
```

### 3.3 MediaMTX Path Configuration

When pull mode is activated, the signaling server calls:

```bash
POST http://mediamtx:9997/v2/paths/add
Content-Type: application/json

{
  "name": "room/{roomId}",
  "sourceUrl": "srt://remote-server:8890?mode=caller&streamid=mystream",
  "sourceProtocol": "automatic",
  "sourceOnDemand": false
}
```

---

## 4. API Design

### 4.1 Configure SRT Mode

**Endpoint:** `POST /api/rooms/:roomId/srt/configure`

**Purpose:** Set SRT mode (push or pull) and optionally the pull URL.

**Request:**
```json
{
  "mode": "push" | "pull",
  "pullUrl": "srt://remote-server:8890?streamid=..."  // Required if mode is 'pull'
}
```

**Response - Success:**
```json
{
  "success": true,
  "room": {
    "id": "ABCD",
    "srtMode": "pull",
    "srtPullUrl": "srt://remote-server:8890?streamid=mystream",
    "srtStreamActive": false
  }
}
```

**Response - Error:**
```json
{
  "success": false,
  "error": "invalid_mode" | "invalid_pull_url" | "room_not_found" | "mediamtx_unavailable"
}
```

**Handler Implementation:**

```javascript
app.post('/api/rooms/:roomId/srt/configure', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { mode, pullUrl } = req.body;

    // Validate mode
    if (!['push', 'pull'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'invalid_mode' });
    }

    // Validate pullUrl if mode is 'pull'
    if (mode === 'pull' && !pullUrl) {
      return res.status(400).json({
        success: false,
        error: 'pull_url_required'
      });
    }

    // Validate pullUrl format
    if (mode === 'pull' && !pullUrl.startsWith('srt://')) {
      return res.status(400).json({
        success: false,
        error: 'invalid_pull_url'
      });
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: 'room_not_found' });
    }

    // Check if mode is actually changing
    const modeChanged = room.srtMode !== mode;

    // If switching modes, stop current stream first
    if (modeChanged && room.srtStreamActive) {
      await mediaMTXClient.stopPath(`room/${roomId}`);
      room.srtStreamActive = false;
      room.srtConnectedAt = null;
    }

    // Update room data
    room.srtMode = mode;
    room.srtPullUrl = mode === 'pull' ? pullUrl : null;

    // If pull mode, configure MediaMTX path
    if (mode === 'pull' && pullUrl) {
      try {
        await mediaMTXClient.addPath({
          name: `room/${roomId}`,
          sourceUrl: pullUrl,
          sourceProtocol: 'automatic',
          sourceOnDemand: false
        });
      } catch (mtxC error) {
        console.error('[SRT Configure] MediaMTX error:', mtxC error.message);
        return res.status(503).json({
          success: false,
          error: 'mediamtx_unavailable'
        });
      }
    }

    // Notify directors
    roomManager.notifyDirectors(roomId, {
      type: 'srt-config-updated',
      mode: room.srtMode,
      pullUrl: room.srtPullUrl,
      active: room.srtStreamActive
    });

    res.json({
      success: true,
      room: {
        id: room.id,
        srtMode: room.srtMode,
        srtPullUrl: room.srtPullUrl,
        srtStreamActive: room.srtStreamActive
      }
    });

  } catch (error) {
    console.error('[SRT Configure] Error:', error.message);
    res.status(500).json({ success: false, error: 'internal_error' });
  }
});
```

### 4.2 Get Room SRT Config

**Endpoint:** `GET /api/rooms/:roomId/srt/config`

**Purpose:** Fetch current SRT configuration for a room.

**Response:**
```json
{
  "success": true,
  "config": {
    "srtMode": "push",
    "srtPullUrl": null,
    "srtPublishSecret": "a1b2c3d4...",
    "srtStreamActive": false,
    "srtConnectedAt": null
  }
}
```

---

## 5. MediaMTX Client

### 5.1 New Client Class

Create `server/src/MediaMTXClient.js`:

```javascript
const axios = require('axios');

class MediaMTXClient {
  constructor(baseUrl = 'http://mediamtx:9997') {
    this.baseUrl = baseUrl;
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 5000
    });
  }

  /**
   * Add or update a path configuration
   * @param {Object} config - Path configuration
   * @param {string} config.name - Path name (e.g., 'room/ABCD')
   * @param {string} config.sourceUrl - Source URL for pull mode
   * @param {string} [config.sourceProtocol='automatic'] - Protocol
   * @param {boolean} [config.sourceOnDemand=false] - Start on demand
   */
  async addPath(config) {
    const response = await this.api.post('/v2/paths/add', config);
    return response.data;
  }

  /**
   * Stop a path (disconnect stream)
   * @param {string} pathName - Path name to stop
   */
  async stopPath(pathName) {
    const response = await this.api.post(`/v2/paths/kick`, {
      path: pathName
    });
    return response.data;
  }

  /**
   * Get path status
   * @param {string} pathName - Path name
   * @returns {Object} Path status including whether stream is active
   */
  async getPathStatus(pathName) {
    const response = await this.api.get(`/v2/paths/get/${pathName}`);
    return response.data;
  }

  /**
   * List all paths
   * @returns {Array} List of path names
   */
  async listPaths() {
    const response = await this.api.get('/v2/paths/list');
    return response.data.items || [];
  }

  /**
   * Check if MediaMTX API is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await this.api.get('/v2/paths/list');
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = MediaMTXClient;
```

### 5.2 MediaMTX Configuration

Add to `docker/mediamtx/mediamtx.yml`:

```yaml
# Enable HTTP API for path management
api: yes
apiAddress: :9997

# Allow path configuration via API
pathDefaults:
  # Allow sourceUrl configuration
  sourceOnDemand: false

paths:
  room/*:
    # SRT publish authentication via webhook
    runOnPublish:
      cmd: curl -X POST http://signaling:3000/api/mediamtx/stream-event \
           -H "Content-Type: application/json" \
           -d '{"path":"%path","event":"publish_start"}'
    runOnUnpublish:
      cmd: curl -X POST http://signaling:3000/api/mediamtx/stream-event \
           -d '{"path":"%path","event":"publish_end"}'
```

---

## 6. Client Implementation

### 6.1 DirectorView.js Changes

**Mode Selection UI:**

```javascript
// In render() method, update SRT Input Section
<div class="srt-input-section glass-panel" style="padding: 16px; margin-bottom: 24px;">
  <h2 style="margin: 0 0 12px 0; font-size: 18px;">SRT Input Feed</h2>
  <p style="color: var(--color-text-secondary); margin-bottom: 12px;">
    Select how external video enters this room
  </p>

  <!-- Mode Selection -->
  <div style="margin-bottom: 16px;">
    <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer;">
      <input type="radio" name="srt-mode" value="push"
             ${this.srtMode === 'push' ? 'checked' : ''}
             onchange="window.directorView.setSrtMode('push')" />
      <span>Push Mode - External sources push to this room</span>
    </label>
    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
      <input type="radio" name="srt-mode" value="pull"
             ${this.srtMode === 'pull' ? 'checked' : ''}
             onchange="window.directorView.setSrtMode('pull')" />
      <span>Pull Mode - Pull from external SRT source</span>
    </label>
  </div>

  <!-- Push Mode Display -->
  ${this.srtMode === 'push' ? `
    <div style="display: flex; gap: 8px; align-items: center;">
      <code id="srt-url" style="flex: 1; background: var(--color-bg-secondary); padding: 8px; border-radius: 4px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${this.srtPublishUrl || 'Generating...'}
      </code>
      <button class="btn btn-secondary" onclick="window.directorView.copySrtUrl()">
        Copy
      </button>
    </div>
    <div id="srt-status" style="margin-top: 8px; font-size: 12px;">
      ${this.srtStreamActive ? '<span style="color: var(--color-success);">● Active</span>' : '<span style="color: var(--color-text-tertiary);">○ Waiting for source</span>'}
    </div>
  ` : ''}

  <!-- Pull Mode Display -->
  ${this.srtMode === 'pull' ? `
    <div style="display: flex; gap: 8px; margin-bottom: 8px;">
      <input type="text" id="srt-pull-url"
             value="${this.srtPullUrl || ''}"
             placeholder="srt://remote-server:8890?streamid=..."
             style="flex: 1; background: var(--color-bg-secondary); border: 1px solid var(--color-border); padding: 8px; border-radius: 4px; font-family: monospace;" />
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn btn-primary" onclick="window.directorView.connectSrtPull()"
              ${this.srtStreamActive ? 'disabled' : ''}>
        Connect
      </button>
      <button class="btn btn-danger" onclick="window.directorView.disconnectSrtPull()"
              ${!this.srtStreamActive ? 'disabled' : ''}>
        Disconnect
      </button>
    </div>
    <div id="srt-status" style="margin-top: 8px; font-size: 12px;">
      ${this.srtStreamActive ? '<span style="color: var(--color-success);">● Connected</span>' : '<span style="color: var(--color-text-tertiary);">○ Disconnected</span>'}
    </div>
  ` : ''}
</div>
```

**New Methods:**

```javascript
/**
 * Set SRT mode (push or pull)
 */
async setSrtMode(mode) {
  try {
    const response = await fetch(`/api/rooms/${this.roomId}/srt/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        pullUrl: mode === 'pull' ? this.srtPullUrl : null
      })
    });

    const result = await response.json();
    if (result.success) {
      this.srtMode = mode;
      this.srtStreamActive = false; // Mode change resets stream state
      this.render();
      this.showToast(`SRT mode changed to ${mode}`, 'success');
    } else {
      this.showToast(`Failed to change mode: ${result.error}`, 'error');
    }
  } catch (error) {
    this.showToast('Failed to change SRT mode', 'error');
  }
}

/**
 * Connect SRT pull stream
 */
async connectSrtPull() {
  const urlInput = document.getElementById('srt-pull-url');
  const pullUrl = urlInput?.value?.trim();

  if (!pullUrl) {
    this.showToast('Please enter an SRT URL', 'error');
    return;
  }

  if (!pullUrl.startsWith('srt://')) {
    this.showToast('SRT URL must start with srt://', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/rooms/${this.roomId}/srt/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'pull', pullUrl })
    });

    const result = await response.json();
    if (result.success) {
      this.srtPullUrl = pullUrl;
      this.srtStreamActive = true;
      this.render();
      this.showToast('SRT pull connected', 'success');
    } else {
      this.showToast(`Failed to connect: ${result.error}`, 'error');
    }
  } catch (error) {
    this.showToast('Failed to connect SRT pull', 'error');
  }
}

/**
 * Disconnect SRT pull stream
 */
async disconnectSrtPull() {
  try {
    // Switch to pull mode without URL - this stops the stream
    const response = await fetch(`/api/rooms/${this.roomId}/srt/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'pull', pullUrl: null })
    });

    const result = await response.json();
    if (result.success) {
      this.srtStreamActive = false;
      this.render();
      this.showToast('SRT pull disconnected', 'success');
    } else {
      this.showToast(`Failed to disconnect: ${result.error}`, 'error');
    }
  } catch (error) {
    this.showToast('Failed to disconnect SRT pull', 'error');
  }
}
```

### 6.2 WebSocket Event Handling

Add handler for `srt-config-updated` event:

```javascript
// In connect() method, add new event listener
this.signaling.addEventListener('srt-config-updated', (e) => {
  const { mode, pullUrl, active } = e.detail;
  console.log('[Director] SRT config updated:', { mode, pullUrl, active });

  this.srtMode = mode;
  this.srtPullUrl = pullUrl;
  this.srtStreamActive = active;
  this.render();
});
```

---

## 7. Error Handling

### 7.1 Configuration Errors

| Scenario | User Experience | System Behavior |
|----------|-----------------|-----------------|
| Invalid mode | Toast error | API returns 400 `invalid_mode` |
| Missing pull URL | Toast error | API returns 400 `pull_url_required` |
| Invalid URL format | Toast error | API returns 400 `invalid_pull_url` |
| MediaMTX unavailable | Toast error | API returns 503 `mediamtx_unavailable` |
| Room not found | Toast error | API returns 404 `room_not_found` |

### 7.2 Stream Errors

| Scenario | User Experience | System Behavior |
|----------|-----------------|-----------------|
| Pull source unreachable | Status shows disconnected | MediaMTX fails to connect, stream stays inactive |
| Pull source disconnects | Status updates to disconnected | `srt-feed-updated` event with `active: false` |
| Mode switch during active stream | Brief interruption | Current stream stopped, new mode applied |

### 7.3 Edge Cases

| Scenario | Behavior | Notes |
|----------|----------|-------|
| Director switches mode mid-stream | Current stream stops, new mode applies | `srtStreamActive` resets to false |
| MediaMTX API unreachable | Configuration fails with error | Room data not updated |
| Invalid SRT URL provided | Connection fails, status remains disconnected | User can retry with corrected URL |
| Multiple directors switch mode rapidly | Last request wins | No locking/queueing |

---

## 8. Testing

### 8.1 Unit Tests

**File:** `server/__tests__/SRTConfig.test.js`

```javascript
describe('SRT Configure Endpoint', () => {
  test('sets push mode', async () => {
    // Create room
    // POST /api/rooms/:roomId/srt/configure with mode: 'push'
    // Verify room.srtMode === 'push'
  });

  test('sets pull mode with valid URL', async () => {
    // Create room
    // POST /api/rooms/:roomId/srt/configure with mode: 'pull', pullUrl: 'srt://...'
    // Verify room.srtMode === 'pull' and room.srtPullUrl set
  });

  test('rejects invalid pull URL format', async () => {
    // POST with invalid URL (not starting with srt://)
    // Expect 400 with error: 'invalid_pull_url'
  });

  test('switching modes stops current stream', async () => {
    // Set pull mode, simulate active stream
    // Switch to push mode
    // Verify MediaMTX stopPath called, srtStreamActive reset
  });
});
```

### 8.2 Integration Tests

**File:** `server/__tests__/SRTConfigIntegration.test.js`

```javascript
describe('SRT Pull Integration', () => {
  test('end-to-end pull configuration', async () => {
    // 1. Create room
    // 2. Configure pull mode via API
    // 3. Verify MediaMTX path created with sourceUrl
    // 4. Verify room data updated
  });

  test('MediaMTX client path management', async () => {
    // Test MediaMTXClient.addPath()
    // Test MediaMTXClient.stopPath()
    // Verify HTTP API calls made correctly
  });
});
```

---

## 9. Deployment

### 9.1 Environment Variables

Add to `.env`:

```bash
# MediaMTX HTTP API
MEDIAMTX_API_URL=http://mediamtx:9997
```

### 9.2 Docker Compose

Ensure MediaMTX HTTP API is exposed (already configured):

```yaml
mediamtx:
  ports:
    - "8890:8890/udp"  # SRT
    - "9997:9997"      # HTTP API
  environment:
    - MTX_API=yes
    - MTX_API_ADDRESS=:9997
```

### 9.3 Migration Steps

1. **Database:** No migration needed (in-memory room extension)
2. **MediaMTX:** Ensure HTTP API enabled (`api: yes`)
3. **Server:** Deploy new `MediaMTXClient.js` and `/api/rooms/:roomId/srt/configure` endpoint
4. **Client:** Deploy updated `DirectorView.js` with mode selection UI

---

## 10. Open Questions (Resolved)

1. **Should both push and pull modes be available simultaneously?**
   - **Resolved:** No - mutually exclusive, director selects one mode at a time

2. **What happens when switching modes during an active stream?**
   - **Resolved:** Current stream stops immediately, new mode applies

3. **Should pull URL be validated for format?**
   - **Resolved:** Yes - basic validation (must start with `srt://`)

4. **Should MediaMTX path be created on room creation or on-demand?**
   - **Resolved:** On-demand - path configured only when pull mode activated

---

## Appendix A: API Changes Summary

### RoomManager.createRoom() - Additions

```javascript
const room = {
  // ... existing fields ...

  // SRT fields (existing)
  srtPublishSecret: crypto.randomBytes(16).toString('hex'),
  srtStreamActive: false,
  srtConnectedAt: null,

  // SRT fields (new)
  srtMode: null,    // 'push' | 'pull' | null
  srtPullUrl: null  // string | null
};
```

### New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rooms/:roomId/srt/configure` | POST | Set SRT mode and pull URL |
| `/api/rooms/:roomId/srt/config` | GET | Get current SRT configuration |

### New Files

| File | Purpose |
|------|---------|
| `server/src/MediaMTXClient.js` | HTTP API client for MediaMTX path management |

---

## Appendix B: MediaMTX HTTP API Reference

### POST /v2/paths/add

Add a new path configuration.

**Request:**
```json
{
  "name": "room/ABCD",
  "sourceUrl": "srt://remote-server:8890?mode=caller&streamid=mystream",
  "sourceProtocol": "automatic",
  "sourceOnDemand": false
}
```

**Response:**
```json
{
  "success": true
}
```

### POST /v2/paths/kick

Stop an active path/stream.

**Request:**
```json
{
  "path": "room/ABCD"
}
```

**Response:**
```json
{
  "success": true
}
```

### GET /v2/paths/list

List all configured paths.

**Response:**
```json
{
  "items": [
    { "name": "room/ABCD", ... },
    { "name": "room/EFGH", ... }
  ]
}
```

---

## Appendix C: SRT URL Format Examples

**Pull Mode URLs:**

```
# Basic SRT pull
srt://192.168.1.100:8890?streamid=read:mystream

# SRT with caller mode
srt://remote-server.com:8890?mode=caller&streamid=live/feed1

# SRT with latency configuration
srt://encoder.example.com:8890?mode=caller&streamid=main&latency=1000
```

**Push Mode URL (existing, auto-generated):**

```
srt://your-server.com:8890?streamid=publish:room/ABCD/a1b2c3d4e5f6...
```
