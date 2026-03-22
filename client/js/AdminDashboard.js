/**
 * AdminDashboard - Admin panel for BreadCall room management
 * Handles login, room creation, participant management, and settings
 */
class AdminDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoggedIn = false;
    this.rooms = [];
    this.users = [];
    this.selectedUsers = [];
    this.userFilters = {
      search: '',
      role: 'all',
      status: 'all'
    };
    this.usersLoaded = false;
    this.userPagination = null;
    this.init();
  }

  async init() {
    // Use AuthService for authentication check
    this.isLoggedIn = await window.authService.init();
    if (this.isLoggedIn) {
      this.renderDashboard();
      await this.loadRooms();
    } else {
      // Redirect to login page
      window.location.href = '/login';
      return;
    }
  }

  // =============================================================================
  // Authentication
  // =============================================================================

  async checkAuthStatus() {
    return await window.authService.checkAuthStatus();
  }

  async login(username, password) {
    const result = await window.authService.login(username, password);
    if (result.success) {
      this.isLoggedIn = true;
      this.renderDashboard();
      await this.loadRooms();
      this.showToast('Login successful', 'success');
    } else {
      this.showToast(result.error || 'Login failed', 'error');
    }
  }

  async logout() {
    await window.authService.logout();
    this.isLoggedIn = false;
    window.location.href = '/login';
  }

  // =============================================================================
  // Permission Helpers
  // =============================================================================

  _hasPermission(permission, objectType = 'room') {
    // Construct permission string in format 'resource:action' (e.g., 'room:create')
    return window.authService.hasPermission(`${objectType}:${permission}`, objectType);
  }

  /**
   * Helper to make authenticated API calls with automatic token refresh on 401
   * @param {string} url - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} - Fetch response
   */
  async _apiCall(url, options = {}) {
    return window.authService.fetchWithAuth(url, options);
  }

  // =============================================================================
  // Room Management
  // =============================================================================

  async loadRooms() {
    try {
      const response = await this._apiCall('/api/admin/rooms');
      const data = await response.json();
      if (data.success) {
        this.rooms = data.rooms;
        this.renderRoomsGrid();
        this.updateStats();
      }
    } catch (error) {
      console.error('[AdminDashboard] Failed to load rooms:', error);
      this.showToast('Failed to load rooms', 'error');
    }
  }

  async createRoom(options) {
    try {
      const response = await this._apiCall('/api/admin/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('Room ' + data.roomId + ' created successfully', 'success');
        await this.loadRooms();
        return data.roomId;
      } else {
        this.showToast(data.error || 'Failed to create room', 'error');
      }
    } catch (error) {
      this.showToast('Connection error', 'error');
    }
  }

  async deleteRoom(roomId) {
    if (!confirm('Are you sure you want to delete room ' + roomId + '? This will disconnect all participants.')) {
      return;
    }

    try {
      const response = await this._apiCall('/api/admin/rooms/' + roomId, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('Room ' + roomId + ' deleted', 'success');
        await this.loadRooms();
      } else {
        this.showToast(data.error || 'Failed to delete room', 'error');
      }
    } catch (error) {
      this.showToast('Connection error', 'error');
    }
  }

  async updateRoomSettings(roomId, settings) {
    try {
      const response = await this._apiCall('/api/admin/rooms/' + roomId + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('Room settings updated', 'success');
        await this.loadRooms();
      } else {
        this.showToast(data.error || 'Failed to update settings', 'error');
      }
    } catch (error) {
      this.showToast('Connection error', 'error');
    }
  }

  async loadRoomParticipants(roomId) {
    try {
      const response = await this._apiCall('/api/admin/rooms/' + roomId + '/participants');
      const data = await response.json();
      if (data.success) {
        return { participants: data.participants || [], directors: data.directors || [] };
      }
      return { participants: [], directors: [] };
    } catch (error) {
      console.error('[AdminDashboard] Failed to load participants:', error);
      return { participants: [], directors: [] };
    }
  }

  async kickParticipant(roomId, participantId) {
    this.showToast('Kick functionality requires additional server endpoint', 'info');
  }

  // =============================================================================
  // Rendering - Login View
  // =============================================================================

  renderLogin() {
    this.appElement.innerHTML =
      '<div class="admin-login animate-fade-in">' +
        '<h1 class="admin-login-logo">BreadCall Admin</h1>' +
        '<p class="admin-login-subtitle">Enter admin credentials to continue</p>' +

        '<form class="admin-login-form glass-panel" id="admin-login-form">' +
          '<div class="form-group">' +
            '<label for="admin-username">Username</label>' +
            '<input type="text" id="admin-username" placeholder="Enter username" autocomplete="username" required>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="admin-password">Password</label>' +
            '<input type="password" id="admin-password" placeholder="Enter password" autocomplete="current-password" required>' +
          '</div>' +
          '<div class="form-actions">' +
            '<button type="submit" class="btn btn-primary btn-block">Login</button>' +
          '</div>' +
        '</form>' +

        '<div class="mt-md" style="text-align: center;">' +
          '<a href="/" style="color: var(--color-text-secondary); font-size: var(--font-size-sm);">&larr; Back to Home</a>' +
        '</div>' +
      '</div>';

    var form = document.getElementById('admin-login-form');
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var username = document.getElementById('admin-username').value;
      var password = document.getElementById('admin-password').value;
      this.login(username, password);
    }.bind(this));
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
            '<h1>BreadCall Admin Panel</h1>' +
            '<p style="color: var(--color-text-secondary); margin: 0;">Room Management Dashboard</p>' +
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
            '<div class="stat-card-label">Total Participants</div>' +
            '<div class="stat-card-value" id="stat-participants">-</div>' +
          '</div>' +
          '<div class="stat-card">' +
            '<div class="stat-card-label">Directors Connected</div>' +
            '<div class="stat-card-value" id="stat-directors">-</div>' +
          '</div>' +
        '</div>' +

        '<section class="admin-section">' +
          '<div class="tab-buttons">' +
            '<button class="tab-btn active" data-tab="rooms">Rooms</button>' +
            (this._hasPermission('create', 'user') || this._hasPermission('delete', 'user') ? '<button class="tab-btn" data-tab="users">Users</button>' : '') +
          '</div>' +
        '</section>' +

        // Rooms Tab
        '<div class="tab-content active" id="rooms-tab">' +
          '<section class="admin-section">' +
            '<div class="admin-section-header">' +
              '<h2 class="admin-section-title">Active Rooms</h2>' +
              (this._hasPermission('create', 'room') ? '<button class="btn btn-primary" id="create-room-btn">+ Create Room</button>' : '') +
            '</div>' +
            '<div class="rooms-grid" id="rooms-grid">' +
              '<div class="loading-spinner"><div class="spinner"></div></div>' +
            '</div>' +
          '</section>' +
        '</div>' +

        // Users Tab
        '<div class="tab-content" id="users-tab">' +
          '<div class="admin-section-header">' +
            '<h2 class="admin-section-title">Users</h2>' +
            (this._hasPermission('create', 'user') ? '<button class="btn btn-primary" id="create-user-btn">+ Create User</button>' : '') +
          '</div>' +
          '<div class="user-filters" id="user-filters">' +
            '<input type="text" class="search-input" id="user-search" placeholder="Search users...">' +
            '<select class="filter-select" id="user-role-filter">' +
              '<option value="all">All Roles</option>' +
              '<option value="admin">Admin</option>' +
              '<option value="director">Director</option>' +
              '<option value="participant">Participant</option>' +
              '<option value="viewer">Viewer</option>' +
              '<option value="operator">Operator</option>' +
            '</select>' +
            '<select class="filter-select" id="user-status-filter">' +
              '<option value="all">All Status</option>' +
              '<option value="active">Active</option>' +
              '<option value="inactive">Inactive</option>' +
            '</select>' +
          '</div>' +
          '<div class="data-table-container">' +
            '<table class="data-table" id="users-table">' +
              '<thead>' +
                '<tr>' +
                  '<th class="checkbox-cell"><input type="checkbox" id="select-all-users"></th>' +
                  '<th>Username</th>' +
                  '<th>Role</th>' +
                  '<th>Status</th>' +
                  '<th>Created</th>' +
                  '<th>Actions</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="users-table-body">' +
                '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>' +
              '</tbody>' +
            '</table>' +
          '</div>' +
          '<div class="table-pagination" id="user-pagination">' +
            '<span>Showing 1-10 of 0 users</span>' +
            '<div class="pagination-buttons">' +
              '<button class="btn btn-secondary" id="user-prev-page">Prev</button>' +
              '<button class="btn btn-secondary" id="user-next-page">Next</button>' +
            '</div>' +
          '</div>' +
          '<div class="bulk-actions-bar" id="bulk-actions-bar" style="display: none;">' +
            '<span id="selected-count">Selected: 0 users</span>' +
            '<button class="btn btn-secondary" id="bulk-role-btn">Change Role</button>' +
            '<button class="btn btn-danger" id="bulk-delete-btn">Delete Selected</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Create Room Modal
      '<div class="modal-overlay" id="create-room-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Create New Room</h3>' +
            '<button class="modal-close" id="close-create-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<form id="create-room-form">' +
              '<div class="form-group">' +
                '<label for="new-room-password">Password (optional)</label>' +
                '<input type="password" id="new-room-password" placeholder="Leave empty for public room">' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-room-max">Max Participants</label>' +
                '<input type="number" id="new-room-max" value="10" min="2" max="50" placeholder="Maximum participants">' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-room-quality">Video Quality</label>' +
                '<select id="new-room-quality">' +
                  '<option value="720p">720p (HD)</option>' +
                  '<option value="1080p">1080p (Full HD)</option>' +
                  '<option value="original" selected>Original</option>' +
                '</select>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-room-codec">Video Codec</label>' +
                '<select id="new-room-codec">' +
                  '<option value="H264">H.264 (Most compatible)</option>' +
                  '<option value="H265" selected>H.265/HEVC (Better efficiency)</option>' +
                  '<option value="VP8">VP8</option>' +
                  '<option value="VP9">VP9 (Better compression)</option>' +
                '</select>' +
              '</div>' +
            '</form>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="cancel-create-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="confirm-create-btn">Create Room</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Room Settings Modal
      '<div class="modal-overlay" id="settings-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Room Settings</h3>' +
            '<button class="modal-close" id="close-settings-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<form id="room-settings-form">' +
              '<input type="hidden" id="settings-room-id">' +
              '<div class="form-group">' +
                '<label for="settings-quality">Video Quality</label>' +
                '<select id="settings-quality">' +
                  '<option value="720p">720p (HD)</option>' +
                  '<option value="1080p">1080p (Full HD)</option>' +
                  '<option value="original">Original</option>' +
                '</select>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="settings-codec">Video Codec</label>' +
                '<select id="settings-codec">' +
                  '<option value="H264">H.264</option>' +
                  '<option value="H265">H.265/HEVC</option>' +
                  '<option value="VP8">VP8</option>' +
                  '<option value="VP9">VP9</option>' +
                '</select>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="settings-max">Max Participants</label>' +
                '<input type="number" id="settings-max" min="2" max="50" placeholder="Maximum participants">' +
              '</div>' +
            '</form>' +
            '<h4 style="margin-top: var(--space-lg); margin-bottom: var(--space-md);">Participants</h4>' +
            '<div id="participants-list" style="max-height: 200px; overflow-y: auto;">' +
              '<p style="color: var(--color-text-secondary); text-align: center;">Loading participants...</p>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="cancel-settings-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="save-settings-btn">Save Changes</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Participant Details Modal
      '<div class="modal-overlay" id="participants-modal">' +
        '<div class="modal modal-large">' +
          '<div class="modal-header">' +
            '<h3>Room Participants</h3>' +
            '<button class="modal-close" id="close-participants-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div id="participants-detail-list">' +
              '<p style="color: var(--color-text-secondary); text-align: center;">Loading...</p>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="close-participants-btn">Close</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Manage Tokens Modal
      '<div class="modal-overlay" id="manage-tokens-modal">' +
        '<div class="modal modal-large">' +
          '<div class="modal-header">' +
            '<h3>Manage Room Tokens</h3>' +
            '<button class="modal-close" id="close-tokens-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div class="token-filters" style="display: flex; gap: var(--space-md); margin-bottom: var(--space-lg);">' +
              '<select id="token-filter-type" style="flex: 1; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: 4px;">' +
                '<option value="all">All Types</option>' +
                '<option value="room_access">Room Access</option>' +
                '<option value="director_access">Director Access</option>' +
                '<option value="stream_access">Stream Access</option>' +
                '<option value="action_token">Action Token</option>' +
                '<option value="admin_token">Admin Token</option>' +
              '</select>' +
              '<select id="token-filter-status" style="flex: 1; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: 4px;">' +
                '<option value="all">All Status</option>' +
                '<option value="active">Active</option>' +
                '<option value="expired">Expired</option>' +
                '<option value="revoked">Revoked</option>' +
              '</select>' +
            '</div>' +
            '<div id="tokens-table-container" style="overflow-x: auto;">' +
              '<table class="tokens-table" style="width: 100%; border-collapse: collapse;">' +
                '<thead style="background: var(--color-bg-secondary);">' +
                  '<tr>' +
                    '<th style="padding: var(--space-md); text-align: left; border-bottom: 2px solid var(--color-border);">Type</th>' +
                    '<th style="padding: var(--space-md); text-align: left; border-bottom: 2px solid var(--color-border);">Created</th>' +
                    '<th style="padding: var(--space-md); text-align: left; border-bottom: 2px solid var(--color-border);">Expires</th>' +
                    '<th style="padding: var(--space-md); text-align: left; border-bottom: 2px solid var(--color-border);">Uses</th>' +
                    '<th style="padding: var(--space-md); text-align: left; border-bottom: 2px solid var(--color-border);">Status</th>' +
                    '<th style="padding: var(--space-md); text-align: left; border-bottom: 2px solid var(--color-border);">Actions</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody id="tokens-table-body">' +
                  '<tr><td colspan="6" style="padding: var(--space-lg); text-align: center; color: var(--color-text-secondary);">Loading...</td></tr>' +
                '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="close-tokens-btn">Close</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Create User Modal
      '<div class="modal-overlay" id="create-user-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Create New User</h3>' +
            '<button class="modal-close" id="close-create-user-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<form id="create-user-form">' +
              '<div class="form-group">' +
                '<label for="new-user-username">Username</label>' +
                '<input type="text" id="new-user-username" placeholder="3-32 characters, starts with letter" required>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-user-password">Password</label>' +
                '<input type="password" id="new-user-password" placeholder="Minimum 8 characters" required>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-user-role">Role</label>' +
                '<select id="new-user-role" required>' +
                  '<option value="">Select a role</option>' +
                  '<option value="admin">Admin</option>' +
                  '<option value="director">Director</option>' +
                  '<option value="participant">Participant</option>' +
                  '<option value="viewer">Viewer</option>' +
                  '<option value="operator">Operator</option>' +
                '</select>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-user-display-name">Display Name (optional)</label>' +
                '<input type="text" id="new-user-display-name" placeholder="Full name">' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-user-email">Email (optional)</label>' +
                '<input type="email" id="new-user-email" placeholder="user@example.com">' +
              '</div>' +
            '</form>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="cancel-create-user-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="confirm-create-user-btn">Create User</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Edit Role Modal
      '<div class="modal-overlay" id="edit-role-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Edit User Role</h3>' +
            '<button class="modal-close" id="close-edit-role-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<form id="edit-role-form">' +
              '<div class="form-group">' +
                '<label for="edit-user-role">New Role</label>' +
                '<select id="edit-user-role" required>' +
                  '<option value="">Select a role</option>' +
                  '<option value="admin">Admin</option>' +
                  '<option value="director">Director</option>' +
                  '<option value="participant">Participant</option>' +
                  '<option value="viewer">Viewer</option>' +
                  '<option value="operator">Operator</option>' +
                '</select>' +
              '</div>' +
            '</form>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="cancel-edit-role-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="confirm-edit-role-btn">Update Role</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Bulk Role Change Modal
      '<div class="modal-overlay" id="bulk-role-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Change Role for Selected Users</h3>' +
            '<button class="modal-close" id="close-bulk-role-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<form id="bulk-role-form">' +
              '<div class="form-group">' +
                '<label for="bulk-user-role">New Role</label>' +
                '<select id="bulk-user-role" required>' +
                  '<option value="">Select a role</option>' +
                  '<option value="admin">Admin</option>' +
                  '<option value="director">Director</option>' +
                  '<option value="participant">Participant</option>' +
                  '<option value="viewer">Viewer</option>' +
                  '<option value="operator">Operator</option>' +
                '</select>' +
              '</div>' +
              '<p style="color: var(--color-text-secondary); font-size: 0.875rem;">This will update the role for all selected users.</p>' +
            '</form>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="cancel-bulk-role-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="confirm-bulk-role-btn">Update Roles</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Toast Container
      '<div id="toast-container" class="toast-container"></div>';

    this.bindDashboardEvents();
    this.setupTabNavigation();
  }

  setupTabNavigation() {
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Update active tab button
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show corresponding content
        tabContents.forEach(content => {
          content.classList.remove('active');
          if (content.id === tabName + '-tab') {
            content.classList.add('active');
          }
        });

        // Load users if switching to users tab
        if (tabName === 'users' && !this.usersLoaded) {
          this.loadUsers();
          this.usersLoaded = true;
        }
      });
    });
  }

  renderRoomsGrid() {
    var grid = document.getElementById('rooms-grid');
    if (!grid) return;

    if (this.rooms.length === 0) {
      grid.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-state-icon">📹</div>' +
          '<h3 class="empty-state-title">No Active Rooms</h3>' +
          (this._hasPermission('create', 'room') ? '<p>Click "Create Room" to get started</p>' : '<p>No rooms available</p>') +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < this.rooms.length; i++) {
      var room = this.rooms[i];
      html +=
        '<div class="room-card" data-room-id="' + room.id + '">' +
          '<div class="room-card-header">' +
            '<h3 class="room-card-title">Room ' + room.id + '</h3>' +
            '<span class="room-card-id">' + room.id + '</span>' +
          '</div>' +
          '<div class="room-card-stats">' +
            '<div class="room-card-stat">' +
              '<div class="room-card-stat-value">' + room.participantCount + '</div>' +
              '<div class="room-card-stat-label">Participants</div>' +
            '</div>' +
            '<div class="room-card-stat">' +
              '<div class="room-card-stat-value">' + room.maxParticipants + '</div>' +
              '<div class="room-card-stat-label">Max</div>' +
            '</div>' +
            '<div class="room-card-stat">' +
              '<div class="room-card-stat-value">' + this.getRoomUptime(room.createdAt) + '</div>' +
              '<div class="room-card-stat-label">Uptime</div>' +
            '</div>' +
          '</div>' +
          '<div class="room-card-settings">' +
            '<span class="room-card-badge"><strong>Quality:</strong> ' + this.formatQuality(room.quality) + '</span>' +
            '<span class="room-card-badge"><strong>Codec:</strong> ' + room.codec + '</span>' +
          '</div>' +
          '<div class="room-card-actions">' +
            ((this._hasPermission('view_all', 'room') || this._hasPermission('mute', 'room')) ? '<button class="btn btn-secondary btn-sm view-participants-btn" data-room-id="' + room.id + '">View Participants</button>' : '') +
            (this._hasPermission('update', 'room') ? '<button class="btn btn-secondary btn-sm settings-btn" data-room-id="' + room.id + '">Settings</button>' : '') +
            (this._hasPermission('assign', 'room') ? '<button class="btn btn-secondary btn-sm manage-tokens-btn" data-room-id="' + room.id + '">Manage Tokens</button>' : '') +
          '</div>' +
          '<div class="room-card-actions" style="margin-top: var(--space-sm);">' +
            (this._hasPermission('join', 'room') ? '<button class="btn btn-accent btn-sm copy-link-btn" data-room-id="' + room.id + '" data-room-password="' + (room.password || '') + '">Copy Link</button>' : '') +
            (this._hasPermission('delete', 'room') ? '<button class="btn btn-danger btn-sm delete-room-btn" data-room-id="' + room.id + '">Delete Room</button>' : '') +
          '</div>' +
        '</div>';
    }
    grid.innerHTML = html;

    this.bindRoomCardEvents();
  }

  updateStats() {
    var totalRooms = this.rooms.length;
    var totalParticipants = this.rooms.reduce(function(sum, room) {
      return sum + room.participantCount;
    }, 0);

    document.getElementById('stat-rooms').textContent = totalRooms;
    document.getElementById('stat-participants').textContent = totalParticipants;
    document.getElementById('stat-directors').textContent = '-';
  }

  // =============================================================================
  // User Management
  // =============================================================================

  async loadUsers(page) {
    page = page || 1;
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      });

      if (this.userFilters.search) {
        params.append('search', this.userFilters.search);
      }
      if (this.userFilters.role && this.userFilters.role !== 'all') {
        params.append('role', this.userFilters.role);
      }
      if (this.userFilters.status && this.userFilters.status !== 'all') {
        params.append('status', this.userFilters.status);
      }

      const response = await this._apiCall('/api/admin/users?' + params.toString());
      const data = await response.json();

      if (data.success) {
        this.users = data.users;
        this.userPagination = data.pagination;
        this.renderUsersTable();
        this.renderPagination();
      } else {
        this.showToast(data.error || 'Failed to load users', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Failed to load users:', error);
      this.showToast('Failed to load users', 'error');
    }
  }

  renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (!this.users || this.users.length === 0) {
      tbody.innerHTML =
        '<tr>' +
          '<td colspan="6" class="empty-state" style="padding: var(--space-xl); text-align: center;">' +
            '<div class="empty-state-icon">👥</div>' +
            '<h3 class="empty-state-title">No Users Found</h3>' +
            '<p>No users match the current filters</p>' +
          '</td>' +
        '</tr>';
      return;
    }

    let html = '';
    for (let i = 0; i < this.users.length; i++) {
      const user = this.users[i];
      const roleClass = this.getRoleBadgeClass(user.role);
      const statusClass = user.status === 'active' ? 'status-active' : 'status-inactive';

      html +=
        '<tr data-user-id="' + user.id + '">' +
          '<td>' +
            '<input type="checkbox" class="user-checkbox" data-user-id="' + user.id + '" />' +
          '</td>' +
          '<td>' +
            '<div class="user-cell-primary">' +
              '<span class="username">' + this.escapeHtml(user.username) + '</span>' +
              (user.display_name ? '<span class="user-display-name">' + this.escapeHtml(user.display_name) + '</span>' : '') +
            '</div>' +
          '</td>' +
          '<td>' +
            '<span class="role-badge ' + roleClass + '">' + this.escapeHtml(user.role) + '</span>' +
          '</td>' +
          '<td>' +
            '<span class="status-badge ' + statusClass + '">' + user.status + '</span>' +
          '</td>' +
          '<td class="created-date">' + this.formatDate(user.created_at) + '</td>' +
          '<td>' +
            '<div class="table-actions">' +
              (this._hasPermission('assign_role', 'user') ? '<button class="btn btn-secondary btn-sm edit-role-btn" data-user-id="' + user.id + '" data-user-role="' + user.role + '">Edit Role</button>' : '') +
              (this._hasPermission('delete', 'user') && user.username !== 'admin' ? '<button class="btn btn-danger btn-sm delete-user-btn" data-user-id="' + user.id + '">Delete</button>' : '') +
            '</div>' +
          '</td>' +
        '</tr>';
    }

    tbody.innerHTML = html;
    this.setupUserTableListeners();
  }

  setupUserTableListeners() {
    const self = this;

    // Edit role buttons
    const editRoleBtns = document.querySelectorAll('.edit-role-btn');
    editRoleBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const userId = this.dataset.userId;
        const userRole = this.dataset.userRole;
        self.showEditRoleModal(userId, userRole);
      });
    });

    // Delete user buttons
    const deleteBtns = document.querySelectorAll('.delete-user-btn');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const userId = this.dataset.userId;
        self.deleteUser(userId);
      });
    });

    // User checkboxes
    const checkboxes = document.querySelectorAll('.user-checkbox');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', function() {
        self.updateUserSelection(this.dataset.userId, this.checked);
      });
    });

    // Select all checkbox
    const selectAll = document.getElementById('select-all-users');
    if (selectAll) {
      selectAll.addEventListener('change', function() {
        self.toggleSelectAll(this.checked);
      });
    }
  }

  getRoleBadgeClass(role) {
    switch (role) {
      case 'admin': return 'role-badge-admin';
      case 'director': return 'role-badge-director';
      case 'operator': return 'role-badge-operator';
      default: return 'role-badge-default';
    }
  }

  formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    if (days < 30) return Math.floor(days / 7) + ' weeks ago';
    if (days < 365) return Math.floor(days / 30) + ' months ago';
    return Math.floor(days / 365) + ' years ago';
  }

  // =============================================================================
  // Event Binding
  // =============================================================================

  bindDashboardEvents() {
    var self = this;

    // Logout
    var logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', function() { self.logout(); });

    // Create room modal
    var createBtn = document.getElementById('create-room-btn');
    if (createBtn) createBtn.addEventListener('click', function() {
      document.getElementById('create-room-modal').classList.add('active');
    });

    var closeCreateModal = document.getElementById('close-create-modal');
    if (closeCreateModal) closeCreateModal.addEventListener('click', function() {
      document.getElementById('create-room-modal').classList.remove('active');
    });

    var cancelCreateBtn = document.getElementById('cancel-create-btn');
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', function() {
      document.getElementById('create-room-modal').classList.remove('active');
    });

    var confirmCreateBtn = document.getElementById('confirm-create-btn');
    if (confirmCreateBtn) confirmCreateBtn.addEventListener('click', function() { self.handleCreateRoom(); });

    // Settings modal
    var closeSettingsModal = document.getElementById('close-settings-modal');
    if (closeSettingsModal) closeSettingsModal.addEventListener('click', function() {
      document.getElementById('settings-modal').classList.remove('active');
    });

    var cancelSettingsBtn = document.getElementById('cancel-settings-btn');
    if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', function() {
      document.getElementById('settings-modal').classList.remove('active');
    });

    var saveSettingsBtn = document.getElementById('save-settings-btn');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', function() { self.handleSaveSettings(); });

    // Participants modal
    var closeParticipantsModal = document.getElementById('close-participants-modal');
    if (closeParticipantsModal) closeParticipantsModal.addEventListener('click', function() {
      document.getElementById('participants-modal').classList.remove('active');
    });

    var closeParticipantsBtn = document.getElementById('close-participants-btn');
    if (closeParticipantsBtn) closeParticipantsBtn.addEventListener('click', function() {
      document.getElementById('participants-modal').classList.remove('active');
    });

    // Generate token modal
    // Use event delegation for copy buttons to prevent multiple bindings
    var tokenResult = document.getElementById('token-result');
    if (tokenResult && !tokenResult._hasDelegatedListeners) {
      tokenResult._hasDelegatedListeners = true;
      tokenResult.addEventListener('click', function(e) {
        if (e.target.id === 'copy-token-url-btn') {
          self.copyTokenUrl();
        } else if (e.target.id === 'copy-token-string-btn') {
          self.copyTokenString();
        }
      });
    }

    // Manage tokens modal
    var closeTokensModal = document.getElementById('close-tokens-modal');
    if (closeTokensModal) closeTokensModal.addEventListener('click', function() {
      document.getElementById('manage-tokens-modal').classList.remove('active');
    });

    var closeTokensBtn = document.getElementById('close-tokens-btn');
    if (closeTokensBtn) closeTokensBtn.addEventListener('click', function() {
      document.getElementById('manage-tokens-modal').classList.remove('active');
    });

    // Token filters
    var filterType = document.getElementById('token-filter-type');
    if (filterType) filterType.addEventListener('change', function() {
      if (self.currentManageTokensRoomId) {
        self.loadRoomTokens(self.currentManageTokensRoomId);
      }
    });

    var filterStatus = document.getElementById('token-filter-status');
    if (filterStatus) filterStatus.addEventListener('change', function() {
      if (self.currentManageTokensRoomId) {
        self.loadRoomTokens(self.currentManageTokensRoomId);
      }
    });

    // User management - Create user button
    var createUserBtn = document.getElementById('create-user-btn');
    if (createUserBtn) {
      createUserBtn.addEventListener('click', function() {
        self.showCreateUserModal();
      });
    }

    // Create user modal - close buttons
    var closeCreateUserModal = document.getElementById('close-create-user-modal');
    if (closeCreateUserModal) {
      closeCreateUserModal.addEventListener('click', function() {
        self.hideCreateUserModal();
      });
    }

    var cancelCreateUserBtn = document.getElementById('cancel-create-user-btn');
    if (cancelCreateUserBtn) {
      cancelCreateUserBtn.addEventListener('click', function() {
        self.hideCreateUserModal();
      });
    }

    var confirmCreateUserBtn = document.getElementById('confirm-create-user-btn');
    if (confirmCreateUserBtn) {
      confirmCreateUserBtn.addEventListener('click', function(e) {
        self.handleCreateUser(e);
      });
    }

    // Edit role modal - close buttons
    var closeEditRoleModal = document.getElementById('close-edit-role-modal');
    if (closeEditRoleModal) {
      closeEditRoleModal.addEventListener('click', function() {
        self.hideEditRoleModal();
      });
    }

    var cancelEditRoleBtn = document.getElementById('cancel-edit-role-btn');
    if (cancelEditRoleBtn) {
      cancelEditRoleBtn.addEventListener('click', function() {
        self.hideEditRoleModal();
      });
    }

    var confirmEditRoleBtn = document.getElementById('confirm-edit-role-btn');
    if (confirmEditRoleBtn) {
      confirmEditRoleBtn.addEventListener('click', function(e) {
        self.handleEditRole(e);
      });
    }

    // User filters
    this.setupUserFilterListeners();

    // Bulk actions - bulk delete
    var bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', function() {
        self.bulkDeleteUsers();
      });
    }

    // Bulk actions - bulk role change
    var bulkRoleBtn = document.getElementById('bulk-role-btn');
    if (bulkRoleBtn) {
      bulkRoleBtn.addEventListener('click', function() {
        self.showBulkRoleModal();
      });
    }

    // Close bulk role modal
    var closeBulkRoleModal = document.getElementById('close-bulk-role-modal');
    if (closeBulkRoleModal) {
      closeBulkRoleModal.addEventListener('click', function() {
        document.getElementById('bulk-role-modal').classList.remove('active');
      });
    }

    var cancelBulkRoleBtn = document.getElementById('cancel-bulk-role-btn');
    if (cancelBulkRoleBtn) {
      cancelBulkRoleBtn.addEventListener('click', function() {
        document.getElementById('bulk-role-modal').classList.remove('active');
      });
    }

    var confirmBulkRoleBtn = document.getElementById('confirm-bulk-role-btn');
    if (confirmBulkRoleBtn) {
      confirmBulkRoleBtn.addEventListener('click', function(e) {
        self.handleBulkRoleChange(e);
      });
    }
  }

  bindRoomCardEvents() {
    var self = this;

    // Click on room card to go to director page (excluding buttons)
    document.querySelectorAll('.room-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        // Don't navigate if clicking on buttons or interactive elements
        if (e.target.closest('button')) return;
        var roomId = e.currentTarget.dataset.roomId;
        window.location.href = '/director/' + roomId;
      });
    });

    // View participants
    document.querySelectorAll('.view-participants-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var roomId = e.target.dataset.roomId;
        self.showParticipantsModal(roomId);
      });
    });

    // Settings
    document.querySelectorAll('.settings-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var roomId = e.target.dataset.roomId;
        self.showSettingsModal(roomId);
      });
    });

    // Delete room
    document.querySelectorAll('.delete-room-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var roomId = e.target.dataset.roomId;
        self.deleteRoom(roomId);
      });
    });

    // Copy link button
    document.querySelectorAll('.copy-link-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var roomId = e.target.dataset.roomId;
        var roomPassword = e.target.dataset.roomPassword || '';
        self.copyRoomLink(roomId, roomPassword);
      });
    });

    // Manage tokens button
    document.querySelectorAll('.manage-tokens-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var roomId = e.target.dataset.roomId;
        self.showManageTokensModal(roomId);
      });
    });
  }

  // =============================================================================
  // Modal Handlers
  // =============================================================================

  handleCreateRoom() {
    var self = this;
    var password = document.getElementById('new-room-password').value || null;
    var maxParticipants = parseInt(document.getElementById('new-room-max').value, 10);
    var quality = document.getElementById('new-room-quality').value;
    var codec = document.getElementById('new-room-codec').value;

    this.createRoom({
      password: password || undefined,
      maxParticipants: maxParticipants,
      quality: quality,
      codec: codec
    }).then(function(roomId) {
      if (roomId) {
        document.getElementById('create-room-modal').classList.remove('active');
        // Reset form
        document.getElementById('new-room-password').value = '';
        document.getElementById('new-room-max').value = '10';
        document.getElementById('new-room-quality').value = 'original';
        document.getElementById('new-room-codec').value = 'H265';
      }
    });
  }

  showSettingsModal(roomId) {
    var self = this;
    var room = this.rooms.find(function(r) { return r.id === roomId; });
    if (!room) return;

    document.getElementById('settings-room-id').value = roomId;
    document.getElementById('settings-quality').value = room.quality;
    document.getElementById('settings-codec').value = room.codec;
    document.getElementById('settings-max').value = room.maxParticipants;

    // Load participants
    this.loadRoomParticipants(roomId).then(function(data) {
      var list = document.getElementById('participants-list');
      var participants = data.participants;
      if (participants.length === 0) {
        list.innerHTML = '<p style="color: var(--color-text-secondary); text-align: center;">No participants</p>';
      } else {
        var html = '';
        for (var i = 0; i < participants.length; i++) {
          var p = participants[i];
          html +=
            '<div class="participant-item">' +
              '<span class="name">' + self.escapeHtml(p.name) + '</span>' +
              '<span class="status ' + (p.isSendingVideo ? 'active' : '') + '">' +
                (p.isSendingVideo ? '📹' : '') + ' ' + (p.isSendingAudio ? '🎤' : '') +
              '</span>' +
            '</div>';
        }
        list.innerHTML = html;
      }
    });

    document.getElementById('settings-modal').classList.add('active');
  }

  handleSaveSettings() {
    var roomId = document.getElementById('settings-room-id').value;
    var quality = document.getElementById('settings-quality').value;
    var codec = document.getElementById('settings-codec').value;
    var maxParticipants = parseInt(document.getElementById('settings-max').value, 10);

    this.updateRoomSettings(roomId, { quality: quality, codec: codec, maxParticipants: maxParticipants });
    document.getElementById('settings-modal').classList.remove('active');
  }

  showParticipantsModal(roomId) {
    var self = this;
    this.loadRoomParticipants(roomId).then(function(data) {
      var participants = data.participants;
      var directors = data.directors;
      var list = document.getElementById('participants-detail-list');

      if (participants.length === 0 && directors.length === 0) {
        list.innerHTML = '<p style="color: var(--color-text-secondary); text-align: center;">No participants or directors</p>';
      } else {
        var html = '';
        if (participants.length > 0) {
          html +=
            '<h4 style="margin-bottom: var(--space-md);">Participants (' + participants.length + ')</h4>' +
            '<table class="participants-table">' +
              '<thead>' +
                '<tr><th>Name</th><th>Joined</th><th>Video</th><th>Audio</th><th>Actions</th></tr>' +
              '</thead>' +
              '<tbody>';
          for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            html +=
              '<tr>' +
                '<td>' + self.escapeHtml(p.name) + '</td>' +
                '<td>' + new Date(p.joinedAt).toLocaleTimeString() + '</td>' +
                '<td>' + (p.isSendingVideo ? '✅' : '❌') + '</td>' +
                '<td>' + (p.isSendingAudio ? '✅' : '❌') + '</td>' +
                '<td class="participant-actions-cell">' +
                  (self._hasPermission('kick', 'room') ? '<button class="btn btn-danger btn-sm kick-btn" data-room-id="' + roomId + '" data-participant-id="' + p.participantId + '">Kick</button>' : '') +
                '</td>' +
              '</tr>';
          }
          html += '</tbody></table>';
        }
        if (directors.length > 0) {
          html +=
            '<h4 style="margin: var(--space-lg) 0 var(--space-md);">Directors (' + directors.length + ')</h4>' +
            '<table class="participants-table">' +
              '<thead>' +
                '<tr><th>Name</th><th>Joined</th></tr>' +
              '</thead>' +
              '<tbody>';
          for (var i = 0; i < directors.length; i++) {
            var d = directors[i];
            html +=
              '<tr>' +
                '<td>' + self.escapeHtml(d.name) + '</td>' +
                '<td>' + new Date(d.joinedAt).toLocaleTimeString() + '</td>' +
              '</tr>';
          }
          html += '</tbody></table>';
        }
        list.innerHTML = html;

        // Bind kick buttons
        list.querySelectorAll('.kick-btn').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            var rId = e.target.dataset.roomId;
            var pId = e.target.dataset.participantId;
            self.kickParticipant(rId, pId);
          });
        });
      }

      document.getElementById('participants-modal').classList.add('active');
    });
  }

  // =============================================================================
  // Utilities
  // =============================================================================

  /**
   * Copy room join link to clipboard (generates token)
   */
  async copyRoomLink(roomId, password) {
    var self = this;

    try {
      // Generate token for room access (8 hour expiry)
      var response = await this._apiCall('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'room_access',
          roomId: roomId,
          options: { expiresAt: Date.now() + (8 * 3600 * 1000) }
        })
      });

      var data = await response.json();

      if (data.success) {
        navigator.clipboard.writeText(data.url).then(function() {
          self.showToast('Token link copied! (expires in 8 hours)', 'success');
        }).catch(function(err) {
          self.showToast('Failed to copy link', 'error');
        });
      } else {
        self.showToast(data.error || 'Failed to generate token', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Copy link failed:', error);
      self.showToast('Connection error', 'error');
    }
  }

  // =============================================================================
  // Token Management
  // =============================================================================

  showManageTokensModal(roomId) {
    this.currentManageTokensRoomId = roomId;
    document.getElementById('manage-tokens-modal').classList.add('active');
    this.loadRoomTokens(roomId);
  }

  async loadRoomTokens(roomId) {
    try {
      var response = await this._apiCall('/api/admin/rooms/' + roomId + '/tokens');
      var data = await response.json();

      if (data.success) {
        this.renderTokensTable(data.tokens || []);
      } else {
        document.getElementById('tokens-table-body').innerHTML =
          '<tr><td colspan="6" style="padding: var(--space-lg); text-align: center; color: var(--color-text-secondary);">Failed to load tokens</td></tr>';
      }
    } catch (error) {
      console.error('[AdminDashboard] Failed to load tokens:', error);
      document.getElementById('tokens-table-body').innerHTML =
        '<tr><td colspan="6" style="padding: var(--space-lg); text-align: center; color: var(--color-text-secondary);">Connection error</td></tr>';
    }
  }

  renderTokensTable(tokens) {
    var filterType = document.getElementById('token-filter-type').value;
    var filterStatus = document.getElementById('token-filter-status').value;
    var self = this;

    // Filter tokens
    var filtered = tokens.filter(function(token) {
      if (filterType !== 'all' && token.type !== filterType) return false;
      if (filterStatus !== 'all') {
        var isExpired = token.expiresAt && token.expiresAt < Date.now();
        var isRevoked = token.revoked === true;
        if (filterStatus === 'expired' && !isExpired) return false;
        if (filterStatus === 'active' && (isExpired || isRevoked)) return false;
        if (filterStatus === 'revoked' && !isRevoked) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      document.getElementById('tokens-table-body').innerHTML =
        '<tr><td colspan="6" style="padding: var(--space-lg); text-align: center; color: var(--color-text-secondary);">No tokens found</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var token = filtered[i];
      var isExpired = token.expiresAt && token.expiresAt < Date.now();
      var isRevoked = token.revoked === true;
      var status = isRevoked ? 'Revoked' : (isExpired ? 'Expired' : 'Active');
      var statusClass = isRevoked ? 'revoked' : (isExpired ? 'expired' : 'active');
      var statusColor = isRevoked ? 'var(--color-danger)' : (isExpired ? 'var(--color-text-secondary)' : 'var(--color-success)');
      var usesDisplay = token.maxUses ? token.usedCount + '/' + token.maxUses : token.usedCount + ' (unlimited)';

      html +=
        '<tr style="border-bottom: 1px solid var(--color-border);">' +
          '<td style="padding: var(--space-md);"><span class="token-type-badge" style="background: var(--color-bg-secondary); padding: 2px 8px; border-radius: 4px; font-size: 12px;">' + token.type + '</span></td>' +
          '<td style="padding: var(--space-md);">' + new Date(token.createdAt).toLocaleString() + '</td>' +
          '<td style="padding: var(--space-md);">' + (token.expiresAt ? new Date(token.expiresAt).toLocaleString() : 'Never') + '</td>' +
          '<td style="padding: var(--space-md);">' + usesDisplay + '</td>' +
          '<td style="padding: var(--space-md);"><span class="status-badge ' + statusClass + '" style="color: ' + statusColor + ';">' + status + '</span></td>' +
          '<td style="padding: var(--space-md);">' +
            '<button class="btn btn-sm btn-secondary copy-token-url-btn" data-token-id="' + token.tokenId + '" data-room-id="' + self.currentManageTokensRoomId + '" data-token-type="' + token.type + '"' + (isRevoked ? ' disabled' : '') + '>' + (isRevoked ? 'Revoked' : 'Copy URL') + '</button>' +
            '<button class="btn btn-sm btn-danger revoke-btn" data-token-id="' + token.tokenId + '"' + (isExpired || isRevoked ? ' disabled' : '') + '>' + (isRevoked ? 'Revoked' : (isExpired ? 'Expired' : 'Revoke')) + '</button>' +
          '</td>' +
        '</tr>';
    }

    document.getElementById('tokens-table-body').innerHTML = html;

    // Bind copy URL buttons
    document.querySelectorAll('.copy-token-url-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var tokenId = e.target.dataset.tokenId;
        var roomId = e.target.dataset.roomId;
        var tokenType = e.target.dataset.tokenType;
        self.copyTokenUrlFromList(roomId, tokenId, tokenType);
      });
    });

    // Bind revoke buttons
    document.querySelectorAll('.revoke-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var tokenId = e.target.dataset.tokenId;
        if (confirm('Are you sure you want to revoke this token? It will no longer work.')) {
          self.revokeToken(tokenId);
        }
      });
    });
  }

  async copyTokenUrlFromList(roomId, tokenId, tokenType) {
    var self = this;

    // Generate new token for copying
    try {
      var response = await this._apiCall('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: tokenType,
          roomId: roomId,
          options: { expiresAt: Date.now() + (8 * 3600 * 1000) }
        })
      });

      var data = await response.json();
      if (data.success) {
        navigator.clipboard.writeText(data.url).then(function() {
          self.showToast('Token URL copied!', 'success');
        }).catch(function() {
          self.showToast('Failed to copy URL', 'error');
        });
      }
    } catch (error) {
      self.showToast('Connection error', 'error');
    }
  }

  async revokeToken(tokenId) {
    var self = this;
    try {
      var response = await this._apiCall('/api/tokens/' + tokenId, {
        method: 'DELETE'
      });

      var data = await response.json();
      if (data.success) {
        self.showToast('Token revoked', 'success');
        // Reload tokens if managing tokens
        if (this.currentManageTokensRoomId) {
          this.loadRoomTokens(this.currentManageTokensRoomId);
        }
      } else {
        self.showToast(data.error || 'Failed to revoke token', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Revoke failed:', error);
      self.showToast('Connection error', 'error');
    }
  }

  /**
   * Copy iframe embed code to clipboard
   */
  copyRoomEmbed(roomId, password) {
    var baseUrl = window.location.origin;
    var embedUrl = baseUrl + '/?room=' + roomId;
    if (password) {
      embedUrl += '&password=' + password;
    }

    var embedCode = '<iframe src="' + embedUrl + '" width="100%" height="100%" frameborder="0" allow="camera; microphone; display-capture" allowfullscreen></iframe>';

    var self = this;
    navigator.clipboard.writeText(embedCode).then(function() {
      self.showToast('Embed code copied to clipboard', 'success');
    }).catch(function(err) {
      // Fallback for older browsers
      var textArea = document.createElement('textarea');
      textArea.value = embedCode;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        self.showToast('Embed code copied to clipboard', 'success');
      } catch (err) {
        self.showToast('Failed to copy embed code', 'error');
      }
      document.body.removeChild(textArea);
    });
  }

  /**
   * Format quality value for display
   */
  formatQuality(quality) {
    switch (quality) {
      case '720p': return '720p (HD)';
      case '1080p': return '1080p (Full HD)';
      case 'original': return 'Original';
      default: return quality.toUpperCase();
    }
  }

  getRoomUptime(createdAt) {
    var now = new Date();
    var created = new Date(createdAt);
    var diff = Math.floor((now - created) / 1000); // seconds

    if (diff < 60) return diff + 's';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    return Math.floor(diff / 3600) + 'h ' + Math.floor((diff % 3600) / 60) + 'm';
  }

  showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;

    var now = Date.now();
    var key = message + '-' + type;
    if (!this.recentToasts) {
      this.recentToasts = new Map();
    }
    if (this.recentToasts.has(key)) {
      var lastShown = this.recentToasts.get(key);
      if (now - lastShown < 5000) return;
    }
    this.recentToasts.set(key, now);

    // Clean up old entries
    if (this.recentToasts.size > 50) {
      var cutoff = now - 30000;
      var toDelete = [];
      this.recentToasts.forEach(function(v, k) {
        if (v < cutoff) toDelete.push(k);
      });
      for (var i = 0; i < toDelete.length; i++) {
        this.recentToasts.delete(toDelete[i]);
      }
    }

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(function() {
      toast.remove();
    }, 4000);
  }

  escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // =============================================================================
  // User Filters
  // =============================================================================

  setupUserFilterListeners() {
    const self = this;
    const searchInput = document.getElementById('user-search');
    const roleFilter = document.getElementById('user-role-filter');
    const statusFilter = document.getElementById('user-status-filter');

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        self.userFilters.search = this.value;
        self.applyFilters();
      });
    }

    if (roleFilter) {
      roleFilter.addEventListener('change', function() {
        self.userFilters.role = this.value;
        self.applyFilters();
      });
    }

    if (statusFilter) {
      statusFilter.addEventListener('change', function() {
        self.userFilters.status = this.value;
        self.applyFilters();
      });
    }
  }

  applyFilters() {
    this.loadUsers(1);
  }

  setFilter(filterType, value) {
    this.userFilters[filterType] = value;
    this.applyFilters();
  }

  // =============================================================================
  // Create User Modal
  // =============================================================================

  showCreateUserModal() {
    const modal = document.getElementById('create-user-modal');
    if (modal) {
      modal.classList.add('active');
    }
  }

  hideCreateUserModal() {
    const modal = document.getElementById('create-user-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    // Clear form
    const form = document.getElementById('create-user-form');
    if (form) form.reset();
  }

  async handleCreateUser(e) {
    e.preventDefault();

    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;
    const displayName = document.getElementById('new-user-display-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim();

    // Validation
    if (!username || !password || !role) {
      this.showToast('Username, password, and role are required', 'error');
      return;
    }

    // Username validation: 3-32 chars, alphanumeric + underscore, starts with letter
    const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;
    if (!usernameRegex.test(username)) {
      this.showToast('Username must be 3-32 characters, start with a letter, and contain only letters, numbers, and underscores', 'error');
      return;
    }

    // Password validation: minimum 8 characters
    if (password.length < 8) {
      this.showToast('Password must be at least 8 characters long', 'error');
      return;
    }

    try {
      const response = await this._apiCall('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          role,
          displayName: displayName || null,
          email: email || null
        })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('User ' + username + ' created successfully', 'success');
        this.hideCreateUserModal();
        this.loadUsers();
      } else {
        this.showToast(data.error || 'Failed to create user', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Create user failed:', error);
      this.showToast('Connection error', 'error');
    }
  }

  // =============================================================================
  // Edit Role Modal
  // =============================================================================

  showEditRoleModal(userId, currentRole) {
    this.editingUserId = userId;
    const modal = document.getElementById('edit-role-modal');
    if (modal) {
      modal.classList.add('active');
      const roleSelect = document.getElementById('edit-user-role');
      if (roleSelect) {
        roleSelect.value = currentRole;
      }
    }
  }

  hideEditRoleModal() {
    const modal = document.getElementById('edit-role-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    this.editingUserId = null;
  }

  async handleEditRole(e) {
    e.preventDefault();

    const role = document.getElementById('edit-user-role').value;
    const userId = this.editingUserId;

    if (!userId || !role) {
      this.showToast('User and role are required', 'error');
      return;
    }

    try {
      const response = await this._apiCall('/api/admin/users/' + userId + '/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('User role updated to ' + role, 'success');
        this.hideEditRoleModal();
        this.loadUsers();
      } else {
        this.showToast(data.error || 'Failed to update role', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Role update failed:', error);
      this.showToast('Connection error', 'error');
    }
  }

  // =============================================================================
  // Delete User
  // =============================================================================

  async deleteUser(userId) {
    // Get username to check if it's the admin user
    const user = this.users.find(u => u.id === userId);
    if (!user) {
      this.showToast('User not found', 'error');
      return;
    }

    if (user.username === 'admin') {
      this.showToast('Cannot delete the admin user', 'error');
      return;
    }

    if (!confirm('Are you sure you want to delete user ' + user.username + '? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await this._apiCall('/api/admin/users/' + userId, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('User ' + user.username + ' deleted successfully', 'success');
        this.loadUsers();
      } else {
        this.showToast(data.error || 'Failed to delete user', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Delete user failed:', error);
      this.showToast('Connection error', 'error');
    }
  }

  // =============================================================================
  // Bulk Operations
  // =============================================================================

  async bulkDeleteUsers() {
    if (this.selectedUsers.length === 0) {
      this.showToast('No users selected', 'error');
      return;
    }

    if (!confirm('Are you sure you want to delete ' + this.selectedUsers.length + ' user(s)? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await this._apiCall('/api/admin/users/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: this.selectedUsers })
      });

      const data = await response.json();
      if (data.success) {
        const msg = data.deleted + ' user(s) deleted successfully' +
          (data.failed && data.failed.length > 0 ? '. ' + data.failed.length + ' failed.' : '');
        this.showToast(msg, data.failed && data.failed.length > 0 ? 'warning' : 'success');
        this.clearSelection();
        this.loadUsers();
      } else {
        this.showToast(data.error || 'Bulk delete failed', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Bulk delete failed:', error);
      this.showToast('Connection error', 'error');
    }
  }

  showBulkRoleModal() {
    if (this.selectedUsers.length === 0) {
      this.showToast('No users selected', 'error');
      return;
    }
    const modal = document.getElementById('bulk-role-modal');
    if (modal) {
      modal.classList.add('active');
    }
  }

  async handleBulkRoleChange(e) {
    e.preventDefault();

    const role = document.getElementById('bulk-user-role').value;

    if (!role) {
      this.showToast('Role is required', 'error');
      return;
    }

    try {
      const response = await this._apiCall('/api/admin/users/bulk-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: this.selectedUsers,
          role: role
        })
      });

      const data = await response.json();
      if (data.success) {
        const msg = data.updated + ' user(s) role updated to ' + role +
          (data.failed && data.failed.length > 0 ? '. ' + data.failed.length + ' failed.' : '');
        this.showToast(msg, data.failed && data.failed.length > 0 ? 'warning' : 'success');
        document.getElementById('bulk-role-modal').classList.remove('active');
        this.clearSelection();
        this.loadUsers();
      } else {
        this.showToast(data.error || 'Bulk role change failed', 'error');
      }
    } catch (error) {
      console.error('[AdminDashboard] Bulk role change failed:', error);
      this.showToast('Connection error', 'error');
    }
  }

  // =============================================================================
  // Pagination
  // =============================================================================

  renderPagination() {
    const container = document.getElementById('user-pagination');
    if (!container || !this.userPagination) return;

    const { page, totalPages, total } = this.userPagination;
    const prevDisabled = page <= 1 ? 'disabled' : '';
    const nextDisabled = page >= totalPages ? 'disabled' : '';

    container.innerHTML =
      '<span class="pagination-info">Showing ' + total + ' users</span>' +
      '<div class="pagination-buttons">' +
        '<button class="btn btn-secondary btn-sm pagination-prev" ' + prevDisabled + '>Previous</button>' +
        '<span class="pagination-pages">Page ' + page + ' of ' + totalPages + '</span>' +
        '<button class="btn btn-secondary btn-sm pagination-next" ' + nextDisabled + '>Next</button>' +
      '</div>';

    const self = this;
    const prevBtn = container.querySelector('.pagination-prev');
    const nextBtn = container.querySelector('.pagination-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', function() {
        if (page > 1) self.loadUsers(page - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        if (page < totalPages) self.loadUsers(page + 1);
      });
    }
  }

  // =============================================================================
  // User Selection
  // =============================================================================

  updateUserSelection(userId, isSelected) {
    if (isSelected) {
      if (!this.selectedUsers.includes(userId)) {
        this.selectedUsers.push(userId);
      }
    } else {
      this.selectedUsers = this.selectedUsers.filter(id => id !== userId);
    }
    this.updateBulkActionsVisibility();
  }

  toggleSelectAll(isChecked) {
    const checkboxes = document.querySelectorAll('.user-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
      const userId = cb.dataset.userId;
      if (isChecked) {
        if (!this.selectedUsers.includes(userId)) {
          this.selectedUsers.push(userId);
        }
      } else {
        this.selectedUsers = this.selectedUsers.filter(id => id !== userId);
      }
    });
    this.updateBulkActionsVisibility();
  }

  clearSelection() {
    this.selectedUsers = [];
    const checkboxes = document.querySelectorAll('.user-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('select-all-users');
    if (selectAll) selectAll.checked = false;
    this.updateBulkActionsVisibility();
  }

  updateBulkActionsVisibility() {
    const bulkActions = document.getElementById('bulk-actions-bar');
    if (!bulkActions) return;

    if (this.selectedUsers.length > 0) {
      bulkActions.classList.add('visible');
      document.getElementById('selected-count').textContent = this.selectedUsers.length;
    } else {
      bulkActions.classList.remove('visible');
    }
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
  window.adminDashboard = new AdminDashboard();
});
