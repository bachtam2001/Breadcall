# BreadCall - WebRTC Live Production Platform

Professional WebRTC platform for live production with split streams and MediaMTX integration.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or start production server
npm start

# Run tests
npm test

# Start with Docker (production)
docker-compose up -d
```

## Features

### Core Platform
- **Signaling Server** - Express + WebSocket server with room management
- **Web Frontend** - Dark theme with glassmorphism design, responsive video grid
- **Solo View** - Full-screen single stream view for OBS Browser Source
- **Director Dashboard** - Multi-participant monitoring with remote controls

### Phase 6: MediaMTX Integration (Latest)
- **WHIP Publishing** - Standard WebRTC publishing via `/whip/{streamName}`
- **WHEP Playback** - Standard WebRTC playback via `/whep/{streamName}`
- **Iframe Embed** - MediaMTX embedded player via `/view/{streamName}`
- **MediaMTX SFU** - Single binary WebRTC media server (port 8887)

### Phase 7: SRT Input Feed
- **SRT Publishing** - Push external video sources (OBS, vMix) via SRT protocol
- **Auto WebRTC Delivery** - MediaMTX transcodes SRT to WebRTC automatically
- **Token-Secured URLs** - 256-bit secrets with webhook authentication
- **Real-time Status** - Directors see SRT feed status in dashboard

### Additional Features
- **Recording** - Local recording with MediaRecorder API
- **Audio Mixer** - Multi-source mixing with EQ and compressor
- **File Transfer** - P2P file transfer via DataChannel
- **Tally Light** - On-air/preview indicators
- **Video Effects** - Filters, LUT, chroma key
- **Scene Composer** - Multi-stream layout composer
- **Remote Control API** - HTTP/WS API for automation

## SRT Input Feed

BreadCall supports SRT (Secure Reliable Transport) input feeds for professional video sources.

### Using SRT

1. Create a room via the admin dashboard
2. Copy the SRT URL from the room creation response (`srtPublishUrl`)
3. Configure OBS/vMix to push to the SRT URL:
   - Protocol: SRT
   - Address: `srt://your-server:8890?streamid=publish:room/ROOMID/SECRET`
   - Video Codec: H264 (recommended)
   - Audio Codec: AAC or Opus

### Example OBS Configuration

1. Go to Settings > Stream
2. Service: Custom
3. Server: `srt://your-server:8890`
4. Stream Key: `publish:room/ROOMID/SECRET`

All participants in the room will automatically receive the SRT feed via WebRTC at the `/whep/room/ROOMID` endpoint.

### Security

- Each room has a unique 32-character hex secret (256-bit entropy)
- MediaMTX validates secrets via webhook to the signaling server
- Rate limiting: 10 auth requests per minute per IP
- All auth attempts are logged for audit

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/srt/auth` | POST | MediaMTX webhook for SRT authentication |
| `/api/srt/stream-event` | POST | Stream start/end notifications |
| `/api/rooms/:roomId/srt-status` | GET | Get SRT feed status |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Browser       │     │   NGINX         │     │   MediaMTX      │
│   (WebRTC)      │────▶│   (Proxy :80)   │────▶│   (SFU :8887)   │
│                 │     │                 │     │                 │
│   - WHIP Pub    │     │   /whip/*       │     │   WHIP/WHEP     │
│   - WHEP Play   │     │   /whep/*       │     │   Endpoints     │
│   - Iframe View │     │   /view/*       │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Signaling     │
                        │   Server :3000  │
                        │                 │
                        │   - Room Mgmt   │
                        │   - WebSocket   │
                        └─────────────────┘
```

## URLs

| View | URL | Description |
|------|-----|-------------|
| **Landing** | `/` | Home page |
| **Room** | `/room/:roomId` | Join a room |
| **Solo View** | `/view/:roomId/:streamId` | Single stream view |
| **Director** | `/director/:roomId` | Director dashboard |
| **Admin** | `/admin` | Admin dashboard (room management, tokens) |
| **MediaMTX Embed** | `/view/:streamName/` | Iframe player (MediaMTX) |

