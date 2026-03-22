# SRT Pull Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SRT pull mode to director dashboard, allowing directors to pull video from remote SRT sources while retaining existing push mode.

**Architecture:** Director selects push/pull mode via radio buttons. Pull mode calls new API endpoint which configures MediaMTX path via HTTP API. RoomManager stores mode and pull URL per room.

**Tech Stack:** Node.js/Express, MediaMTX HTTP API (v2/paths/add), vanilla JavaScript frontend.

---

### Task 1: Add axios dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add axios to dependencies**

```json
// In dependencies section, add:
"axios": "^1.6.0"
```

- [ ] **Step 2: Install dependency**

Run: `npm install`
Expected: axios installed successfully

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add axios dependency for MediaMTX HTTP API"
```

---

### Task 2: Create MediaMTXClient class

**Files:**
- Create: `server/src/MediaMTXClient.js`
- Test: `server/__tests__/MediaMTXClient.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// server/__tests__/MediaMTXClient.test.js
const MediaMTXClient = require('../src/MediaMTXClient');

describe('MediaMTXClient', () => {
  let client;

  beforeEach(() => {
    client = new MediaMTXClient('http://localhost:9997');
  });

  test('constructor sets baseUrl', () => {
    expect(client.baseUrl).toBe('http://localhost:9997');
  });

  test('addPath calls POST /v2/paths/add', async () => {
    // Mock axios-post
    const mockPost = jest.fn().mockResolvedValue({ data: { success: true } });
    client.api = { post: mockPost };

    await client.addPath({
      name: 'room/ABCD',
      sourceUrl: 'srt://remote:8890',
      sourceProtocol: 'automatic'
    });

    expect(mockPost).toHaveBeenCalledWith('/v2/paths/add', {
      name: 'room/ABCD',
      sourceUrl: 'srt://remote:8890',
      sourceProtocol: 'automatic'
    });
  });

  test('stopPath calls POST /v2/paths/kick', async () => {
    const mockPost = jest.fn().mockResolvedValue({ data: { success: true } });
    client.api = { post: mockPost };

    await client.stopPath('room/ABCD');

    expect(mockPost).toHaveBeenCalledWith('/v2/paths/kick', { path: 'room/ABCD' });
  });

  test('listPaths calls GET /v2/paths/list', async () => {
    const mockGet = jest.fn().mockResolvedValue({ data: { items: [] } });
    client.api = { get: mockGet };

    const result = await client.listPaths();

    expect(mockGet).toHaveBeenCalledWith('/v2/paths/list');
    expect(result).toEqual([]);
  });

  test('isAvailable returns true when API reachable', async () => {
    const mockGet = jest.fn().mockResolvedValue({ data: {} });
    client.api = { get: mockGet };

    const result = await client.isAvailable();

    expect(result).toBe(true);
  });

  test('isAvailable returns false when API unreachable', async () => {
    const mockGet = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    client.api = { get: mockGet };

    const result = await client.isAvailable();

    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MediaMTXClient`
Expected: FAIL - Cannot find module '../src/MediaMTXClient'

- [ ] **Step 3: Write MediaMTXClient implementation**

```javascript
// server/src/MediaMTXClient.js
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
    const response = await this.api.post('/v2/paths/kick', {
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- MediaMTXClient`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/MediaMTXClient.js server/__tests__/MediaMTXClient.test.js
git commit -m "feat: add MediaMTXClient for HTTP API path management"
```

---

### Task 3: Extend RoomManager with SRT mode fields

**Files:**
- Modify: `server/src/RoomManager.js:44-58`
- Test: `server/__tests__/RoomManager.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// Add to server/__tests__/RoomManager.test.js

describe('SRT mode fields', () => {
  test('createRoom includes srtMode and srtPullUrl', () => {
    const room = roomManager.createRoom();

    expect(room.srtMode).toBeNull();
    expect(room.srtPullUrl).toBeNull();
  });

  test('getRoom returns srtMode and srtPullUrl', () => {
    const room = roomManager.createRoom();
    room.srtMode = 'pull';
    room.srtPullUrl = 'srt://remote:8890';

    const retrieved = roomManager.getRoom(room.id);

    expect(retrieved.srtMode).toBe('pull');
    expect(retrieved.srtPullUrl).toBe('srt://remote:8890');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- RoomManager`
Expected: FAIL - srtMode and srtPullUrl are undefined

- [ ] **Step 3: Update RoomManager.createRoom()**

```javascript
// In server/src/RoomManager.js, update createRoom() room object:
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
  // SRT fields (existing)
  srtPublishSecret: crypto.randomBytes(16).toString('hex'),
  srtStreamActive: false,
  srtConnectedAt: null,
  // SRT fields (new)
  srtMode: null,    // 'push' | 'pull' | null
  srtPullUrl: null  // string | null
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- RoomManager`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/RoomManager.js server/__tests__/RoomManager.test.js
git commit -m "feat: add srtMode and srtPullUrl fields to room data"
```

---

### Task 4: Add SRT configure API endpoint

**Files:**
- Modify: `server/src/index.js` (add route)
- Create: `server/src/routes/srt.js` (new router)
- Test: `server/__tests__/SRTConfig.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// server/__tests__/SRTConfig.test.js
const request = require('supertest');
const express = require('express');
const RoomManager = require('../src/RoomManager');
const MediaMTXClient = require('../src/MediaMTXClient');

describe('SRT Configure Endpoint', () => {
  let app;
  let roomManager;
  let mockMediaMTX;

  beforeEach(() => {
    roomManager = new RoomManager();

    // Mock MediaMTX client
    mockMediaMTX = {
      addPath: jest.fn().mockResolvedValue({ success: true }),
      stopPath: jest.fn().mockResolvedValue({ success: true }),
      isAvailable: jest.fn().mockResolvedValue(true)
    };

    app = express();
    app.use(express.json());

    // Mount SRT routes with roomManager and mediaMTX client
    const createSrtRouter = require('../src/routes/srt');
    app.use('/api/rooms', createSrtRouter(roomManager, mockMediaMTX));
  });

  test('sets push mode', async () => {
    const room = roomManager.createRoom();

    const response = await request(app)
      .post(`/api/rooms/${room.id}/srt/configure`)
      .send({ mode: 'push' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(room.srtMode).toBe('push');
    expect(room.srtPullUrl).toBeNull();
  });

  test('sets pull mode with valid URL', async () => {
    const room = roomManager.createRoom();

    const response = await request(app)
      .post(`/api/rooms/${room.id}/srt/configure`)
      .send({ mode: 'pull', pullUrl: 'srt://remote:8890?streamid=test' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(room.srtMode).toBe('pull');
    expect(room.srtPullUrl).toBe('srt://remote:8890?streamid=test');
    expect(mockMediaMTX.addPath).toHaveBeenCalled();
  });

  test('rejects invalid pull URL format', async () => {
    const room = roomManager.createRoom();

    const response = await request(app)
      .post(`/api/rooms/${room.id}/srt/configure`)
      .send({ mode: 'pull', pullUrl: 'http://invalid' })
      .expect(400);

    expect(response.body.error).toBe('invalid_pull_url');
  });

  test('rejects invalid mode', async () => {
    const room = roomManager.createRoom();

    const response = await request(app)
      .post(`/api/rooms/${room.id}/srt/configure`)
      .send({ mode: 'invalid' })
      .expect(400);

    expect(response.body.error).toBe('invalid_mode');
  });

  test('switching modes stops current stream', async () => {
    const room = roomManager.createRoom();
    room.srtMode = 'pull';
    room.srtStreamActive = true;

    await request(app)
      .post(`/api/rooms/${room.id}/srt/configure`)
      .send({ mode: 'push' })
      .expect(200);

    expect(mockMediaMTX.stopPath).toHaveBeenCalledWith(`room/${room.id}`);
    expect(room.srtStreamActive).toBe(false);
  });

  test('room not found returns 404', async () => {
    const response = await request(app)
      .post('/api/rooms/NONEXISTENT/srt/configure')
      .send({ mode: 'push' })
      .expect(404);

    expect(response.body.error).toBe('room_not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SRTConfig`
Expected: FAIL - Cannot find module '../src/routes/srt'

- [ ] **Step 3: Create srt.js router**

```javascript
// server/src/routes/srt.js
const express = require('express');

/**
 * Create SRT configuration router
 * @param {RoomManager} roomManager - RoomManager instance
 * @param {MediaMTXClient} mediaMTXClient - MediaMTX HTTP API client
 * @returns {express.Router} Router instance
 */
function createSrtRouter(roomManager, mediaMTXClient) {
  const router = express.Router();

  /**
   * POST /api/rooms/:roomId/srt/configure
   * Set SRT mode (push or pull) and optionally the pull URL
   */
  router.post('/:roomId/srt/configure', async (req, res) => {
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
        } catch (mtxError) {
          console.error('[SRT Configure] MediaMTX error:', mtxError.message);
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

  /**
   * GET /api/rooms/:roomId/srt/config
   * Get current SRT configuration for a room
   */
  router.get('/:roomId/srt/config', async (req, res) => {
    try {
      const room = roomManager.getRoom(req.params.roomId);

      if (!room) {
        return res.status(404).json({ success: false, error: 'room_not_found' });
      }

      res.json({
        success: true,
        config: {
          srtMode: room.srtMode,
          srtPullUrl: room.srtPullUrl,
          srtPublishSecret: room.srtPublishSecret,
          srtStreamActive: room.srtStreamActive,
          srtConnectedAt: room.srtConnectedAt
        }
      });
    } catch (error) {
      console.error('[SRT Config] Error:', error.message);
      res.status(500).json({ success: false, error: 'internal_error' });
    }
  });

  return router;
}

module.exports = createSrtRouter;
```

- [ ] **Step 4: Mount router in index.js**

```javascript
// In server/src/index.js, after other requires:
const createSrtRouter = require('./routes/srt');

// ... after MediaMTX client initialization (add this):
const MediaMTXClient = require('./MediaMTXClient');
const mediaMTXClient = new MediaMTXClient(process.env.MEDIAMTX_API_URL || 'http://mediamtx:9997');

// ... mount routes (add after other app.use calls):
app.use('/api/rooms', createSrtRouter(roomManager, mediaMTXClient));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- SRTConfig`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/srt.js server/__tests__/SRTConfig.test.js server/src/index.js
git commit -m "feat: add SRT configure API endpoint"
```

---

### Task 5: Update DirectorView.js with mode selection UI

**Files:**
- Modify: `client/js/DirectorView.js`
- Test: `client/__tests__/DirectorView.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// client/__tests__/DirectorView.test.js

describe('DirectorView SRT mode selection', () => {
  test('render shows mode selection radio buttons', () => {
    const view = new DirectorView();
    view.roomId = 'ABCD';
    view.srtMode = 'push';
    view.render();

    const pushRadio = document.querySelector('input[type="radio"][value="push"]');
    const pullRadio = document.querySelector('input[type="radio"][value="pull"]');

    expect(pushRadio).toBeTruthy();
    expect(pullRadio).toBeTruthy();
    expect(pushRadio.checked).toBe(true);
    expect(pullRadio.checked).toBe(false);
  });

  test('render shows push mode UI when srtMode is push', () => {
    const view = new DirectorView();
    view.roomId = 'ABCD';
    view.srtMode = 'push';
    view.srtPublishUrl = 'srt://host:8890?streamid=publish:room/ABCD/secret';
    view.render();

    const srtUrlCode = document.getElementById('srt-url');
    expect(srtUrlCode).toBeTruthy();
    expect(srtUrlCode.textContent).toContain('srt://host:8890');
  });

  test('render shows pull mode UI when srtMode is pull', () => {
    const view = new DirectorView();
    view.roomId = 'ABCD';
    view.srtMode = 'pull';
    view.srtPullUrl = 'srt://remote:8890?streamid=test';
    view.render();

    const pullUrlInput = document.getElementById('srt-pull-url');
    const connectBtn = document.querySelector('button#connect-srt-btn');
    const disconnectBtn = document.querySelector('button#disconnect-srt-btn');

    expect(pullUrlInput).toBeTruthy();
    expect(connectBtn).toBeTruthy();
    expect(disconnectBtn).toBeTruthy();
  });

  test('setSrtMode calls configure API', async () => {
    const view = new DirectorView();
    view.roomId = 'ABCD';

    // Mock fetch
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, room: { srtMode: 'pull' } })
    });

    await view.setSrtMode('pull');

    expect(fetch).toHaveBeenCalledWith('/api/rooms/ABCD/srt/configure', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ mode: 'pull' })
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DirectorView`
Expected: FAIL - Tests for SRT mode selection fail

- [ ] **Step 3: Update DirectorView render() method**

Update the render() method to include mode selection radio buttons and conditional UI for push/pull modes as shown in the spec.

- [ ] **Step 4: Add new methods to DirectorView**

Add setSrtMode(), connectSrtPull(), disconnectSrtPull(), and fetchSrtConfig() methods.

- [ ] **Step 5: Add WebSocket event listener for srt-config-updated**

Add listener in connect() method to handle srt-config-updated events.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- DirectorView`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add client/js/DirectorView.js client/__tests__/DirectorView.test.js
git commit -m "feat: add SRT mode selection UI to director dashboard"
```

---

### Task 6: Update MediaMTX configuration

**Files:**
- Modify: `docker/mediamtx/mediamtx.yml`

- [ ] **Step 1: Read current mediamtx.yml**

- [ ] **Step 2: Add HTTP API configuration**

```yaml
# Enable HTTP API for path management
api: yes
apiAddress: :9997
```

- [ ] **Step 3: Commit**

```bash
git add docker/mediamtx/mediamtx.yml
git commit -m "config: enable MediaMTX HTTP API for path management"
```

---

### Task 7: Add environment variable

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add MediaMTX API URL**

```bash
# Add to .env.example:
MEDIAMTX_API_URL=http://mediamtx:9997
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add MEDIAMTX_API_URL to environment example"
```

---

### Task 8: Run full test suite

**Files:**
- All test files

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing tests + new SRT tests)

- [ ] **Step 2: Fix any failures**

If any tests fail, fix them before proceeding.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "test: ensure all tests pass after SRT pull mode implementation"
```

---

## Verification

After all tasks complete:

1. **Check git status:**
   ```bash
   git status
   git log --oneline -10
   ```

2. **Verify all files changed:**
   - `package.json` - axios dependency
   - `server/src/MediaMTXClient.js` - new file
   - `server/src/RoomManager.js` - srtMode/srtPullUrl fields
   - `server/src/routes/srt.js` - new file
   - `server/src/index.js` - mount SRT router
   - `client/js/DirectorView.js` - mode selection UI
   - `docker/mediamtx/mediamtx.yml` - HTTP API enabled
   - `.env.example` - MEDIAMTX_API_URL

3. **Announce completion:**
   "I'm using the finishing-a-development-branch skill to complete this work."
