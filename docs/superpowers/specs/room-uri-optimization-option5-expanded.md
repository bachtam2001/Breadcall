# Option 5 Expanded: Token-Based Access System

**Date:** 2026-03-14
**Scope:** Comprehensive token system for room access, actions, and admin operations

---

## Overview

This expanded design extends Option 5 beyond simple room validation into a **unified token system** that optimizes multiple actions across the BreadCall platform:

| Action | Current Flow | Token-Optimized Flow |
|--------|--------------|---------------------|
| Join room | WebSocket join, then validate | Token validates upfront |
| Director access | Same as participant | Separate token type |
| Solo view access | Same as participant | Stream-specific token |
| Room settings change | Director permission check | Token encodes permissions |
| Kick participant | Director permission check | Token validates authority |
| Admin actions | Session-based auth | Token + session hybrid |
| Invite sharing | Room ID only | Signed invite token |

---

## Token Types

### 1. Room Access Token (room_access)

**Purpose:** Secure room entry for participants

```javascript
{
  type: 'room_access',
  roomId: 'ABCD',
  userId: uuid(),         // Unique user identifier
  permissions: ['join', 'send-audio', 'send-video', 'chat'],
  expiresAt: timestamp,    // 24 hours from creation
  maxUses: 1,              // Single-use token
  issuedBy: 'admin'|null,  // Who created this token
  metadata: {
    name: 'John Doe',      // Pre-registered name
    role: 'participant'
  }
}
```

**URL Format:** `#/room/ABCD?token=tok_abc123xyz`

**Use Cases:**
- Guest invitations
- Scheduled event access
- Paid content access (integration point)

---

### 2. Director Token (director_access)

**Purpose:** Director/observer dashboard access

```javascript
{
  type: 'director_access',
  roomId: 'ABCD',
  userId: uuid(),
  permissions: ['view-all', 'mute-participant', 'kick-participant', 'room-settings'],
  expiresAt: timestamp,    // 8 hours (shorter for security)
  maxUses: null,           // Multi-use during validity
  issuedBy: 'admin',
  metadata: {
    directorName: 'Producer 1',
    level: 'full'|'limited' // 'limited' can't kick
  }
}
```

**URL Format:** `#/director/ABCD?token=tok_dir456uvw`

**Use Cases:**
- Remote producer access
- Quality control monitoring
- Multi-camera coordination

---

### 3. Stream View Token (stream_access)

**Purpose:** Individual stream viewing (SoloView/OBS sources)

```javascript
{
  type: 'stream_access',
  roomId: 'ABCD',
  streamId: 'participant_uuid',  // Specific participant or 'any'
  permissions: ['view', 'record'],
  expiresAt: timestamp,          // 1 hour for stream links
  maxUses: null,
  issuedBy: 'admin',
  metadata: {
    streamName: 'ABCD_uuid123',
    quality: '720p'|'1080p',
    watermark: true              // Add watermark overlay
  }
}
```

**URL Format:** `#/view/ABCD/participant_uuid?token=tok_str789rst`

**Use Cases:**
- OBS Browser Source URLs
- Embeddable player widgets
- Public stream links

---

### 4. Action Token (action_token)

**Purpose:** One-time action authorization (kick, mute, settings)

```javascript
{
  type: 'action_token',
  roomId: 'ABCD',
  action: 'kick'|'mute'|'settings',
  targetId: 'participant_uuid',  // Who the action affects
  permissions: ['execute'],
  expiresAt: timestamp,          // 5 minutes (very short)
  maxUses: 1,
  issuedBy: 'director_uuid',
  metadata: {
    reason: 'Spam violation',
    issuedAt: timestamp
  }
}
```

**URL Format:** Not URL-based, passed via WebSocket

**Use Cases:**
- Delegated moderation
- Audit trail for actions
- Reversible actions (token = undo capability)

---

### 5. Admin Token (admin_token)

**Purpose:** Admin panel operations

