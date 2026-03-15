# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BreadCall is a WebRTC live production platform with split streams and MediaMTX integration. The project consists of:

- **Signaling Server** (Node.js/Express + WebSocket) - Room management and WebRTC signaling
- **Client Frontend** (Vanilla JS) - Room UI, director dashboard, solo view
- **MediaMTX Integration** - WHIP/WHEP media server for SFU functionality

## Commands

```bash
# Install dependencies
npm install

# Start development server (auto-reload)
npm run dev

# Start production server
npm start

# Run all tests
npm test

# Run specific test file
npm test -- MediaManager
npm test -- AppCSRFRefresh

# Run E2E tests (requires Docker)
npm run test:e2e

# Build frontend bundle
npm run build

# Build for development (unbundled)
npm run build:dev
```

## Architecture

### Server (`server/src/`)

| Module | Responsibility |
|--------|----------------|
| `index.js` | Express server setup, CORS, CSRF, session, dependency initialization |
| `RoomManager.js` | Room CRUD, participant management, token generation, director coordination |
| `SignalingHandler.js` | WebSocket message handling (join-room, offer, answer, ice-candidate) |
| `TokenManager.js` | JWT access/refresh token generation, validation, rotation |
| `AuthMiddleware.js` | Express session middleware for auth |
| `RedisClient.js` | Redis connection wrapper for token revocation cache |
| `RemoteControlAPI.js` | HTTP/WS API for external automation |
| `database.js` | SQLite database for refresh token persistence |

### Client (`client/js/`)

| Module | Responsibility |
|--------|----------------|
| `app.js` | Main application class, routing, coordinator |
| `SignalingClient.js` | WebSocket wrapper for signaling messages |
| `WebRTCManager.js` | PeerConnection management, stream publishing |
| `MediaManager.js` | getUserMedia, displayMedia, track management |
| `UIManager.js` | DOM rendering, video grid, toasts |
| `WHIPClient.js` / `WHEPClient.js` | WHIP/WHEP protocol clients for MediaMTX |
| `DirectorView.js` / `SoloView.js` | Specialized view controllers |
| `AdminDashboard.js` | Admin panel for room management, participant monitoring, token generation |
| `AudioMixer.js` | Multi-source audio mixing with EQ and compressor |
| `FileTransfer.js` | P2P file transfer via DataChannel |
| `SceneComposer.js` | Multi-stream layout composer |
| `VideoEffects.js` | Video filters, LUT, chroma key |
| `TallyLight.js` | On-air/preview indicators |
| `Recorder.js` | MediaRecorder API wrapper for local recording |

### Key Flows

**Join Room:**
1. Client calls `/api/join-room` → server creates session, generates tokens
2. Access token (JWT, 15min) + refresh token (24h) stored in HttpOnly cookies
3. WebSocket connects, sends `join-room` message
4. Server adds participant to RoomManager, returns existing peers list
5. Client creates WebRTC connections, publishes stream via WHIP

**Token Refresh:**
1. Client auto-schedules refresh 1min before access token expiry
2. POST `/api/tokens/refresh` with CSRF token header
3. Server validates refresh token, rotates to new pair
4. New cookies set, client updates expiry timer

**WebRTC Publishing:**
1. Client creates PeerConnection with MediaMTX via WHIP endpoint
2. Offer sent via POST `/whip/{streamName}`, answer returned
3. ICE candidates exchanged, media published
4. Other clients consume via WHEP endpoint `/whep/{streamName}`

## Testing

**Jest Configuration** - Multi-project setup in `jest.config.js`:
- `server` project - Node environment, server tests
- `client` project - jsdom environment, client tests

**Test Files:**
- Server: `server/__tests__/*.test.js`
- Client: `client/__tests__/*.test.js`

**Key Test Patterns:**
- Client tests mock `SignalingClient`, `WebRTCManager`, `MediaManager`, `UIManager`
- Use `jest.useFakeTimers()` for timer-based tests
- For async callbacks with fake timers, use `await Promise.resolve()` ticks instead of `setTimeout`
- Server tests use `supertest` for HTTP endpoint testing

## Docker Deployment

```bash
# Start all services
docker-compose up -d

# Services: nginx (80), signaling (3000), MediaMTX (8887)
```

## Environment Variables

Required in `.env`:
- `PORT` - Signaling server port (default: 3000)
- `REDIS_URL` - Redis connection URL
- `DATABASE_PATH` - SQLite database path
- `TOKEN_SECRET` - JWT signing secret
- `CSRF_SECRET` - CSRF protection secret
- `ALLOWED_ORIGINS` - CORS origins (comma-separated)
- `TURN_SECRET` - TURN server secret
- `EXTERNAL_IP` - Public IP for TURN

## URL Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/room/:roomId` | Room view |
| `/view/:roomId/:streamId` | Solo stream view |
| `/director/:roomId` | Director dashboard |
| `/admin` | Admin dashboard (room management, tokens) |
| `/whip/:streamName` | WHIP publish endpoint |
| `/whep/:streamName` | WHEP playback endpoint |
| `/view/:streamName/` | MediaMTX iframe player |

## Key Conventions

- **CSRF Protection**: Double-submit pattern - GET `/api/csrf-token`, send via `X-CSRF-Token` header
- **Tokens**: JWT access tokens (HttpOnly cookie) + opaque refresh tokens (Redis+DB revocation)
- **Room IDs**: 4-character uppercase alphanumeric (excluding ambiguous chars)
- **Participant IDs**: UUID format
- **Stream Names**: `{roomId}_{participantId}` format
