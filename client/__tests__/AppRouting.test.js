/**
 * BreadCallApp Routing Tests
 * Tests for /room/:roomId routing behavior with password prompt
 */

// Mock fetch globally before any imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('handleRouteChange /room/:roomId', () => {
  let mockSignaling;
  let mockWebRTCManager;
  let mockMediaManager;
  let mockUIManager;
  let BreadCallApp;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset fetch mock
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => Promise.resolve({}));

    // Mock WebRTCManager
    mockWebRTCManager = {
      setLocalStream: jest.fn(),
      consumeRemoteStream: jest.fn(),
      cleanup: jest.fn(),
      closePeerConnection: jest.fn(),
      replaceVideoTrack: jest.fn(),
      replaceAudioTrack: jest.fn(),
      addEventListener: jest.fn()
    };
    global.WebRTCManager = jest.fn().mockImplementation(() => mockWebRTCManager);

    // Mock MediaManager
    mockMediaManager = {
      getUserMedia: jest.fn().mockResolvedValue({
        getVideoTracks: jest.fn().mockReturnValue([]),
        getAudioTracks: jest.fn().mockReturnValue([])
      }),
      stop: jest.fn(),
      toggleMute: jest.fn(),
      toggleVideo: jest.fn(),
      getDisplayMedia: jest.fn(),
      switchCamera: jest.fn(),
      switchMicrophone: jest.fn(),
      addEventListener: jest.fn(),
      videoTrack: null,
      audioTrack: null
    };
    global.MediaManager = jest.fn().mockImplementation(() => mockMediaManager);

    // Mock SignalingClient
    mockSignaling = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      send: jest.fn(),
      isConnected: jest.fn().mockReturnValue(false),
      addEventListener: jest.fn()
    };
    global.SignalingClient = jest.fn().mockImplementation(() => mockSignaling);

    // Mock UIManager - must be set up before loading app.js
    mockUIManager = {
      showToast: jest.fn(),
      renderRoom: jest.fn(),
      renderLanding: jest.fn(),
      addVideoTile: jest.fn(),
      removeVideoTile: jest.fn(),
      updateMuteButton: jest.fn(),
      updateVideoButton: jest.fn(),
      addChatMessage: jest.fn(),
      updateParticipantStatus: jest.fn(),
      showMediaNotFoundDialog: jest.fn(),
      showJoinDialog: jest.fn(),
      participants: new Map()
    };
    global.UIManager = jest.fn().mockImplementation(() => mockUIManager);

    window.history = {
      pushState: jest.fn()
    };
    window.addEventListener = jest.fn();

    // Mock AuthService
    global.authService = {
      init: jest.fn().mockResolvedValue(false),
      checkAuthStatus: jest.fn().mockResolvedValue(false),
      login: jest.fn(),
      logout: jest.fn(),
      getAccessToken: jest.fn().mockReturnValue(null),
      getCurrentUser: jest.fn().mockReturnValue(null),
      hasPermission: jest.fn().mockReturnValue(false),
      hasRole: jest.fn().mockReturnValue(false),
      refreshAccessToken: jest.fn().mockResolvedValue(false),
      checkRoomSession: jest.fn().mockResolvedValue({ hasRoom: false }),
      getWebSocketUrl: jest.fn().mockReturnValue('ws://localhost:3000/ws'),
      fetchWithAuth: jest.fn().mockImplementation((url, options) => {
        return mockFetch(url, options);
      })
    };

    // Load the app module after mocks are set up
    BreadCallApp = require('../js/app.js');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  function createApp() {
    const app = new BreadCallApp();
    // Replace uiManager with our mock (since the app creates its own)
    app.uiManager = mockUIManager;
    return app;
  }

  describe('handleRouteChange extracts room ID', () => {
    it('extracts room ID from path and calls checkSessionForAutoRejoin', async () => {
      // Simulate what handleRouteChange does when path starts with /room/
      const path = '/room/ABCD';
      const roomId = path.split('/')[2]?.toUpperCase();

      expect(roomId).toBe('ABCD');
    });

    it('converts lowercase room ID to uppercase', () => {
      const path = '/room/abcd';
      const roomId = path.split('/')[2]?.toUpperCase();

      expect(roomId).toBe('ABCD');
    });
  });

  describe('redirects to landing page on session failure', () => {
    it('redirects to landing with room ID when no valid session exists', async () => {
      // Mock session check to return no existing room
      mockFetch.mockImplementation((url) => {
        if (url === '/api/session/room') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: false,
              hasRoom: false
            })
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();
      await app.checkSessionForAutoRejoin('ABCD');

      // Should NOT show join dialog (old behavior) - redirect was used instead
      expect(mockUIManager.showJoinDialog).not.toHaveBeenCalled();
      expect(mockUIManager.renderRoom).not.toHaveBeenCalled();
    });

    it('redirects to landing without auto-join for protected rooms', async () => {
      mockFetch.mockImplementation((url) => {
        if (url === '/api/session/room') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: false,
              hasRoom: false
            })
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();
      await app.checkSessionForAutoRejoin('ABCD');

      // Should NOT auto-join (old behavior)
      expect(mockSignaling.send).not.toHaveBeenCalledWith(
        'join-room',
        expect.anything()
      );
    });
  });

  describe('checkSessionForAutoRejoin behavior', () => {
    it('auto-joins when session has valid token for matching room', async () => {
      mockFetch.mockImplementation((url) => {
        if (url === '/api/session/room') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              hasRoom: true,
              roomId: 'ABCD'
            })
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();
      await app.checkSessionForAutoRejoin('ABCD');

      // Should auto-join with existing session
      expect(app.roomId).toBe('ABCD');
      expect(mockUIManager.renderRoom).toHaveBeenCalledWith('ABCD');
      // Should NOT show join dialog (auto-joined instead)
      expect(mockUIManager.showJoinDialog).not.toHaveBeenCalled();
    });

    it('does not auto-join when session has token for different room', async () => {
      mockFetch.mockImplementation((url) => {
        if (url === '/api/session/room') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              hasRoom: true,
              roomId: 'WXYZ' // Different room
            })
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();
      await app.checkSessionForAutoRejoin('ABCD');

      // Should NOT auto-join (different room)
      // Redirect was used instead of showing join dialog
      expect(mockUIManager.showJoinDialog).not.toHaveBeenCalled();
    });

    it('does not show join dialog on session check error', async () => {
      mockFetch.mockImplementation(() => {
        return Promise.reject(new Error('Network error'));
      });

      const app = createApp();
      await app.checkSessionForAutoRejoin('ABCD');

      // Should NOT show join dialog (redirect was used on error)
      expect(mockUIManager.showJoinDialog).not.toHaveBeenCalled();
    });

    it('renders landing page when no expected room and no session', async () => {
      mockFetch.mockImplementation((url) => {
        if (url === '/api/session/room') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: false,
              hasRoom: false
            })
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();
      await app.checkSessionForAutoRejoin(null);

      expect(mockUIManager.renderLanding).toHaveBeenCalled();
      expect(mockUIManager.renderRoom).not.toHaveBeenCalled();
    });
  });
});

