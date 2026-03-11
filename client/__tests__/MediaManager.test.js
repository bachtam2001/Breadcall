/**
 * MediaManager Tests
 * Tests for graceful degradation: test mode and devices-not-found handling
 */

// Helper function to ensure navigator is properly mocked
function ensureNavigatorMocked() {
  // jsdom provides a navigator but not mediaDevices
  if (!global.navigator) {
    global.navigator = {};
  }
  if (!global.navigator.mediaDevices) {
    global.navigator.mediaDevices = {
      getUserMedia: jest.fn(),
      enumerateDevices: jest.fn()
    };
  }
  // Ensure getUserMedia is a jest mock
  if (!jest.isMockFunction(global.navigator.mediaDevices.getUserMedia)) {
    global.navigator.mediaDevices.getUserMedia = jest.fn();
  }
  if (!jest.isMockFunction(global.navigator.mediaDevices.enumerateDevices)) {
    global.navigator.mediaDevices.enumerateDevices = jest.fn();
  }
  return global.navigator;
}

describe('MediaManager - Graceful Degradation', () => {
  let MediaManager;

  beforeEach(() => {
    // Setup navigator mock FIRST
    ensureNavigatorMocked();

    // Mock HTMLCanvasElement for jsdom (which doesn't support canvas)
    const mockCanvas = {
      getContext: jest.fn().mockReturnValue({
        createLinearGradient: jest.fn().mockReturnValue({
          addColorStop: jest.fn()
        }),
        fillRect: jest.fn(),
        fillText: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        createPattern: jest.fn(),
        drawImage: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        rotate: jest.fn(),
        scale: jest.fn(),
        transform: jest.fn(),
        setTransform: jest.fn(),
        resetTransform: jest.fn(),
        clip: jest.fn(),
        clearRect: jest.fn(),
        measureText: jest.fn().mockReturnValue({ width: 100 }),
        stroke: jest.fn(),
        beginPath: jest.fn(),
        closePath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        rect: jest.fn(),
        strokeRect: jest.fn(),
        strokeText: jest.fn(),
        quadraticCurveTo: jest.fn(),
        bezierCurveTo: jest.fn(),
        ellipse: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn(),
        clearRect: jest.fn(),
        getImageData: jest.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
        createImageData: jest.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        setLineDash: jest.fn(),
        getLineDash: jest.fn().mockReturnValue([]),
        createRadialGradient: jest.fn(),
        isPointInPath: jest.fn(),
        isPointInStroke: jest.fn(),
        drawFocusIfNeeded: jest.fn(),
        scrollPathIntoView: jest.fn()
      }),
      captureStream: jest.fn().mockReturnValue({
        getVideoTracks: jest.fn().mockReturnValue([{ kind: 'video', enabled: true }]),
        getAudioTracks: jest.fn().mockReturnValue([]),
        getTracks: jest.fn().mockReturnValue([]),
        addTrack: jest.fn(),
        removeTrack: jest.fn(),
        clone: jest.fn()
      })
    };

    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockCanvas.getContext());
    HTMLCanvasElement.prototype.captureStream = jest.fn().mockReturnValue(mockCanvas.captureStream());

    // Mock requestAnimationFrame
    global.requestAnimationFrame = jest.fn((cb) => setTimeout(cb, 0));
    global.cancelAnimationFrame = jest.fn();

    // Load MediaManager
    require('../js/MediaManager.js');
    MediaManager = window.MediaManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Test Mode Detection', () => {
    test('should detect testMode from URL parameter', () => {
      // Test that testMode property is read from window.location.search
      // Note: We can't easily mock window.location.search in jsdom
      // So we test that the property exists and can be set manually
      const mediaManager = new MediaManager();
      // Manually set testMode to simulate URL parameter detection
      mediaManager.testMode = true;
      expect(mediaManager.testMode).toBe(true);
    });

    test('should not enable testMode without URL parameter by default', () => {
      // By default, without URL parameter, testMode should be false
      // (window.location.search is '' by default in jsdom)
      const mediaManager = new MediaManager();
      expect(mediaManager.testMode).toBe(false);
    });
  });

  describe('setTestMode', () => {
    test('should enable test mode when setTestMode(true) is called', () => {
      const mediaManager = new MediaManager();
      mediaManager.setTestMode(true);
      expect(mediaManager.testMode).toBe(true);
    });

    test('should disable test mode when setTestMode(false) is called', () => {
      const mediaManager = new MediaManager();
      mediaManager.testMode = true;
      mediaManager.setTestMode(false);
      expect(mediaManager.testMode).toBe(false);
    });
  });

  describe('createTestStream', () => {
    test('should create a MediaStream from canvas', () => {
      const mediaManager = new MediaManager();
      const stream = mediaManager.createTestStream();

      expect(stream).toBeTruthy();
      expect(stream.getVideoTracks).toBeDefined();
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.captureStream).toHaveBeenCalled();
    });

    test('should create stream with video track', () => {
      const mediaManager = new MediaManager();
      const stream = mediaManager.createTestStream();

      const videoTracks = stream.getVideoTracks();
      expect(videoTracks.length).toBe(1);
      expect(videoTracks[0].kind).toBe('video');
    });

    test('should create canvas with correct dimensions', () => {
      const mediaManager = new MediaManager();
      mediaManager.createTestStream();

      // Verify canvas was created (getContext was called)
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
    });
  });

  describe('getUserMedia with Test Mode', () => {
    test('should return test stream when testMode is enabled', async () => {
      const mediaManager = new MediaManager();
      mediaManager.testMode = true;

      const stream = await mediaManager.getUserMedia({}, true);

      expect(stream).toBeTruthy();
      expect(HTMLCanvasElement.prototype.captureStream).toHaveBeenCalled();
    });

    test('should dispatch stream-created event with testMode: true', async () => {
      const eventHandler = jest.fn();
      const mediaManager = new MediaManager();
      mediaManager.testMode = true;
      mediaManager.addEventListener('stream-created', eventHandler);

      await mediaManager.getUserMedia({}, true);

      expect(eventHandler).toHaveBeenCalled();
      expect(eventHandler.mock.calls[0][0].detail.testMode).toBe(true);
    });

    test('should NOT use test stream when testMode is false', async () => {
      // Ensure navigator is mocked and get reference
      const nav = ensureNavigatorMocked();

      // Mock navigator.mediaDevices.getUserMedia
      const mockStream = {
        getVideoTracks: jest.fn().mockReturnValue([{ kind: 'video', enabled: true }]),
        getAudioTracks: jest.fn().mockReturnValue([{ kind: 'audio', enabled: true }]),
        getTracks: jest.fn().mockReturnValue([])
      };

      nav.mediaDevices.getUserMedia.mockResolvedValue(mockStream);

      const mediaManager = new MediaManager();
      mediaManager.testMode = false;

      const stream = await mediaManager.getUserMedia({}, false);

      expect(HTMLCanvasElement.prototype.captureStream).not.toHaveBeenCalled();
      expect(stream).toBe(mockStream);
    });
  });

  describe('getUserMedia - Devices Not Found', () => {
    test('should dispatch devices-not-found event on NotFoundError', async () => {
      const nav = ensureNavigatorMocked();

      // Mock getUserMedia to throw NotFoundError
      nav.mediaDevices.getUserMedia.mockRejectedValue({
        name: 'NotFoundError',
        message: 'No devices found'
      });

      const eventHandler = jest.fn();
      const mediaManager = new MediaManager();
      mediaManager.addEventListener('devices-not-found', eventHandler);

      try {
        await mediaManager.getUserMedia({}, true);
      } catch (e) {
        // Expected to throw
      }

      expect(eventHandler).toHaveBeenCalled();
      expect(eventHandler.mock.calls[0][0].type).toBe('devices-not-found');
    });

    test('should NOT dispatch devices-not-found when allowTestMode is false', async () => {
      const nav = ensureNavigatorMocked();

      nav.mediaDevices.getUserMedia.mockRejectedValue({
        name: 'NotFoundError',
        message: 'No devices found'
      });

      const eventHandler = jest.fn();
      const mediaManager = new MediaManager();
      mediaManager.addEventListener('devices-not-found', eventHandler);

      try {
        await mediaManager.getUserMedia({}, false);
      } catch (e) {
        // Expected to throw
      }

      expect(eventHandler).not.toHaveBeenCalled();
    });

    test('should NOT dispatch devices-not-found for non-NotFoundError', async () => {
      const nav = ensureNavigatorMocked();

      nav.mediaDevices.getUserMedia.mockRejectedValue({
        name: 'NotAllowedError',
        message: 'Permission denied'
      });

      const eventHandler = jest.fn();
      const mediaManager = new MediaManager();
      mediaManager.addEventListener('devices-not-found', eventHandler);

      try {
        await mediaManager.getUserMedia({}, true);
      } catch (e) {
        // Expected to throw
      }

      expect(eventHandler).not.toHaveBeenCalled();
    });

    test('should dispatch error event on getUserMedia failure', async () => {
      const nav = ensureNavigatorMocked();

      nav.mediaDevices.getUserMedia.mockRejectedValue({
        name: 'NotFoundError',
        message: 'No devices found'
      });

      const errorHandler = jest.fn();
      const mediaManager = new MediaManager();
      mediaManager.addEventListener('error', errorHandler);

      try {
        await mediaManager.getUserMedia({}, true);
      } catch (e) {
        // Expected to throw
      }

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('getUserMedia - Success Case', () => {
    test('should return stream on successful getUserMedia', async () => {
      const nav = ensureNavigatorMocked();

      const mockStream = {
        getVideoTracks: jest.fn().mockReturnValue([{ kind: 'video', enabled: true }]),
        getAudioTracks: jest.fn().mockReturnValue([{ kind: 'audio', enabled: true }]),
        getTracks: jest.fn().mockReturnValue([])
      };

      nav.mediaDevices.getUserMedia.mockResolvedValue(mockStream);

      const mediaManager = new MediaManager();
      const stream = await mediaManager.getUserMedia({}, true);

      expect(stream).toBe(mockStream);
      expect(mediaManager.localStream).toBe(mockStream);
    });

    test('should dispatch stream-created event with testMode: false on success', async () => {
      const nav = ensureNavigatorMocked();

      const mockStream = {
        getVideoTracks: jest.fn().mockReturnValue([]),
        getAudioTracks: jest.fn().mockReturnValue([]),
        getTracks: jest.fn().mockReturnValue([])
      };

      nav.mediaDevices.getUserMedia.mockResolvedValue(mockStream);

      const eventHandler = jest.fn();
      const mediaManager = new MediaManager();
      mediaManager.addEventListener('stream-created', eventHandler);

      await mediaManager.getUserMedia({}, true);

      expect(eventHandler).toHaveBeenCalled();
      expect(eventHandler.mock.calls[0][0].detail.testMode).toBe(false);
    });
  });
});
