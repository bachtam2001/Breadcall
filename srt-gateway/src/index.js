const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const { WebRTCReceiver } = require('./WebRTCReceiver');
const { SRTOutput } = require('./SRTOutput');
const { GatewayAPI } = require('./GatewayAPI');

const PORT = process.env.PORT || 8080;
const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:3000/ws';
const SRT_PORT_RANGE = process.env.SRT_PORT_RANGE || '9000-9100';

const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize components
const webrtcReceiver = new WebRTCReceiver();
const srtOutput = new SRTOutput(SRT_PORT_RANGE);
const gatewayAPI = new GatewayAPI(webrtcReceiver, srtOutput);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'srt-gateway',
    timestamp: new Date().toISOString(),
    webrtc: webrtcReceiver.isConnected(),
    srt: srtOutput.getActiveOutputs()
  });
});

// Gateway API routes
app.post('/api/connect/:roomId', gatewayAPI.connect.bind(gatewayAPI));
app.post('/api/disconnect', gatewayAPI.disconnect.bind(gatewayAPI));
app.post('/api/srt/:streamId/start', gatewayAPI.startSRT.bind(gatewayAPI));
app.delete('/api/srt/:streamId/stop', gatewayAPI.stopSRT.bind(gatewayAPI));
app.get('/api/srt/status', gatewayAPI.getStatus.bind(gatewayAPI));
app.get('/api/streams', gatewayAPI.getStreams.bind(gatewayAPI));

// Start server
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║           BreadCall SRT Gateway                        ║
╠════════════════════════════════════════════════════════╣
║  HTTP API:   http://localhost:${PORT}                     ║
║  SRT Ports:  ${SRT_PORT_RANGE}/udp                       ║
║  Signaling:  ${SIGNALING_URL}                              ║
╚════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SRT Gateway] SIGTERM received, shutting down...');
  webrtcReceiver.disconnect();
  srtOutput.cleanup();
  server.close(() => {
    console.log('[SRT Gateway] Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, webrtcReceiver, srtOutput };
