/**
 * DirectorDashboard Tests
 * Tests for room management functionality
 */

describe('DirectorDashboard', () => {
  let DirectorDashboard;

  beforeEach(() => {
    // Mock authService
    window.authService = {
      init: jest.fn().mockResolvedValue(true),
      checkAuthStatus: jest.fn().mockResolvedValue(true),
      login: jest.fn().mockResolvedValue({ success: true }),
      logout: jest.fn().mockResolvedValue(),
      hasPermission: jest.fn().mockReturnValue(true),
      fetchWithAuth: jest.fn(),
      getCurrentUser: jest.fn().mockReturnValue({ id: 'director-user', role: 'director' }),
      getToken: jest.fn().mockReturnValue('mock-token')
    };

    // Load DirectorDashboard
    require('../js/DirectorDashboard.js');
    DirectorDashboard = global.DirectorDashboard;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('Room Management', () => {
    test('should show create room button for admin users', async () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'admin-user', role: 'admin' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      // Wait for init to complete
      await Promise.resolve();

      expect(document.getElementById('create-room-btn')).toBeTruthy();
    });

    test('should show create room button for director users', async () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'director-user', role: 'director' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      await Promise.resolve();

      expect(document.getElementById('create-room-btn')).toBeTruthy();
    });

    test('should create room via POST /api/rooms using fetchWithAuth', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true, roomId: 'ABCD' })
      });

      const dashboard = new DirectorDashboard();
      dashboard.loadRooms = jest.fn();
      dashboard.showToast = jest.fn();

      const result = await dashboard.createRoom({ maxParticipants: 10, quality: '720p', codec: 'H264' });

      expect(window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/rooms', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxParticipants: 10, quality: '720p', codec: 'H264' })
      }));
      expect(result.success).toBe(true);
    });

    test('should show error toast when room creation fails', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: false, error: 'Room name already exists' })
      });

      const dashboard = new DirectorDashboard();
      dashboard.loadRooms = jest.fn();
      dashboard.showToast = jest.fn();

      const result = await dashboard.createRoom({ maxParticipants: 10 });

      expect(dashboard.showToast).toHaveBeenCalledWith('Room name already exists', 'error');
      expect(result.success).toBe(false);
    });

    test('should delete room via DELETE /api/rooms/:id using fetchWithAuth', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true })
      });

      const dashboard = new DirectorDashboard();
      dashboard.rooms = [{ roomId: 'ABCD', name: 'Test Room' }];
      dashboard.showToast = jest.fn();
      dashboard.loadRooms = jest.fn();

      global.confirm = jest.fn().mockReturnValue(true);

      await dashboard.deleteRoom('ABCD');

      expect(window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/rooms/ABCD', expect.objectContaining({
        method: 'DELETE'
      }));
      expect(dashboard.showToast).toHaveBeenCalledWith('Room deleted successfully', 'success');
    });

    test('should show admin link only for admin users', async () => {
      // Test with admin user
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'admin-user', role: 'admin' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const adminDashboard = new DirectorDashboard();

      // Wait for init to complete
      await Promise.resolve();

      const adminLink = document.querySelector('a[href="/admin"]');
      expect(adminLink).toBeTruthy();

      // Clean up and test with director user
      document.body.innerHTML = '';

      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'director-user', role: 'director' });

      const mockElement2 = document.createElement('div');
      mockElement2.id = 'app';
      document.body.appendChild(mockElement2);

      const directorDashboard = new DirectorDashboard();

      // Wait for init to complete
      await Promise.resolve();

      const adminLinkForDirector = document.querySelector('a[href="/admin"]');
      expect(adminLinkForDirector).toBeFalsy();
    });

    test('should load rooms from /api/rooms', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const mockRooms = [
        { roomId: 'ROOM1', name: 'Room 1' },
        { roomId: 'ROOM2', name: 'Room 2' }
      ];

      window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, rooms: mockRooms })
      });

      const dashboard = new DirectorDashboard();

      await Promise.resolve();

      expect(window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/rooms', expect.objectContaining({
        credentials: 'include'
      }));
    });

    test('should show all rooms returned by server (server filters by ownership)', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const mockRooms = [
        { roomId: 'ROOM1', name: 'Room 1' },
        { roomId: 'ROOM3', name: 'Room 3' }
      ];

      window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, rooms: mockRooms })
      });

      const dashboard = new DirectorDashboard();

      // Wait for loadRooms to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // All rooms from server should be shown (server already filters by ownership)
      expect(dashboard.rooms.length).toBe(2);
      expect(dashboard.rooms.map(r => r.roomId)).toEqual(['ROOM1', 'ROOM3']);
    });

    test('should update room settings via PUT /api/rooms/:id/settings using fetchWithAuth', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true })
      });

      const dashboard = new DirectorDashboard();
      dashboard.showToast = jest.fn();
      dashboard.loadRooms = jest.fn();

      const result = await dashboard.updateRoomSettings('ROOM1', {
        quality: '1080p',
        codec: 'H265',
        maxParticipants: 10
      });

      expect(window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/rooms/ROOM1/settings', expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quality: '1080p',
          codec: 'H265',
          maxParticipants: 10
        })
      }));
      expect(result.success).toBe(true);
    });

    test('should load participants via GET /api/rooms/:id/participants', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const mockParticipants = [
        { participantId: 'p1', name: 'Participant 1', status: 'active' },
        { participantId: 'p2', name: 'Participant 2', status: 'active' }
      ];

      window.authService.fetchWithAuth = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ success: true, participants: mockParticipants })
      });

      const dashboard = new DirectorDashboard();

      const result = await dashboard.loadRoomParticipants('ROOM1');

      expect(window.authService.fetchWithAuth).toHaveBeenCalledWith('/api/rooms/ROOM1/participants');
      expect(result).toEqual(mockParticipants);
    });
  });

  describe('Access Control', () => {
    test('should have director access for director role', () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'user1', role: 'director' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      expect(dashboard.hasDirectorAccess()).toBe(true);
    });

    test('should have director access for admin role', () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'user1', role: 'admin' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      expect(dashboard.hasDirectorAccess()).toBe(true);
    });

    test('should have director access for operator role', () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'user1', role: 'operator' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      expect(dashboard.hasDirectorAccess()).toBe(true);
    });

    test('should NOT have director access for participant role', () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'user1', role: 'participant' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = Object.create(DirectorDashboard.prototype);

      expect(dashboard.hasDirectorAccess()).toBe(false);
    });

    test('should identify admin access correctly', () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'user1', role: 'admin' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      expect(dashboard.hasAdminAccess()).toBe(true);
    });

    test('should NOT identify admin access for non-admin roles', () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'user1', role: 'director' });

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      expect(dashboard.hasAdminAccess()).toBe(false);
    });
  });

  describe('UI Rendering', () => {
    test('should render room cards with stats and info', () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      const room = { roomId: 'ABCD', participantCount: 3, maxParticipants: 10, quality: '720p', codec: 'H264' };
      const html = dashboard.renderRoomCard(room);

      expect(html).toContain('Room ABCD');
      expect(html).toContain('data-room-id="ABCD"');
      expect(html).toContain('Participants');
      expect(html).toContain('Quality');
      expect(html).toContain('Copy Link');
    });

    test('should render action buttons for all users (server enforces ownership)', () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'director', role: 'director' });
      const dashboard = new DirectorDashboard();

      const room = { roomId: 'ROOM1', name: 'Test Room' };
      const html = dashboard.renderRoomCard(room);

      // Action buttons shown for all users - server enforces ownership checks
      expect(html).toContain('btn-participants');
      expect(html).toContain('btn-settings');
      expect(html).toContain('btn-delete-room');
    });

    test('should render access denied for users without director access', () => {
      window.authService.getCurrentUser = jest.fn().mockReturnValue({ id: 'user1', role: 'participant' });
      window.authService.init = jest.fn().mockResolvedValue(true);

      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = Object.create(DirectorDashboard.prototype);
      dashboard.isLoggedIn = true;
      dashboard.appElement = mockElement;

      dashboard.renderAccessDenied();

      expect(document.querySelector('.access-denied')).toBeTruthy();
      expect(document.querySelector('.denied-icon')).toBeTruthy();
    });
  });

  describe('Logout', () => {
    test('should logout and redirect to login page', async () => {
      const mockElement = document.createElement('div');
      mockElement.id = 'app';
      document.body.appendChild(mockElement);

      const dashboard = new DirectorDashboard();

      // Mock redirectToLogin to avoid jsdom navigation issues
      let redirectedTo = null;
      dashboard.redirectToLogin = () => {
        redirectedTo = '/login';
      };

      await dashboard.logout();

      expect(window.authService.logout).toHaveBeenCalled();
      expect(redirectedTo).toBe('/login');
    });
  });
});
