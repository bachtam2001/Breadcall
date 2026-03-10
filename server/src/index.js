const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const RoomManager = require('./RoomManager');
const SignalingHandler = require('./SignalingHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files in development
app.use(express.static(path.join(__dirname, '../../client')));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws' });

// Initialize managers
const roomManager = new RoomManager();
const signalingHandler = new SignalingHandler(roomManager, wss);

// REST API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create room
app.post('/api/rooms', async (req, res) => {
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
      createdAt: room.createdAt
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
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

// Get OME configuration for clients
app.get('/api/ome-config', (req, res) => {
  const hostIp = process.env.EXTERNAL_IP || process.env.OME_HOST_IP || 'localhost';
  const webrtcPort = process.env.OME_WEBRTC_PORT || '3333';

  res.json({
    success: true,
    omeUrl: `http://${hostIp}:${webrtcPort}`,
    appProfile: 'app', // Matching Server.xml config
  });
});

// Allowed origins for WebSocket connections
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:8080'];

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  // Validate origin
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`[WebSocket] Rejected connection from unauthorized origin: ${origin}`);
    ws.close(1008, 'Unauthorized origin');
    return;
  }

  console.log(`[WebSocket] New connection from ${origin || 'unknown origin'}`);

  signalingHandler.handleConnection(ws);

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
