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
    const result = await window.authService.logout();
    if (result.success) {
      this.redirectToLogin();
    } else {
      this.showToast(result.error || 'Logout failed', 'error');
    }
  }

  // =============================================================================
  // Rendering
  // =============================================================================

  renderDashboard() {
    const user = window.authService.getCurrentUser();
    const roleBadge = this.getRoleBadge(user?.role);

    this.appElement.innerHTML = `
      <div class="dashboard-container">
        ${this.renderNavbar(user, roleBadge)}
        <main class="dashboard-main">
          <div class="dashboard-header">
            <h1>Director Dashboard</h1>
            <p class="dashboard-subtitle">View and manage your assigned production rooms</p>
          </div>
          <div id="content-area" class="content-area">
            <!-- Content will be rendered here -->
          </div>
        </main>
        <div id="toast-container" class="toast-container"></div>
      </div>
    `;

    // Attach event listeners
    this.attachEventListeners();
  }

  renderNavbar(user, roleBadge) {
    return `
      <nav class="dashboard-navbar">
        <div class="navbar-brand">
          <span class="brand-icon">&#127909;</span>
          <span class="brand-text">BreadCall Director</span>
        </div>
        <div class="navbar-user">
          <span class="user-role-badge ${roleBadge.class}">${roleBadge.label}</span>
          <span class="user-name">${this.escapeHtml(user?.username || 'Unknown')}</span>
          <button id="logout-btn" class="btn btn-sm btn-secondary">Logout</button>
        </div>
      </nav>
    `;
  }

  getRoleBadge(role) {
    const badges = {
      'super_admin': { label: 'Super Admin', class: 'badge-super-admin' },
      'room_admin': { label: 'Room Admin', class: 'badge-room-admin' },
      'director': { label: 'Director', class: 'badge-director' }
    };
    return badges[role] || { label: role || 'User', class: 'badge-default' };
  }

  renderContent() {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    if (this.isLoading) {
      contentArea.innerHTML = this.renderLoadingState();
    } else if (this.error) {
      contentArea.innerHTML = this.renderErrorState();
    } else if (this.rooms.length === 0) {
      contentArea.innerHTML = this.renderEmptyState();
    } else {
      contentArea.innerHTML = this.renderRoomGrid();
    }

    // Re-attach event listeners for dynamically created elements
    this.attachContentEventListeners();
  }

  renderLoadingState() {
    return `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading your rooms...</p>
      </div>
    `;
  }

  renderErrorState() {
    return `
      <div class="error-state">
        <div class="error-icon">&#9888;&#65039;</div>
        <h3>Failed to Load Rooms</h3>
        <p>${this.escapeHtml(this.error)}</p>
        <button id="retry-btn" class="btn btn-primary">Try Again</button>
      </div>
    `;
  }

  renderEmptyState() {
    return `
      <div class="empty-state">
        <div class="empty-icon">&#127909;</div>
        <h3>No Rooms Assigned</h3>
        <p>You don't have any rooms assigned for director access yet.</p>
        <p class="empty-hint">Contact an administrator to get assigned to a room.</p>
      </div>
    `;
  }

  renderRoomGrid() {
    return `
      <div class="room-grid">
        ${this.rooms.map(room => this.renderRoomCard(room)).join('')}
      </div>
    `;
  }

  renderRoomCard(room) {
    const isLive = room.participantCount > 0;
    const statusClass = isLive ? 'status-live' : 'status-offline';
    const statusText = isLive ? 'Live' : 'Offline';

    return `
      <div class="room-card glass-panel">
        <div class="room-card-header">
          <h3 class="room-name">${this.escapeHtml(room.name || room.id)}</h3>
          <span class="room-status ${statusClass}">${statusText}</span>
        </div>
        <div class="room-card-body">
          <div class="room-info">
            <div class="info-item">
              <span class="info-label">Room ID:</span>
              <span class="info-value room-id">${this.escapeHtml(room.id)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Participants:</span>
              <span class="info-value participant-count">${room.participantCount || 0}</span>
            </div>
          </div>
        </div>
        <div class="room-card-footer">
          <button
            class="btn btn-primary btn-enter"
            data-room-id="${this.escapeHtml(room.id)}"
          >
            Enter Director View
          </button>
        </div>
      </div>
    `;
  }

  renderAccessDenied() {
    this.appElement.innerHTML = `
      <div class="access-denied">
        <div class="access-denied-content">
          <div class="denied-icon">&#128683;</div>
          <h1>Access Denied</h1>
          <p>You don't have permission to access the Director Dashboard.</p>
          <p class="denied-hint">This area requires director, room_admin, or super_admin privileges.</p>
          <button id="back-btn" class="btn btn-primary">Go to Home</button>
        </div>
      </div>
    `;

    document.getElementById('back-btn')?.addEventListener('click', () => {
      window.location.href = '/';
    });
  }

  // =============================================================================
  // Event Listeners
  // =============================================================================

  attachEventListeners() {
    const logoutBtn = document.getElementById('logout-btn');
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
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Deduplicate toasts
    const now = Date.now();
    const key = `${message}-${type}`;
    if (this.recentToasts && this.recentToasts.has(key)) {
      const lastShown = this.recentToasts.get(key);
      if (now - lastShown < 5000) return;
    }

    if (!this.recentToasts) this.recentToasts = new Map();
    this.recentToasts.set(key, now);

    // Cleanup old toasts
    if (this.recentToasts.size > 50) {
      const cutoff = now - 30000;
      for (const [k, v] of this.recentToasts.entries()) {
        if (v < cutoff) this.recentToasts.delete(k);
      }
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
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
