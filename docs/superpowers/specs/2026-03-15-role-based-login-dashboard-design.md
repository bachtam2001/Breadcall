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

**Out of Scope:** The actual in-room moderation UI (mute, kick, etc.) is handled within the room view. This dashboard only lists rooms and provides entry points.

### 4. OperatorDashboard (`/monitoring`)

**Location:** `public/monitoring.html` + `client/js/OperatorDashboard.js`

**Features:**
- Protected route (requires operator role)
- System-wide monitoring view:
  - Active rooms count
  - Total participants across all rooms
  - Stream health indicators
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

Each dashboard implements this auth check pattern:

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

## API Endpoints (Existing)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Authenticate user, returns user object with role |
| `/api/auth/me` | GET | Get current user info |
| `/api/auth/logout` | POST | End session |
| `/api/admin/rooms` | GET | List rooms (admin only) |
| `/api/rooms/:id/participants` | GET | Get room participants |

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

**Note:** `build.js` exists and uses esbuild for bundling. Update it to include new entry points:
- `LoginPage.bundle.js`
- `DirectorDashboard.bundle.js`
- `ModeratorDashboard.bundle.js`
- `OperatorDashboard.bundle.js`

## Navigation Updates

### Admin Panel
- Add "Director View" link if user has director role
- Add "Moderator View" link if user has moderator role
- Add "Monitoring" link if user has operator role

### Landing Page (index.html)
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
- [ ] Responsive design works on mobile

## Future Enhancements

- Remember me / persistent login
- Password reset flow
- Multi-factor authentication
- Session timeout warning
- Role switching (if user has multiple roles)
