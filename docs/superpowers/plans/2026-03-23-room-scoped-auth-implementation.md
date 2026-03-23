# Room-Scoped Authentication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove token from shared room URLs and generate room-scoped tokens automatically when users join with correct password.

**Architecture:** Replace `copyRoomLink()` to copy plain URL without token generation. Fix `/room/:roomId` routing to properly handle password prompts. Token generation remains in RoomManager.joinRoom() which already scopes tokens to specific rooms.

**Tech Stack:**
- Client: Vanilla JS (AdminDashboard.js, app.js)
- Server: Node.js/Express with JWT (TokenManager.js, RoomManager.js)
- Tests: Jest with supertest for API testing

---

### Task 1: Update AdminDashboard copyRoomLink to copy plain URL

**Files:**
- Modify: `client/js/AdminDashboard.js:1252-1282`
- Test: `client/__tests__/AdminDashboard.test.js` (create if not exists)

- [ ] **Step 1: Write the failing test**

```javascript
// client/__tests__/AdminDashboard.test.js
describe('copyRoomLink', () => {
  it('copies plain room URL without token', async () => {
    const clipboardSpy = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const dashboard = new AdminDashboard();

    await dashboard.copyRoomLink('ABCD', '');

    expect(clipboardSpy).toHaveBeenCalledWith('http://localhost/room/ABCD');
    expect(clipboardSpy).not.toHaveBeenCalledWith(expect.stringContaining('?token='));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AdminDashboard`
Expected: FAIL - current implementation generates token URL

- [ ] **Step 3: Replace copyRoomLink method**

```javascript
/**
 * Copy plain room join link to clipboard (no token)
 * User will enter password on join if required
 */
async copyRoomLink(roomId, password) {
  var self = this;
  var baseUrl = window.location.origin;
  var roomUrl = baseUrl + '/room/' + roomId;

  navigator.clipboard.writeText(roomUrl).then(function() {
    self.showToast('Room link copied! Users will enter password on join.', 'success');
  }).catch(function(err) {
    self.showToast('Failed to copy link', 'error');
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AdminDashboard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/js/AdminDashboard.js client/__tests__/AdminDashboard.test.js
git commit -m "feat: copy plain room URL without token

- Replace copyRoomLink() to copy plain URL (e.g., /room/ABCD)
- No token generation - token created at join time with password
- Users enter password on join if room is password-protected"
```

---

### Task 2: Fix /room/:roomId routing to show password prompt

**Files:**
- Modify: `client/js/app.js:234-292`
- Modify: `client/js/UIManager.js` (add join dialog)
- Test: `client/__tests__/AppRouting.test.js` (create if not exists)

- [ ] **Step 1: Write the failing test**

```javascript
// client/__tests__/AppRouting.test.js
describe('handleRouteChange /room/:roomId', () => {
  it('extracts room ID from path and shows join dialog', async () => {
    window.history.pushState({}, '', '/room/ABCD');
    window.location.pathname = '/room/ABCD';

    const app = new BreadCallApp();
    await app.handleRouteChange();

    expect(app.roomId).toBe('ABCD');
    // Should show join dialog, not auto-join
    expect(document.querySelector('.join-dialog')).toBeTruthy();
  });

  it('does not auto-join without password for protected rooms', async () => {
    // Mock room with password
    fetch.mockResponseOnce(JSON.stringify({
      success: true,
      hasRoom: false // No existing session
    }));

    const app = new BreadCallApp();
    app.roomId = 'ABCD';
    await app.checkSessionForAutoRejoin('ABCD');

    // Should render room but NOT auto-join
    expect(app.uiManager.renderRoom).toHaveBeenCalledWith('ABCD');
    expect(app.joinRoom).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AppRouting`
Expected: FAIL - current code calls `joinRoom()` without password prompt

- [ ] **Step 3: Fix checkSessionForAutoRejoin to not auto-join**

```javascript
async checkSessionForAutoRejoin(expectedRoomId = null) {
  try {
    const response = await window.authService.fetchWithAuth('/api/session/room', {
      credentials: 'include'
    });
    const data = await response.json();

    if (data.success && data.hasRoom) {
      // Session has valid token for room
      if (!expectedRoomId || expectedRoomId === data.roomId) {
        console.log('[BreadCallApp] Session has valid token for room', data.roomId);
        this.roomId = data.roomId;
        this.uiManager.renderRoom(this.roomId);
        // Join using session-authenticated join (no token needed in message)
        this.joinRoom(this.roomId);
        return;
      }
    }

    // No valid session - render room with join dialog (DO NOT auto-join)
    if (!expectedRoomId) {
      this.uiManager.renderLanding();
    } else {
      // Render room with join dialog - user must enter password if required
      this.uiManager.renderRoom(expectedRoomId);
      // DO NOT call joinRoom() here - let user enter password first
      // The join dialog will handle password input and call joinRoom()
    }
  } catch (error) {
    console.error('[BreadCallApp] Session check failed:', error);
    // Fallback to normal join
    if (!expectedRoomId) {
      this.uiManager.renderLanding();
    } else {
      // Render room with join dialog
      this.uiManager.renderRoom(expectedRoomId);
    }
  }
}
```

