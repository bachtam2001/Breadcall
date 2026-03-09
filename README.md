# BreadCall - WebRTC Live Production Platform

Professional WebRTC platform for live production with split streams, NDI/SRT output support, and mobile connectivity.

## Phase 1: Core WebRTC Platform

This implementation includes the complete Phase 1 foundation:

### Features Implemented

- **Signaling Server** (`server/`)
  - Express + WebSocket server
  - Room management with password protection
  - Participant lifecycle management
  - Heartbeat/ping-pong for connection health
  - REST API for room creation and management

- **Web Frontend** (`client/`)
  - Dark theme with glassmorphism design
  - Responsive video grid layout
  - Real-time audio/video controls
  - Screen sharing support
  - Chat functionality
  - Settings modal for device selection
  - Toast notifications

- **Solo View** (for OBS Browser Source)
  - Full-screen single stream view
  - URL parameters for quality control
  - Transparent background option
  - Auto-reconnect

- **Director Dashboard**
  - Multi-participant monitoring
  - Solo view link copying
  - Remote mute/kick controls
  - Real-time stats display

### Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or start production server
npm start

# Run tests
npm test
```

### API Endpoints

- `POST /api/rooms` - Create a new room
- `GET /api/rooms/:roomId` - Get room info
- `GET /api/rooms/:roomId/participants` - List participants
- `GET /health` - Health check

### WebSocket Messages

- `join-room` - Join a room
- `leave-room` - Leave a room
- `offer` - WebRTC offer
- `answer` - WebRTC answer
- `ice-candidate` - ICE candidate
- `chat-message` - Chat message
- `mute-status` - Mute/video status update

### URLs

- **Landing**: `http://localhost:3000`
- **Room**: `http://localhost:3000/#/room/:roomId`
- **Solo View**: `http://localhost:3000/#/view/:roomId/:streamId`
- **Director**: `http://localhost:3000/#/director/:roomId`

### Test

```bash
# Run unit tests
npm test

# Test room creation
curl -X POST http://localhost:3000/api/rooms -H "Content-Type: application/json"

# Check health
curl http://localhost:3000/health
```

## Project Structure

```
breadcall/
├── client/
│   ├── index.html
│   ├── css/
│   │   └── index.css
│   └── js/
│       ├── app.js
│       ├── SignalingClient.js
│       ├── WebRTCManager.js
│       ├── MediaManager.js
│       ├── UIManager.js
│       ├── SoloView.js
│       ├── DirectorView.js
│       └── IframeAPI.js
├── server/
│   ├── src/
│   │   ├── index.js
│   │   ├── RoomManager.js
│   │   └── SignalingHandler.js
│   └── __tests__/
│       ├── RoomManager.test.js
│       └── SignalingHandler.test.js
├── docs/
├── package.json
├── .env.example
└── README.md
```

## Next Phases

- **Phase 2**: Docker Infrastructure (coturn deployment) ✅
- **Phase 3**: NDI Desktop Client ✅
- **Phase 4**: SRT Gateway ✅
- **Phase 5**: Mobile App (React Native) ✅
- **Phase 6**: Advanced Features (WHIP/WHEP, recording, etc.)

## Phase 2: Docker Deployment

### Quick Start with Docker

```bash
# Start all services (signaling + coturn + nginx)
make dev

# Or using docker compose directly
docker compose up --build -d

# View logs
make logs

# Stop services
make stop

# Clean everything
make clean
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| Web (nginx) | 80 | Static frontend |
| Signaling | 3000 | WebSocket + REST API |
| Coturn | 3478 | TURN/STUN server |

### Configuration

1. Copy `.env.example` to `.env`
2. Update `TURN_SECRET` and `EXTERNAL_IP` for production
3. Generate SSL certificates (optional):
   ```bash
   make certs
   ```

### Scaling

```bash
# Scale coturn to 3 replicas
make scale REPLICAS=3

# Production deployment with distributed config
docker compose -f docker-compose.yml -f docker-compose.distributed.yml up -d
```

### Project Structure

```
breadcall/
├── client/              # Web frontend
├── server/              # Signaling server
├── docker/
│   ├── coturn/          # TURN server config
│   └── nginx/           # Nginx config
├── docker-compose.yml
├── docker-compose.distributed.yml
├── Dockerfile.signaling
├── Makefile
└── ...
```

## License

ISC

## Phase 4: SRT Gateway

Server-side component that receives WebRTC streams from BreadCall and outputs them as SRT (Secure Reliable Transport) streams for professional broadcasting.

### Quick Start

```bash
cd srt-gateway

# Install dependencies
npm install

# Start the gateway
npm start

# Or run with Docker
npm run docker:build
npm run docker:run
```

### Features

- **WebRTC Receiver**: Connect to BreadCall signaling server and receive participant streams
- **SRT Output**: Output streams as SRT sources for OBS, vMix, and professional encoders
- **REST API**: Control SRT output lifecycle via HTTP endpoints
- **FFmpeg Pipeline**: H.264 encoding with low-latency SRT transmission

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/connect/:roomId` | POST | Connect to a BreadCall room |
| `/api/disconnect` | POST | Disconnect from current room |
| `/api/srt/:streamId/start` | POST | Start SRT output for a stream |
| `/api/srt/:streamId/stop` | DELETE | Stop SRT output |
| `/api/srt/status` | GET | Get status of all SRT outputs |
| `/api/streams` | GET | List available WebRTC streams |
| `/health` | GET | Health check endpoint |

