# Role-Based Login Dashboard Design

**Date:** 2026-03-15
**Feature:** Unified login system with role-based dashboard routing

## Overview

A unified login page at `/login` that authenticates users and redirects them to role-appropriate dashboards. Viewer and participant roles don't need login - they continue accessing rooms directly via room links.

## Goals

- Provide a single entry point for authenticated users (admin, director, moderator, operator)
- Route users to appropriate dashboards based on their role
- Keep viewer/participant access simple (no login required)
- Reuse existing AuthService and authentication APIs

## Dependencies (Existing)

These components already exist in the codebase:

| Component | Location | Purpose |
|-----------|----------|---------|
| AuthService | `client/js/AuthService.js` | Handles login/logout, session management |
| OLAManager | `server/src/OLAManager.js` | Room assignment management (Object-Level Authorization) |
| RoomManager | `server/src/RoomManager.js` | Room data and participant tracking |
| AdminDashboard | `client/js/AdminDashboard.js` | Existing admin panel ( reused for admin roles) |
| DirectorView | `client/js/DirectorView.js` | Existing director room view |
| build.js | `build.js` | esbuild configuration for bundling |

## Data Fetching

**Director/Moderator Dashboards:**
- Call `GET /api/user/rooms` (new endpoint) - returns rooms assigned to current user
- Server uses `OLAManager.getUserRoomAssignments(userId)` to fetch assignments
- Joins with RoomManager data to get participant counts, status

**Operator Dashboard:**
- Call `GET /api/monitoring/status` (new endpoint) - returns system-wide data
- Server aggregates data from RoomManager (active rooms, participants)
- Returns: `{ activeRooms, totalParticipants, rooms: [...] }`

## Login Flow

```
User visits /login
    ↓
Enters username + password
    ↓
POST /api/auth/login
    ↓
API returns user object with role
    ↓
Redirect based on role:
    - super_admin/room_admin → /admin
    - director → /director
    - moderator → /moderator
    - operator → /monitoring
```

## Role-to-Dashboard Mapping

| Role | Destination | Description |
|------|-------------|-------------|
| super_admin | `/admin` | Full admin panel (all rooms, users, system settings) |
| room_admin | `/admin` | Admin panel (own rooms only, filtered by permissions) |
| director | `/director` | Director dashboard listing assigned rooms |
| moderator | `/moderator` | Moderator panel for assigned rooms |
| operator | `/monitoring` | System monitoring dashboard |
| participant | N/A | No login needed - direct room access |
| viewer | N/A | No login needed - direct room/stream access |

## Components

### 1. LoginPage (`/login`)

**Location:** `public/login.html` + `client/js/LoginPage.js`

**Features:**
- Clean, centered login form
- Username input field
- Password input field (masked)
- "Sign In" button with loading state
- Error message display (invalid credentials, server errors)
- Link to public room access (for viewers/participants)
- No role selector (role determined after authentication)

**Behavior:**
- On successful login, read role from response
- Redirect to appropriate dashboard URL
- Store auth state via AuthService

### 2. DirectorDashboard (`/director`)

**Location:** `public/director.html` + `client/js/DirectorDashboard.js`

**Features:**
- Protected route (requires director role)
- List of rooms where user has director assignment
- Room cards showing:
  - Room name/ID
  - Participant count
  - Stream status (live/offline)
  - "Enter Director View" button
- Navbar with:
  - User display name
  - Role badge
  - Logout button

**Navigation:**
- Click room → navigate to `/director/:roomId`
- Room director view uses existing DirectorView.js component

### 3. ModeratorDashboard (`/moderator`)

**Location:** `public/moderator.html` + `client/js/ModeratorDashboard.js`

**Features:**
- Protected route (requires moderator role)
- List of assigned rooms for moderation
- Room cards showing:
  - Room name/ID
  - Active participant count
  - Quick moderation actions
- "Enter Moderation" button per room
- Navbar with user info and logout

**Navigation:**
- Click "Enter Moderation" → navigate to `/room/:roomId` (moderator enters room with elevated permissions)
- Moderation actions (mute, kick) appear in room UI when moderator joins

**Out of Scope:** The actual in-room moderation UI (mute, kick, etc.) is handled within the room view. This dashboard only lists rooms and provides entry points.

### 4. OperatorDashboard (`/monitoring`)

**Location:** `public/monitoring.html` + `client/js/OperatorDashboard.js`

**Features:**
- Protected route (requires operator role)
- System-wide monitoring view:
  - Active rooms count
  - Total participants across all rooms
  - Stream status per room (live/offline based on MediaMTX stream state)
- Rooms list with:
  - Room ID and name
  - Participant count
  - Stream status
  - Peak viewer count
- Auto-refresh every 30 seconds
- **Future:** Activity log (room events, participant activity) - requires activity logging infrastructure
- Navbar with user info and logout

## Protected Route Pattern

**Note:** AuthService already exists at `client/js/AuthService.js` with `init()` and `getCurrentUser()` methods.

**Role Check Utility:**
```javascript
// Each dashboard defines allowed roles
const ALLOWED_ROLES = ['director']; // or ['moderator'], ['operator']

function checkAccess() {
  const user = authService.getCurrentUser();
  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    window.location.href = '/login';
    return false;
  }
  return true;
}
```

**Auth Check Pattern:**

1. **On page load:**
   - Call `authService.init()` to check session
   - If not logged in → redirect to `/login`
   - If logged in but wrong role → redirect to appropriate dashboard or show "Access Denied"

2. **Role verification:**
   ```javascript
   const user = authService.getCurrentUser();
   if (!user || !isAllowedRole(user.role)) {
     window.location.href = '/login';
     return;
   }
   ```

