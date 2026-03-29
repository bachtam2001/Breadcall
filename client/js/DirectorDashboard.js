/**
 * DirectorDashboard - Dashboard for directors to view and manage assigned rooms
 * Shows rooms where user has director role assignment
 */
class DirectorDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoggedIn = false;
    this.isAdmin = false;
    this.rooms = [];
    this.isLoading = false;
    this.error = null;
    this.selectedRoomId = null;
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

    // Check if user is admin for room management features
    this.isAdmin = this.hasAdminAccess();

    this.renderDashboard();
    await this.loadRooms();
  }

  // =============================================================================
  // Role Checking
  // =============================================================================

  /**
   * Check if user has director access (director or admin role)
   * @returns {boolean}
   */
  hasDirectorAccess() {
    const user = window.authService.getCurrentUser();
    if (!user) return false;

    const allowedRoles = ['director', 'admin', 'operator'];
    return allowedRoles.includes(user.role);
  }

  /**
   * Check if user has admin role
   * @returns {boolean}
   */
  hasAdminAccess() {
    const user = window.authService.getCurrentUser();
    return user?.role === 'admin';
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
      const response = await window.authService.fetchWithAuth('/api/user/rooms', {
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
            (this.isAdmin ? '<button class="btn btn-primary" id="create-room-btn">+ Create Room</button>' : '') +
          '</div>' +
          '<div class="rooms-grid" id="rooms-grid">' +
            '<div class="loading-spinner"><div class="spinner"></div></div>' +
          '</div>' +
        '</section>' +
      '</div>' +

      // Create Room Modal
      '<div class="modal-overlay" id="create-room-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Create New Room</h3>' +
            '<button class="modal-close" id="close-create-room-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<form id="create-room-form">' +
              '<div class="form-group">' +
                '<label for="new-room-name">Room Name</label>' +
                '<input type="text" id="new-room-name" placeholder="Enter room name" required>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="new-room-description">Description (optional)</label>' +
                '<input type="text" id="new-room-description" placeholder="Room description">' +
              '</div>' +
            '</form>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="cancel-create-room-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="confirm-create-room-btn">Create Room</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Room Settings Modal
      '<div class="modal-overlay" id="room-settings-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Room Settings</h3>' +
            '<button class="modal-close" id="close-room-settings-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<form id="room-settings-form">' +
              '<div class="form-group">' +
                '<label for="edit-room-name">Room Name</label>' +
                '<input type="text" id="edit-room-name" placeholder="Enter room name" required>' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="edit-room-description">Description (optional)</label>' +
                '<input type="text" id="edit-room-description" placeholder="Room description">' +
              '</div>' +
              '<div class="form-group">' +
                '<label for="edit-room-max-participants">Max Participants (optional)</label>' +
                '<input type="number" id="edit-room-max-participants" placeholder="Maximum participants" min="1">' +
              '</div>' +
            '</form>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="cancel-room-settings-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="confirm-room-settings-btn">Save Changes</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Room Participants Modal
      '<div class="modal-overlay" id="room-participants-modal">' +
        '<div class="modal">' +
          '<div class="modal-header">' +
            '<h3>Room Participants</h3>' +
            '<button class="modal-close" id="close-room-participants-modal">&times;</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div id="room-participants-list">' +
              '<div class="loading-spinner"><div class="spinner"></div></div>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" id="close-participants-btn">Close</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Toast Container
      '<div id="toast-container" class="toast-container"></div>';

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

    // Room action buttons - admin only
    const actionButtons = this.isAdmin ?
      '<div class="room-actions">' +
        '<button class="btn btn-secondary btn-sm btn-participants" data-room-id="' + this.escapeHtml(room.roomId) + '">Participants</button>' +
        '<button class="btn btn-secondary btn-sm btn-settings" data-room-id="' + this.escapeHtml(room.roomId) + '">Settings</button>' +
        '<button class="btn btn-danger btn-sm btn-delete-room" data-room-id="' + this.escapeHtml(room.roomId) + '">Delete</button>' +
      '</div>' : '';

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
      actionButtons +
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
          '<p class="denied-hint">This area requires director, admin, or operator privileges.</p>' +
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

    // Create room button
    const createRoomBtn = document.getElementById('create-room-btn');
    if (createRoomBtn) {
      createRoomBtn.addEventListener('click', () => this.showCreateRoomModal());
    }

    // Create room modal - close buttons
    const closeCreateRoomModal = document.getElementById('close-create-room-modal');
    if (closeCreateRoomModal) {
      closeCreateRoomModal.addEventListener('click', () => this.hideCreateRoomModal());
    }

    const cancelCreateRoomBtn = document.getElementById('cancel-create-room-btn');
    if (cancelCreateRoomBtn) {
      cancelCreateRoomBtn.addEventListener('click', () => this.hideCreateRoomModal());
    }

    const confirmCreateRoomBtn = document.getElementById('confirm-create-room-btn');
    if (confirmCreateRoomBtn) {
      confirmCreateRoomBtn.addEventListener('click', (e) => this.handleCreateRoom(e));
    }

    // Room settings modal - close buttons
    const closeRoomSettingsModal = document.getElementById('close-room-settings-modal');
    if (closeRoomSettingsModal) {
      closeRoomSettingsModal.addEventListener('click', () => this.hideSettingsModal());
    }

    const cancelRoomSettingsBtn = document.getElementById('cancel-room-settings-btn');
    if (cancelRoomSettingsBtn) {
      cancelRoomSettingsBtn.addEventListener('click', () => this.hideSettingsModal());
    }

    const confirmRoomSettingsBtn = document.getElementById('confirm-room-settings-btn');
    if (confirmRoomSettingsBtn) {
      confirmRoomSettingsBtn.addEventListener('click', (e) => this.handleUpdateSettings(e));
    }

    // Room participants modal - close buttons
    const closeRoomParticipantsModal = document.getElementById('close-room-participants-modal');
    if (closeRoomParticipantsModal) {
      closeRoomParticipantsModal.addEventListener('click', () => this.hideParticipantsModal());
    }

    const closeParticipantsBtn = document.getElementById('close-participants-btn');
    if (closeParticipantsBtn) {
      closeParticipantsBtn.addEventListener('click', () => this.hideParticipantsModal());
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

    // Admin-only room management buttons
    if (this.isAdmin) {
      // Participants buttons
      const participantsButtons = document.querySelectorAll('.btn-participants');
      participantsButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const roomId = e.target.dataset.roomId;
          if (roomId) {
            this.showParticipantsModal(roomId);
          }
        });
      });

      // Settings buttons
      const settingsButtons = document.querySelectorAll('.btn-settings');
      settingsButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const roomId = e.target.dataset.roomId;
          if (roomId) {
            this.showSettingsModal(roomId);
          }
        });
      });

      // Delete room buttons
      const deleteButtons = document.querySelectorAll('.btn-delete-room');
      deleteButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const roomId = e.target.dataset.roomId;
          if (roomId) {
            this.deleteRoom(roomId);
          }
        });
      });
    }
  }

  // =============================================================================
  // Room Management Methods
  // =============================================================================

  /**
   * Get CSRF token from server
   * @returns {Promise<string>}
   */
  async getCsrfToken() {
    const response = await fetch('/api/csrf-token', { credentials: 'include' });
    const data = await response.json();
    return data.csrfToken;
  }

  /**
   * Create a new room
   * @param {Object} options - Room options
   * @returns {Promise<Object>}
   */
  async createRoom(options) {
    try {
      const csrfToken = await this.getCsrfToken();
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify(options)
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('Room created successfully', 'success');
        await this.loadRooms();
        return data;
      } else {
        this.showToast(data.error || 'Failed to create room', 'error');
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('[DirectorDashboard] Create room failed:', error);
      this.showToast('Connection error', 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a room
   * @param {string} roomId - Room ID to delete
   */
  async deleteRoom(roomId) {
    const room = this.rooms.find(r => r.roomId === roomId);
    if (!room) {
      this.showToast('Room not found', 'error');
      return;
    }

    if (!confirm('Are you sure you want to delete room "' + this.escapeHtml(room.name || roomId) + '"? This action cannot be undone.')) {
      return;
    }

    try {
      const csrfToken = await this.getCsrfToken();
      const response = await fetch('/api/rooms/' + encodeURIComponent(roomId), {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include'
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('Room deleted successfully', 'success');
        await this.loadRooms();
      } else {
        this.showToast(data.error || 'Failed to delete room', 'error');
      }
    } catch (error) {
      console.error('[DirectorDashboard] Delete room failed:', error);
      this.showToast('Connection error', 'error');
    }
  }

  /**
   * Update room settings
   * @param {string} roomId - Room ID
   * @param {Object} settings - New settings
   */
  async updateRoomSettings(roomId, settings) {
    try {
      const csrfToken = await this.getCsrfToken();
      const response = await fetch('/api/rooms/' + encodeURIComponent(roomId), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify(settings)
      });

      const data = await response.json();
      if (data.success) {
        this.showToast('Room settings updated', 'success');
        await this.loadRooms();
        return data;
      } else {
        this.showToast(data.error || 'Failed to update room settings', 'error');
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('[DirectorDashboard] Update room settings failed:', error);
      this.showToast('Connection error', 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Load room participants
   * @param {string} roomId - Room ID
   * @returns {Promise<Array>}
   */
  async loadRoomParticipants(roomId) {
    try {
      const response = await window.authService.fetchWithAuth('/api/rooms/' + encodeURIComponent(roomId) + '/participants');
      const data = await response.json();
      if (data.success) {
        return data.participants || [];
      } else {
        this.showToast(data.error || 'Failed to load participants', 'error');
        return [];
      }
    } catch (error) {
      console.error('[DirectorDashboard] Load participants failed:', error);
      this.showToast('Connection error', 'error');
      return [];
    }
  }

  // =============================================================================
  // Modal Handlers
  // =============================================================================

  /**
   * Show create room modal
   */
  showCreateRoomModal() {
    const modal = document.getElementById('create-room-modal');
    if (modal) {
      modal.classList.add('active');
    }
  }

  /**
   * Hide create room modal
   */
  hideCreateRoomModal() {
    const modal = document.getElementById('create-room-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    // Clear form
    const form = document.getElementById('create-room-form');
    if (form) form.reset();
  }

  /**
   * Handle create room form submission
   * @param {Event} e
   */
  async handleCreateRoom(e) {
    e.preventDefault();

    const name = document.getElementById('new-room-name').value.trim();
    const description = document.getElementById('new-room-description').value.trim();

    // Validation
    if (!name) {
      this.showToast('Room name is required', 'error');
      return;
    }

    const result = await this.createRoom({ name, description });
    if (result.success) {
      this.hideCreateRoomModal();
    }
  }

  /**
   * Show settings modal for a room
   * @param {string} roomId
   */
  async showSettingsModal(roomId) {
    this.selectedRoomId = roomId;
    const room = this.rooms.find(r => r.roomId === roomId);
    if (!room) return;

    const modal = document.getElementById('room-settings-modal');
    if (modal) {
      modal.classList.add('active');
      // Populate form with current settings
      document.getElementById('edit-room-name').value = room.name || '';
      document.getElementById('edit-room-description').value = room.description || '';
      document.getElementById('edit-room-max-participants').value = room.maxParticipants || '';
    }
  }

  /**
   * Hide settings modal
   */
  hideSettingsModal() {
    const modal = document.getElementById('room-settings-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    this.selectedRoomId = null;
  }

  /**
   * Handle settings form submission
   * @param {Event} e
   */
  async handleUpdateSettings(e) {
    e.preventDefault();

    const name = document.getElementById('edit-room-name').value.trim();
    const description = document.getElementById('edit-room-description').value.trim();
    const maxParticipants = parseInt(document.getElementById('edit-room-max-participants').value, 10) || null;

    if (!name) {
      this.showToast('Room name is required', 'error');
      return;
    }

    const settings = { name, description };
    if (maxParticipants) settings.maxParticipants = maxParticipants;

    const result = await this.updateRoomSettings(this.selectedRoomId, settings);
    if (result.success) {
      this.hideSettingsModal();
    }
  }

  /**
   * Show participants modal for a room
   * @param {string} roomId
   */
  async showParticipantsModal(roomId) {
    this.selectedRoomId = roomId;
    const modal = document.getElementById('room-participants-modal');
    if (modal) {
      modal.classList.add('active');
      await this.renderParticipantsList(roomId);
    }
  }

  /**
   * Hide participants modal
   */
  hideParticipantsModal() {
    const modal = document.getElementById('room-participants-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    this.selectedRoomId = null;
  }

  /**
   * Render participants list in modal
   * @param {string} roomId
   */
  async renderParticipantsList(roomId) {
    const container = document.getElementById('room-participants-list');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    const participants = await this.loadRoomParticipants(roomId);
    if (participants.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No participants in this room yet.</p></div>';
      return;
    }

    let html = '<div class="participants-list">';
    participants.forEach(p => {
      html += '<div class="participant-item">' +
        '<div class="participant-info">' +
          '<span class="participant-name">' + this.escapeHtml(p.name || p.participantId) + '</span>' +
          '<span class="participant-id">' + this.escapeHtml(p.participantId) + '</span>' +
        '</div>' +
        '<div class="participant-status">' +
          '<span class="status-badge ' + (p.status === 'active' ? 'status-active' : 'status-inactive') + '">' + (p.status || 'unknown') + '</span>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
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
if (window.location.pathname === '/director' ||
    window.location.pathname === '/director/') {
  window.directorDashboard = new DirectorDashboard();
}

window.DirectorDashboard = DirectorDashboard;
