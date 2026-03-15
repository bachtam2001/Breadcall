# Role-Based Login Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a unified login page and role-specific dashboards (director, moderator, operator) with proper authentication and routing.

**Architecture:** Single entry point at `/login` that authenticates users and redirects to role-appropriate dashboards. Reuses existing AuthService and OLAManager. Server routes separated into dedicated route files for maintainability.

**Tech Stack:** Node.js/Express, Vanilla JS, esbuild, PostgreSQL, Redis, JWT cookies

---

## File Structure

### New Files (Client)
- `public/login.html` - Login page entry point
- `public/director-dashboard.html` - Director dashboard entry
- `public/moderator-dashboard.html` - Moderator dashboard entry
- `public/monitoring.html` - Operator monitoring entry
- `client/js/LoginPage.js` - Login form logic and role-based redirect
- `client/js/DirectorDashboard.js` - Director room listing dashboard
- `client/js/ModeratorDashboard.js` - Moderator room listing dashboard
- `client/js/OperatorDashboard.js` - System monitoring dashboard
- `public/css/login.min.css` - Login page styles
- `public/css/dashboard.min.css` - Shared dashboard styles

### New Files (Server)
- `server/src/routes/user.js` - User-specific API routes (`/api/user/rooms`)
- `server/src/routes/monitoring.js` - Operator monitoring routes (`/api/monitoring/*`)

### Modified Files
- `server/src/index.js` - Mount new route modules
- `build.js` - Add new entry points for bundling
- `client/js/AdminDashboard.js` - Add links to role dashboards
- `public/index.html` - Replace admin link with "Staff Login"
- `public/admin.html` - Add role dashboard navigation links

---

## Chunk 1: Server API Routes

### Task 1: Create User Routes Module

**Files:**
- Create: `server/src/routes/user.js`
- Modify: `server/src/index.js`

**Context:** The OLAManager at `server/src/OLAManager.js` has `getUserRoomAssignments(userId)` method that returns room assignments. RoomManager at `server/src/RoomManager.js` has room data.

- [ ] **Step 1: Create user routes file**

```javascript
const express = require('express');
const router = express.Router();

/**
 * GET /api/user/rooms
 * Returns rooms assigned to the current user (director/moderator assignments)
 */
router.get('/rooms', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Get room assignments from OLAManager
    const assignments = await req.app.locals.olaManager.getUserRoomAssignments(userId);

    // Get room details from RoomManager for each assignment
    const rooms = [];
    for (const assignment of assignments) {
      const room = req.app.locals.roomManager.getRoom(assignment.room_id);
      if (room) {
        rooms.push({
          roomId: assignment.room_id,
          name: room.name || assignment.room_id,
          participantCount: room.participants?.size || 0,
          assignmentRole: assignment.assignment_role
        });
      }
    }

    res.json({ success: true, rooms });
  } catch (error) {
    console.error('[UserRoutes] Error fetching user rooms:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount user routes in index.js**

In `server/src/index.js`, find the other route definitions and add:

```javascript
// User routes (for director/moderator dashboards)
const userRoutes = require('./routes/user');
app.use('/api/user', requireAuth(), userRoutes);
```

- [ ] **Step 3: Test the endpoint**

Run: `npm test -- user 2>&1 | head -30`
Expected: Tests pass or no tests found (new routes)

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/user.js server/src/index.js
git commit -m "feat: add /api/user/rooms endpoint for director/moderator dashboards"
```

### Task 2: Create Monitoring Routes Module

**Files:**
- Create: `server/src/routes/monitoring.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create monitoring routes file**

```javascript
const express = require('express');
const router = express.Router();

/**
 * GET /api/monitoring/status
 * Returns system-wide monitoring stats (operator only)
 */
router.get('/status', async (req, res) => {
  try {
    // Check if user has operator role
    const userRole = req.user?.role;
    if (!['operator', 'super_admin'].includes(userRole)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const roomManager = req.app.locals.roomManager;
    const rooms = roomManager.getAllRooms ? roomManager.getAllRooms() : [];

    let totalParticipants = 0;
    const roomList = [];

    for (const [roomId, room] of rooms) {
      const participantCount = room.participants?.size || 0;
      totalParticipants += participantCount;

      roomList.push({
        roomId,
        name: room.name || roomId,
        participantCount,
        streamStatus: room.isLive ? 'live' : 'offline'
      });
    }

    res.json({
      success: true,
      activeRooms: rooms.size || rooms.length || 0,
      totalParticipants
    });
  } catch (error) {
    console.error('[MonitoringRoutes] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch monitoring data' });
  }
});

