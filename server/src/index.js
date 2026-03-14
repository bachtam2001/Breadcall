const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
require('dotenv').config();

const RoomManager = require('./RoomManager');
const SignalingHandler = require('./SignalingHandler');
const AuthMiddleware = require('./AuthMiddleware');
const RedisClient = require('./RedisClient');
const Database = require('./database');
const TokenManager = require('./TokenManager');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize auth middleware
const authMiddleware = new AuthMiddleware();

// Initialize Redis, Database, and TokenManager
const redisClient = new RedisClient();
const database = new Database();
const tokenManager = new TokenManager(redisClient, database);

// Allowed origins for CORS (loaded from environment variable)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost', 'http://localhost:80', 'http://localhost:3000', 'http://localhost:8080'];

// Middleware

// Trust proxy - required for secure cookies when behind nginx reverse proxy
// Allows Express to correctly identify HTTPS connections via X-Forwarded-Proto header
app.set('trust proxy', 1);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl, but block admin API)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// CSRF protection middleware
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: (req) => process.env.CSRF_SECRET || 'csrf-secret-change-in-production',
  cookieName: 'csrfToken',
  cookieOptions: {
    httpOnly: false,
    secure: process.env.USE_SECURE_COOKIES === 'true',
    sameSite: 'lax',
    path: '/'
  },
  size: 32,
  getTokenFromRequest: (req) => req.headers['x-csrf-token']
});

// Apply CSRF protection to mutation requests
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    doubleCsrfProtection(req, res, next);
  } else {
    next();
  }
});

// Expose CSRF token generation endpoint
app.get('/api/csrf-token', generateToken, (req, res) => {
  res.json({
    success: true,
    csrfToken: res.locals.csrfToken
  });
});

// Session middleware (must be before routes that use it)
app.use(authMiddleware.getSessionMiddleware());

// Initialize async dependencies
async function initializeDependencies() {
  try {
    await redisClient.connect();
    console.log('[Index] Redis client connected');

    await database.initialize();
    console.log('[Index] Database initialized');

    await tokenManager.initialize();
    console.log('[Index] TokenManager initialized');

    // Initialize RoomManager with TokenManager
    roomManager.setTokenManager(tokenManager);
    console.log('[Index] RoomManager initialized with TokenManager');
  } catch (error) {
    console.error('[Index] Failed to initialize dependencies:', error.message);
    // Continue without JWT features - legacy token support still works
  }
}

initializeDependencies();

// Serve static files in development
app.use(express.static(path.join(__dirname, '../../client')));

// REST API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create room - RESTRICTED TO ADMIN ONLY (use /api/admin/rooms)
app.post('/api/rooms', (req, res) => {
  res.status(403).json({
    success: false,
    error: 'Room creation is restricted to admin users. Please use /api/admin/rooms with valid admin session.'
  });
});

// Get room info
app.get('/api/rooms/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }
  res.json({
    success: true,
    room: {
      id: room.id,
      participantCount: room.participants.size,
      maxParticipants: room.maxParticipants,
      quality: room.quality,
      codec: room.codec,
      createdAt: room.createdAt
    }
  });
});

// Get room participants
app.get('/api/rooms/:roomId/participants', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }

  const participants = Array.from(room.participants.values()).map(p => ({
    participantId: p.participantId,
    name: p.name,
    joinedAt: p.joinedAt,
    isSendingVideo: p.isSendingVideo,
    isSendingAudio: p.isSendingAudio
  }));

  res.json({ success: true, participants });
});

// Get WebRTC configuration for clients
app.get('/api/webrtc-config', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  // X-Forwarded-Host may include port (e.g., localhost:3000) - use it for proxied environments
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  // WebRTC traffic goes through nginx proxy, use same host as signaling
  const webrtcUrl = `${protocol}://${host}`;

  res.json({
    success: true,
    webrtcUrl: webrtcUrl,
    app: '',
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
});

// Get session info for auto-rejoin (returns roomId if user has valid token in session)
app.get('/api/session/room', (req, res) => {
  if (req.session && req.session.tokens && req.session.roomId) {
    const roomId = req.session.roomId;
    const token = req.session.tokens[roomId];

    // Validate token is still valid
    const validation = roomManager.validateToken(token, 'join');
    if (validation.valid) {
      res.json({
        success: true,
        hasRoom: true,
        roomId
      });
      return;
    }
  }

  res.json({
    success: true,
    hasRoom: false
  });
});

// =============================================================================
// Admin API Routes
// =============================================================================

// Admin login
app.post('/api/admin/login', (req, res) => {
  console.log('[API] Admin login attempt');
  authMiddleware.login(req, res);
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  authMiddleware.logout(req, res);
});

// Get current admin status
app.get('/api/admin/me', (req, res) => {
  authMiddleware.getCurrentUser(req, res);
});

// List all rooms (admin only)
app.get('/api/admin/rooms', authMiddleware.isAuthenticated.bind(authMiddleware), (req, res) => {
  const rooms = roomManager.getAllRooms();
  res.json({ success: true, rooms });
});

// Get room participants (admin only)
app.get('/api/admin/rooms/:roomId/participants', authMiddleware.isAuthenticated.bind(authMiddleware), (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }

  const participants = Array.from(room.participants.values()).map(p => ({
    participantId: p.participantId,
    name: p.name,
    joinedAt: p.joinedAt,
    isSendingVideo: p.isSendingVideo,
    isSendingAudio: p.isSendingAudio,
    isMuted: p.isMuted,
    isVideoOff: p.isVideoOff
  }));

  const directors = roomManager.getRoomDirectors(req.params.roomId);

  res.json({ success: true, participants, directors });
});