## API Endpoints

### Signaling Server

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms` | POST | Create a new room |
| `/api/rooms/:roomId` | GET | Get room info |
| `/api/rooms/:roomId/participants` | GET | List participants |
| `/health` | GET | Health check |
| `/api/webrtc-config` | GET | Get WebRTC/MediaMTX config |

### MediaMTX (via proxy)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/whip/:streamName` | POST | Publish stream (WHIP) |
| `/whep/:streamName` | POST | Play stream (WHEP) |
| `/view/:streamName/` | GET | Iframe embed player |

### WebSocket Messages

- `join-room` - Join a room
- `leave-room` - Leave a room
- `offer` - WebRTC offer
- `answer` - WebRTC answer
- `ice-candidate` - ICE candidate
- `chat-message` - Chat message
- `mute-status` - Mute/video status update

## Docker Deployment

### Services

| Service | Port | Description |
|---------|------|-------------|
| Web (nginx) | 80 | Static frontend + proxy |
| Signaling | 3000 | WebSocket + REST API |
| MediaMTX | 8887 | WHIP/WHEP media server |
| Coturn | 3478 | TURN/STUN server |

### Configuration

1. Copy `.env.example` to `.env`
2. Update `TURN_SECRET` and `EXTERNAL_IP` for production
3. Start services:

```bash
docker-compose up -d
```

### Verification

```bash
# Check MediaMTX is running
curl http://localhost:8887

# Check WebRTC config endpoint
curl http://localhost/api/webrtc-config

# Test WHIP endpoint
curl -X POST http://localhost/whip/test-stream \
  -H "Content-Type: application/sdp" \
  --data-binary @offer.sdp
```

## Project Structure

```
breadcall/
├── client/
│   ├── index.html
│   ├── css/
│   │   └── index.css
│   ├── js/
│   │   ├── app.js
│   │   ├── SignalingClient.js
│   │   ├── WebRTCManager.js
│   │   ├── MediaManager.js
│   │   ├── UIManager.js
│   │   ├── SoloView.js
│   │   ├── DirectorView.js
│   │   ├── WHIPClient.js
│   │   ├── WHEPClient.js
│   │   └── ...
│   └── __tests__/
├── server/
│   ├── src/
│   │   ├── index.js
│   │   ├── RoomManager.js
│   │   ├── SignalingHandler.js
│   │   └── RemoteControlAPI.js
│   └── __tests__/
├── docker/
│   ├── nginx/
│   │   └── nginx.conf
│   ├── mediamtx/
│   │   └── mediamtx.yml
│   └── coturn/
├── srt-gateway/
├── mobile/
├── docker-compose.yml
├── package.json
└── README.md
```

## Development

### Run Tests

```bash
# All tests
npm test

# Specific test file
npm test -- WHEPClient
npm test -- MediaManager
npm test -- UIManager
```

### Code Style

- ESLint configured for project
- Prettier for formatting
- Husky pre-commit hooks

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ | Core WebRTC Platform |
| Phase 2 | ✅ | Docker Infrastructure |
| Phase 3 | ✅ | MediaMTX Integration (WHIP/WHEP) |

## Troubleshooting

**WebRTC connection fails:**
- Check TURN servers are configured
- Verify firewall allows UDP ports
- Check browser WebRTC support

**MediaMTX not accessible:**
- Verify port 8887 is open
- Check nginx proxy configuration
- Review MediaMTX logs: `docker logs breadcall-mediamtx-1`

**WHIP publish fails:**
- Ensure SDP offer is valid
- Check Content-Type header is `application/sdp`
- Verify stream name doesn't conflict

**WHEP playback fails:**
- Check stream exists (must be published first)
- Verify codec compatibility (H265/opus)
- Check browser supports H265

## License

ISC
