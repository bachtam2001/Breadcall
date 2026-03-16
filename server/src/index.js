const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const RoomManager = require('./RoomManager');
const SignalingHandler = require('./SignalingHandler');
const AuthMiddleware = require('./AuthMiddleware');
const Database = require('./database');
const RBACManager = require('./RBACManager');
const UserManager = require('./UserManager');
const TokenManager = require('./TokenManager');
const RedisClient = require('./RedisClient');
const OLAManager = require('./OLAManager');
const bootstrap = require('./bootstrap');
const createUserRouter = require('./routes/user');
const createMonitoringRouter = require('./routes/monitoring');

const app = express();
const PORT = process.env.PORT || 3000;

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
      console.warn(`[CORS] Rejected request from origin: ${origin}`);
      console.warn(`[CORS] Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));
app.use(express.json());
app.use(cookieParser());

// Serve static files in development
app.use(express.static(path.join(__dirname, '../../client')));

// Wrapper function for auth middleware that defers initialization until request time
// This is needed because routes are defined before authMiddleware is initialized
const requireAuth = () => {
  return (req, res, next) => {
    if (!authMiddleware) {
      return res.status(500).json({ success: false, error: 'Auth middleware not initialized' });
    }
    return authMiddleware.requireAuth()(req, res, next);
  };
};

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

// Refresh access token using refresh token cookie
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshTokenId = req.cookies?.refreshToken;

    if (!refreshTokenId) {
      return res.status(401).json({
        success: false,
        error: 'No refresh token provided'
      });
    }

    // Validate refresh token
    const validation = await tokenManager.validateRefreshToken(refreshTokenId);

    if (!validation.valid) {
      // Clear invalid refresh token cookie
      res.clearCookie('refreshToken');
      return res.status(401).json({
        success: false,
        error: `Invalid refresh token: ${validation.reason}`
      });
    }

    // Generate new access token from refresh token data
    const tokenResult = await tokenManager.generateTokenPair({
      type: validation.payload.type,
      roomId: validation.payload.roomId,
      userId: validation.payload.userId,
      permissions: tokenManager._getDefaultPermissions(validation.payload.type)
    });

    // Set new refresh token in HttpOnly cookie (rotate refresh token)
    res.cookie('refreshToken', tokenResult.tokenId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Revoke old refresh token after rotation
    await tokenManager.revokeToken(refreshTokenId, 'rotated');

    // Return new access token in response body
    res.json({
      success: true,
      accessToken: tokenResult.accessToken,
      expiresIn: tokenResult.expiresIn
    });
  } catch (error) {
    console.error('[API] Token refresh error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
});

// Get session info for auto-rejoin (returns roomId if user has valid token)
app.get('/api/session/room', async (req, res) => {
  // Try to get token from Authorization header first
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  // Fallback to jwt cookie for backward compatibility
  if (!token && req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (token) {
    // Validate token is still valid
    const validation = await tokenManager.validateAccessToken(token);
    if (validation.valid) {
      // Only return hasRoom for actual room tokens, not admin tokens
      const hasRealRoom = validation.payload.roomId &&
                          validation.payload.roomId !== 'admin' &&
                          validation.payload.type !== 'admin_token';
      res.json({
        success: true,
        hasRoom: hasRealRoom,
        roomId: hasRealRoom ? validation.payload.roomId : null
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
// Auth API Routes (general user authentication)
// =============================================================================

// User login - authenticate user and return JWT token
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('[API] Login attempt received:', req.body?.username);

    const { username, password } = req.body;

    if (!username || !password) {
      console.log('[API] Login rejected: missing username or password');
      return res.status(400).json({
        success: false,
        error: 'Username and password required'
      });
    }

    // Authenticate user credentials
    console.log('[API] Authenticating user:', username);
    const authResult = await userManager.authenticateUser(username, password);

    if (!authResult.success) {
      console.log('[API] Authentication failed for user:', username);
      return res.status(401).json({
        success: false,
        error: authResult.error || 'Invalid credentials'
      });
    }

    console.log('[API] User authenticated successfully:', username, 'role:', authResult.user.role);

    // Determine token type based on user role
    const tokenType = authResult.user.role === 'admin' ? 'admin_token' : 'room_access';

    // Generate JWT token pair
    console.log('[API] Generating token pair for user:', username);
    const tokenResult = await tokenManager.generateTokenPair({
      type: tokenType,
      roomId: 'admin',
      userId: authResult.user.id,
      permissions: authResult.user.role === 'admin'
        ? ['*', 'room:create', 'room:delete', 'room:update', 'user:assign_role']
        : ['room:view', 'stream:publish', 'chat:send']
    });

    console.log('[API] Token generated successfully for user:', username);

    // Set refresh token in HttpOnly cookie (not access token)
    res.cookie('refreshToken', tokenResult.tokenId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    console.log('[API] Sending login response for user:', username);

    // Return access token in response body (client stores in memory)
    return res.json({
      success: true,
      user: {
        id: authResult.user.id,
        username: authResult.user.username,
        role: authResult.user.role,
        displayName: authResult.user.displayName
      },
      accessToken: tokenResult.accessToken,
      expiresIn: tokenResult.expiresIn
    });
  } catch (error) {
    console.error('[API] Login error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: 'Login failed: ' + error.message
    });
  }
});

// User logout - clear refresh token cookie and revoke token
app.post('/api/auth/logout', async (req, res) => {
  const tokenId = req.cookies?.refreshToken;
  if (tokenId) {
    // Revoke the refresh token in database/redis
    await tokenManager.revokeRefreshToken(tokenId);
    res.clearCookie('refreshToken');
  }
  res.json({ success: true });
});

// Get current user info
app.get('/api/auth/me', requireAuth(), (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      displayName: req.user.displayName,
      permissions: req.user.permissions
    }
  });
});

// =============================================================================
// Admin API Routes
// =============================================================================

// Admin login - authenticate user and return JWT token
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password required'
      });
    }

    // Authenticate user credentials
    const authResult = await userManager.authenticateUser(username, password);

    if (!authResult.success) {
      return res.status(401).json({
        success: false,
        error: authResult.error || 'Invalid credentials'
      });
    }

    // Get permissions from user's role via RBAC
    const rolePermissions = await rbacManager.getAllPermissions(authResult.user.role);
    const permissions = rolePermissions.map(p => p.permission);

    // Generate JWT token pair
    const tokenResult = await tokenManager.generateTokenPair({
      type: 'admin_token',
      roomId: 'admin',
      userId: authResult.user.id,
      permissions
    });

    // Set JWT in HttpOnly cookie
    res.cookie('jwt', tokenResult.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: tokenResult.expiresIn * 1000
    });

    res.json({
      success: true,
      user: {
        id: authResult.user.id,
        username: authResult.user.username,
        role: authResult.user.role,
        displayName: authResult.user.displayName
      },
      tokenId: tokenResult.tokenId,
      expiresIn: tokenResult.expiresIn
    });
  } catch (error) {
    console.error('[API] Login error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Admin logout - clear JWT cookie
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('jwt');
  res.json({ success: true });
});

// Get current admin status
app.get('/api/admin/me', requireAuth(), (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      displayName: req.user.displayName,
      permissions: req.user.permissions
    }
  });
});

// List all rooms (admin with room:view_all permission)
app.get('/api/admin/rooms', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:view_all') ||
                  await rbacManager.hasPermission(req.user.role, '*', 'room');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
  const rooms = roomManager.getAllRooms();
  res.json({ success: true, rooms });
});

// Get room participants (admin only)
app.get('/api/admin/rooms/:roomId/participants', requireAuth(), (req, res) => {
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

// Create room (admin with room:create permission)
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

// Delete room (admin with room:delete permission)
app.delete('/api/admin/rooms/:roomId', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:delete');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
  const deleted = roomManager.deleteRoom(req.params.roomId);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }
  res.json({ success: true });
});

// Update room settings (admin with room:update permission)
app.put('/api/admin/rooms/:roomId/settings', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'room:update');
  if (!hasPerm) {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }
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
 * Generate token
 */
app.post('/api/tokens', requireAuth(), async (req, res) => {
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

    // Generate token using TokenManager
    const tokenResult = await tokenManager.generateTokenPair({
      type,
      roomId,
      userId: req.user.id,
      permissions: options.permissions || []
    });

    // Build shareable URL (using new HTML5 History API format, not hash)
    const baseUrl = getTokenBaseUrl(type, roomId);
    const fullUrl = `${req.protocol}://${req.get('host')}${baseUrl}?token=${tokenResult.accessToken}`;

    // Generate QR code if requested
    let qrCode = null;
    if (req.body.includeQrCode) {
      const QRCode = require('qrcode');
      qrCode = await QRCode.toDataURL(fullUrl);
    }

    res.json({
      success: true,
      tokenId: tokenResult.tokenId,
      accessToken: tokenResult.accessToken,
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
app.delete('/api/tokens/:tokenId', requireAuth(), (req, res) => {
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
app.get('/api/admin/rooms/:roomId/tokens', requireAuth(), (req, res) => {
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

// Global error handler - must be after all routes
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message, err.stack);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

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

// Initialize database, RBAC, and user management
const db = new Database();
let authMiddleware = null;
let userManager = null;
let tokenManager = null;
let rbacManager = null;
let redisClient = null;
let olaManager = null;

// Parse token from cookie for WebSocket connections
const parseTokenFromCookie = (cookie) => {
  if (!cookie) return null;

  // Extract jwt from cookie string
  const match = cookie.match(/jwt=([^;]+)/);
  if (!match) return null;

  // URL decode the token
  return decodeURIComponent(match[1]);
};

// Parse token from WebSocket URL query parameters
const parseTokenFromUrl = (url) => {
  if (!url) return null;
  try {
    const urlObj = new URL(url, 'http://localhost');
    const token = urlObj.searchParams.get('token');
    return token || null;
  } catch {
    return null;
  }
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

  // Parse token from cookie (backward compat) or URL query param
  const cookie = req.headers.cookie;
  const cookieToken = parseTokenFromCookie(cookie);
  const urlToken = parseTokenFromUrl(req.url);
  const token = urlToken || cookieToken;

  console.log(`[WebSocket] New connection from ${origin || 'unknown origin'}${token ? ' (has token)' : ' (no token)'}`);

  signalingHandler.handleConnection(ws, token);

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
async function startServer() {
  try {
    // Initialize database
    await db.initialize();

    // Load seed data (roles and permissions)
    const seedFilePath = path.join(__dirname, '../database/seed/001-roles-permissions.sql');
    await db.loadSeedData(seedFilePath);

    // Initialize Redis Client FIRST (required by other managers)
    redisClient = new RedisClient();
    await redisClient.connect();

    // Initialize RBAC Manager
    rbacManager = new RBACManager(db, redisClient);
    await rbacManager.initialize();

    // Initialize UserManager
    userManager = new UserManager(db, rbacManager, redisClient);
    await userManager.initialize();

    // Initialize TokenManager
    tokenManager = new TokenManager(redisClient, db);
    await tokenManager.initialize();

    // Initialize AuthMiddleware with dependencies
    authMiddleware = new AuthMiddleware(db, rbacManager, tokenManager);

    // Initialize OLAManager
    olaManager = new OLAManager(db, rbacManager);
    await olaManager.initialize();

    // Make managers available to routes via app.locals
    app.locals.rbacManager = rbacManager;
    app.locals.userManager = userManager;
    app.locals.tokenManager = tokenManager;

    // Mount user routes with auth middleware
    app.use('/api/user', requireAuth(), createUserRouter(olaManager, roomManager));

    // Mount monitoring routes with auth middleware
    app.use('/api/monitoring', requireAuth(), createMonitoringRouter(roomManager));

    // Run bootstrap to create super admin if needed
    await bootstrap();

    console.log('[Server] All managers initialized');

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
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    console.log('[Server] Closed out remaining connections');

    // Close database pool
    if (db) {
      await db.shutdown();
    }

    // Close Redis connection
    if (redisClient) {
      await redisClient.disconnect();
    }

    console.log('[Server] Database and Redis connections closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

module.exports = { app, server, wss };
