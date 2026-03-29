/**
 * AdminDashboard Tests
 * Tests for user management functionality
 */

// Suppress navigation errors from jsdom
const originalError = console.error;
console.error = (...args) => {
  if (args[0] && args[0].message && args[0].message.includes('Not implemented: navigation')) {
    return;
  }
  originalError.apply(console, args);
};

describe('AdminDashboard', () => {
  let AdminDashboard;

  beforeEach(() => {
    // Mock authService
    global.window.authService = {
      init: jest.fn().mockResolvedValue(true),
      checkAuthStatus: jest.fn().mockResolvedValue(true),
      login: jest.fn().mockResolvedValue({ success: true }),
      logout: jest.fn().mockResolvedValue(),
      hasPermission: jest.fn().mockReturnValue(true),
      fetchWithAuth: jest.fn(),
      getCurrentUser: jest.fn().mockReturnValue({ id: 'test-user', role: 'admin' }),
      getToken: jest.fn().mockReturnValue('mock-token')
    };

    // Load AdminDashboard - the class is in global scope after require
    require('../js/AdminDashboard.js');
    AdminDashboard = global.AdminDashboard;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('User Management', () => {
    test('should load users from API', async () => {
      const mockUsers = [
        { id: '1', username: 'user1', role: 'director', status: 'active', created_at: new Date().toISOString() },
        { id: '2', username: 'user2', role: 'participant', status: 'active', created_at: new Date().toISOString() }
      ];

      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true, users: mockUsers, pagination: { page: 1, totalPages: 1, total: 2 } })
      });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new AdminDashboard();

      // Wait for init to complete
      await Promise.resolve();

      // Call loadUsers directly
      await dashboard.loadUsers(1);

      expect(global.window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/admin/users?page=1&limit=20', {});
      expect(dashboard.users).toEqual(mockUsers);
    });

    test('should create user via POST /api/admin/users', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Create modal with proper DOM methods for better jsdom compatibility
      const modal = document.createElement('div');
      modal.id = 'create-user-modal';
      modal.className = 'modal-overlay active';
      modal.innerHTML = `
        <form id="create-user-form">
          <input type="text" id="new-user-username" value="newuser">
          <input type="password" id="new-user-password" value="password123">
          <select id="new-user-role">
            <option value="">Select</option>
            <option value="director">director</option>
          </select>
          <input type="text" id="new-user-display-name" value="New User">
          <input type="email" id="new-user-email" value="new@test.com">
        </form>
      `;
      document.body.appendChild(modal);

      // Set the value directly for jsdom compatibility
      document.getElementById('new-user-role').value = 'director';

      // Mock fetchWithAuth (used by _apiCall) instead of global.fetch
      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true, user: { id: '1', username: 'newuser' } })
      });

      const dashboard = new AdminDashboard();
      await Promise.resolve();

      dashboard.showToast = jest.fn();
      dashboard.loadUsers = jest.fn();
      dashboard.hideCreateUserModal = jest.fn();

      const mockEvent = { preventDefault: jest.fn() };
      await dashboard.handleCreateUser(mockEvent);

      expect(global.window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }));
    });

    test('should validate username format (3-32 chars, starts with letter)', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Create modal with proper DOM methods
      const modal = document.createElement('div');
      modal.id = 'create-user-modal';
      modal.className = 'modal-overlay active';
      modal.innerHTML = `
        <form id="create-user-form">
          <input type="text" id="new-user-username" value="1invalid">
          <input type="password" id="new-user-password" value="password123">
          <select id="new-user-role">
            <option value="">Select</option>
            <option value="director">director</option>
          </select>
          <input type="text" id="new-user-display-name" value="">
          <input type="email" id="new-user-email" value="">
        </form>
      `;
      document.body.appendChild(modal);

      // Set the value directly for jsdom compatibility
      document.getElementById('new-user-role').value = 'director';

      const dashboard = new AdminDashboard();
      await Promise.resolve();

      dashboard.showToast = jest.fn();

      await dashboard.handleCreateUser({ preventDefault: jest.fn() });

      expect(dashboard.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Username must be'),
        'error'
      );
    });

    test('should validate password length (min 8 characters)', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Create modal with proper DOM methods
      const modal = document.createElement('div');
      modal.id = 'create-user-modal';
      modal.className = 'modal-overlay active';
      modal.innerHTML = `
        <form id="create-user-form">
          <input type="text" id="new-user-username" value="validuser">
          <input type="password" id="new-user-password" value="short">
          <select id="new-user-role">
            <option value="">Select</option>
            <option value="director">director</option>
          </select>
          <input type="text" id="new-user-display-name" value="">
          <input type="email" id="new-user-email" value="">
        </form>
      `;
      document.body.appendChild(modal);

      // Set the value directly for jsdom compatibility
      document.getElementById('new-user-role').value = 'director';

      const dashboard = new AdminDashboard();
      await Promise.resolve();

      dashboard.showToast = jest.fn();

      await dashboard.handleCreateUser({ preventDefault: jest.fn() });

      expect(dashboard.showToast).toHaveBeenCalledWith(
        'Password must be at least 8 characters long',
        'error'
      );
    });

    test('should require username, password, and role', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new AdminDashboard();
      await Promise.resolve();

      // Add modal with empty required fields
      const modalHtml = `
        <div id="create-user-modal" class="modal-overlay active">
          <form id="create-user-form">
            <input type="text" id="new-user-username" value="">
            <input type="password" id="new-user-password" value="">
            <select id="new-user-role">
              <option value="" selected>Select</option>
              <option value="director">director</option>
            </select>
          </form>
        </div>
      `;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = modalHtml;
      document.body.appendChild(tempDiv.firstElementChild);

      dashboard.showToast = jest.fn();

      await dashboard.handleCreateUser({ preventDefault: jest.fn() });

      expect(dashboard.showToast).toHaveBeenCalledWith(
        'Username, password, and role are required',
        'error'
      );
    });

    test('should delete user via DELETE /api/admin/users/:id', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true })
      });

      const dashboard = new AdminDashboard();
      dashboard.users = [{ id: 'user-123', username: 'testuser', role: 'director', status: 'active' }];
      dashboard.showToast = jest.fn();
      dashboard.loadUsers = jest.fn();

      global.confirm = jest.fn().mockReturnValue(true);

      await dashboard.deleteUser('user-123');

      expect(global.window.authService.fetchWithAuth).toHaveBeenCalledWith(
        '/api/admin/users/user-123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    test('should prevent deleting the admin user', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new AdminDashboard();
      dashboard.users = [{ id: 'admin-id', username: 'admin', role: 'admin', status: 'active' }];
      dashboard.showToast = jest.fn();

      await dashboard.deleteUser('admin-id');

      expect(dashboard.showToast).toHaveBeenCalledWith('Cannot delete the admin user', 'error');
    });

    test('should update user role via PUT /api/admin/users/:id/role', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Create the modal HTML first
      const modalHtml = `
        <div id="edit-role-modal" class="modal-overlay active">
          <form id="edit-role-form">
            <select id="edit-user-role">
              <option value="">Select</option>
              <option value="admin" selected>admin</option>
            </select>
          </form>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);

      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true })
      });

      const dashboard = new AdminDashboard();
      await Promise.resolve();

      dashboard.editingUserId = 'user-123';
      dashboard.showToast = jest.fn();
      dashboard.loadUsers = jest.fn();
      dashboard.hideEditRoleModal = jest.fn();

      // Verify role is being read correctly
      const roleSelect = document.getElementById('edit-user-role');
      expect(roleSelect.value).toBe('admin');

      const mockEvent = { preventDefault: jest.fn() };
      await dashboard.handleEditRole(mockEvent);

      expect(global.window.authService.fetchWithAuth).toHaveBeenCalledWith(
        '/api/admin/users/user-123/role',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    test('should perform bulk delete via POST /api/admin/users/bulk-delete', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true, deleted: 2, failed: [] })
      });

      const dashboard = new AdminDashboard();
      dashboard.selectedUsers = ['user-1', 'user-2'];
      dashboard.showToast = jest.fn();
      dashboard.loadUsers = jest.fn();
      dashboard.clearSelection = jest.fn();

      global.confirm = jest.fn().mockReturnValue(true);

      await dashboard.bulkDeleteUsers();

      expect(global.window.authService.fetchWithAuth).toHaveBeenCalledWith(
        '/api/admin/users/bulk-delete',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    test('should perform bulk role change via POST /api/admin/users/bulk-role', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Create the modal HTML first
      const modalHtml = `
        <div id="bulk-role-modal" class="modal-overlay active">
          <form id="bulk-role-form">
            <select id="bulk-user-role">
              <option value="">Select</option>
              <option value="director" selected>director</option>
            </select>
          </form>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);

      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true, updated: 2 })
      });

      const dashboard = new AdminDashboard();
      await Promise.resolve();

      dashboard.selectedUsers = ['user-1', 'user-2'];
      dashboard.showToast = jest.fn();
      dashboard.loadUsers = jest.fn();
      dashboard.clearSelection = jest.fn();

      // Verify role is being read correctly
      const roleSelect = document.getElementById('bulk-user-role');
      expect(roleSelect.value).toBe('director');

      const mockEvent = { preventDefault: jest.fn() };
      await dashboard.handleBulkRoleChange(mockEvent);

      expect(global.window.authService.fetchWithAuth).toHaveBeenCalledWith(
        '/api/admin/users/bulk-role',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });
  });

  describe('Permission Checks', () => {
    test('should check permissions using hasPermission helper', () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      global.window.authService.hasPermission = jest.fn().mockReturnValue(true);

      const dashboard = new AdminDashboard();

      const result = dashboard._hasPermission('create', 'user');

      expect(global.window.authService.hasPermission).toHaveBeenCalledWith('user:create', 'user');
      expect(result).toBe(true);
    });

    test('should use _apiCall helper for authenticated requests', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const mockResponse = { ok: true, json: jest.fn().mockResolvedValue({ success: true }) };
      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue(mockResponse);

      const dashboard = new AdminDashboard();

      const result = await dashboard._apiCall('/api/test-endpoint');

      expect(global.window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/test-endpoint', {});
    });
  });

  describe('Toast Notifications', () => {
    test('should show success toast', () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Create toast container (normally created by renderDashboard)
      const toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);

      const dashboard = new AdminDashboard();
      dashboard.showToast('Test message', 'success');

      const toast = document.querySelector('.toast.success');
      expect(toast).toBeTruthy();
      expect(toast.textContent).toBe('Test message');
    });

    test('should show error toast', () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Create toast container (normally created by renderDashboard)
      const toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);

      const dashboard = new AdminDashboard();
      dashboard.showToast('Error message', 'error');

      const toast = document.querySelector('.toast.error');
      expect(toast).toBeTruthy();
      expect(toast.textContent).toBe('Error message');
    });
  });
});
