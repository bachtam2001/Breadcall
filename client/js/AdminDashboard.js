/**
 * AdminDashboard - Admin panel for BreadCall room management
 * Handles login, room creation, participant management, and settings
 */
class AdminDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoggedIn = false;
    this.rooms = [];
    this.init();
  }

  async init() {
    await this.checkAuthStatus();
    if (this.isLoggedIn) {
      this.renderDashboard();
      await this.loadRooms();
    } else {
      this.renderLogin();
    }
  }

  // =============================================================================
  // Authentication
  // =============================================================================

  async checkAuthStatus() {
    try {
      const response = await fetch('/api/admin/me');
      const data = await response.json();
      this.isLoggedIn = data.isAdmin;
    } catch (error) {
      console.error('[AdminDashboard] Auth check failed:', error);
      this.isLoggedIn = false;
    }
  }

  async login(password) {
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();
      if (data.success) {
        this.isLoggedIn = true;
        this.renderDashboard();
        await this.loadRooms();
        this.showToast('Login successful', 'success');
      } else {
        this.showToast(data.error || 'Login failed', 'error');
      }
    } catch (error) {
      this.showToast('Connection error', 'error');
    }
  }

  async logout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
      this.isLoggedIn = false;
      this.renderLogin();
      this.showToast('Logged out successfully', 'info');
    } catch (error) {
      console.error('[AdminDashboard] Logout failed:', error);
    }
  }

  // =============================================================================
  // Room Management
  // =============================================================================

  async loadRooms() {
    try {
      const response = await fetch('/api/admin/rooms');
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
      const response = await fetch('/api/admin/rooms', {
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
      const response = await fetch('/api/admin/rooms/' + roomId, {
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
      const response = await fetch('/api/admin/rooms/' + roomId + '/settings', {
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
      const response = await fetch('/api/admin/rooms/' + roomId + '/participants');
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
        '<p class="admin-login-subtitle">Enter admin password to continue</p>' +

        '<form class="admin-login-form glass-panel" id="admin-login-form">' +
          '<div class="form-group">' +
            '<label for="admin-password">Admin Password</label>' +
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
      var password = document.getElementById('admin-password').value;
      this.login(password);
    }.bind(this));
  }

  // =============================================================================
  // Rendering - Dashboard View
  // =============================================================================

  renderDashboard() {
    this.appElement.innerHTML =
      '<div class="admin-dashboard animate-fade-in">' +
        '<header class="admin-header">' +
          '<div>' +
            '<h1>BreadCall Admin Panel</h1>' +
            '<p style="color: var(--color-text-secondary); margin: 0;">Room Management Dashboard</p>' +
          '</div>' +
          '<div class="admin-header-actions">' +
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
          '<div class="admin-section-header">' +
            '<h2 class="admin-section-title">Active Rooms</h2>' +
            '<button class="btn btn-primary" id="create-room-btn">+ Create Room</button>' +
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

      // Toast Container
      '<div id="toast-container" class="toast-container"></div>';

    this.bindDashboardEvents();
  }

  renderRoomsGrid() {
    var grid = document.getElementById('rooms-grid');
    if (!grid) return;

    if (this.rooms.length === 0) {
      grid.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-state-icon">📹</div>' +
          '<h3 class="empty-state-title">No Active Rooms</h3>' +
          '<p>Click "Create Room" to get started</p>' +
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
            '<button class="btn btn-secondary btn-sm view-participants-btn" data-room-id="' + room.id + '">View Participants</button>' +
            '<button class="btn btn-secondary btn-sm settings-btn" data-room-id="' + room.id + '">Settings</button>' +
            '<button class="btn btn-danger btn-sm delete-room-btn" data-room-id="' + room.id + '">Delete Room</button>' +
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
  }

  bindRoomCardEvents() {
    var self = this;

    // View participants
    document.querySelectorAll('.view-participants-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var roomId = e.target.dataset.roomId;
        self.showParticipantsModal(roomId);
      });
    });

    // Settings
    document.querySelectorAll('.settings-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var roomId = e.target.dataset.roomId;
        self.showSettingsModal(roomId);
      });
    });

    // Delete room
    document.querySelectorAll('.delete-room-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var roomId = e.target.dataset.roomId;
        self.deleteRoom(roomId);
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
        document.getElementById('new-room-quality').value = '720p';
        document.getElementById('new-room-codec').value = 'H264';
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
                  '<button class="btn btn-danger btn-sm kick-btn" data-room-id="' + roomId + '" data-participant-id="' + p.participantId + '">Kick</button>' +
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
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
  window.adminDashboard = new AdminDashboard();
});
