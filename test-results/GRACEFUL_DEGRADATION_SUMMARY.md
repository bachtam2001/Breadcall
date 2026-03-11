# Graceful Degradation for Missing Media Devices

## Summary

Implemented comprehensive graceful degradation for environments without camera/microphone devices. This allows users to join rooms even when `getUserMedia` fails, with clear UI feedback and multiple recovery options.

## Changes Made

### 1. MediaManager.js - Test Mode & Event Dispatching

**Added:**
- Test mode support via `?testMode=true` URL parameter
- `createTestStream()` method that generates animated canvas video stream
- `devices-not-found` event dispatch when `getUserMedia` fails with `NotFoundError`
- `setTestMode(enabled)` method

**Key Code:**
```javascript
async getUserMedia(constraints = {}, allowTestMode = true) {
  // Test mode: use fake stream
  if (allowTestMode && this.testMode) {
    const stream = this.createTestStream();
    this.dispatchEvent(new CustomEvent('stream-created', { detail: { stream, testMode: true } }));
    return stream;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(mergedConstraints);
    // ... normal flow
  } catch (error) {
    if (allowTestMode && error.name === 'NotFoundError') {
      this.dispatchEvent(new CustomEvent('devices-not-found', { ... }));
    }
    throw error;
  }
}
```

### 2. UIManager.js - Media Not Found Dialog

**Added:**
- `showMediaNotFoundDialog(onRetry, onContinueWithoutMedia, onEnableTestMode)` method
- Modal with three options:
  1. **Retry** - Attempt `getUserMedia` again
  2. **Continue Without Media** - Join room in view-only mode
  3. **Enable Test Mode** - Use simulated canvas video stream

**Key Code:**
```javascript
showMediaNotFoundDialog(onRetry, onContinueWithoutMedia, onEnableTestMode) {
  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'media-not-found-modal';
  modalOverlay.className = 'modal-overlay active'; // Must use 'active' class for CSS
  // Creates modal with three buttons
}
```

### 3. app.js - Non-blocking Join & Event Handlers

**Changes:**
- `joinRoom()` now calls `getUserMedia()` without blocking - users join room even if media fails
- Added `devices-not-found` event handler that shows dialog
- Media failure is logged but doesn't prevent room join

**Key Code:**
```javascript
async joinRoom(roomId) {
  // Connect to signaling server
  // ...

  // Try to get media, but don't block joining if it fails
  this.mediaManager.getUserMedia()
    .catch((error) => {
      console.warn('[BreadCallApp] Joining without media:', error.message);
    });
}

setupMediaHandlers() {
  this.mediaManager.addEventListener('devices-not-found', (e) => {
    this.uiManager.showMediaNotFoundDialog(
      () => { /* Retry */ },
      () => { /* Continue without media */ },
      () => { /* Enable test mode */ }
    );
  });
}
```

## Testing

All functionality verified with Playwright tests:

**Test 1: Test Mode**
- Navigate to `http://localhost?testMode=true`
- Create room
- Verify video tile shows "You (Test Mode)" with animated canvas stream
- **Status: PASSED**

**Test 2: Media Dialog**
- Mock `getUserMedia` to fail with `NotFoundError`
- Create room
- Verify modal dialog appears with three buttons
- Click "Enable Test Mode"
- Verify test mode stream appears
- **Status: PASSED**

## Usage

### For Users Without Media Devices

1. Navigate to `http://localhost`
2. Create or join a room
3. When dialog appears, choose one of:
   - **Retry** - Try again (useful if permissions were denied accidentally)
   - **Continue Without Media** - Join room view-only
   - **Enable Test Mode** - Use simulated video (good for testing UI)

### For Developers/Testing

Add `?testMode=true` to URL to automatically use simulated media:
```
http://localhost?testMode=true
```

This bypasses the dialog and directly uses canvas-based fake video stream.

## Files Modified

- `client/js/MediaManager.js` - Test mode, event dispatching
- `client/js/UIManager.js` - Dialog UI
- `client/js/app.js` - Non-blocking join, event handlers

## Test Results

```
All server tests: 84 passed
Media dialog test: PASSED
Test mode stream test: PASSED
```

## Notes

- The modal requires `class="modal-overlay active"` (not `visible`) to display correctly due to CSS rules in `index.css`
- Error is caught but doesn't prevent room join - users can still see/hear others
- Test mode generates animated canvas video at 30 FPS with color gradient and bouncing circle
