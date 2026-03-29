# Onboarding Guide: BreadCall

## Overview

BreadCall is a WebRTC live production platform for broadcast-quality video streaming. It enables multiple participants to join rooms, publish streams via WHIP, and consume streams via WHEP. The platform includes role-based access control (admin, director, operator, moderator, viewer) with specialized dashboards for each role.

**Key Use Cases:**
- Live multi-camera productions with director controls
- Remote guest interviews with low-latency WebRTC
- Split-stream workflows (separate audio/video tracks)
- Operator monitoring and moderation

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Language | JavaScript (Node.js 20) | Server runtime |
| Framework | Express.js 5 | HTTP API |
| WebSocket | ws library | Real-time signaling |
| Database | PostgreSQL 17 | Persistent storage |
| Cache | Redis 7 | Token revocation, session cache |
| Media Server | MediaMTX | WHIP/WHEP SFU for WebRTC |
| Frontend | Vanilla JS (ES6+) | No framework, bundled with esbuild |
| Testing | Jest + Playwright | Unit and E2E tests |
| Auth | JWT + bcrypt | Token-based authentication |
| CSRF | csrf-csrf | Double-submit cookie pattern |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Client Browser                           │
└──────────────────────────────────────────────────────────────────────────┘
         │                              │
         │ HTTP/API                     │ WebRTC
         │                              │
         ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              Nginx (Port 80)                     │
│  ────────────────────────────────────────────────────────────────────  │
└──────────────────────────────────────────────────────────────────────────┘
         │                              │
         │                              │
    HTTP/API                     WHIP/WHEP
         │                              │
         ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Signaling Server (Port 3000)    │    MediaMTX (Port 8887)           │
