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

    // Check role - must be operator or super_admin
    const user = window.authService.getCurrentUser();
    const allowedRoles = ['operator', 'super_admin'];
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

    this.appElement.innerHTML = `
      <div class="dashboard-container">
        ${this.renderNavbar(user)}
        <main class="dashboard-main">
          <div class="dashboard-header">
            <h1>Operator Dashboard</h1>
            <p class="dashboard-subtitle">System-wide monitoring and statistics</p>
          </div>
          <div id="dashboard-content" class="dashboard-content">
            ${this.renderContentHTML()}
          </div>
        </main>
        <div id="toast-container" class="toast-container"></div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderNavbar(user) {
    return `
      <nav class="dashboard-navbar">
        <div class="navbar-brand">
          <span class="brand-icon">&#128202;</span>
          <span class="brand-text">BreadCall Operator</span>
        </div>
        <div class="navbar-user">
          <span class="user-name">${this.escapeHtml(user?.username || 'Unknown')}</span>
          <span class="role-badge role-operator">${this.escapeHtml(user?.role || 'operator')}</span>
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

    return `
      ${this.renderStatsOverview()}
      ${this.rooms.length === 0 ? this.renderEmptyState() : this.renderRoomsList()}
    `;
  }

  renderLoadingState() {
    return `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading system statistics...</p>
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
        <h3>Failed to Load Data</h3>
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
        <h3>No Active Rooms</h3>
        <p>There are no active rooms in the system.</p>
        <p class="empty-hint">Rooms will appear here when participants join.</p>
      </div>
    `;
  }

  renderStatsOverview() {
    return `
      <div class="stats-overview">
        <div class="stat-card">
          <div class="stat-icon">&#128200;</div>
          <div class="stat-content">
            <div class="stat-value">${this.stats.activeRooms}</div>
            <div class="stat-label">Active Rooms</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">&#128101;</div>
          <div class="stat-content">
            <div class="stat-value">${this.stats.totalParticipants}</div>
            <div class="stat-label">Total Participants</div>
          </div>
        </div>
      </div>
    `;
  }

  renderRoomsList() {
    return `
      <div class="rooms-section">
        <h2 class="section-title">Active Rooms</h2>
        <div class="rooms-table-container">
          <table class="rooms-table">
            <thead>
              <tr>
                <th>Room Name/ID</th>
                <th>Status</th>
                <th>Participants</th>
              </tr>
            </thead>
            <tbody>
              ${this.rooms.map(room => this.renderRoomRow(room)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderRoomRow(room) {
    const isLive = room.participantCount > 0;
    const statusClass = isLive ? 'status-live' : 'status-offline';
    const statusText = isLive ? 'Live' : 'Offline';

    return `
      <tr>
        <td class="room-name-cell">
          <span class="room-name">${this.escapeHtml(room.name || room.id)}</span>
          <span class="room-id">${this.escapeHtml(room.id)}</span>
        </td>
        <td>
          <span class="room-status ${statusClass}">${statusText}</span>
        </td>
        <td>
          <span class="participant-count">${room.participantCount || 0}</span>
        </td>
      </tr>
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
