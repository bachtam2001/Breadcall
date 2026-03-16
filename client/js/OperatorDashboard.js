/**
 * OperatorDashboard - System monitoring dashboard for operators
 * Shows system-wide stats, active rooms, and participant counts
 */
class OperatorDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoggedIn = false;
    this.rooms = [];
    this.stats = {
      activeRooms: 0,
      totalParticipants: 0
    };
    this.isLoading = false;
    this.error = null;
    this.refreshInterval = null;
    this.init();
  }

  async init() {
    // Check authentication
    this.isLoggedIn = await window.authService.init();

    if (!this.isLoggedIn) {
      this.redirectToLogin();
      return;
    }

    // Check role - must be operator or admin
    const user = window.authService.getCurrentUser();
    const allowedRoles = ['operator', 'admin'];
    if (!user || !allowedRoles.includes(user.role)) {
      this.showToast('Access denied: Operator role required', 'error');
      window.location.href = '/login';
      return;
    }

    this.renderDashboard();
    await this.loadData();
    this.startAutoRefresh();
  }

  // =============================================================================
  // Data Loading
  // =============================================================================

  async loadData() {
    this.isLoading = true;
    this.error = null;
    this.renderContent();

    try {
      // Fetch both endpoints in parallel
      const [statusResponse, roomsResponse] = await Promise.all([
        this.fetchStatus(),
        this.fetchRooms()
      ]);

      this.stats = statusResponse;
      this.rooms = roomsResponse;
    } catch (error) {
      console.error('[OperatorDashboard] Failed to load data:', error);
      this.error = error.message || 'Failed to load monitoring data. Please try again.';
    } finally {
      this.isLoading = false;
      this.renderContent();
    }
  }

  async fetchStatus() {
    const response = await fetch('/api/monitoring/status', {
      method: 'GET',
      credentials: 'include'
    });

    if (response.status === 401 || response.status === 403) {
      this.redirectToLogin();
      throw new Error('Authentication required');
    }

    if (!response.ok) {
      throw new Error(`Failed to load status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      return {
        activeRooms: data.activeRooms || 0,
        totalParticipants: data.totalParticipants || 0
      };
    }

    return { activeRooms: 0, totalParticipants: 0 };
  }

  async fetchRooms() {
    const response = await fetch('/api/monitoring/rooms', {
      method: 'GET',
      credentials: 'include'
    });

    if (response.status === 401 || response.status === 403) {
      this.redirectToLogin();
      throw new Error('Authentication required');
    }

    if (!response.ok) {
      throw new Error(`Failed to load rooms: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.rooms)) {
      return data.rooms;
    }

    return [];
  }

  // =============================================================================
  // Auto Refresh
  // =============================================================================

  startAutoRefresh() {
    // Clear any existing interval
    this.stopAutoRefresh();

    // Refresh every 30 seconds
    this.refreshInterval = setInterval(() => {
      this.refreshData();
    }, 30000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async refreshData() {
    try {
      // Fetch both endpoints in parallel without showing loading state
      const [statusResponse, roomsResponse] = await Promise.all([
        this.fetchStatus(),
        this.fetchRooms()
      ]);

      this.stats = statusResponse;
      this.rooms = roomsResponse;
      this.renderContent();
    } catch (error) {
      console.error('[OperatorDashboard] Auto-refresh failed:', error);
      // Don't show error toast on auto-refresh to avoid spamming
    }
  }

  // =============================================================================
  // Navigation
  // =============================================================================

  redirectToLogin() {
    window.location.href = '/login';
  }

  async logout() {
    this.stopAutoRefresh();
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
    if (userRole === 'director' || userRole === 'admin') {
      roleNavLinks += '<a href="/director-dashboard" class="btn btn-secondary">Director Dashboard</a>';
    }
    if (userRole === 'moderator' || userRole === 'admin') {
      roleNavLinks += '<a href="/moderator-dashboard" class="btn btn-secondary">Moderator Dashboard</a>';
    }

    this.appElement.innerHTML =
      '<div class="admin-dashboard animate-fade-in">' +
        '<header class="admin-header">' +
          '<div>' +
            '<h1>Monitoring Dashboard</h1>' +
            '<p style="color: var(--color-text-secondary); margin: 0;">System-wide monitoring and statistics</p>' +
          '</div>' +
          '<div class="admin-header-actions">' +
            roleNavLinks +
            '<a href="/" class="btn btn-secondary">View Public Page</a>' +
            '<button class="btn btn-danger admin-logout-btn" id="admin-logout-btn">Logout</button>' +
          '</div>' +
        '</header>' +

        '<div class="admin-stats">' +
          '<div class="stat-card">' +
            '<div class="stat-card-label">Active Rooms</div>' +
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
            '<h2 class="admin-section-title">Active Rooms</h2>' +
          '</div>' +
          '<div id="rooms-content">' +
            '<div class="loading-spinner"><div class="spinner"></div></div>' +
          '</div>' +
        '</section>' +
      '</div>';

    this.attachEventListeners();
  }

  updateStats() {
    const totalRooms = this.rooms.length;
    const liveRooms = this.rooms.filter(r => (r.participantCount || 0) > 0).length;
    const totalParticipants = this.stats.totalParticipants || 0;

    const roomsEl = document.getElementById('stat-rooms');
    const liveEl = document.getElementById('stat-live');
    const participantsEl = document.getElementById('stat-participants');

    if (roomsEl) roomsEl.textContent = totalRooms;
    if (liveEl) liveEl.textContent = liveRooms;
    if (participantsEl) participantsEl.textContent = totalParticipants;
  }

  renderContent() {
    const roomsContent = document.getElementById('rooms-content');
    if (!roomsContent) return;

    // Update stats
    this.updateStats();

    if (this.isLoading) {
      roomsContent.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
    } else if (this.error) {
      roomsContent.innerHTML = this.renderErrorState();
    } else if (this.rooms.length === 0) {
      roomsContent.innerHTML = this.renderEmptyState();
    } else {
      roomsContent.innerHTML = this.renderRoomsList();
    }

    this.attachContentEventListeners();
  }

  renderErrorState() {
    return '<div class="empty-state">' +
      '<div class="empty-icon">&#9888;</div>' +
      '<h3>Failed to Load Data</h3>' +
      '<p>' + this.escapeHtml(this.error) + '</p>' +
      '<button class="btn btn-primary" id="retry-btn">Try Again</button>' +
    '</div>';
  }

  renderEmptyState() {
    return '<div class="empty-state">' +
      '<div class="empty-icon">&#128200;</div>' +
      '<h3>No Active Rooms</h3>' +
      '<p>There are no active rooms in the system.</p>' +
      '<p class="empty-hint">Rooms will appear here when participants join.</p>' +
    '</div>';
  }

  renderRoomsList() {
    return '<div class="rooms-grid">' +
      this.rooms.map(room => this.renderRoomCard(room)).join('') +
    '</div>';
  }

  renderRoomCard(room) {
    const isLive = (room.participantCount || 0) > 0;
    const statusClass = isLive ? 'status-live' : 'status-offline';
    const statusText = isLive ? 'Live' : 'Offline';

    return '<div class="room-card">' +
      '<div class="room-card-header">' +
        '<h3 class="room-name">' + this.escapeHtml(room.name || room.roomId || room.id) + '</h3>' +
        '<span class="room-status ' + statusClass + '">' + statusText + '</span>' +
      '</div>' +
      '<div class="room-card-body">' +
        '<div class="room-info">' +
          '<div class="info-item">' +
            '<span class="info-label">Room ID:</span>' +
            '<span class="info-value">' + this.escapeHtml(room.roomId || room.id) + '</span>' +
          '</div>' +
          '<div class="info-item">' +
            '<span class="info-label">Participants:</span>' +
            '<span class="info-value">' + (room.participantCount || 0) + '</span>' +
          '</div>' +
        '</div>' +
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
    // Retry button for error state
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadData());
    }
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

  // =============================================================================
  // Cleanup
  // =============================================================================

  destroy() {
    this.stopAutoRefresh();
  }
}

// Initialize dashboard when on operator monitoring page
if (window.location.pathname === '/monitoring' ||
    window.location.pathname === '/monitoring/') {
  window.operatorDashboard = new OperatorDashboard();
}

window.OperatorDashboard = OperatorDashboard;