/**
 * GET /api/monitoring/rooms
 * Returns detailed room list for monitoring
 */
router.get('/rooms', async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!['operator', 'super_admin'].includes(userRole)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const roomManager = req.app.locals.roomManager;
    const rooms = roomManager.getAllRooms ? roomManager.getAllRooms() : [];

    const roomList = [];
    for (const [roomId, room] of rooms) {
      roomList.push({
        roomId,
        name: room.name || roomId,
        participantCount: room.participants?.size || 0,
        streamStatus: room.isLive ? 'live' : 'offline'
      });
    }

    res.json({ success: true, rooms: roomList });
  } catch (error) {
    console.error('[MonitoringRoutes] Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount monitoring routes in index.js**

In `server/src/index.js`, add:

```javascript
// Monitoring routes (for operator dashboard)
const monitoringRoutes = require('./routes/monitoring');
app.use('/api/monitoring', requireAuth(), monitoringRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/monitoring.js server/src/index.js
git commit -m "feat: add monitoring API endpoints for operator dashboard"
```


---

## Chunk 2: Login Page

### Task 3: Create Login Page HTML

**Files:**
- Create: `public/login.html`

- [ ] **Step 1: Create login.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Staff Login - BreadCall</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/index.min.css">
  <link rel="stylesheet" href="css/login.min.css">
</head>
<body>
  <div id="app"></div>

  <script src="js/dist/LoginPage.bundle.min.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/login.html
git commit -m "feat: add login page HTML"
```

### Task 4: Create LoginPage JavaScript

**Files:**
- Create: `client/js/LoginPage.js`

- [ ] **Step 1: Create LoginPage.js**

```javascript
/**
 * LoginPage - Unified login for staff roles (admin, director, moderator, operator)
 */
class LoginPage {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoading = false;
    this.init();
  }

  async init() {
    // Check if already logged in
    const isLoggedIn = await window.authService.init();
    if (isLoggedIn) {
      this.redirectToDashboard(window.authService.getCurrentUser()?.role);
      return;
    }

    this.render();
    this.attachEventListeners();
  }

  render() {
    this.appElement.innerHTML = `
      <div class="login-container">
        <div class="login-box">
          <h1 class="login-title">BreadCall Staff Login</h1>
          <p class="login-subtitle">Sign in to access your dashboard</p>

          <form id="login-form" class="login-form">
            <div class="form-group">
              <label for="username">Username</label>
              <input
                type="text"
                id="username"
                name="username"
                required
                autocomplete="username"
                placeholder="Enter your username"
              >
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                required
                autocomplete="current-password"
                placeholder="Enter your password"
              >
            </div>

            <div id="error-message" class="error-message"></div>

            <button type="submit" class="login-button" id="login-button">
              Sign In
            </button>
          </form>

          <div class="login-footer">
            <a href="/" class="back-link">← Back to home</a>
            <span class="separator">|</span>
            <a href="/" class="public-link">Join as viewer/participant</a>
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    const form = document.getElementById('login-form');
    form.addEventListener('submit', (e) => this.handleLogin(e));
  }

  async handleLogin(e) {
    e.preventDefault();

    if (this.isLoading) return;

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorElement = document.getElementById('error-message');
    const button = document.getElementById('login-button');

    // Clear previous errors
    errorElement.textContent = '';

    // Basic validation
    if (!username || !password) {
      errorElement.textContent = 'Please enter both username and password';
      return;
    }

    // Show loading state
    this.isLoading = true;
    button.textContent = 'Signing in...';
    button.disabled = true;

    try {
      const result = await window.authService.login(username, password);

      if (result.success) {
        this.redirectToDashboard(result.user?.role);
      } else {
        errorElement.textContent = result.error || 'Invalid username or password';
      }
    } catch (error) {
      console.error('[LoginPage] Login error:', error);
      errorElement.textContent = 'Connection error. Please try again.';
    } finally {
      this.isLoading = false;
      button.textContent = 'Sign In';
      button.disabled = false;
    }
  }

  redirectToDashboard(role) {
    // Map roles to dashboard URLs
    const dashboardMap = {
      'super_admin': '/admin',
      'room_admin': '/admin',
      'director': '/director-dashboard',
      'moderator': '/moderator-dashboard',
      'operator': '/monitoring'
    };

    const destination = dashboardMap[role];
    if (destination) {
      window.location.href = destination;
    } else {
      // Unknown role - show error
      this.render();
      this.attachEventListeners();
      document.getElementById('error-message').textContent =
        'Unknown role. Please contact an administrator.';
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new LoginPage());
} else {
  new LoginPage();
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/LoginPage.js
git commit -m "feat: add LoginPage.js with role-based redirect"
```


### Task 5: Create Login CSS

**Files:**
- Create: `public/css/login.min.css`

- [ ] **Step 1: Create login.min.css**

```css
/* Login Page Styles */
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  padding: 20px;
}

.login-box {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 40px;
  width: 100%;
  max-width: 400px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.login-title {
  font-size: 28px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 8px 0;
  text-align: center;
}

.login-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0 0 32px 0;
  text-align: center;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.form-group input {
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #ffffff;
  font-size: 16px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.form-group input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.error-message {
  color: #ef4444;
  font-size: 14px;
  min-height: 20px;
  text-align: center;
}

.login-button {
  padding: 14px 24px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.login-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.login-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-footer {
  margin-top: 24px;
  text-align: center;
  font-size: 14px;
}

.login-footer a {
  color: rgba(255, 255, 255, 0.6);
  text-decoration: none;
  transition: color 0.2s;
}

.login-footer a:hover {
  color: #ffffff;
}

.login-footer .separator {
  margin: 0 12px;
  color: rgba(255, 255, 255, 0.3);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/login.min.css
git commit -m "feat: add login page styles"
```

---

## Chunk 3: Dashboard Styles

### Task 6: Create Shared Dashboard CSS

**Files:**
- Create: `public/css/dashboard.min.css`

- [ ] **Step 1: Create dashboard.min.css**

```css
/* Shared Dashboard Styles */
.dashboard-container {
  min-height: 100vh;
  background: #0f0f1a;
  color: #ffffff;
}

/* Navbar */
.dashboard-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.navbar-brand {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
}

.navbar-user {
  display: flex;
  align-items: center;
  gap: 16px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-name {
  font-weight: 500;
  color: #ffffff;
}

.role-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.role-badge.director {
  background: #6366f1;
  color: white;
}

.role-badge.moderator {
  background: #f59e0b;
  color: white;
}

.role-badge.operator {
  background: #10b981;
  color: white;
}

.logout-button {
  padding: 8px 16px;
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.logout-button:hover {
  background: rgba(239, 68, 68, 0.3);
}

/* Main Content */
.dashboard-content {
  padding: 32px 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.dashboard-header {
  margin-bottom: 32px;
}

.dashboard-title {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.dashboard-subtitle {
  color: rgba(255, 255, 255, 0.6);
  margin: 0;
}

/* Room Grid */
.rooms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

.room-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.room-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.room-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.room-id {
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
}

.room-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.live {
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}

.status-dot.offline {
  background: #6b7280;
}

.room-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: #ffffff;
}

.stat-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
}

.enter-button {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.enter-button:hover {
  opacity: 0.9;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 64px 24px;
  color: rgba(255, 255, 255, 0.5);
}

.empty-state-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state-title {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 8px 0;
}

.empty-state-text {
  margin: 0;
}

/* Loading State */
.loading-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Error State */
.error-state {
  text-align: center;
  padding: 64px 24px;
}

.error-state-title {
  color: #ef4444;
  font-size: 20px;
  margin-bottom: 16px;
}

.retry-button {
  padding: 12px 24px;
  background: rgba(99, 102, 241, 0.2);
  color: #6366f1;
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}

.retry-button:hover {
  background: rgba(99, 102, 241, 0.3);
}

/* Stats Overview (for operator dashboard) */
.stats-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 24px;
  margin-bottom: 32px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}

.stat-card-value {
  font-size: 36px;
  font-weight: 700;
  color: #6366f1;
  margin: 0 0 8px 0;
}

.stat-card-label {
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  margin: 0;
}

/* Refresh button */
.refresh-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.refresh-button {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.refresh-button:hover {
  background: rgba(255, 255, 255, 0.15);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/dashboard.min.css
git commit -m "feat: add shared dashboard styles"
```


---

## Chunk 4: Director Dashboard

### Task 7: Create Director Dashboard HTML

**Files:**
- Create: `public/director-dashboard.html`

- [ ] **Step 1: Create director-dashboard.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Director Dashboard - BreadCall</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/index.min.css">
  <link rel="stylesheet" href="css/dashboard.min.css">
</head>
<body>
  <div id="app"></div>

  <script src="js/dist/DirectorDashboard.bundle.min.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/director-dashboard.html
git commit -m "feat: add director dashboard HTML"
```

### Task 8: Create DirectorDashboard JavaScript

**Files:**
- Create: `client/js/DirectorDashboard.js`

- [ ] **Step 1: Create DirectorDashboard.js**

```javascript
/**
 * DirectorDashboard - Room listing for directors
 */
class DirectorDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.rooms = [];
    this.isLoading = true;
    this.error = null;
    this.init();
  }

  async init() {
    // Check authentication
    const isLoggedIn = await window.authService.init();
    if (!isLoggedIn) {
      window.location.href = '/login';
      return;
    }

    // Check role
    const user = window.authService.getCurrentUser();
    if (!user || !['director', 'super_admin', 'room_admin'].includes(user.role)) {
      window.location.href = '/login';
      return;
    }

    this.user = user;
    this.render();
    await this.loadRooms();
  }

  render() {
    this.appElement.innerHTML = this.getTemplate();
    this.attachEventListeners();
  }

  getTemplate() {
    return `
      <div class="dashboard-container">
        <nav class="dashboard-navbar">
          <div class="navbar-brand">BreadCall Director</div>
          <div class="navbar-user">
            <div class="user-info">
              <span class="user-name">${this.escapeHtml(this.user?.displayName || this.user?.username || 'Director')}</span>
              <span class="role-badge director">Director</span>
            </div>
            <button class="logout-button" id="logout-btn">Logout</button>
          </div>
        </nav>

        <main class="dashboard-content">
          <div class="dashboard-header">
            <h1 class="dashboard-title">Your Rooms</h1>
            <p class="dashboard-subtitle">Rooms where you are assigned as director</p>
          </div>

          <div id="rooms-container">${this.renderContent()}</div>
        </main>
      </div>
    `;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  renderContent() {
    if (this.isLoading) {
      return `
        <div class="loading-spinner">
          <div class="spinner"></div>
        </div>
      `;
    }

    if (this.error) {
      return `
        <div class="error-state">
          <div class="error-state-title">${this.escapeHtml(this.error)}</div>
          <button class="retry-button" id="retry-btn">Try Again</button>
        </div>
      `;
    }

    if (this.rooms.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon">🎬</div>
          <h3 class="empty-state-title">No Rooms Assigned</h3>
          <p class="empty-state-text">You don't have any rooms assigned as director yet.</p>
        </div>
      `;
    }

    return `
      <div class="rooms-grid">
        ${this.rooms.map(room => this.renderRoomCard(room)).join('')}
      </div>
    `;
  }

  renderRoomCard(room) {
    const isLive = room.streamStatus === 'live' || room.isLive;

    return `
      <div class="room-card" data-room-id="${room.roomId}">
        <div class="room-header">
          <span class="room-id">${this.escapeHtml(room.name || room.roomId)}</span>
          <span class="room-status">
            <span class="status-dot ${isLive ? 'live' : 'offline'}"></span>
            ${isLive ? 'LIVE' : 'Offline'}
          </span>
        </div>

        <div class="room-stats">
          <div class="stat">
            <span class="stat-value">${room.participantCount || 0}</span>
            <span class="stat-label">Participants</span>
          </div>
        </div>

        <button class="enter-button" data-room-id="${room.roomId}">Enter Director View</button>
      </div>
    `;
  }

  attachEventListeners() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadRooms());
    }

    const enterButtons = document.querySelectorAll('.enter-button');
    enterButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.target.dataset.roomId;
        this.enterRoom(roomId);
      });
    });
  }

  async loadRooms() {
    this.isLoading = true;
    this.error = null;
    this.render();

    try {
      const response = await fetch('/api/user/rooms', {
        credentials: 'include'
      });

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        throw new Error('Failed to load rooms');
      }

      const data = await response.json();

      // Filter only director assignments
      this.rooms = (data.rooms || []).filter(r =>
        r.assignmentRole === 'director' || r.assignmentRole === '*'
      );
    } catch (error) {
      console.error('[DirectorDashboard] Error loading rooms:', error);
      this.error = 'Failed to load rooms. Please try again.';
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  enterRoom(roomId) {
    // Navigate to existing director view
    window.location.href = `/view/${roomId}`;
  }

  async handleLogout() {
    try {
      await window.authService.logout();
      window.location.href = '/login';
    } catch (error) {
      console.error('[DirectorDashboard] Logout error:', error);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new DirectorDashboard());
} else {
  new DirectorDashboard();
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/DirectorDashboard.js
git commit -m "feat: add DirectorDashboard.js with room listing"
```


---

## Chunk 5: Moderator Dashboard

### Task 9: Create Moderator Dashboard HTML

**Files:**
- Create: `public/moderator-dashboard.html`

- [ ] **Step 1: Create moderator-dashboard.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Moderator Dashboard - BreadCall</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/index.min.css">
  <link rel="stylesheet" href="css/dashboard.min.css">
</head>
<body>
  <div id="app"></div>

  <script src="js/dist/ModeratorDashboard.bundle.min.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/moderator-dashboard.html
git commit -m "feat: add moderator dashboard HTML"
```

### Task 10: Create ModeratorDashboard JavaScript

**Files:**
- Create: `client/js/ModeratorDashboard.js`

- [ ] **Step 1: Create ModeratorDashboard.js**

```javascript
/**
 * ModeratorDashboard - Room listing for moderators
 */
class ModeratorDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.rooms = [];
    this.isLoading = true;
    this.error = null;
    this.init();
  }

  async init() {
    // Check authentication
    const isLoggedIn = await window.authService.init();
    if (!isLoggedIn) {
      window.location.href = '/login';
      return;
    }

    // Check role
    const user = window.authService.getCurrentUser();
    if (!user || !['moderator', 'super_admin', 'room_admin'].includes(user.role)) {
      window.location.href = '/login';
      return;
    }

    this.user = user;
    this.render();
    await this.loadRooms();
  }

  render() {
    this.appElement.innerHTML = this.getTemplate();
    this.attachEventListeners();
  }

  getTemplate() {
    return `
      <div class="dashboard-container">
        <nav class="dashboard-navbar">
          <div class="navbar-brand">BreadCall Moderator</div>
          <div class="navbar-user">
            <div class="user-info">
              <span class="user-name">${this.escapeHtml(this.user?.displayName || this.user?.username || 'Moderator')}</span>
              <span class="role-badge moderator">Moderator</span>
            </div>
            <button class="logout-button" id="logout-btn">Logout</button>
          </div>
        </nav>

        <main class="dashboard-content">
          <div class="dashboard-header">
            <h1 class="dashboard-title">Rooms to Moderate</h1>
            <p class="dashboard-subtitle">Rooms where you are assigned as moderator</p>
          </div>

          <div id="rooms-container">${this.renderContent()}</div>
        </main>
      </div>
    `;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  renderContent() {
    if (this.isLoading) {
      return `
        <div class="loading-spinner">
          <div class="spinner"></div>
        </div>
      `;
    }

    if (this.error) {
      return `
        <div class="error-state">
          <div class="error-state-title">${this.escapeHtml(this.error)}</div>
          <button class="retry-button" id="retry-btn">Try Again</button>
        </div>
      `;
    }

    if (this.rooms.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon">🛡️</div>
          <h3 class="empty-state-title">No Rooms Assigned</h3>
          <p class="empty-state-text">You don't have any rooms assigned for moderation yet.</p>
        </div>
      `;
    }

    return `
      <div class="rooms-grid">
        ${this.rooms.map(room => this.renderRoomCard(room)).join('')}
      </div>
    `;
  }

  renderRoomCard(room) {
    const isLive = room.streamStatus === 'live' || room.isLive;

    return `
      <div class="room-card" data-room-id="${room.roomId}">
        <div class="room-header">
          <span class="room-id">${this.escapeHtml(room.name || room.roomId)}</span>
          <span class="room-status">
            <span class="status-dot ${isLive ? 'live' : 'offline'}"></span>
            ${isLive ? 'LIVE' : 'Offline'}
          </span>
        </div>

        <div class="room-stats">
          <div class="stat">
            <span class="stat-value">${room.participantCount || 0}</span>
            <span class="stat-label">Participants</span>
          </div>
        </div>

        <button class="enter-button" data-room-id="${room.roomId}">Enter Room</button>
      </div>
    `;
  }

  attachEventListeners() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadRooms());
    }

    const enterButtons = document.querySelectorAll('.enter-button');
    enterButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.target.dataset.roomId;
        this.enterRoom(roomId);
      });
    });
  }

  async loadRooms() {
    this.isLoading = true;
    this.error = null;
    this.render();

    try {
      const response = await fetch('/api/user/rooms', {
        credentials: 'include'
      });

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        throw new Error('Failed to load rooms');
      }

      const data = await response.json();

      // Filter only moderator assignments
      this.rooms = (data.rooms || []).filter(r =>
        r.assignmentRole === 'moderator' || r.assignmentRole === '*'
      );
    } catch (error) {
      console.error('[ModeratorDashboard] Error loading rooms:', error);
      this.error = 'Failed to load rooms. Please try again.';
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  enterRoom(roomId) {
    // Navigate to room - moderator enters with elevated permissions
    window.location.href = `/room/${roomId}`;
  }

  async handleLogout() {
    try {
      await window.authService.logout();
      window.location.href = '/login';
    } catch (error) {
      console.error('[ModeratorDashboard] Logout error:', error);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ModeratorDashboard());
} else {
  new ModeratorDashboard();
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/ModeratorDashboard.js
git commit -m "feat: add ModeratorDashboard.js with room listing"
```


---

## Chunk 6: Operator Dashboard

### Task 11: Create Operator Monitoring HTML

**Files:**
- Create: `public/monitoring.html`

- [ ] **Step 1: Create monitoring.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>System Monitoring - BreadCall</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/index.min.css">
  <link rel="stylesheet" href="css/dashboard.min.css">
</head>
<body>
  <div id="app"></div>

  <script src="js/dist/OperatorDashboard.bundle.min.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/monitoring.html
git commit -m "feat: add operator monitoring HTML"
```

### Task 12: Create OperatorDashboard JavaScript

**Files:**
- Create: `client/js/OperatorDashboard.js`

- [ ] **Step 1: Create OperatorDashboard.js**

```javascript
/**
 * OperatorDashboard - System-wide monitoring for operators
 */
class OperatorDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.stats = null;
    this.rooms = [];
    this.isLoading = true;
    this.error = null;
    this.refreshInterval = null;
    this.init();
  }

  async init() {
    // Check authentication
    const isLoggedIn = await window.authService.init();
    if (!isLoggedIn) {
      window.location.href = '/login';
      return;
    }

    // Check role
    const user = window.authService.getCurrentUser();
    if (!user || !['operator', 'super_admin'].includes(user.role)) {
      window.location.href = '/login';
      return;
    }

    this.user = user;
    this.render();
    await this.loadData();

    // Auto-refresh every 30 seconds
    this.refreshInterval = setInterval(() => this.loadData(false), 30000);
  }

  render() {
    this.appElement.innerHTML = this.getTemplate();
    this.attachEventListeners();
  }

  getTemplate() {
    return `
      <div class="dashboard-container">
        <nav class="dashboard-navbar">
          <div class="navbar-brand">BreadCall Monitoring</div>
          <div class="navbar-user">
            <div class="user-info">
              <span class="user-name">${this.escapeHtml(this.user?.displayName || this.user?.username || 'Operator')}</span>
              <span class="role-badge operator">Operator</span>
            </div>
            <button class="logout-button" id="logout-btn">Logout</button>
          </div>
        </nav>

        <main class="dashboard-content">
          <div class="dashboard-header">
            <h1 class="dashboard-title">System Overview</h1>
            <p class="dashboard-subtitle">Real-time system monitoring</p>
          </div>

          <div id="monitoring-content">${this.renderContent()}</div>
        </main>
      </div>
    `;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  renderContent() {
    if (this.isLoading) {
      return `
        <div class="loading-spinner">
          <div class="spinner"></div>
        </div>
      `;
    }

    if (this.error) {
      return `
        <div class="error-state">
          <div class="error-state-title">${this.escapeHtml(this.error)}</div>
          <button class="retry-button" id="retry-btn">Try Again</button>
        </div>
      `;
    }

    return `
      <div class="stats-overview">
        <div class="stat-card">
          <div class="stat-card-value">${this.stats?.activeRooms || 0}</div>
          <div class="stat-card-label">Active Rooms</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${this.stats?.totalParticipants || 0}</div>
          <div class="stat-card-label">Total Participants</div>
        </div>
      </div>

      <div class="refresh-bar">
        <button class="refresh-button" id="refresh-btn">🔄 Refresh</button>
      </div>

      ${this.rooms.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <h3 class="empty-state-title">No Active Rooms</h3>
          <p class="empty-state-text">There are no active rooms in the system.</p>
        </div>
      ` : `
        <div class="rooms-grid">
          ${this.rooms.map(room => this.renderRoomCard(room)).join('')}
        </div>
      `}
    `;
  }

  renderRoomCard(room) {
    const isLive = room.streamStatus === 'live' || room.isLive;

    return `
      <div class="room-card" data-room-id="${room.roomId}">
        <div class="room-header">
          <span class="room-id">${this.escapeHtml(room.name || room.roomId)}</span>
          <span class="room-status">
            <span class="status-dot ${isLive ? 'live' : 'offline'}"></span>
            ${isLive ? 'LIVE' : 'Offline'}
          </span>
        </div>

        <div class="room-stats">
          <div class="stat">
            <span class="stat-value">${room.participantCount || 0}</span>
            <span class="stat-label">Participants</span>
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadData());
    }

    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadData());
    }
  }

  async loadData(showLoading = true) {
    if (showLoading) {
      this.isLoading = true;
      this.error = null;
      this.render();
    }

    try {
      // Fetch status
      const statusResponse = await fetch('/api/monitoring/status', {
        credentials: 'include'
      });

      if (!statusResponse.ok) {
        if (statusResponse.status === 401 || statusResponse.status === 403) {
          window.location.href = '/login';
          return;
        }
        throw new Error('Failed to load monitoring data');
      }

      const statusData = await statusResponse.json();
      this.stats = {
        activeRooms: statusData.activeRooms,
        totalParticipants: statusData.totalParticipants
      };

      // Fetch rooms
      const roomsResponse = await fetch('/api/monitoring/rooms', {
        credentials: 'include'
      });

      if (roomsResponse.ok) {
        const roomsData = await roomsResponse.json();
        this.rooms = roomsData.rooms || [];
      }
    } catch (error) {
      console.error('[OperatorDashboard] Error loading data:', error);
      this.error = 'Failed to load monitoring data. Please try again.';
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  async handleLogout() {
    // Clear refresh interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    try {
      await window.authService.logout();
      window.location.href = '/login';
    } catch (error) {
      console.error('[OperatorDashboard] Logout error:', error);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new OperatorDashboard());
} else {
  new OperatorDashboard();
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/OperatorDashboard.js
git commit -m "feat: add OperatorDashboard.js with system monitoring"
```


---

## Chunk 7: Build Configuration

### Task 13: Update Build Script

**Files:**
- Modify: `build.js`

- [ ] **Step 1: Read current build.js structure**

Check how existing entry points are defined in `build.js`.

- [ ] **Step 2: Add new entry points**

Add these to the build configuration (exact syntax depends on current build.js structure):

```javascript
// Build LoginPage
await esbuild.build({
  entryPoints: ['client/js/LoginPage.js'],
  bundle: true,
  minify: !isDev,
  outfile: `${BUILD_DIR}/LoginPage.bundle${isDev ? '' : '.min'}.js`,
  format: 'iife'
});

// Build DirectorDashboard
await esbuild.build({
  entryPoints: ['client/js/DirectorDashboard.js'],
  bundle: true,
  minify: !isDev,
  outfile: `${BUILD_DIR}/DirectorDashboard.bundle${isDev ? '' : '.min'}.js`,
  format: 'iife'
});

// Build ModeratorDashboard
await esbuild.build({
  entryPoints: ['client/js/ModeratorDashboard.js'],
  bundle: true,
  minify: !isDev,
  outfile: `${BUILD_DIR}/ModeratorDashboard.bundle${isDev ? '' : '.min'}.js`,
  format: 'iife'
});

// Build OperatorDashboard
await esbuild.build({
  entryPoints: ['client/js/OperatorDashboard.js'],
  bundle: true,
  minify: !isDev,
  outfile: `${BUILD_DIR}/OperatorDashboard.bundle${isDev ? '' : '.min'}.js`,
  format: 'iife'
});
```

- [ ] **Step 3: Test build**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds with new bundles created

- [ ] **Step 4: Commit**

```bash
git add build.js
git commit -m "feat: add dashboard bundles to build configuration"
```

---

## Chunk 8: Navigation Updates

### Task 14: Update Landing Page

**Files:**
- Modify: `client/js/app.js` (or `public/index.html` if it has the admin link)

- [ ] **Step 1: Find current admin link**

Search for where the admin link/button is rendered.

- [ ] **Step 2: Replace with Staff Login**

Replace the admin link with a "Staff Login" button that links to `/login`.

Example change in `client/js/app.js`:
```javascript
// Old
<a href="/admin" class="nav-link">Admin</a>

// New
<a href="/login" class="nav-link">Staff Login</a>
```

- [ ] **Step 3: Commit**

```bash
git add client/js/app.js
[or git add public/index.html]
git commit -m "feat: replace admin link with staff login"
```

### Task 15: Update Admin Dashboard Navigation

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add role dashboard links**

In the AdminDashboard navbar or menu, add links to role-specific dashboards based on user's role.

Find the render method and add (after checking the user's role):
```javascript
// In navbar rendering
const userRole = window.authService.getCurrentUser()?.role;

// Add navigation links
if (userRole === 'director' || userRole === 'super_admin') {
  navHtml += `<a href="/director-dashboard" class="nav-link">Director View</a>`;
}

if (userRole === 'moderator' || userRole === 'super_admin') {
  navHtml += `<a href="/moderator-dashboard" class="nav-link">Moderator View</a>`;
}

if (userRole === 'operator' || userRole === 'super_admin') {
  navHtml += `<a href="/monitoring" class="nav-link">Monitoring</a>`;
}
```

- [ ] **Step 2: Test navigation**

Run: `npm test -- AdminDashboard 2>&1 | tail -20`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add client/js/AdminDashboard.js
git commit -m "feat: add role dashboard links to admin panel"
```

---

## Chunk 9: Testing & Verification

### Task 16: Build and Test

**Files:**
- All modified files

- [ ] **Step 1: Run full build**

```bash
npm run build 2>&1
```
Expected: All bundles created successfully

- [ ] **Step 2: Run tests**

```bash
npm test 2>&1 | tail -30
```
Expected: All existing tests pass

- [ ] **Step 3: Restart Docker services**

```bash
docker compose restart
```

- [ ] **Step 4: Verify pages load**

Test these URLs return 200:
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/login.html`
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/director-dashboard.html`
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/moderator-dashboard.html`
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:18080/monitoring.html`

Expected: All return 200

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete role-based login dashboard implementation"
```

---

## Summary

This implementation creates:
1. **Server API** - `/api/user/rooms` and `/api/monitoring/*` endpoints
2. **Login Page** - Unified entry at `/login` with role-based redirect
3. **Director Dashboard** - Room listing at `/director-dashboard`
4. **Moderator Dashboard** - Room listing at `/moderator-dashboard`
5. **Operator Dashboard** - System monitoring at `/monitoring`
6. **Build updates** - New bundles for all dashboards
7. **Navigation** - Updated landing page and admin panel

**Ready to execute?** Invoke `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement.
