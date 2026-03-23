/**
 * AdminDashboard Tests
 * Tests for copyRoomLink and other AdminDashboard functionality
 */

// Suppress navigation errors from jsdom
const originalError = console.error;
console.error = (...args) => {
  if (args[0] && args[0].message && args[0].message.includes('Not implemented: navigation')) {
    return;
  }
  originalError.apply(console, args);
};

describe('AdminDashboard - copyRoomLink', () => {
  let AdminDashboard;
  let originalClipboard;
  let originalLocationOrigin;

  beforeEach(() => {
    // Store original clipboard
    originalClipboard = global.navigator?.clipboard;

    // Store original location.origin
    originalLocationOrigin = global.window.location.origin;

    // Mock navigator.clipboard
    if (!global.navigator) {
      global.navigator = {};
    }
    global.navigator.clipboard = {
      writeText: jest.fn()
    };

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
    // Restore clipboard
    if (originalClipboard) {
      global.navigator.clipboard = originalClipboard;
    }
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('copyRoomLink', () => {
    test('should copy plain room URL without token', async () => {
      // Mock clipboard writeText to resolve successfully
      const mockWriteText = jest.fn().mockResolvedValue();
      global.navigator.clipboard.writeText = mockWriteText;

      // Create instance - need to mock document.getElementById for constructor
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new AdminDashboard();

      // Mock showToast to verify it's called with correct message
      dashboard.showToast = jest.fn();

      // Call copyRoomLink
      await dashboard.copyRoomLink('ABCD', 'mypassword');

      // Get the origin from window.location (jsdom default is about:blank)
      const expectedOrigin = global.window.location.origin === 'null' || global.window.location.origin === 'about:blank'
        ? ''
        : global.window.location.origin;

      // Verify clipboard was called with plain URL (no token)
      expect(mockWriteText).toHaveBeenCalledTimes(1);
      const calledUrl = mockWriteText.mock.calls[0][0];
      expect(calledUrl).toMatch(/\/room\/ABCD$/);
      expect(calledUrl).not.toMatch(/\?/);
      expect(calledUrl).not.toMatch(/token=/);

      // Verify success message mentions password on join (not token)
      expect(dashboard.showToast).toHaveBeenCalledWith(
        'Room link copied! Users will enter password on join.',
        'success'
      );
    });

    test('should copy URL without any query parameters', async () => {
      const mockWriteText = jest.fn().mockResolvedValue();
      global.navigator.clipboard.writeText = mockWriteText;

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new AdminDashboard();
      dashboard.showToast = jest.fn();

      await dashboard.copyRoomLink('XYZ123', null);

      const copiedUrl = mockWriteText.mock.calls[0][0];

      // Verify URL has no query parameters (no ?token= or any other params)
      expect(copiedUrl).toMatch(/\/room\/XYZ123$/);
      expect(copiedUrl).not.toMatch(/\?/);
      expect(copiedUrl).not.toMatch(/token=/);
    });

    test('should show error toast on clipboard failure', async () => {
      const mockWriteText = jest.fn().mockRejectedValue(new Error('Clipboard error'));
      global.navigator.clipboard.writeText = mockWriteText;

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new AdminDashboard();
      dashboard.showToast = jest.fn();

      // Mock fetchWithAuth to prevent loadRooms from failing
      global.window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true, rooms: [] })
      });

      await dashboard.copyRoomLink('ABCD', null);

      // Wait for promise to resolve
      await Promise.resolve();

      expect(dashboard.showToast).toHaveBeenCalledWith(
        'Failed to copy link',
        'error'
      );
    });

    test('should NOT call /api/tokens endpoint for copyRoomLink', async () => {
      // Mock clipboard to resolve
      global.navigator.clipboard.writeText = jest.fn().mockResolvedValue();

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      // Track calls specifically for /api/tokens
      var tokensEndpointCalled = false;

      // Mock fetchWithAuth to return empty rooms for constructor
      // but track if /api/tokens is ever called
      global.window.authService.fetchWithAuth = jest.fn().mockImplementation(function(url) {
        if (url && url.includes('/api/tokens')) {
          tokensEndpointCalled = true;
        }
        return Promise.resolve({
          json: jest.fn().mockResolvedValue({ success: true, rooms: [] })
        });
      });

      const dashboard = new AdminDashboard();
      dashboard.showToast = jest.fn();

      await dashboard.copyRoomLink('ABCD', null);

      // Verify /api/tokens was NOT called by copyRoomLink
      expect(tokensEndpointCalled).toBe(false);
    });
  });
});