### Usage Examples

```bash
# 1. Connect to a BreadCall room
curl -X POST http://localhost:8080/api/connect/ABCD \
  -H "Content-Type: application/json" \
  -d '{"signalingUrl": "ws://localhost:3000/ws"}'

# 2. Start SRT output to an encoder
curl -X POST http://localhost:8080/api/srt/stream1/start \
  -H "Content-Type: application/json" \
  -d '{"srtUrl": "srt://encoder.example.com:9999", "peerId": "participant-123"}'

# 3. Check status
curl http://localhost:8080/api/srt/status

# 4. Stop SRT output
curl -X DELETE http://localhost:8080/api/srt/stream1/stop
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | HTTP API port |
| `SIGNALING_URL` | ws://localhost:3000/ws | BreadCall WebSocket URL |
| `SRT_PORT_RANGE` | 9000-9100 | UDP port range for SRT listeners |

### Docker Deployment

```bash
# Build the image
docker build -t breadcall-srt-gateway srt-gateway/

# Run with required ports
docker run -p 8080:8080 -p 9000-9100:9000-9100/udp \
  -e SIGNALING_URL=ws://your-server:3000/ws \
  breadcall-srt-gateway
```

### SRT URL Format

- **Caller mode** (push to encoder): `srt://host:port?mode=caller&latency=1000000`
- **Listener mode** (receive from encoder): `srt://0.0.0.0:port?mode=listener`
- **Rendezvous mode**: `srt://host:port?mode=rendezvous`

### Project Structure

```
srt-gateway/
├── src/
│   ├── index.js              # Express server + REST API
│   ├── WebRTCReceiver.js     # WebRTC stream receiver
│   ├── SRTOutput.js          # FFmpeg-based SRT encoder
│   └── GatewayAPI.js         # API route handlers
├── Dockerfile                # Container with FFmpeg + libsrt
└── package.json
```

### Troubleshooting

**FFmpeg not found:**
```
Error: spawn ffmpeg ENOENT
```
**Solution**: Install FFmpeg with SRT support: `apt-get install ffmpeg libsrt-openssl-dev`

**No available ports:**
```
[SRTOutput] No available ports
```
**Solution**: Increase `SRT_PORT_RANGE` or stop unused SRT outputs.

**WebRTC connection fails:**
- Check `SIGNALING_URL` is accessible
- Configure STUN/TURN servers if behind NAT
- Ensure WebSocket port (3000) is open

## Phase 5: Mobile App (React Native)

Cross-platform mobile application for iOS and Android with screen sharing and system audio capture.

### Quick Start

```bash
cd mobile

# Install dependencies
npm install

# iOS only
cd ios && pod install && cd ..

# Run on Android
npm run android

# Run on iOS
npm run ios
```

### Features

- **WebRTC Video Calls**: Join rooms and participate in video calls
- **Screen Sharing**: Share screen with system audio (Android 10+, iOS 14+)
- **Multi-Participant**: Mesh topology P2P connections
- **Auto-Reconnect**: Automatic reconnection to signaling server
- **Dark Theme**: Modern dark theme UI

### Requirements

| Platform | Minimum Version | Notes |
|----------|-----------------|-------|
| Android | 5.0 (API 21) | Screen share requires Android 10+ for system audio |
| iOS | 13.0 | ReplayKit broadcast requires iOS 11+ |

### Project Structure

```
mobile/
├── src/
│   ├── App.js                    # Main app with navigation
│   ├── services/
│   │   ├── SignalingService.js   # WebSocket client
│   │   ├── WebRTCService.js      # WebRTC PeerConnection manager
│   │   └── ScreenShareService.js # Screen capture service
│   └── screens/
│       ├── HomeScreen.js         # Create/join room
│       └── RoomScreen.js         # Video grid and controls
├── android/
│   └── app/src/main/java/com/breadcall/
│       ├── ScreenCaptureModule.java
│       ├── ScreenCaptureService.java
│       └── BreadCallPackage.java
├── ios/
│   ├── BreadCall/
│   │   └── ScreenCaptureModule.m
│   └── BroadcastUploadExtension/
│       ├── SampleHandler.swift
│       ├── SocketConnection.swift
│       └── SampleUploader.swift
└── package.json
```

### Screen Sharing

**Android (10+):**
- Uses `MediaProjection` API for screen capture
- Uses `AudioPlaybackCapture` API for system audio
- Requires foreground service

**iOS (14+):**
- Uses `ReplayKit` Broadcast Upload Extension
- Requires App Group configuration
- Frame forwarding via socket connection

### Configuration

Edit `mobile/.env` for your signaling server:

```
SIGNALING_URL=ws://your-server:3000/ws
```

### Building Release

```bash
# Android APK
npm run build:android

# iOS Archive
npm run build:ios
```

### Troubleshooting

**Screen capture permission denied (Android):**
- User must grant permission each time
- Ensure foreground service is running

**Broadcast extension not appearing (iOS):**
- Verify App Group is configured
- Check Bundle Identifier matches

**WebRTC connection fails:**
- Configure TURN servers for mobile networks
- Check firewall settings for mobile data

