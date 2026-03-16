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

    // Check role - must be moderator or admin
    const user = window.authService.getCurrentUser();
    const allowedRoles = ['moderator', 'admin'];
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
    if (userRole === 'director' || userRole === 'admin') {
      roleNavLinks += '<a href="/director-dashboard" class="btn btn-secondary">Director Dashboard</a>';
    }
    if (userRole === 'operator' || userRole === 'admin') {
      roleNavLinks += '<a href="/monitoring" class="btn btn-secondary">Monitoring</a>';
    }

    this.appElement.innerHTML =
      '<div class="admin-dashboard animate-fade-in">' +
        '<header class="admin-header">' +
          '<div>' +
            '<h1>Moderator Dashboard</h1>' +
            '<p style="color: var(--color-text-secondary); margin: 0;">View and manage your assigned rooms</p>' +
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
      roomsGrid.innerHTML = this.renderRoomsGrid();
    }

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
      '<div class="empty-icon">&#128197;</div>' +
      '<h3>No Rooms Assigned</h3>' +
      '<p>You don\'t have any rooms assigned as a moderator.</p>' +
      '<p class="empty-hint">Contact an administrator to get room assignments.</p>' +
    '</div>';
  }

  renderRoomsGrid() {
    return this.rooms.map(room => this.renderRoomCard(room)).join('');
  }

  renderRoomCard(room) {
    const isLive = (room.participantCount || 0) > 0;
    const statusClass = isLive ? 'status-live' : 'status-offline';
    const statusText = isLive ? 'Live' : 'Offline';

    return '<div class="room-card">' +
      '<div class="room-card-header">' +
        '<h3 class="room-name">' + this.escapeHtml(room.name || 'Unnamed Room') + '</h3>' +
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
        '<button class="btn btn-primary enter-room-btn" data-room-id="' + this.escapeHtml(room.roomId) + '">Enter Room</button>' +
      '</div>' +
    '</div>';
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
    toast.innerHTML = '<span class="toast-message">' + this.escapeHtml(message) + '</span>';

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