```javascript
{
  type: 'admin_token',
  permissions: ['create-room', 'delete-room', 'list-all', 'manage-users'],
  expiresAt: timestamp,          // 1 hour
  maxUses: null,
  issuedBy: 'system',
  metadata: {
    adminId: 'admin_001',
    scope: 'global'|'room-specific',
    roomId: 'ABCD'|null
  }
}
```

**URL Format:** `/admin?token=tok_adm000abc`

**Use Cases:**
- Temporary admin access
- API authentication
- Service account operations

---

## Token Generation API

### Endpoint: POST /api/tokens

```javascript
// Request
{
  type: 'room_access',
  roomId: 'ABCD',
  options: {
    expiresInSeconds: 86400,
    maxUses: 1,
    metadata: {
      name: 'Guest User',
      role: 'participant'
    }
  }
}

// Response
{
  success: true,
  token: 'tok_abc123xyz...',
  expiresAt: '2026-03-15T10:00:00Z',
  url: 'https://breadcall.local/#/room/ABCD?token=tok_abc123xyz...',
  qrCode: 'data:image/png;base64,...'  // Optional QR code
}
```

### Endpoint: POST /api/tokens/validate

```javascript
// Request
{
  token: 'tok_abc123xyz...',
  action: 'join-room'  // What the token is being used for
}

// Response (valid)
{
  success: true,
  valid: true,
  payload: {
    type: 'room_access',
    roomId: 'ABCD',
    permissions: ['join', 'send-audio', 'send-video'],
    metadata: { name: 'Guest User' }
  }
}

// Response (invalid)
{
  success: true,
  valid: false,
  reason: 'expired'|'max_uses_reached'|'invalid'|'revoked',
  message: 'This token has expired'
}
```

### Endpoint: DELETE /api/tokens/:tokenId

```javascript
// Revoke a token immediately
// Response
{
  success: true,
  revoked: true
}
```

---

## Server-Side Implementation

### RoomManager Extensions

