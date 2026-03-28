# Room ID Format Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change room ID format from 4-character uppercase (e.g., `N9CR`) to 3-4-3 lowercase hyphenated format (e.g., `abc-defg-hij`).

**Architecture:** Update room ID generation in RoomManager.js, validation in SignalingHandler.js, and client-side validation in UIManager.js. No backward compatibility needed.

**Tech Stack:** Node.js, Express, vanilla JavaScript, Jest for testing

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server/src/RoomManager.js` | Room ID generation via `generateRoomId()` |
| `server/src/SignalingHandler.js` | Room ID validation via `isValidRoomId()` |
| `client/js/UIManager.js` | Client-side validation and input formatting |
| `server/__tests__/RoomManager.test.js` | Tests for room ID generation |
| `server/__tests__/SignalingHandler.test.js` | Tests for room ID validation |

---

## Task 1: Update Room ID Generation (RoomManager.js)

**Files:**
- Modify: `server/src/RoomManager.js:21-28`

**Current code:**
```javascript
generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

- [ ] **Step 1: Write the new generateRoomId function**

```javascript
generateRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const part1 = Array.from({ length: 3 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  const part2 = Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  const part3 = Array.from({ length: 3 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  return `${part1}-${part2}-${part3}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/RoomManager.js
git commit -m "feat: update room ID generation to 3-4-3 hyphenated format"
```

---

## Task 2: Update Room ID Validation (SignalingHandler.js)

**Files:**
- Modify: `server/src/SignalingHandler.js:25-27`

**Current code:**
```javascript
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[A-Z0-9]{4}$/.test(roomId);
}
```

- [ ] **Step 1: Update the validation regex**

```javascript
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(roomId);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/SignalingHandler.js
git commit -m "feat: update room ID validation for new format"
```

---

## Task 3: Update Client-Side Validation (UIManager.js)

**Files:**
- Modify: `client/js/UIManager.js` (validation in bindLandingEvents)

- [ ] **Step 1: Update room ID validation in join form**

Find the validation code in `bindLandingEvents()` and update:

```javascript
// Old validation:
if (roomId.length === 4) {

// New validation:
const roomIdPattern = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
if (roomIdPattern.test(roomId)) {
```

- [ ] **Step 2: Update error message**

```javascript
// Old:
this.showToast('Please enter a valid 4-character room ID', 'error');

// New:
this.showToast('Please enter a valid room ID (e.g., abc-defg-hij)', 'error');
```

- [ ] **Step 3: Update input placeholder and maxlength**

Find the room ID input in `renderLanding()` and update:

```javascript
// Old:
<input type="text" id="join-room-id" placeholder="4-letter code" maxlength="4"
       style="text-transform: uppercase; letter-spacing: 4px; text-align: center;"
       value="${roomIdFromUrl || ''}">

// New:
<input type="text" id="join-room-id" placeholder="abc-defg-hij" maxlength="12"
       style="text-align: center;"
       value="${roomIdFromUrl || ''}">
```

- [ ] **Step 4: Remove auto-uppercase transformation**

Remove or update this line:
```javascript
// Remove this:
roomIdInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
```

- [ ] **Step 5: Commit**

```bash
git add client/js/UIManager.js
git commit -m "feat: update client room ID validation for new format"
```

---

## Task 4: Update Tests

**Files:**
- Modify: `server/__tests__/RoomManager.test.js`
- Modify: `server/__tests__/SignalingHandler.test.js`

- [ ] **Step 1: Update RoomManager tests**

Find tests that check room ID format and update expectations:

```javascript
// Old expectation:
expect(room.id).toMatch(/^[A-Z0-9]{4}$/);

// New expectation:
expect(room.id).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
```

- [ ] **Step 2: Update SignalingHandler tests**

Update test cases for valid/invalid room IDs:

```javascript
// Valid room IDs:
const validRoomIds = ['abc-defg-hij', 'sun-blue-tree', 'xyz-abcd-efg'];

// Invalid room IDs:
const invalidRoomIds = ['ABCD', 'abcd', 'abc-123-def', 'abc-def-ghij', 'abc-defg-hijk'];
```

- [ ] **Step 3: Run tests**

```bash
npm test -- RoomManager
npm test -- SignalingHandler
```

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/
git commit -m "test: update room ID tests for new format"
```

---

## Task 5: Verification

- [ ] **Step 1: Start development server**

```bash
docker compose -f docker-compose.dev.yml up -d
```

- [ ] **Step 2: Create a room via admin panel**

1. Go to `/admin`
2. Create a new room
3. Verify room ID format is `xxx-xxxx-xxx`

- [ ] **Step 3: Join room via landing page**

1. Go to `/`
2. Enter room ID in new format
3. Verify validation accepts the format

- [ ] **Step 4: Run all tests**

```bash
npm test
```

- [ ] **Step 5: Commit if all tests pass**

```bash
git commit -m "chore: verify room ID format change"
```

---

## Summary

After completing these tasks:
- Room IDs will be generated in `xxx-xxxx-xxx` format
- Server will validate new format only
- Client will validate and display new format
- All tests will pass with new format