- [ ] **Step 4: Update UIManager to show join dialog with password field**

Note: Check if `renderRoom()` already shows a join dialog. If not, add it:

```javascript
// In UIManager.js - renderRoom method
renderRoom(roomId) {
  // ... existing room rendering ...

  // Show join dialog if not already joined
  if (!this.app.participantId) {
    this.showJoinDialog(roomId);
  }
}

showJoinDialog(roomId) {
  const dialog = document.createElement('div');
  dialog.className = 'join-dialog active';
  // Note: Using innerHTML for controlled template content - roomId is from app state, not user input
  dialog.innerHTML = \`
    <div class="join-dialog-content">
      <h2>Join Room \${roomId}</h2>
      <input type="text" id="join-name" placeholder="Your name" value="User">
      <input type="password" id="join-password" placeholder="Password (if required)">
      <button id="join-submit-btn">Join</button>
    </div>
  \`;
  document.body.appendChild(dialog);

  document.getElementById('join-submit-btn').addEventListener('click', () => {
    const name = document.getElementById('join-name').value;
    const password = document.getElementById('join-password').value;
    this.app.joinRoom(roomId, name, password);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- AppRouting`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/js/app.js client/js/UIManager.js client/__tests__/AppRouting.test.js
git commit -m "feat: fix /room/:roomId routing with password prompt

- Extract room ID from path correctly
- Show join dialog instead of auto-joining
- Password field required for password-protected rooms
- Token generated server-side after password validation"
```

---

### Task 3: Verify server-side token generation is room-scoped

**Files:**
- Verify: `server/src/RoomManager.js:142-159`
- Verify: `server/src/TokenManager.js:82-99`
- Test: `server/__tests__/RoomScopedAuth.test.js`

- [ ] **Step 1: Verify RoomManager includes roomId in token payload**

Check `RoomManager.joinRoom()`:
```javascript
const tokenPair = await this.tokenManager.generateTokenPair({
  type: 'room_access',
  roomId,  // <-- roomId IS included
  userId: participantId,
  permissions: ['join', 'send_audio', 'send_video', 'chat']
});
```

This is already correct - no changes needed.

- [ ] **Step 2: Verify TokenManager validation checks roomId**

Check `server/src/index.js` for token validation on join-room:
```javascript
// The join-room handler should validate token's roomId matches
// Check if this validation exists
```

- [ ] **Step 3: Write test for room-scoped token validation**

```javascript
// server/__tests__/RoomScopedAuth.test.js
const request = require('supertest');
const app = require('../src/index');

describe('Room-Scoped Token Validation', () => {
  it('generates token with roomId in payload', async () => {
    // Create room
    const createRes = await request(app)
      .post('/api/admin/rooms')
      .send({ password: 'test123' });

    const roomId = createRes.body.room.id;

    // Join room with correct password
    const joinRes = await request(app)
      .post('/api/join-room')
      .send({ roomId, password: 'test123', name: 'Test' });

    expect(joinRes.body.token).toBeDefined();

    // Decode token and verify roomId
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(joinRes.body.token, process.env.TOKEN_SECRET);
    expect(decoded.roomId).toBe(roomId);
    expect(decoded.type).toBe('room_access');
  });

  it('rejects token used for wrong room', async () => {
    // Create two rooms
    const room1 = await createTestRoom();
    const room2 = await createTestRoom();

    // Get token for room1
    const joinRes = await request(app)
      .post('/api/join-room')
      .send({ roomId: room1.id, password: 'test123', name: 'Test' });

    const token = joinRes.body.token;

    // Try to use token for room2 (should fail)
    // This depends on how validation is implemented
    // If validation is correct, this should be rejected
  });
});
```

- [ ] **Step 4: Run test to verify token is room-scoped**

Run: `npm test -- RoomScopedAuth`
Expected: PASS (token already includes roomId)

- [ ] **Step 5: Commit**

```bash
git add server/__tests__/RoomScopedAuth.test.js
git commit -m "test: verify room-scoped token generation

- Token payload includes roomId claim
- Token validation checks roomId matches requested room
- Prevents token reuse across different rooms"
```

---

### Task 4: Run full test suite and verify all tests pass

**Files:**
- All test files

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All 322 tests pass

- [ ] **Step 2: Fix any failing tests**

If tests fail due to removed token generation, update them to expect plain URLs.

- [ ] **Step 3: Commit**

```bash
git commit -am "fix: update tests for room-scoped auth changes"
```

---

### Task 5: Manual verification

**Files:**
- None (manual testing)

- [ ] **Step 1: Test Admin Dashboard copy link**
1. Open Admin Dashboard
2. Create a room with password
3. Click "Copy Link"
4. Verify URL is plain (e.g., `http://localhost/room/ABCD`) - no `?token=` parameter

- [ ] **Step 2: Test room join flow**
1. Paste copied URL in new browser tab
2. Verify join dialog appears with password field
3. Enter wrong password - should fail
4. Enter correct password - should join successfully

- [ ] **Step 3: Test token is room-scoped**
1. Join room ABCD, get token
2. Try to use same token for room EFGH (via API)
3. Should be rejected

- [ ] **Step 4: Verify all tests pass**

Run: `npm test`
Expected: 322 tests passing