```javascript
const crypto = require('crypto');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.tokens = new Map();           // tokenId -> TokenData
    this.tokenIndex = new Map();       // roomId -> Set of tokenIds
    this.revokedTokens = new Set();    // Revoked token IDs
  }

  /**
   * Generate a signed token for room access or actions
   */
  generateToken(roomId, type, options = {}) {
    const room = this.rooms.get(roomId);
    if (!room && type !== 'admin_token') {
      throw new Error('Room not found');
    }

    const tokenId = crypto.randomBytes(16).toString('hex');
    const signature = this._signToken(tokenId, roomId, type);

    const tokenData = {
      tokenId,
      signature,
      type,
      roomId,
      userId: options.userId || crypto.randomBytes(8).toString('hex'),
      permissions: this._getDefaultPermissions(type),
      expiresAt: options.expiresAt || Date.now() + 3600000,
      maxUses: options.maxUses || null,
      usedCount: 0,
      issuedBy: options.issuedBy || 'system',
      metadata: options.metadata || {},
      createdAt: Date.now()
    };

    // Store token
    this.tokens.set(tokenId, tokenData);

    // Index by room for cleanup
    if (!this.tokenIndex.has(roomId)) {
      this.tokenIndex.set(roomId, new Set());
    }
    this.tokenIndex.get(roomId).add(tokenId);

    // Return serialized token
    return this._serializeToken(tokenData);
  }

  /**
   * Validate and consume a token
   */
  validateToken(tokenString, action = null) {
    const tokenData = this._deserializeToken(tokenString);
    if (!tokenData) {
      return { valid: false, reason: 'invalid_format' };
    }

    // Check revocation
    if (this.revokedTokens.has(tokenData.tokenId)) {
      return { valid: false, reason: 'revoked' };
    }

    // Check existence
    const stored = this.tokens.get(tokenData.tokenId);
    if (!stored) {
      return { valid: false, reason: 'not_found' };
    }

    // Verify signature
    if (!this._verifySignature(stored)) {
      return { valid: false, reason: 'invalid_signature' };
    }

    // Check expiration
    if (stored.expiresAt && stored.expiresAt < Date.now()) {
      return { valid: false, reason: 'expired' };
    }

    // Check usage limit
    if (stored.maxUses && stored.usedCount >= stored.maxUses) {
      return { valid: false, reason: 'max_uses_reached' };
    }

    // Check action permission if specified
    if (action && !stored.permissions.includes(action)) {
      return { valid: false, reason: 'permission_denied' };
    }

    // Increment usage count
    stored.usedCount++;

    return {
      valid: true,
      payload: {
        type: stored.type,
        roomId: stored.roomId,
        permissions: stored.permissions,
        metadata: stored.metadata
      }
    };
  }

  /**
   * Revoke a token
   */
  revokeToken(tokenId) {
    const token = this.tokens.get(tokenId);
    if (token) {
      this.revokedTokens.add(tokenId);
      // Cleanup after 24 hours
      setTimeout(() => {
        this.revokedTokens.delete(tokenId);
        this.tokens.delete(tokenId);
      }, 86400000);
      return true;
    }
    return false;
  }

  /**
   * Cleanup expired tokens for a room
   */
  cleanupExpiredTokens(roomId) {
    const tokenIds = this.tokenIndex.get(roomId);
    if (!tokenIds) return;

    const now = Date.now();
    for (const tokenId of tokenIds) {
      const token = this.tokens.get(tokenId);
      if (token && token.expiresAt < now) {
        this.tokens.delete(tokenId);
        tokenIds.delete(tokenId);
      }
    }

    if (tokenIds.size === 0) {
      this.tokenIndex.delete(roomId);
    }
  }

  /**
   * Get default permissions by token type
   */
  _getDefaultPermissions(type) {
    switch (type) {
      case 'room_access':
        return ['join', 'send-audio', 'send-video', 'chat'];
      case 'director_access':
        return ['view-all', 'mute-participant', 'room-settings'];
      case 'stream_access':
        return ['view'];
      case 'action_token':
        return ['execute'];
      case 'admin_token':
        return ['create-room', 'delete-room', 'list-all', 'manage-users'];
      default:
        return [];
    }
  }

  /**
   * Sign token with HMAC
   */
  _signToken(tokenId, roomId, type) {
    const secret = process.env.TOKEN_SECRET || 'default-secret-change-in-production';
    return crypto
      .createHmac('sha256', secret)
      .update(`${tokenId}:${roomId}:${type}`)
      .digest('hex');
  }

  /**
   * Verify token signature
   */
  _verifySignature(token) {
    const expected = this._signToken(token.tokenId, token.roomId, token.type);
    return crypto.timingSafeEqual(
      Buffer.from(token.signature),
      Buffer.from(expected)
    );
  }

  /**
   * Serialize token for transmission
   */
  _serializeToken(token) {
    // Compact format: tokenId.signature (base64 encoded JSON)
    const payload = Buffer.from(JSON.stringify({
      tokenId: token.tokenId,
      signature: token.signature
    })).toString('base64');
    return `tok_${payload}`;
  }

  /**
   * Deserialize token from string
   */
  _deserializeToken(tokenString) {
    try {
      if (!tokenString.startsWith('tok_')) return null;
      const payload = tokenString.slice(4);
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
      return decoded;
    } catch (e) {
      return null;
    }
  }
}
```

---

## Server Routes

