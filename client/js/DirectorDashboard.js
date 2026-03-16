/**
 * DirectorDashboard - Dashboard for directors to view and manage assigned rooms
 * Shows rooms where user has director role assignment
 */
class DirectorDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoggedIn = false;
    this.rooms = [];
    this.isLoading = false;
    this.error = null;
    this.init();
  }

  async init() {
    // Use AuthService for authentication check
    this.isLoggedIn = await window.authService.init();

    if (!this.isLoggedIn) {
      this.redirectToLogin();
      return;
    }

    // Check if user has director role
    if (!this.hasDirectorAccess()) {
      this.renderAccessDenied();
      return;
    }

    this.renderDashboard();
    await this.loadRooms();
  }

  // =============================================================================
  // Role Checking
  // =============================================================================

  /**
   * Check if user has director access (director, super_admin, or room_admin role)
   * @returns {boolean}
   */
  hasDirectorAccess() {
    const user = window.authService.getCurrentUser();
    if (!user) return false;

    const allowedRoles = ['director', 'super_admin', 'room_admin'];
    return allowedRoles.includes(user.role);
  }

  /**
   * Check if user has specific room assignment
   * @param {Object} room - Room object with assignments
   * @returns {boolean}
   */
  hasRoomDirectorAssignment(room) {
    if (!room.assignments) return false;

    const user = window.authService.getCurrentUser();
    if (!user) return false;

    // Check for wildcard assignment (all rooms)
    if (room.assignments['*'] === 'director') {
      return true;
    }

    // Check for specific user assignment
    const assignment = room.assignments[user.id];
    return assignment === 'director' || assignment === '*';
  }

  // =============================================================================
  // Navigation
  // =============================================================================

  redirectToLogin() {
    window.location.href = '/login';
  }

  enterDirectorView(roomId) {
    window.location.href = `/view/${roomId}`;
  }

  // =============================================================================
  // Data Loading
  // =============================================================================

  async loadRooms() {
    this.isLoading = true;
    this.error = null;
    this.renderContent();

    try {
      const response = await fetch('/api/user/rooms', {
        method: 'GET',
        credentials: 'include'
      });

      if (response.status === 401) {
        this.redirectToLogin();
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load rooms: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && Array.isArray(data.rooms)) {
        // Filter rooms where user has director assignment
        this.rooms = data.rooms.filter(room => this.hasRoomDirectorAssignment(room));
      } else {
        this.rooms = [];
      }
    } catch (error) {
      console.error('[DirectorDashboard] Failed to load rooms:', error);
      this.error = error.message || 'Failed to load rooms. Please try again.';
    } finally {
      this.isLoading = false;
      this.renderContent();
    }
  }

  async logout() {
    await window.authService.logout();
    this.redirectToLogin();
  }

  // =============================================================================
  // Rendering - Dashboard View
  // =============================================================================

  renderDashboard() {
    // Get current user role for conditional navigation
    const currentUser = window.authService.getCurrentUser();
    const userRole = currentUser?.role;

    // Build role-based navigation links
    let roleNavLinks = '';
    if (userRole === 'admin') {
      roleNavLinks += '<a href="/admin" class="btn btn-secondary">Admin Panel</a>';
    }
    if (userRole === 'moderator' || userRole === 'admin') {
      roleNavLinks += '<a href="/moderator-dashboard" class="btn btn-secondary">Moderator Dashboard</a>';
    }
    if (userRole === 'operator' || userRole === 'admin') {
      roleNavLinks += '<a href="/monitoring" class="btn btn-secondary">Monitoring</a>';
    }

    this.appElement.innerHTML =
      '<div class="admin-dashboard animate-fade-in">' +
        '<header class="admin-header">' +
          '<div>' +
            '<h1>Director Dashboard</h1>' +
            '<p style="color: var(--color-text-secondary); margin: 0;">View and manage your assigned production rooms</p>' +
          '</div>' +
          '<div class="admin-header-actions">' +
            roleNavLinks +
            '<a href="/" class="btn btn-secondary">View Public Page</a>' +
            '<button class="btn btn-danger admin-logout-btn" id="admin-logout-btn">Logout</button>' +
          '</div>' +
        '</header>' +

        '<div class="admin-stats">' +
          '<div class="stat-card">' +
            '<div class="stat-card-label">Assigned Rooms</div>' +
            '<div class="stat-card-value" id="stat-rooms">-</div>' +
          '</div>' +
          '<div class="stat-card">' +
            '<div class="stat-card-label">Live Rooms</div>' +
            '<div class="stat-card-value" id="stat-live">-</div>' +
          '</div>' +
          '<div class="stat-card">' +
            '<div class="stat-card-label">Total Participants</div>' +
            '<div class="stat-card-value" id="stat-participants">-</div>' +
          '</div>' +
        '</div>' +

        '<section class="admin-section">' +
          '<div class="admin-section-header">' +
            '<h2 class="admin-section-title">Your Rooms</h2>' +
          '</div>' +
          '<div class="rooms-grid" id="rooms-grid">' +
            '<div class="loading-spinner"><div class="spinner"></div></div>' +
          '</div>' +
        '</section>' +
      '</div>';

    // Attach event listeners
    this.attachEventListeners();
  }

  updateStats() {
    const totalRooms = this.rooms.length;
    const liveRooms = this.rooms.filter(r => (r.participantCount || 0) > 0).length;
    const totalParticipants = this.rooms.reduce((sum, r) => sum + (r.participantCount || 0), 0);

    const roomsEl = document.getElementById('stat-rooms');
    const liveEl = document.getElementById('stat-live');
    const participantsEl = document.getElementById('stat-participants');

    if (roomsEl) roomsEl.textContent = totalRooms;
    if (liveEl) liveEl.textContent = liveRooms;
    if (participantsEl) participantsEl.textContent = totalParticipants;
  }

  renderContent() {
    const roomsGrid = document.getElementById('rooms-grid');
    if (!roomsGrid) return;

    // Update stats
    this.updateStats();

    if (this.isLoading) {
      roomsGrid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    } else if (this.error) {
      roomsGrid.innerHTML = this.renderErrorState();
    } else if (this.rooms.length === 0) {
      roomsGrid.innerHTML = this.renderEmptyState();
    } else {
      roomsGrid.innerHTML = this.renderRoomGrid();
    }

    // Re-attach event listeners for dynamically created elements
    this.attachContentEventListeners();
  }

  renderErrorState() {
    return '<div class="empty-state">' +
      '<div class="empty-icon">&#9888;</div>' +
      '<h3>Failed to Load Rooms</h3>' +
      '<p>' + this.escapeHtml(this.error) + '</p>' +
      '<button class="btn btn-primary" id="retry-btn">Try Again</button>' +
    '</div>';
  }

  renderEmptyState() {
    return '<div class="empty-state">' +
      '<div class="empty-icon">&#127909;</div>' +
      '<h3>No Rooms Assigned</h3>' +
      '<p>You don\'t have any rooms assigned for director access yet.</p>' +
      '<p class="empty-hint">Contact an administrator to get assigned to a room.</p>' +
    '</div>';
  }

  renderRoomGrid() {
    return this.rooms.map(room => this.renderRoomCard(room)).join('');
  }

  renderRoomCard(room) {
    const isLive = (room.participantCount || 0) > 0;
    const statusClass = isLive ? 'status-live' : 'status-offline';
    const statusText = isLive ? 'Live' : 'Offline';

    return '<div class="room-card">' +
      '<div class="room-card-header">' +
        '<h3 class="room-name">' + this.escapeHtml(room.name || room.roomId) + '</h3>' +
        '<span class="room-status ' + statusClass + '">' + statusText + '</span>' +
      '</div>' +
      '<div class="room-card-body">' +
        '<div class="room-info">' +
          '<div class="info-item">' +
            '<span class="info-label">Room ID:</span>' +
            '<span class="info-value">' + this.escapeHtml(room.roomId) + '</span>' +
          '</div>' +
          '<div class="info-item">' +
            '<span class="info-label">Participants:</span>' +
            '<span class="info-value">' + (room.participantCount || 0) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="room-card-footer">' +
        '<button class="btn btn-primary btn-enter" data-room-id="' + this.escapeHtml(room.roomId) + '">Enter Director View</button>' +
      '</div>' +
    '</div>';
  }

  renderAccessDenied() {
    this.appElement.innerHTML =
      '<div class="access-denied">' +
        '<div class="access-denied-content">' +
          '<div class="denied-icon">&#128683;</div>' +
          '<h1>Access Denied</h1>' +
          '<p>You don\'t have permission to access the Director Dashboard.</p>' +
          '<p class="denied-hint">This area requires director, room_admin, or super_admin privileges.</p>' +
          '<button id="back-btn" class="btn btn-primary">Go to Home</button>' +
        '</div>' +
      '</div>';

    document.getElementById('back-btn')?.addEventListener('click', () => {
      window.location.href = '/';
    });
  }

  // =============================================================================
  // Event Listeners
  // =============================================================================

  attachEventListeners() {
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.logout());
    }
  }

  attachContentEventListeners() {
    // Retry button for error state
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadRooms());
    }

    // Enter director view buttons
    const enterButtons = document.querySelectorAll('.btn-enter');
    enterButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.target.dataset.roomId;
        if (roomId) {
          this.enterDirectorView(roomId);
        }
      });
    });
  }

  // =============================================================================
  // Utilities
  // =============================================================================

  showToast(message, type = 'info') {
    // Check if toast container exists, create if not
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    // Deduplicate toasts
    const now = Date.now();
    const key = message + '-' + type;
    if (this.recentToasts && this.recentToasts[key]) {
      const lastShown = this.recentToasts[key];
      if (now - lastShown < 5000) return;
    }

    if (!this.recentToasts) this.recentToasts = {};
    this.recentToasts[key] = now;

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Initialize dashboard when on director dashboard page
if (window.location.pathname === '/director-dashboard' ||
    window.location.pathname === '/director-dashboard/') {
  window.directorDashboard = new DirectorDashboard();
}

window.DirectorDashboard = DirectorDashboard;
