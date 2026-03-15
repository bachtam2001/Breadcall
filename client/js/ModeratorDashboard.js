/**
 * ModeratorDashboard - Dashboard for moderators to view assigned rooms
 * Handles room listing, authentication checks for moderator role
 */
class ModeratorDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoggedIn = false;
    this.rooms = [];
    this.isLoading = false;
    this.error = null;
    this.init();
  }

  async init() {
    // Check authentication
    this.isLoggedIn = await window.authService.init();

    if (!this.isLoggedIn) {
      window.location.href = '/login';
      return;
    }

    // Check role - must be moderator, super_admin, or room_admin
    const user = window.authService.getCurrentUser();
    const allowedRoles = ['moderator', 'super_admin', 'room_admin'];
    if (!user || !allowedRoles.includes(user.role)) {
      this.showToast('Access denied: Moderator role required', 'error');
      window.location.href = '/';
      return;
    }

    this.renderDashboard();
    await this.loadRooms();
  }

  // =============================================================================
  // Room Loading
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
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load rooms: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success && data.rooms) {
        // Filter rooms where assignmentRole is 'moderator' or '*'
        this.rooms = data.rooms.filter(room =>
          room.assignmentRole === 'moderator' || room.assignmentRole === '*'
        );
      } else {
        this.rooms = [];
      }
    } catch (error) {
      console.error('[ModeratorDashboard] Failed to load rooms:', error);
      this.error = error.message || 'Failed to load rooms. Please try again.';
    } finally {
      this.isLoading = false;
      this.renderContent();
    }
  }

  // =============================================================================
  // Navigation
  // =============================================================================

  enterRoom(roomId) {
    window.location.href = `/room/${roomId}`;
  }

  async logout() {
    await window.authService.logout();
    window.location.href = '/login';
  }

  // =============================================================================
  // Rendering
  // =============================================================================

  renderDashboard() {
    const user = window.authService.getCurrentUser();

    this.appElement.innerHTML = `
      <div class="dashboard-container">
        ${this.renderNavbar(user)}
        <main class="dashboard-main">
          <div class="dashboard-header">
            <h1>Moderator Dashboard</h1>
            <p class="dashboard-subtitle">View and manage your assigned rooms</p>
          </div>
          <div id="dashboard-content" class="dashboard-content">
            ${this.renderContentHTML()}
          </div>
        </main>
      </div>
    `;

    this.attachEventListeners();
  }

  renderNavbar(user) {
    return `
      <nav class="dashboard-navbar">
        <div class="navbar-brand">
          <span class="logo">BreadCall</span>
          <span class="navbar-divider">|</span>
          <span class="navbar-title">Moderator</span>
        </div>
        <div class="navbar-user">
          <span class="user-name">${this.escapeHtml(user?.username || 'Unknown')}</span>
          <span class="role-badge role-moderator">${this.escapeHtml(user?.role || 'moderator')}</span>
          <button class="btn btn-secondary logout-btn" id="logout-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Logout
          </button>
        </div>
      </nav>
    `;
  }

  renderContent() {
    const contentElement = document.getElementById('dashboard-content');
    if (contentElement) {
      contentElement.innerHTML = this.renderContentHTML();
      this.attachContentEventListeners();
    }
  }

  renderContentHTML() {
    if (this.isLoading) {
      return this.renderLoadingState();
    }

    if (this.error) {
      return this.renderErrorState();
    }

    if (this.rooms.length === 0) {
      return this.renderEmptyState();
    }

    return this.renderRoomsGrid();
  }

  renderLoadingState() {
    return `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading your assigned rooms...</p>
      </div>
    `;
  }

  renderErrorState() {
    return `
      <div class="error-state">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h3>Failed to Load Rooms</h3>
        <p>${this.escapeHtml(this.error)}</p>
        <button class="btn btn-primary" id="retry-btn">Try Again</button>
      </div>
    `;
  }

  renderEmptyState() {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
        <h3 class="empty-state-title">No Rooms Assigned</h3>
        <p>You don't have any rooms assigned as a moderator.</p>
        <p class="empty-state-hint">Contact an administrator to get room assignments.</p>
      </div>
    `;
  }

  renderRoomsGrid() {
    return `
      <div class="rooms-grid">
        ${this.rooms.map(room => this.renderRoomCard(room)).join('')}
      </div>
    `;
  }

  renderRoomCard(room) {
    const isLive = room.participantCount > 0;
    const statusClass = isLive ? 'status-live' : 'status-offline';
    const statusText = isLive ? 'Live' : 'Offline';

    return `
      <div class="room-card">
        <div class="room-card-header">
          <div class="room-card-info">
            <h3 class="room-card-title">${this.escapeHtml(room.name || 'Unnamed Room')}</h3>
            <span class="room-card-id">${this.escapeHtml(room.roomId)}</span>
          </div>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="room-card-body">
          <div class="room-card-stat">
            <span class="stat-value">${room.participantCount || 0}</span>
            <span class="stat-label">Participants</span>
          </div>
        </div>
        <div class="room-card-actions">
          <button class="btn btn-primary enter-room-btn" data-room-id="${this.escapeHtml(room.roomId)}">
            Enter Room
          </button>
        </div>
      </div>
    `;
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
    // Retry button
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadRooms());
    }

    // Enter room buttons
    const enterButtons = document.querySelectorAll('.enter-room-btn');
    enterButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.target.dataset.roomId;
        this.enterRoom(roomId);
      });
    });
  }

  // =============================================================================
  // Utilities
  // =============================================================================

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(message, type = 'info') {
    // Create toast container if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-message">${this.escapeHtml(message)}</span>
    `;

    toastContainer.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.moderatorDashboard = new ModeratorDashboard();
});