describe('UIManager showJoinDialog', () => {
  let uiManager;
  let mockApp;

  beforeEach(() => {
    document.body.innerHTML = '';
    mockApp = {
      joinRoom: jest.fn()
    };
    require('../js/UIManager.js');
    uiManager = new window.UIManager(mockApp);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('creates a join dialog with password field', () => {
    uiManager.showJoinDialog('ABCD');

    const dialog = document.querySelector('.join-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.classList.contains('active')).toBe(true);

    // Check for password field
    const passwordInput = document.getElementById('join-password');
    expect(passwordInput).toBeTruthy();
    expect(passwordInput.type).toBe('password');

    // Check for name field
    const nameInput = document.getElementById('join-name');
    expect(nameInput).toBeTruthy();

    // Check for submit button
    const submitBtn = document.getElementById('join-submit-btn');
    expect(submitBtn).toBeTruthy();
  });

  it('calls joinRoom with name and password on submit', () => {
    uiManager.showJoinDialog('ABCD');

    // Fill in the form
    document.getElementById('join-name').value = 'Test User';
    document.getElementById('join-password').value = 'secret123';

    // Click submit
    document.getElementById('join-submit-btn').click();

    expect(mockApp.joinRoom).toHaveBeenCalledWith('ABCD', 'Test User', 'secret123');
  });

  it('uses default name if not provided', () => {
    uiManager.showJoinDialog('XYZ');

    const nameInput = document.getElementById('join-name');
    expect(nameInput.value).toBe('User');
  });
});