```javascript
// server/src/index.js

/**
 * Generate token
 */
app.post('/api/tokens', authMiddleware.isAuthenticated.bind(authMiddleware), async (req, res) => {
  try {
    const { type, roomId, options = {} } = req.body;

    // Validate token type
    const validTypes = ['room_access', 'director_access', 'stream_access', 'action_token', 'admin_token'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid token type' });
    }

    // Validate room exists for room-based tokens
    if (['room_access', 'director_access', 'stream_access'].includes(type)) {
      if (!roomId) {
        return res.status(400).json({ success: false, error: 'Room ID required' });
      }
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }
    }

    // Set expiry based on token type if not specified
    const expiryDefaults = {
      room_access: 86400,        // 24 hours
      director_access: 28800,    // 8 hours
      stream_access: 3600,       // 1 hour
      action_token: 300,         // 5 minutes
      admin_token: 3600          // 1 hour
    };

    if (!options.expiresAt && expiryDefaults[type]) {
      options.expiresAt = Date.now() + (expiryDefaults[type] * 1000);
    }

    // Generate token
    const token = roomManager.generateToken(roomId, type, {
      ...options,
      issuedBy: req.session?.admin?.id || 'api'
    });

    // Build shareable URL
    const baseUrl = getTokenBaseUrl(type, roomId);
    const fullUrl = `${req.protocol}://${req.get('host')}${baseUrl}?token=${token}`;

    // Generate QR code if requested
    let qrCode = null;
    if (req.body.includeQrCode) {
      const QRCode = require('qrcode');
      qrCode = await QRCode.toDataURL(fullUrl);
    }

    res.json({
      success: true,
      token,
      expiresAt: options.expiresAt,
      url: fullUrl,
      qrCode
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Validate token
 */
app.post('/api/tokens/validate', async (req, res) => {
  try {
    const { token, action } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }

    const result = roomManager.validateToken(token, action);

    if (!result.valid) {
      return res.json({
        success: true,
        valid: false,
        reason: result.reason,
        message: getTokenErrorMessage(result.reason)
      });
    }

    res.json({
      success: true,
      valid: true,
      payload: result.payload
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Revoke token
 */
app.delete('/api/tokens/:tokenId', authMiddleware.isAuthenticated.bind(authMiddleware), (req, res) => {
  const { tokenId } = req.params;

  if (roomManager.revokeToken(tokenId)) {
    res.json({ success: true, revoked: true });
  } else {
    res.status(404).json({ success: false, error: 'Token not found' });
  }
});

/**
 * List tokens for a room (admin only)
 */
app.get('/api/admin/rooms/:roomId/tokens', authMiddleware.isAuthenticated.bind(authMiddleware), (req, res) => {
  const { roomId } = req.params;
  const room = roomManager.getRoom(roomId);

  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }

  const tokenIds = roomManager.tokenIndex.get(roomId);
  if (!tokenIds) {
    return res.json({ success: true, tokens: [] });
  }

  const tokens = [];
  for (const tokenId of tokenIds) {
    const token = roomManager.tokens.get(tokenId);
    if (token) {
      tokens.push({
        tokenId: token.tokenId,
        type: token.type,
        createdAt: token.createdAt,
        expiresAt: token.expiresAt,
        usedCount: token.usedCount,
        maxUses: token.maxUses,
        metadata: token.metadata
      });
    }
  }

  res.json({ success: true, tokens });
});

// Helper: Get base URL for token type
function getTokenBaseUrl(type, roomId) {
  switch (type) {
    case 'room_access':
      return `/#/room/${roomId}`;
    case 'director_access':
      return `/#/director/${roomId}`;
    case 'stream_access':
      return `/#/view/${roomId}`;
    case 'admin_token':
      return `/admin`;
    default:
      return '/';
  }
}

// Helper: Get error message
function getTokenErrorMessage(reason) {
  const messages = {
    expired: 'This invite link has expired',
    max_uses_reached: 'This invite link has reached its usage limit',
    not_found: 'The room for this token no longer exists',
    invalid_format: 'Invalid token format',
    invalid_signature: 'Token signature verification failed',
    revoked: 'This token has been revoked',
    permission_denied: 'This token does not have permission for that action'
  };
  return messages[reason] || 'Invalid or expired token';
}
```

---

## Client-Side Integration

### SignalingClient Extensions

```javascript
// client/js/SignalingClient.js

class SignalingClient extends EventTarget {
  // ... existing code ...

  /**
   * Validate a token with the server
   */
  async validateToken(token, action = null) {
    try {
      const response = await fetch('/api/tokens/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Validation failed');
      }

      return data;
    } catch (error) {
      console.error('[SignalingClient] Token validation failed:', error);
      throw error;
    }
  }

  /**
   * Join room with token authentication
   */
  async joinRoomWithToken(roomId, token, name = 'User') {
    // First validate token
    const validation = await this.validateToken(token, 'join');

    if (!validation.valid) {
      throw new Error(validation.message || 'Invalid token');
    }

    // Extract pre-registered name from token if available
    const useName = validation.payload.metadata?.name || name;

    // Connect to WebSocket
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    return new Promise((resolve, reject) => {
      const onConnected = () => {
        this.removeEventListener('connected', onConnected);

        // Send join with token
        this.send('join-room-with-token', {
          roomId,
          token,
          name: useName
        });
      };

      const onResponse = (e) => {
        if (e.detail.type === 'joined-room') {
          this.removeEventListener('joined-room', onResponse);
          this.removeEventListener('error', onError);
          resolve(e.detail);
        }
      };

      const onError = (e) => {
        this.removeEventListener('connected', onConnected);
        this.removeEventListener('joined-room', onResponse);
        this.removeEventListener('error', onError);
        reject(new Error(e.detail.message));
      };

      this.addEventListener('connected', onConnected, { once: true });
      this.addEventListener('joined-room', onResponse, { once: true });
      this.addEventListener('error', onError, { once: true });

      if (!this.isConnected()) {
        this.connect(wsUrl);
      } else {
        onConnected();
      }
    });
  }
}
```

### App.js Extensions

```javascript
// client/js/app.js

class BreadCallApp {
  // ... existing code ...

  async handleRouteChange() {
    const hash = window.location.hash;
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    // Handle token-based routes
    if (token) {
      await this.handleTokenBasedRoute(hash, token);
      return;
    }

    // ... existing non-token routing ...
  }

  async handleTokenBasedRoute(hash, token) {
    try {
      // Validate token before rendering anything
      const validation = await this.signaling.validateToken(token);

      if (!validation.valid) {
        // Token invalid - redirect to join page with error
        const errorType = `token_${validation.reason}`;
        window.location.hash = `#/join?error=${errorType}&message=${encodeURIComponent(validation.message)}`;
        return;
      }

      // Token valid - route based on token type
      const { type, roomId, permissions } = validation.payload;

      switch (type) {
        case 'room_access':
          this.roomId = roomId;
          this.uiManager.renderRoom(this.roomId);
          await this.joinRoomWithToken(this.roomId, token);
          break;

        case 'director_access':
          this.roomId = roomId;
          // Initialize DirectorView with token
          window.directorView = new DirectorView(roomId, token);
          break;

        case 'stream_access':
          this.roomId = roomId;
          // Initialize SoloView with token
          window.soloView = new SoloView(roomId, token);
          break;

        case 'admin_token':
          // Redirect to admin panel with token
          window.location.href = `/admin?token=${token}`;
          break;

        default:
          window.location.hash = '#/';
      }
    } catch (error) {
      console.error('[BreadCallApp] Token handling failed:', error);
      window.location.hash = '#/join?error=token_validation_failed';
    }
  }

  async joinRoomWithToken(roomId, token, name = 'User') {
    // Prevent multiple concurrent join attempts
    if (this.isJoining) return;
    this.isJoining = true;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    try {
      // Token-based join with automatic validation
      await this.signaling.joinRoomWithToken(roomId, token, name);
    } catch (error) {
      this.isJoining = false;
      this.uiManager.showToast(error.message, 'error');
      throw error;
    }

    // Continue with media setup (same as regular join)
    await this.mediaManager.getUserMedia().catch((error) => {
      console.warn('[BreadCallApp] Joining without media:', error.message);
    });
  }
}
```

---

## SignalingHandler Extensions

```javascript
// server/src/SignalingHandler.js

class SignalingHandler {
  // ... existing code ...

  /**
   * Handle join-room-with-token message
   */
  async handleJoinRoomWithToken(ws, payload) {
    const { roomId, token, name } = payload || {};

    if (!roomId || !token) {
      this.sendError(ws, 'Room ID and token are required');
      return;
    }

    // Validate token
    const validation = this.roomManager.validateToken(token, 'join');

    if (!validation.valid) {
      this.sendError(ws, getTokenErrorMessage(validation.reason));
      return;
    }

    // Extract info from token
    const { metadata } = validation.payload;

    try {
      // Join room with token-authenticated user
      const result = this.roomManager.joinRoom(roomId, {
        name: metadata?.name || name || 'Authenticated User',
        ws,
        authenticated: true,
        tokenPermissions: validation.payload.permissions
      });

      // Store connection mapping with token info
      this.wsMap.set(ws, {
        participantId: result.participantId,
        roomId: result.roomId,
        token: token,
        permissions: validation.payload.permissions
      });

      // Send success
      this.send(ws, {
        type: 'joined-room',
        participantId: result.participantId,
        room: result.room,
        existingPeers: result.existingPeers,
        authenticated: true
      });

      // Notify room
      this.broadcastToRoom(roomId, {
        type: 'participant-joined',
        participantId: result.participantId,
        streamName: `${roomId}_${result.participantId}`,
        name: result.participantData.name,
        authenticated: true
      }, ws);

      console.log(`[Signaling] Token-authenticated participant ${result.participantId} joined room ${roomId}`);
    } catch (error) {
      this.sendError(ws, error.message);
    }
  }

  /**
   * Handle director join with token
   */
  async handleJoinDirectorWithToken(ws, payload) {
    const { roomId, token, name } = payload || {};

    if (!roomId || !token) {
      this.sendError(ws, 'Room ID and token are required');
      return;
    }

    // Validate token
    const validation = this.roomManager.validateToken(token, 'director-join');

    if (!validation.valid) {
      this.sendError(ws, getTokenErrorMessage(validation.reason));
      return;
    }

    try {
      const result = this.roomManager.joinRoomAsDirector(roomId, {
        name: validation.payload.metadata?.directorName || name || 'Director',
        ws,
        tokenPermissions: validation.payload.permissions
      });

      this.wsMap.set(ws, {
        participantId: result.directorId,
        roomId: result.roomId,
        isDirector: true,
        token: token,
        permissions: validation.payload.permissions
      });

      this.send(ws, {
        type: 'joined-room',
        directorId: result.directorId,
        room: result.room,
        existingPeers: result.existingParticipants,
        authenticated: true,
        permissions: validation.payload.permissions
      });

      console.log(`[Signaling] Token-authenticated director ${result.directorId} joined room ${roomId}`);
    } catch (error) {
      this.sendError(ws, error.message);
    }
  }

  /**
   * Handle action with action token (kick, mute, etc.)
   */
  async handleActionWithToken(ws, payload) {
    const { action, targetId, token } = payload || {};

    if (!action || !targetId || !token) {
      this.sendError(ws, 'Action, target, and token are required');
      return;
    }

    // Validate action token
    const validation = this.roomManager.validateToken(token, action);

    if (!validation.valid) {
      this.sendError(ws, `Action unauthorized: ${getTokenErrorMessage(validation.reason)}`);
      return;
    }

    const connection = this.wsMap.get(ws);
    if (!connection) {
      this.sendError(ws, 'Not connected to a room');
      return;
    }

    // Execute action based on type
    switch (action) {
      case 'kick':
        const kickedWs = this.findPeerWebSocket(connection.roomId, targetId);
        if (kickedWs) {
          kickedWs.send(JSON.stringify({
            type: 'kicked',
            reason: validation.payload.metadata?.reason || 'Removed by director'
          }));
          kickedWs.close();
        }
        this.roomManager.leaveRoom(connection.roomId, targetId);
        this.broadcastToRoom(connection.roomId, {
          type: 'participant-left',
          participantId: targetId
        });
        break;

      case 'mute':
        const targetWs = this.findPeerWebSocket(connection.roomId, targetId);
        if (targetWs) {
          targetWs.send(JSON.stringify({
            type: 'mute-requested',
            muted: true
          }));
        }
        break;
    }

    // Log action for audit
    console.log(`[Signaling] Action ${action} executed by token from ${connection.participantId}`);
  }
}
```

---

## Optimization Benefits for Other Actions

### 1. One-Click Director Access

**Before:**
1. Director navigates to /admin
2. Logs in with credentials
3. Finds room in list
4. Clicks "Direct" button
5. New window opens

**After:**
1. Admin generates director token
2. Sends link to producer
3. Producer clicks link, instantly authenticated
4. Full director access immediately

**URL:** `#/director/ABCD?token=tok_dir_xyz123`

---

### 2. Secure OBS Stream Links

**Before:**
1. OBS operator needs room ID
2. Must coordinate with director for stream name
3. Anyone with URL can view

**After:**
1. Admin generates stream token for specific participant
2. Token includes quality settings, watermark flag
3. OBS uses token-authenticated URL
4. Token can be revoked if compromised

**URL:** `#/view/ABCD/participant123?token=tok_str_abc456`

---

### 3. Delegated Moderation

**Before:**
1. Only director can kick/mute
2. Director must manually perform all actions

**After:**
1. Director generates action token for specific action
2. Sends to trusted participant
3. Participant can execute ONE action (kick/mute)
4. Token expires after use

**WebSocket Message:**
```json
{
  "type": "action-with-token",
  "payload": {
    "action": "kick",
    "targetId": "spam_user_456",
    "token": "tok_act_789"
  }
}
```

---

### 4. Scheduled Events

**Before:**
1. Room created at event time
2. Participants manually joined
3. No access control

**After:**
1. Room created in advance
2. Tokens generated with future activation
3. Tokens sent to registered attendees
4. Access only during scheduled window

```javascript
// Generate token that activates at event time
const token = roomManager.generateToken(roomId, 'room_access', {
  expiresAt: eventEndTime,
  metadata: {
    eventName: 'Live Product Launch',
    registeredEmail: 'user@example.com'
  }
});
```

---

### 5. Paid Content/Paywall Integration

**Before:**
- No built-in payment integration
- Room password is only access control

**After:**
```javascript
// After payment confirmation
app.post('/api/purchase-complete', async (req, res) => {
  const { roomId, userId } = req.body;

  // Generate single-use token
  const token = roomManager.generateToken(roomId, 'room_access', {
    expiresAt: Date.now() + 7200000,  // 2 hour access
    maxUses: 1,
    metadata: {
      purchaseId: req.body.purchaseId,
      tier: 'premium'
    }
  });

  // Email token to user
  await sendEmail({
    to: req.body.email,
    subject: 'Your Event Access Link',
    body: `Click here to join: ${eventUrl}?token=${token}`
  });
});
```

---

### 6. Audit Trail

All token actions are logged:

```javascript
// server/src/TokenAuditLog.js

class TokenAuditLog {
  static log(event, tokenData, additional = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,  // 'generated', 'validated', 'consumed', 'revoked'
      tokenId: tokenData?.tokenId,
      type: tokenData?.type,
      roomId: tokenData?.roomId,
      userId: tokenData?.userId,
      issuedBy: tokenData?.issuedBy,
      ...additional
    };

    // Write to database/file
    fs.appendFileSync('token-audit.log', JSON.stringify(entry) + '\n');
  }
}

// Usage in validateToken
const result = this.validateToken(token, action);
TokenAuditLog.log(result.valid ? 'consumed' : 'validation_failed', tokenData, {
  reason: result.reason,
  action: action,
  ip: req.ip
});
```

---

## Security Considerations

### Token Storage

```javascript
// NEVER store tokens in localStorage (XSS vulnerable)
// Use httpOnly cookies for persistent tokens, or keep in memory

// For admin tokens - httpOnly cookie
res.cookie('admin_token', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 3600000  // 1 hour
});

// For shareable links - URL parameter only (not stored)
```

### Rate Limiting

```javascript
// Prevent brute force token guessing
const rateLimit = require('express-rate-limit');

const tokenValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,  // 20 attempts per window
  message: { success: false, error: 'Too many token validation attempts' }
});

app.post('/api/tokens/validate', tokenValidateLimiter, async (req, res) => {
  // ...
});
```

### Token Format Security

```javascript
// Use constant-time comparison for signatures
const crypto = require('crypto');

function verifySignature(token, expected) {
  return crypto.timingSafeEqual(
    Buffer.from(token.signature),
    Buffer.from(expected)
  );
}

// Rotate secrets periodically
const TOKEN_SECRETS = [
  process.env.TOKEN_SECRET_CURRENT,
  process.env.TOKEN_SECRET_PREVIOUS  // For validation during rotation
];
```

### XSS Prevention in UI

When rendering token data in the UI, always escape user-provided content:

```javascript
// In UIManager.js - use escapeHtml() for ALL dynamic content
const escapedUrl = this.escapeHtml(tokenUrl);
const escapedName = this.escapeHtml(tokenData.metadata.name);

// Never insert untrusted content directly
element.innerHTML = `<div>${escapedUrl}</div>`;  // Safe
element.innerHTML = `<div>${tokenUrl}</div>`;     // UNSAFE!
```

---

## Migration Path

### Phase 1: Core Token System (Week 1)
- [ ] Add token generation/validation to RoomManager
- [ ] Create REST endpoints
- [ ] Basic admin panel UI

### Phase 2: Room Access Integration (Week 2)
- [ ] Update app.js for token-based joins
- [ ] Add token join handler to SignalingHandler
- [ ] Test: valid token, expired token, invalid token

### Phase 3: Director/Stream Tokens (Week 3)
- [ ] DirectorView token support
- [ ] SoloView token support
- [ ] Token list/management in admin panel

### Phase 4: Action Tokens (Week 4)
- [ ] Kick/mute with tokens
- [ ] Audit logging
- [ ] Token revocation UI

### Phase 5: Production Hardening (Week 5)
- [ ] Rate limiting
- [ ] Secret rotation
- [ ] Monitoring/alerting
- [ ] Documentation

---

## Comparison: Original vs Expanded Option 5

| Aspect | Original | Expanded |
|--------|----------|----------|
| Token Types | 1 (generic) | 5 (typed) |
| Permissions | Binary (valid/invalid) | Granular (per-action) |
| Actions Covered | Room join only | Join, direct, view, kick, mute, admin |
| Audit Trail | None | Full logging |
| Revocation | None | Per-token revocation |
| Admin Integration | Basic | Full token management UI |
| Payment Ready | No | Yes (paywall hooks) |
| Scheduled Events | No | Yes (time-based) |

---

## Conclusion

The expanded Option 5 transforms from a simple "room validation" solution into a **comprehensive access control system** that optimizes:

1. **User Experience**: One-click authenticated access
2. **Security**: Signed tokens with expiration and revocation
3. **Flexibility**: Typed tokens for different use cases
4. **Auditability**: Full logging of token operations
5. **Extensibility**: Ready for payments, scheduling, and integrations

This system scales from simple room sharing to enterprise broadcast workflows with multiple producer levels, paid content, and compliance requirements.

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| server/src/RoomManager.js | Add token methods | +200 |
| server/src/index.js | Add token routes | +150 |
| server/src/SignalingHandler.js | Add token handlers | +100 |
| client/js/SignalingClient.js | Add validateToken | +50 |
| client/js/app.js | Token-based routing | +80 |
| client/js/AdminDashboard.js | Token generator UI | +100 |
| client/js/DirectorView.js | Token support | +30 |
| client/js/SoloView.js | Token support | +30 |
| **Total** | | **~740 lines** |

---

*Document generated as part of Room URI Optimization brainstorming session - Option 5 Expanded*