│  ───────────────────────────────────  │    ────────────────────────────────  │
│  - Express HTTP API             │    - WHIP (WebRTC Ingest)         │
│  - WebSocket signaling          │    - WHEP (WebRTC Egress)         │
│  - JWT auth + CSRF protection   │    - SRT streaming                │
│  - Room management              │    - ICE/WebRTC handling          │
└──────────────────────────────────────────────────────────────────────────┘
         │
         │ SQL queries
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              PostgreSQL + Redis (Data Layer)                       │
└──────────────────────────────────────────────────────────────────────────┘
```

## Directory Map

| Directory | Purpose |
|-----------|---------|
| `server/src/` | Express server, WebSocket handling, business logic |
| `server/src/routes/` | API route handlers (user, monitoring, mediamtx, srt) |
| `server/database/migrations/` | SQL schema migrations |
| `server/database/seed/` | Initial roles/permissions data |
| `client/js/` | Browser-side JavaScript modules |
| `client/css/` | Stylesheets |
| `public/` | Static HTML entry points (served by nginx) |
| `docker/` | Container configurations (nginx, mediamtx) |

## Request Lifecycle

**Example: User Joins Room**

1. **Browser** → `POST /api/join-room` (with roomId, password)
   - Express route handler validates input
   - CSRF protection check

2. **TokenManager** generates JWT access token (15min) + refresh token (24h)
   - Stored in HttpOnly cookies
   - Refresh token persisted to PostgreSQL

3. **RoomManager** adds participant to room
   - Updates in-memory room state
   - Returns list of existing peers

4. **Browser** → `WS /ws` WebSocket connection
   - Sends `join-room` message with token
   - SignalingHandler validates and adds to room broadcast

5. **WebRTC Setup** (client-side)
   - getUserMedia() captures camera/mic
   - WHIPClient publishes to MediaMTX via `POST /whip/{streamName}`
   - Other peers consume via WHEP endpoint

## Key Entry Points

- **Server startup**: `server/src/index.js` → `startServer()`
- **Client startup**: `client/js/app.js` → `App.init()`
- **Build process**: `build.js` (esbuild bundler)
- **Tests**: `jest.config.js` (multi-project: server + client)
- **Docker compose**: `docker-compose.yml` (prod), `docker-compose.dev.yml` (dev)

## Conventions

**File Naming:**
- Classes: `PascalCase.js` (e.g., `RoomManager.js`)
- Utils: `camelCase.js` (e.g., `build.js`)
- Tests: `__tests__/*.test.js`

**Code Patterns:**
- Classes for stateful modules (RoomManager, TokenManager)
- Plain functions for utilities
- Error handling: `{ success: false, error: 'message' }` for API responses

**Async:**
- Prefer `async/await` over callbacks
- WebSocket messages use Promise-based request/response

## Common Tasks

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` (nodemon auto-reload) |
| Production | `npm start` |
| Run tests | `npm test` (Jest with coverage) |
| E2E tests | `npm run test:e2e` (Playwright, requires Docker) |
| Build frontend | `npm run build` (production bundle) |
| Build dev | `npm run build:dev` (unbundled) |
| Docker prod | `docker-compose up -d` |
| Docker dev | `docker compose -f docker-compose.dev.yml up -d --build` |

## Where to Look

| I want to... | Look at... |
|--------------|------------|
| Add API endpoint | `server/src/index.js` (route definitions), `server/src/routes/` |
| Change auth logic | `server/src/AuthMiddleware.js`, `server/src/TokenManager.js` |
| Modify room behavior | `server/src/RoomManager.js`, `docs/ROOM_OWNERSHIP.md` |
| Add WebSocket message | `server/src/SignalingHandler.js` |
| Change UI component | `client/js/` (e.g., `UIManager.js` for video grid) |
| Add client feature | `client/js/app.js` (routing), create new module |
| Modify database schema | `server/database/migrations/` |
| Change access control | `server/src/RBACManager.js`, `server/database/seed/001-roles-permissions.sql` |
| Configure nginx | `docker/nginx/nginx.conf` |
| Configure MediaMTX | `docker/mediamtx/mediamtx.yml` |

## Dashboards

| Dashboard | Purpose | Location |
|-----------|---------|----------|
| Admin | Room management, user management, token generation | `/admin`, `client/js/AdminDashboard.js` |
| Director | Room participant controls (mute, kick, spotlight) | `/director/:roomId`, `client/js/DirectorView.js` |
| Operator | System-wide monitoring, all rooms overview | `/monitoring`, `client/js/OperatorDashboard.js` |
| Login | Authentication with role-based redirects | `/login`, `client/js/LoginPage.js` |

## Roles & Permissions

| Role | Hierarchy | Capabilities |
|------|-----------|--------------|
| admin | 100 | Full system access, user management, all rooms |
| director | 80 | Room management (owned rooms), participant controls |
| operator | 60 | System monitoring, view all rooms |
| moderator | 40 | Moderate assigned rooms |
| viewer | 20 | View only, no controls |

## Room Ownership

Directors own the rooms they create. This affects room management permissions:

| Action | Director | Admin |
|--------|----------|-------|
| Create room | ✓ (becomes owner) | ✓ |
| View rooms | Own rooms only | All rooms |
| Delete room | Own rooms only | All rooms |
| Update settings | Own rooms only | All rooms |
| Manage participants | Own rooms only | All rooms |

See `docs/ROOM_OWNERSHIP.md` for details on the ownership model and API.

## Environment Setup

1. Copy `.env.example` to `.env`
2. Set required secrets (`TOKEN_SECRET`, `CSRF_SECRET`, `TURN_SECRET`)
3. Configure `DATABASE_URL` for PostgreSQL
4. Configure `REDIS_URL` for Redis
5. Set `ALLOWED_ORIGINS` for CORS

## Testing Strategy

- **Unit tests**: Jest with separate projects for server (Node) and client (jsdom)
- **E2E tests**: Playwright for full browser automation
- **Mocking**: Client tests mock `SignalingClient`, `WebRTCManager`, `MediaManager`
- **Coverage**: Server files in `server/src/` (excluding `index.js`)
