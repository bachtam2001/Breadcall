/**
 * BreadCallApp AuthService Integration Tests
 * Tests for memory-based access token with refresh token cookie authentication
 */

// Mock fetch globally before any imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('BreadCallApp - AuthService Integration', () => {
  let app;
  let mockSignaling;
  let mockWebRTCManager;
  let mockMediaManager;
  let mockUIManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset fetch mock and provide default no-op implementation
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

    // Mock UIManager
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
      participants: new Map()
    };
    global.UIManager = jest.fn().mockImplementation(() => mockUIManager);

    // Mock window.location properties (jsdom already provides window)
    window.location = {
      pathname: '/',
      host: 'localhost:3000',
      protocol: 'http:',
      href: 'http://localhost:3000/',
      pushState: jest.fn()
    };
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
      getWebSocketUrl: jest.fn().mockReturnValue('ws://localhost:3000/ws')
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
    return app;
  }

  describe('App initialization', () => {
    test('should create app instance without token refresh properties', () => {
      const app = createApp();

      // App should not have old token refresh properties
      expect(app.refreshTimerId).toBeUndefined();
      expect(app.tokenExpiryTime).toBeUndefined();
    });

    test('should initialize with WebRTC config fetch', async () => {
      mockFetch.mockImplementation((url) => {
        if (url === '/api/webrtc-config') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              webrtcUrl: 'http://localhost:8887',
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            })
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();

      // Wait for async init
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledWith('/api/webrtc-config');
    });
  });

  describe('AuthService delegation', () => {
    test('should not implement fetchCsrfToken (removed)', () => {
      const app = createApp();

      // Old CSRF method should not exist
      expect(app.fetchCsrfToken).toBeUndefined();
    });

    test('should not implement refreshTokens (moved to AuthService)', () => {
      const app = createApp();

      // Old refresh method should not exist
      expect(app.refreshTokens).toBeUndefined();
    });

    test('should not implement scheduleTokenRefresh (moved to AuthService)', () => {
      const app = createApp();

      // Old schedule method should not exist
      expect(app.scheduleTokenRefresh).toBeUndefined();
    });

    test('should not implement clearTokenRefreshTimer (moved to AuthService)', () => {
      const app = createApp();

      // Old clear method should not exist
      expect(app.clearTokenRefreshTimer).toBeUndefined();
    });
  });

  describe('Room join without token management', () => {
    test('should handle joined-room event without scheduling token refresh', () => {
      const app = createApp();

      // Simulate joined-room event
      const joinedRoomHandler = mockSignaling.addEventListener.mock.calls.find(
        call => call[0] === 'joined-room'
      );

      if (joinedRoomHandler) {
        const [, handler] = joinedRoomHandler;

        // Trigger the event
        handler({
          detail: {
            participantId: 'test-participant',
            existingPeers: [],
            room: { id: 'ABCD', codec: 'H264' }
          }
        });

        // App should not have old token management properties
        expect(app.tokenExpiryTime).toBeUndefined();
        expect(app.refreshTimerId).toBeUndefined();

        // But should have set participantId and room data
        expect(app.participantId).toBe('test-participant');
      }
    });
  });

  describe('leaveRoom cleanup', () => {
    test('should handle leaveRoom without clearing token refresh timer', () => {
      const app = createApp();

      // Call leaveRoom
      app.leaveRoom();

      // Should disconnect signaling
      expect(mockSignaling.send).toHaveBeenCalledWith('leave-room');
      expect(mockSignaling.disconnect).toHaveBeenCalled();
    });
  });

  describe('error handling without token refresh cleanup', () => {
    test('should handle error event without clearing token refresh timer', () => {
      const app = createApp();

      // Simulate error event
      const errorHandler = mockSignaling.addEventListener.mock.calls.find(
        call => call[0] === 'error'
      );

      if (errorHandler) {
        const [, handler] = jest.mocked(errorHandler);
        app.isJoining = true;

        // Trigger the error event
        handler({
          detail: {
            message: 'Connection failed'
          }
        });

        // App should not have old token management properties
        expect(app.tokenExpiryTime).toBeUndefined();
        expect(app.refreshTimerId).toBeUndefined();
      }
    });
  });
});
