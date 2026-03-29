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
| `database.js` | PostgreSQL database for refresh tokens, users, roles, room data |
| `RBACManager.js` | Role-based access control (admin, director, operator, moderator, viewer)
| `UserManager.js` | User CRUD, password hashing with bcrypt
| `OLAManager.js` | Operator-level access management for room assignments |
| `MediaMTXClient.js` | HTTP API client for MediaMTX media server |
| `RemoteControlAPI.js` | External automation API (HTTP/WebSocket) |

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
| `OperatorDashboard.js` | System-wide monitoring dashboard |
| `LoginPage.js` | Authentication page with role-based redirects |
| `AuthService.js` | Authentication API client (login, logout, token refresh) |
| `DirectorDashboard.js` | Director view for managing room participants |
| `DirectorView.js` | In-room director controls (mute, kick, spotlight) |
| `SoloView.js` | Single stream viewer page |
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

**Production:**
```bash
# Start all services (pulls pre-built image from GHCR)
docker-compose up -d

# Services: nginx (80), signaling (3000), MediaMTX (8887)
```

**Development:**
```bash
# Start with local build (builds from source)
docker compose -f docker-compose.dev.yml up -d --build

# Rebuild after code changes
docker compose -f docker-compose.dev.yml up -d --build signaling
```

## Environment Variables

Required in `.env`:
- `PORT` - Signaling server port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection URL (e.g., `postgres://user:pass@localhost:5432/breadcall`)
- `REDIS_URL` - Redis connection URL
- `TOKEN_SECRET` - JWT signing secret
- `CSRF_SECRET` - CSRF protection secret
- `ALLOWED_ORIGINS` - CORS origins (comma-separated)
- `TURN_SECRET` - TURN server secret
- `EXTERNAL_IP` - Public IP for TURN
- `DB_PASSWORD` - PostgreSQL password (for Docker Compose)
- `EXTERNAL_URL` - Public domain for token URL generation

## URL Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/login` | Authentication page |
| `/room/:roomId` | Room view |
| `/view/:roomId/:streamId` | Solo stream view |
| `/director` | Director dashboard (standalone) |
| `/director/:roomId` | Director view for specific room (owner or admin) |
| `/admin` | Admin dashboard (all rooms, user management, tokens) |
| `/monitoring` | Operator monitoring dashboard (system-wide view) |
| `/whip/:streamName` | WHIP publish endpoint |
| `/whep/:streamName` | WHEP playback endpoint |
| `/view/:streamName/` | MediaMTX iframe player |

## Room API

| Route | Method | Description |
|-------|--------|-------------|
| `/api/rooms` | GET | List rooms (filtered by ownership for directors) |
| `/api/rooms` | POST | Create room (sets `owner_id` to current user) |
| `/api/rooms/:id` | DELETE | Delete room (owner or admin only) |
| `/api/rooms/:id/settings` | PUT | Update settings (owner or admin only) |
| `/api/rooms/:id/participants` | GET | Get participants (owner or admin only) |

See `docs/ROOM_OWNERSHIP.md` for the full ownership model.

## Project Structure

```
/root/Breadcall/
├── server/
│   ├── src/              # Server source code
│   │   ├── index.js      # Express server entry point
│   │   ├── routes/       # API route handlers
│   │   └── *.js          # Core modules (RoomManager, TokenManager, etc.)
│   ├── database/
│   │   ├── migrations/   # SQL schema migrations
│   │   └── seed/         # Initial data (roles, permissions)
│   └── __tests__/        # Server-side Jest tests
├── client/
│   ├── js/               # Client source code
│   │   ├── app.js        # Main application entry
│   │   └── *.js          # Feature modules
│   ├── css/              # Stylesheets
│   └── __tests__/        # Client-side Jest tests
├── public/               # Static HTML files (served by nginx in production)
├── docker/
│   ├── nginx/
│   │   └── nginx.conf    # Reverse proxy configuration
│   └── mediamtx/
│       └── mediamtx.yml  # Media server configuration
└── docs/                 # Documentation
```

## Code Style & Conventions

**Naming:**
- Files: PascalCase for classes (`RoomManager.js`), camelCase for utilities
- Classes: PascalCase (`RoomManager`, `TokenManager`)
- Methods: camelCase (`joinRoom`, `generateTokens`)
- Constants: UPPER_SNAKE_CASE for true constants

**Error Handling:**
- Server: Try/catch with structured error responses `{ success: false, error: 'message' }`
- Client: Toast notifications for user-facing errors

**Async Patterns:**
- Server: `async/await` throughout
- Client: `async/await` with Promise chains for WebSocket callbacks

## Git Conventions

**Commit Style (from git log):**
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation updates
- `chore:` Maintenance tasks
- Format: `<type>: <description>` (lowercase, imperative mood)

## Key Conventions

- **CSRF Protection**: Double-submit pattern - GET `/api/csrf-token`, send via `X-CSRF-Token` header
- **Tokens**: JWT access tokens (HttpOnly cookie) + opaque refresh tokens (Redis+DB revocation)
- **Room IDs**: 4-character uppercase alphanumeric (excluding ambiguous chars)
- **Participant IDs**: UUID format
- **Stream Names**: `{roomId}_{participantId}` format

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Breadcall** (864 symbols, 2365 relationships, 71 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/Breadcall/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Breadcall/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Breadcall/clusters` | All functional areas |
| `gitnexus://repo/Breadcall/processes` | All execution flows |
| `gitnexus://repo/Breadcall/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->