// Create room (admin only)
app.post('/api/admin/rooms', authMiddleware.isAuthenticated.bind(authMiddleware), (req, res) => {
  try {
    const { password, maxParticipants = 10, quality = 'hd', codec = 'H264' } = req.body;
    const room = roomManager.createRoom({
      password,
      maxParticipants,
      quality,
      codec
    });
    res.json({
      success: true,
      roomId: room.id,
      room: {
        id: room.id,
        maxParticipants: room.maxParticipants,
        quality: room.quality,
        codec: room.codec,
        createdAt: room.createdAt
      },
      createdAt: room.createdAt
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Delete room (admin only)
app.delete('/api/admin/rooms/:roomId', authMiddleware.isAuthenticated.bind(authMiddleware), async (req, res) => {
  const deleted = await roomManager.deleteRoom(req.params.roomId);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }
  res.json({ success: true });
});

// Update room settings (admin only)
app.put('/api/admin/rooms/:roomId/settings', authMiddleware.isAuthenticated.bind(authMiddleware), (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }

  const { quality, codec, maxParticipants } = req.body;
  const updates = {};

  if (quality && ['720p', '1080p', 'original'].includes(quality)) {
    updates.quality = quality;
  }
  if (codec && ['H264', 'H265', 'VP8', 'VP9'].includes(codec)) {
    updates.codec = codec;
  }
  if (maxParticipants && typeof maxParticipants === 'number' && maxParticipants > 0) {
    updates.maxParticipants = maxParticipants;
  }

  // Update room settings
  Object.assign(room, updates);

  // Notify all participants in the room about settings change
  signalingHandler.broadcastRoomSettings(req.params.roomId, {
    quality: room.quality,
    codec: room.codec,
    maxParticipants: room.maxParticipants
  });

  res.json({
    success: true,
    room: {
      id: room.id,
      quality: room.quality,
      codec: room.codec,
      maxParticipants: room.maxParticipants
    }
  });
});

// =============================================================================
// Token API Routes
// =============================================================================

/**
 * Generate token (legacy HMAC format or JWT via TokenManager)
 * When TokenManager is available, generates JWT access + refresh token pair
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

    // Use TokenManager for JWT tokens when available
    if (tokenManager && ['room_access', 'director_access', 'admin_token'].includes(type)) {
      // Generate JWT token pair via TokenManager
      const tokenPair = await tokenManager.generateTokenPair({
        type,
        roomId,
        userId: options.userId || uuidv4(),
        permissions: options.permissions
      });

      // Set access and refresh tokens as HttpOnly cookies
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.USE_SECURE_COOKIES === 'true',
        sameSite: 'lax',
        path: '/',
        maxAge: 900 * 1000 // 15 minutes (access token expiry)
      };

      // Access token cookie (short-lived)
      res.cookie('accessToken', tokenPair.accessToken, cookieOptions);

      // Refresh token cookie (long-lived, managed by TokenManager)
      res.cookie('refreshToken', tokenPair.tokenId, {
        httpOnly: true,
        secure: process.env.USE_SECURE_COOKIES === 'true',
        sameSite: 'strict',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      // Build shareable URL with access token as query param (for initial join only)
      const baseUrl = getTokenBaseUrl(type, roomId);
      const fullUrl = `${req.protocol}://${req.get('host')}${baseUrl}?token=${tokenPair.accessToken}`;

      // Generate QR code if requested
      let qrCode = null;
      if (req.body.includeQrCode) {
        const QRCode = require('qrcode');
        qrCode = await QRCode.toDataURL(fullUrl);
      }

      return res.json({
        success: true,
        tokenId: tokenPair.tokenId,
        expiresAt: Date.now() + (tokenPair.expiresIn * 1000),
        expiresIn: tokenPair.expiresIn,
        url: fullUrl,
        qrCode
      });
    }

    // Fallback to legacy token generation (for stream_access, action_token)
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

    // Generate legacy token
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
 * Refresh access token using refresh token
 * POST /api/tokens/refresh
 */
app.post('/api/tokens/refresh', doubleCsrfProtection, async (req, res) => {
  try {
    // Get refresh token from cookie
    const refreshTokenId = req.cookies?.refreshToken;

    if (!refreshTokenId) {
      return res.status(401).json({
        success: false,
        error: 'refresh_required',
        message: 'Refresh token not found'
      });
    }

    // Validate refresh token via TokenManager
    const validation = await tokenManager.validateRefreshToken(refreshTokenId);

    if (!validation.valid) {
      return res.status(401).json({
        success: false,
        error: validation.reason === 'rotated' ? 'token_rotated' : 'refresh_invalid',
        message: validation.reason === 'rotated'
          ? 'Refresh token has been rotated (possible token reuse detected)'
          : 'Refresh token is invalid or expired'
      });
    }

    // Rotate refresh token and issue new pair
    const rotation = await tokenManager.rotateRefreshToken(refreshTokenId);

    if (!rotation.success) {
      return res.status(401).json({
        success: false,
        error: 'rotation_failed',
        message: 'Failed to rotate refresh token'
      });
    }

    // Set new access token cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.USE_SECURE_COOKIES === 'true',
      sameSite: 'lax',
      path: '/',
      maxAge: 900 * 1000 // 15 minutes
    };

    res.cookie('accessToken', rotation.accessToken, cookieOptions);

    // Set new refresh token cookie (rotation)
    res.cookie('refreshToken', rotation.tokenId, {
      httpOnly: true,
      secure: process.env.USE_SECURE_COOKIES === 'true',
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      success: true,
      accessToken: rotation.accessToken,
      refreshToken: rotation.tokenId,
      expiresIn: 900
    });
  } catch (error) {
    console.error('[API] Token refresh error:', error.message);
    res.status(500).json({
      success: false,
      error: 'refresh_failed',
      message: 'Token refresh failed'
    });
  }
});

/**
 * Validate token (supports both JWT and legacy formats)
 */
app.post('/api/tokens/validate', async (req, res) => {
  try {
    const { token, action } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }

    // Check if this is a JWT token (starts with eyJ)
    if (token.startsWith('eyJ')) {
      // Validate via TokenManager (stateless JWT validation)
      const result = await tokenManager.validateAccessToken(token);

      if (!result.valid) {
        return res.json({
          success: true,
          valid: false,
          reason: result.reason,
          message: getTokenErrorMessage(result.reason)
        });
      }

      return res.json({
        success: true,
        valid: true,
        payload: result.payload
      });
    }

    // Fallback to legacy token validation
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

  const tokens = roomManager.getRoomTokens(roomId);
  res.json({ success: true, tokens });
});

// Helper: Get base URL for token type (using HTML5 History API format, not hash)
function getTokenBaseUrl(type, roomId) {
  switch (type) {
    case 'room_access':
      return `/room/${roomId}`;
    case 'director_access':
      return `/director/${roomId}`;
    case 'stream_access':
      return `/view/${roomId}`;
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

// SPA catch-all route - serve index.html for unknown paths
// This enables HTML5 History API routing (clean URLs without #)
app.get('{*path}', (req, res, next) => {
  const reqPath = req.path;

  // Skip API routes, static files, admin, and files with extensions
  if (reqPath.startsWith('/api/') ||
      reqPath.startsWith('/css/') ||
      reqPath.startsWith('/js/') ||
      reqPath.startsWith('/admin') ||
      reqPath.includes('.') ||
      reqPath.startsWith('/view/')) {  // MediaMTX proxy paths
    return next();
  }

  // Serve index.html for SPA routes
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Allowed origins for WebSocket connections
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost', 'http://localhost:80', 'http://localhost:3000', 'http://localhost:8080', 'https://localhost'];

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws' });

// Initialize managers
const roomManager = new RoomManager();
const signalingHandler = new SignalingHandler(roomManager, wss);

// Parse session from cookie for WebSocket connections
const parseSessionFromCookie = (cookie) => {
  if (!cookie) return null;

  // Extract connect.sid from cookie string
  const match = cookie.match(/connect\.sid=([^;]+)/);
  if (!match) return null;

  // URL decode the session ID
  const sessionId = decodeURIComponent(match[1]);

  // Get session from middleware's store
  const sessionStore = authMiddleware.getSessionMiddleware().store;
  return new Promise((resolve, reject) => {
    sessionStore.get(sessionId, (err, session) => {
      if (err) reject(err);
      else resolve(session);
    });
  });
};

// Handle WebSocket connections
wss.on('connection', async (ws, req) => {
  // Validate origin
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`[WebSocket] Rejected connection from unauthorized origin: ${origin}`);
    ws.close(1008, 'Unauthorized origin');
    return;
  }

  // Parse session from cookie
  const cookie = req.headers.cookie;
  const session = await parseSessionFromCookie(cookie);

  console.log(`[WebSocket] New connection from ${origin || 'unknown origin'}${session ? ' (authenticated)' : ' (no session)'}`);

  signalingHandler.handleConnection(ws, session);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      signalingHandler.handleMessage(ws, data);
    } catch (error) {
      console.error('[WebSocket] Parse error:', error.message);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Connection closed');
    signalingHandler.handleClose(ws);
  });

  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error.message);
    signalingHandler.handleError(ws, error);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║           BreadCall Signaling Server                   ║
╠════════════════════════════════════════════════════════╣
║  HTTP Server:  http://localhost:${PORT}                   ║
║  WebSocket:    ws://localhost:${PORT}/ws                ║
║  Environment:  ${process.env.NODE_ENV || 'development'}                           ║
╚════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Closed out remaining connections');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

module.exports = { app, server, wss };
