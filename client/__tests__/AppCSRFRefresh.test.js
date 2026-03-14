/**
 * BreadCallApp CSRF and Token Refresh Tests
 * Tests for CSRF protection and automatic token refresh functionality
 */

// Mock fetch globally before any imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('BreadCallApp - CSRF and Token Refresh', () => {
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

    // Load the app module after mocks are set up
    BreadCallApp = require('../js/app.js');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    // Clear any pending timers
    jest.clearAllTimers();
  });

  function createApp() {
    // Create app instance without calling init
    const app = new BreadCallApp();
    // Note: we don't clear mock here to avoid race conditions with async init calls
    // Tests should set up their own mocks and track calls independently
    return app;
  }

  describe('fetchCsrfToken', () => {
    test('should fetch CSRF token from server', async () => {
      // Setup fetch mock - must be done before creating app instance
      mockFetch.mockImplementation(() => Promise.resolve({
        json: async () => ({
          success: true,
          csrfToken: 'test-csrf-token-123'
        })
      }));

      const app = createApp();
      const csrfToken = await app.fetchCsrfToken();

      expect(csrfToken).toBe('test-csrf-token-123');
      expect(mockFetch).toHaveBeenCalledWith('/api/csrf-token', {
        credentials: 'include'
      });
    });

    test('should throw error when CSRF token fetch fails', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        json: async () => ({
          success: false
        })
      }));

      const app = createApp();

      await expect(app.fetchCsrfToken()).rejects.toThrow('Failed to fetch CSRF token');
    });

    test('should throw error when server returns error', async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')));

      const app = createApp();

      await expect(app.fetchCsrfToken()).rejects.toThrow('Network error');
    });
  });

  describe('refreshTokens', () => {
    test('should refresh tokens with CSRF protection', async () => {
      const mockCsrfToken = 'csrf-token-123';
      const mockRefreshResponse = {
        success: true,
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 900
      };

      // Setup mock BEFORE createApp to handle all fetch calls including init
      mockFetch.mockImplementation((url, options) => {
        // Skip init calls (checkSessionForAutoRejoin runs async without await)
        if (url === '/api/webrtc-config') {
          return Promise.resolve({ json: async () => ({ iceServers: [] }) });
        }
        if (url === '/api/session/room') {
          return Promise.resolve({ json: async () => ({ success: false }) });
        }
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            json: async () => ({
              success: true,
              csrfToken: mockCsrfToken
            })
          });
        }
        if (url === '/api/tokens/refresh') {
          return Promise.resolve({
            json: async () => mockRefreshResponse
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();

      const result = await app.refreshTokens();

      // Verify CSRF token was fetched (call #2, after webrtc-config at #1)
      // Note: session/room may appear at #3 due to async checkSessionForAutoRejoin()
      expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/csrf-token', { credentials: 'include' });

      // Verify tokens were refreshed with CSRF header (call #4, or #3 if no session/room interference)
      const refreshCallIndex = mockFetch.mock.calls.findIndex(call => call[0] === '/api/tokens/refresh');
      expect(refreshCallIndex).toBeGreaterThan(0);
      const refreshCall = mockFetch.mock.calls[refreshCallIndex];
      expect(refreshCall[0]).toBe('/api/tokens/refresh');
      expect(refreshCall[1]).toEqual({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': mockCsrfToken
        }
      });

      expect(result.success).toBe(true);
      expect(app.tokenExpiryTime).toBeDefined();
    });

    test('should throw error when token refresh fails', async () => {
      let refreshCallCount = 0;

      // Setup mock BEFORE createApp to handle all fetch calls including init
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/webrtc-config') {
          return Promise.resolve({
            json: async () => ({ iceServers: [] })
          });
        }
        if (url === '/api/session/room') {
          return Promise.resolve({
            json: async () => ({ success: false })
          });
        }
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            json: async () => ({
              success: true,
              csrfToken: 'csrf-token'
            })
          });
        }
        if (url === '/api/tokens/refresh') {
          refreshCallCount++;
          return Promise.resolve({
            json: async () => ({
              success: false,
              error: 'refresh_invalid'
            })
          });
        }
        return Promise.resolve({ json: async () => ({}) });
      });

      const app = createApp();

      await expect(app.refreshTokens()).rejects.toThrow('refresh_invalid');
      expect(refreshCallCount).toBe(1);
    });
  });

  describe('scheduleTokenRefresh', () => {
    test('should schedule refresh for 1 minute before expiry', async () => {
      const fs = require('fs');
      const path = require('path');
      const debugFile = path.join(__dirname, 'debug-log.txt');
      fs.writeFileSync(debugFile, '[TEST] Starting test\n');

      const fixedTime = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(fixedTime);

      let refreshCallCount = 0;
      let scheduledCallback = null;
      let scheduleCallCount = 0;
      let allSetTimeoutDelays = [];

      // Mock setTimeout to capture ALL callbacks (init might also set timers)
      const originalSetTimeout = setTimeout;
      const setTimeoutMock = jest.fn((cb, delay) => {
        // Track all delays for debugging
        allSetTimeoutDelays.push(delay);
        fs.appendFileSync(debugFile, `[TEST] setTimeout called with delay: ${delay}\n`);
        // Only capture callbacks with reasonable delays (token refresh uses ~14 min delay)
        if (delay > 10000) {
          scheduledCallback = cb;
          scheduleCallCount++;
          fs.appendFileSync(debugFile, `[TEST] Captured callback with delay: ${delay}\n`);
        }
        return { _timerId: scheduleCallCount, delay };
      });
      global.setTimeout = setTimeoutMock;

      // Setup mock BEFORE createApp to handle all fetch calls including init
      mockFetch.mockImplementation((url, options) => {
        fs.appendFileSync(debugFile, `[FETCH] Called with URL: ${url}\n`);
        // Skip init calls (checkSessionForAutoRejoin runs async without await)
        if (url === '/api/webrtc-config') {
          return Promise.resolve({ json: async () => ({ iceServers: [] }) });
        }
        if (url === '/api/session/room') {
          return Promise.resolve({ json: async () => ({ success: false }) });
        }
        if (url === '/api/csrf-token') {
          return Promise.resolve({
            json: async () => ({
              success: true,
              csrfToken: 'csrf-token'
            })
          });
        } else if (url === '/api/tokens/refresh') {
          refreshCallCount++;
          fs.appendFileSync(debugFile, `[FETCH] tokens/refresh called, count: ${refreshCallCount}\n`);
          return Promise.resolve({
            json: async () => ({
              success: true,
              accessToken: 'new-token',
              refreshToken: 'new-refresh',
              expiresIn: 900
            })
          });
        }
        return Promise.resolve({});
      });

      fs.appendFileSync(debugFile, '[TEST] About to createApp\n');
      const app = createApp();
      fs.appendFileSync(debugFile, '[TEST] app created, mockFetch calls: ' + mockFetch.mock.calls.length + '\n');

      const timeUntilExpiry = 15 * 60 * 1000; // 15 minutes
      app.tokenExpiryTime = fixedTime + timeUntilExpiry;
      fs.appendFileSync(debugFile, '[TEST] tokenExpiryTime set, calling scheduleTokenRefresh\n');

      app.scheduleTokenRefresh();
      fs.appendFileSync(debugFile, '[TEST] scheduleTokenRefresh called\n');
      fs.appendFileSync(debugFile, '[TEST] All setTimeout delays: ' + JSON.stringify(allSetTimeoutDelays) + '\n');
      fs.appendFileSync(debugFile, '[TEST] scheduledCallback defined: ' + (scheduledCallback !== null) + '\n');
      fs.appendFileSync(debugFile, '[TEST] scheduleCallCount: ' + scheduleCallCount + '\n');
      fs.appendFileSync(debugFile, '[TEST] mockFetch.calls count: ' + mockFetch.mock.calls.length + '\n');

      expect(scheduledCallback).toBeDefined();

      // Fast-forward time by calling the callback directly
      // The callback should be the refreshTokens call
      // Note: callback needs proper 'this' binding to app instance
      // IMPORTANT: The callback internally calls refreshTokens() which is async,
      // so we need to await the refreshTokens call directly, not just the callback
      if (scheduledCallback) {
        fs.appendFileSync(debugFile, '[TEST] About to invoke callback\n');
        // Call the callback (which starts the async refreshTokens)
        scheduledCallback.call(app);
        // Wait for async operations to complete using microtask ticks
        // refreshTokens() -> fetchCsrfToken() -> fetch() -> json() each need a tick
        await Promise.resolve(); // tick 1: fetchCsrfToken promise resolves
        await Promise.resolve(); // tick 2: fetch response promise resolves
        await Promise.resolve(); // tick 3: response.json() promise resolves
        await Promise.resolve(); // tick 4: refreshTokens promise resolves
        fs.appendFileSync(debugFile, '[TEST] Callback invoked, mockFetch.calls count now: ' + mockFetch.mock.calls.length + '\n');
        fs.appendFileSync(debugFile, '[TEST] refreshCallCount: ' + refreshCallCount + '\n');
      } else {
        fs.appendFileSync(debugFile, '[TEST] scheduledCallback was null/undefined\n');
      }

      fs.appendFileSync(debugFile, '[TEST] Final refreshCallCount: ' + refreshCallCount + '\n');

      // Refresh should have been called
      expect(refreshCallCount).toBe(1);

      // Restore original setTimeout
      global.setTimeout = originalSetTimeout;
      Date.now.mockRestore();
    });

    test('should clear existing timer before scheduling new one', () => {
      const app = createApp();
      app.tokenExpiryTime = Date.now() + (15 * 60 * 1000);

      // Schedule first refresh
      app.scheduleTokenRefresh();
      const firstTimerId = app.refreshTimerId;

      // Schedule second refresh
      app.tokenExpiryTime = Date.now() + (15 * 60 * 1000);
      app.scheduleTokenRefresh();
      const secondTimerId = app.refreshTimerId;

      // Should have different timer IDs (first one cleared)
      expect(firstTimerId).not.toBe(secondTimerId);
    });

    test('should handle immediate refresh when token is already expired', async () => {
      const app = createApp();
      app.tokenExpiryTime = Date.now() - 1000; // Already expired

      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          csrfToken: 'csrf-token'
        })
      });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          accessToken: 'new-token',
          expiresIn: 900
        })
      });

      app.scheduleTokenRefresh();

      // Should trigger immediate refresh
      expect(mockFetch).toHaveBeenCalledWith('/api/csrf-token', expect.anything());
    });
  });

  describe('clearTokenRefreshTimer', () => {
    test('should clear refresh timer and reset expiry time', () => {
      const app = createApp();
      app.tokenExpiryTime = Date.now() + (15 * 60 * 1000);
      app.refreshTimerId = setTimeout(() => {}, 1000);

      expect(app.refreshTimerId).toBeDefined();
      expect(app.tokenExpiryTime).toBeDefined();

      app.clearTokenRefreshTimer();

      expect(app.refreshTimerId).toBeNull();
      expect(app.tokenExpiryTime).toBeNull();
    });
  });

  describe('Integration: Token refresh on join', () => {
    test('should schedule token refresh after joining room', () => {
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

        // Should have set token expiry time
        expect(app.tokenExpiryTime).toBeDefined();

        // Should be approximately 15 minutes from now
        const expectedExpiry = Date.now() + (15 * 60 * 1000);
        expect(app.tokenExpiryTime).toBeCloseTo(expectedExpiry, -2); // Within 100ms

        // Should have scheduled refresh
        expect(app.refreshTimerId).toBeDefined();
      }
    });
  });

  describe('Integration: Token refresh cleanup on leave', () => {
    test('should clear token refresh timer when leaving room', () => {
      const app = createApp();

      // Set up token refresh
      app.tokenExpiryTime = Date.now() + (15 * 60 * 1000);
      app.refreshTimerId = setTimeout(() => {}, 1000);

      // Call leaveRoom
      app.leaveRoom();

      // Timer should be cleared
      expect(app.refreshTimerId).toBeNull();
      expect(app.tokenExpiryTime).toBeNull();
    });
  });

  describe('Integration: Token refresh cleanup on error', () => {
    test('should clear token refresh timer on error during join', () => {
      const app = createApp();

      // Set up token refresh
      app.tokenExpiryTime = Date.now() + (15 * 60 * 1000);
      app.refreshTimerId = setTimeout(() => {}, 1000);

      // Simulate error event during join
      const errorHandler = mockSignaling.addEventListener.mock.calls.find(
        call => call[0] === 'error'
      );

      if (errorHandler) {
        const [, handler] = errorHandler;
        app.isJoining = true;

        // Trigger the error event
        handler({
          detail: {
            message: 'Connection failed'
          }
        });

        // Timer should be cleared
        expect(app.refreshTimerId).toBeNull();
        expect(app.tokenExpiryTime).toBeNull();
      }
    });
  });
});
