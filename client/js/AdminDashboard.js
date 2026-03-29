/**
 * AdminDashboard - Admin panel for BreadCall user management
 * Handles login and user administration
 */
class AdminDashboard {
  constructor() {
    this.appElement = document.getElementById('app');
    this.isLoggedIn = false;
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

  _hasPermission(permission, objectType = 'user') {
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
      roleNavLinks += '<a href="/director" class="btn btn-secondary">Director Dashboard</a>';
    }
    if (userRole === 'operator' || userRole === 'admin') {
      roleNavLinks += '<a href="/monitoring" class="btn btn-secondary">Monitoring</a>';
    }

    this.appElement.innerHTML =
      '<div class="admin-dashboard animate-fade-in">' +
        '<header class="admin-header">' +
          '<div>' +
            '<h1>BreadCall Admin Panel</h1>' +
            '<p style="color: var(--color-text-secondary); margin: 0;">User Management Dashboard</p>' +
          '</div>' +
          '<div class="admin-header-actions">' +
            roleNavLinks +
            '<a href="/" class="btn btn-secondary">View Public Page</a>' +
            '<button class="btn btn-danger admin-logout-btn" id="admin-logout-btn">Logout</button>' +
          '</div>' +
        '</header>' +

        // Users Tab
        '<div class="tab-content active" id="users-tab">' +
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

// Export for testing
window.AdminDashboard = AdminDashboard;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
  window.adminDashboard = new AdminDashboard();
});