3. **Logout handling:**
   - Clear session via `/api/auth/logout`
   - Redirect to `/login`

## Data Model

Room-to-user assignments are stored in the `room_assignments` table (via OLAManager).

**Assignment Structure:**
```
room_assignments:
  - id: UUID
  - user_id: User UUID
  - room_id: Room ID (e.g., "ABCD")
  - assignment_role: Role in this room (director, moderator)
  - granted_by: Admin user who created assignment
  - granted_at: Timestamp
  - expires_at: Optional expiration timestamp
```

**Key Methods (via OLAManager):**
- `getUserRoomAssignments(userId)` - Returns all room assignments for a user
- `assignRoom(userId, roomId, role, grantedBy)` - Create assignment
- `removeRoomAssignment(userId, roomId)` - Remove assignment

Director and moderator dashboards query their assignments via `getUserRoomAssignments()` and join with room data from RoomManager.

## API Endpoints

### Existing (No Changes Needed)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Authenticate user, returns user object with role |
| `/api/auth/me` | GET | Get current user info |
| `/api/auth/logout` | POST | End session |

### New Endpoints Required

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/user/rooms` | GET | Required | List rooms assigned to current user (director/moderator) |
| `/api/monitoring/status` | GET | Required | System-wide monitoring data (operator) |
| `/api/monitoring/rooms` | GET | Required | Detailed room list with stats (operator) |

**Response Formats:**

`GET /api/user/rooms`:
```json
{
  "success": true,
  "rooms": [
    {
      "roomId": "ABCD",
      "name": "Production Room",
      "participantCount": 5,
      "isLive": true,
      "assignmentRole": "director"
    }
  ]
}
```

`GET /api/monitoring/status`:
```json
{
  "success": true,
  "activeRooms": 12,
  "totalParticipants": 45,
  "rooms": [
    {
      "roomId": "ABCD",
      "name": "Production Room",
      "participantCount": 5,
      "streamStatus": "live"
    }
  ]
}
```

**Error Responses:**
- `401 Unauthorized` - Not logged in
- `403 Forbidden` - Wrong role for endpoint
- `500 Server Error` - Database or server failure

## Server Implementation

**Modify `server/src/index.js`:**
- Add route handler for `GET /api/user/rooms`
  - Use `OLAManager.getUserRoomAssignments(req.user.id)` to get assignments
  - Join with RoomManager data for participant counts
  - Return filtered room list

- Add route handler for `GET /api/monitoring/status`
  - Use RoomManager to get all active rooms
  - Aggregate participant counts
  - Return system-wide stats (operator role only)

## New Files

```
public/
  login.html              # Login page entry
  director.html           # Director dashboard entry
  moderator.html          # Moderator dashboard entry
  monitoring.html         # Operator monitoring entry

client/js/
  LoginPage.js            # Login form logic
  DirectorDashboard.js    # Director room listing
  ModeratorDashboard.js   # Moderator room listing
  OperatorDashboard.js    # System monitoring view

css/
  login.min.css           # Login page styles
  dashboard.min.css       # Shared dashboard styles
```

## Build Configuration

**Note:** `build.js` exists and uses esbuild for bundling.

**Add to build.js entry points array:**
```javascript
const dashboardFiles = [
  'AuthService.js',
  'LoginPage.js',
  'DirectorDashboard.js',
  'ModeratorDashboard.js',
  'OperatorDashboard.js'
];
```

**Output bundles:**
- `LoginPage.bundle.min.js` → `public/js/dist/`
- `DirectorDashboard.bundle.min.js` → `public/js/dist/`
- `ModeratorDashboard.bundle.min.js` → `public/js/dist/`
- `OperatorDashboard.bundle.min.js` → `public/js/dist/`

## Navigation Updates

### Admin Panel (`public/admin.html` + `AdminDashboard.js`)
- Add "Director View" link if user has director role → `/director`
- Add "Moderator View" link if user has moderator role → `/moderator`
- Add "Monitoring" link if user has operator role → `/monitoring`

### Landing Page (`public/index.html` + `app.js`)
- Replace direct admin link with "Staff Login" button → `/login`
- Keep "Join Room" for participants/viewers

## Security Considerations

1. **Role verification on both client and server**
   - Client redirects for UX
   - Server validates permissions for all API calls

2. **Session management**
   - Use existing HttpOnly cookie-based JWT
   - AuthService handles token refresh

3. **Access control**
   - Each dashboard checks role before rendering
   - API endpoints enforce role-based permissions

## Error Handling

**Dashboard Error Handling:**
- API network errors → Show "Connection lost" message with retry button
- 401 errors → Redirect to `/login`
- 403 errors → Show "Access Denied" with link to appropriate dashboard
- 500 errors → Show "Server error" message, log to console

**Login Page Error Handling:**
- Invalid credentials → Show "Invalid username or password"
- Network errors → Show "Cannot connect to server"
- Server errors → Show "Login service unavailable"

## Testing Checklist

- [ ] Login page loads and authenticates correctly
- [ ] Each role redirects to correct dashboard
- [ ] Wrong role cannot access other dashboards
- [ ] Logout works from all dashboards
- [ ] Unauthenticated users redirected to login
- [ ] Viewer/participant can still access rooms without login
- [ ] Director dashboard shows assigned rooms only
- [ ] Moderator dashboard shows assigned rooms only
- [ ] Operator dashboard shows system-wide data
- [ ] Responsive design works on mobile (standard CSS, no special breakpoints required)

## Future Enhancements

- Remember me / persistent login
- Password reset flow
- Multi-factor authentication
- Session timeout warning
- Role switching (if user has multiple roles)
