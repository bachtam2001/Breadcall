/**
 * WHEPClient Tests
 * Tests for WHEP client retry logic and stream consumption
 */

// Mock RTCSessionDescription
global.RTCSessionDescription = jest.fn().mockImplementation((desc) => desc);

// Mock RTCPeerConnection
global.RTCPeerConnection = jest.fn().mockImplementation(() => ({
  addTransceiver: jest.fn(),
  createOffer: jest.fn().mockResolvedValue({ sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }),
  setLocalDescription: jest.fn().mockResolvedValue(undefined),
  setRemoteDescription: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  iceGatheringState: 'complete',
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  ontrack: null,
  onconnectionstatechange: null,
  onicecandidate: null,
  localDescription: { sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }
}));

// Mock window.setTimeout for retry logic - don't invoke immediately to avoid infinite loops
global.setTimeout = jest.fn().mockImplementation(() => 123);
global.clearTimeout = jest.fn();

// Mock window object for browser globals
const originalWindow = global.window;

describe('WHEPClient', () => {
  beforeEach(() => {
    // Reset modules and mocks
    jest.clearAllMocks();
    jest.resetModules();

    // Setup fetch mock fresh for each test - must return Promise for .then() chaining
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 204,
      headers: { get: jest.fn().mockReturnValue(null) }
    }));

    global.window = { WHEPClient: null };

    // Load WHEPClient - it exports to window.WHEPClient
    require('../js/WHEPClient.js');
  });

  afterEach(() => {
    global.window = originalWindow;
    jest.resetModules();
  });

  describe('Constructor', () => {
    test('should create WHEPClient with endpoint and options', () => {
      const WHEPClient = window.WHEPClient;
      const endpoint = 'http://localhost/teststream/whep';
      const videoElement = { srcObject: null };
      const options = { authToken: 'test-token' };

      const client = new WHEPClient(endpoint, videoElement, options);

      expect(client.endpoint).toBe(endpoint);
      expect(client.videoElement).toBe(videoElement);
      expect(client.authToken).toBe('test-token');
      expect(client.pc).toBeNull();
      expect(client.resourceURL).toBeNull();
      expect(client.etag).toBeNull();
    });

    test('should create WHEPClient without auth token', () => {
      const WHEPClient = window.WHEPClient;
      const endpoint = 'http://localhost/teststream/whep';
      const client = new WHEPClient(endpoint, null);

      expect(client.authToken).toBeNull();
    });
  });

  describe('consume() - Success Cases', () => {
    test('should consume stream successfully', async () => {
      const WHEPClient = window.WHEPClient;
      const mockAnswer = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\nm=video 0\r\n';

      // Mock OPTIONS request for ICE servers
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: {
          get: jest.fn().mockReturnValue(null) // No Link header for ICE servers
        }
      });

      // Mock POST request for offer
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: {
          get: jest.fn((name) => {
            if (name.toLowerCase() === 'location') return '/whep/teststream/session123';
            if (name === 'ETag') return 'abc123';
            return null;
          })
        },
        text: jest.fn().mockResolvedValue(mockAnswer)
      });

      const client = new WHEPClient('http://localhost/teststream/whep', null);
      await client.consume();

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      // First call is OPTIONS
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost/teststream/whep',
        expect.objectContaining({
          method: 'OPTIONS',
          headers: {}
        })
      );

      // Second call is POST with offer
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost/teststream/whep',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/sdp'
          })
        })
      );

      // Resource URL is converted to absolute
      expect(client.resourceURL).toBe('http://localhost/whep/teststream/session123');
      expect(client.etag).toBe('abc123');
    });

    test('should use auth token in headers when provided', async () => {
      const WHEPClient = window.WHEPClient;
      const mockAnswer = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n';

      // Mock OPTIONS request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: jest.fn().mockReturnValue(null) }
      });

      // Mock POST request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: {
          get: jest.fn((name) => {
            if (name.toLowerCase() === 'location') return '/session';
            if (name === 'ETag') return 'etag';
            return null;
          })
        },
        text: jest.fn().mockResolvedValue(mockAnswer)
      });

      const client = new WHEPClient('http://localhost/test/whep', null, {
        authToken: 'token123'
      });
      await client.consume();

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      // Check OPTIONS has auth header
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({
          method: 'OPTIONS',
          headers: expect.objectContaining({
            'Authorization': 'Bearer token123'
          })
        })
      );

      // Check POST has auth header
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer token123',
            'Content-Type': 'application/sdp'
          })
        })
      );
    });

    test('should convert relative resource URL to absolute', async () => {
      const WHEPClient = window.WHEPClient;
      const mockAnswer = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n';

      // Mock OPTIONS request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: jest.fn().mockReturnValue(null) }
      });

      // Mock POST request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: {
          get: jest.fn((name) => {
            if (name.toLowerCase() === 'location') return '/whep/relative/path';
            if (name === 'ETag') return 'etag';
            return null;
          })
        },
        text: jest.fn().mockResolvedValue(mockAnswer)
      });

      const client = new WHEPClient('http://localhost:8887/test/whep', null);
      await client.consume();

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      expect(client.resourceURL).toBe('http://localhost:8887/whep/relative/path');
    });

    test('should handle absolute URL in Location header', async () => {
      const WHEPClient = window.WHEPClient;
      const mockAnswer = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n';

      // Mock OPTIONS request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: jest.fn().mockReturnValue(null) }
      });

      // Mock POST request with absolute URL
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: {
          get: jest.fn((name) => {
            if (name.toLowerCase() === 'location') return 'http://example.com/session/123';
            if (name === 'ETag') return 'etag';
            return null;
          })
        },
        text: jest.fn().mockResolvedValue(mockAnswer)
      });

      const client = new WHEPClient('http://localhost/test/whep', null);
      await client.consume();

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      expect(client.resourceURL).toBe('http://example.com/session/123');
    });
  });

  describe('consume() - Error Handling', () => {
    test('should handle 404 stream not found error', async () => {
      const WHEPClient = window.WHEPClient;

      // Mock OPTIONS request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: jest.fn().mockReturnValue(null) }
      });

      // Mock POST request returning 404
      global.fetch.mockResolvedValueOnce({
        status: 404,
        json: jest.fn().mockResolvedValue({ error: 'stream not found' })
      });

      const client = new WHEPClient('http://localhost/test/whep', null);
      await client.consume();

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      // Should make OPTIONS + POST
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Should trigger retry via setTimeout
      expect(setTimeout).toHaveBeenCalled();
    });

    test('should handle 400 bad request error', async () => {
      const WHEPClient = window.WHEPClient;

      // Mock OPTIONS request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: jest.fn().mockReturnValue(null) }
      });

      // Mock POST request returning 400
      global.fetch.mockResolvedValueOnce({
        status: 400,
        json: jest.fn().mockResolvedValue({ error: 'invalid offer' })
      });

      const client = new WHEPClient('http://localhost/test/whep', null);
      await client.consume();

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(setTimeout).toHaveBeenCalled();
    });

    test('should handle generic error status', async () => {
      const WHEPClient = window.WHEPClient;

      // Mock OPTIONS request
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: { get: jest.fn().mockReturnValue(null) }
      });

      // Mock POST request returning 500
      global.fetch.mockResolvedValueOnce({
        status: 500,
        json: jest.fn().mockResolvedValue({ error: 'server error' })
      });

      const client = new WHEPClient('http://localhost/test/whep', null);
      await client.consume();

      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop()', () => {
    test('should send DELETE to resource URL with ETag', async () => {
      const WHEPClient = window.WHEPClient;
      global.fetch.mockResolvedValue({ ok: true });

      const client = new WHEPClient('http://localhost/test/whep', null);
      client.resourceURL = 'http://localhost/test/session123';
      client.etag = 'test-etag-123';

      await client.stop();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost/test/session123',
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'If-Match': 'test-etag-123'
          }
        })
      );
    });

    test('should send DELETE without ETag if not present', async () => {
      const WHEPClient = window.WHEPClient;
      global.fetch.mockResolvedValue({ ok: true });

      const client = new WHEPClient('http://localhost/test/whep', null);
      client.resourceURL = 'http://localhost/test/session123';
      client.etag = null;

      await client.stop();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'DELETE',
          headers: {}
        })
      );
    });

    test('should close peer connection', async () => {
      const WHEPClient = window.WHEPClient;
      global.fetch.mockResolvedValue({ ok: true });

      const client = new WHEPClient('http://localhost/test/whep', null);
      const mockPc = { close: jest.fn() };
      client.pc = mockPc;

      await client.stop();

      expect(mockPc.close).toHaveBeenCalled();
      expect(client.state).toBe('closed');
    });

    test('should clear video element srcObject', async () => {
      const WHEPClient = window.WHEPClient;
      global.fetch.mockResolvedValue({ ok: true });

      const videoElement = { srcObject: { id: 'stream123' } };
      const client = new WHEPClient('http://localhost/test/whep', videoElement);
      client.resourceURL = 'http://localhost/test/session';

      await client.stop();

      expect(videoElement.srcObject).toBeNull();
    });

    test('should not throw if resource URL is missing', async () => {
      const WHEPClient = window.WHEPClient;
      const client = new WHEPClient('http://localhost/test/whep', null);
      client.resourceURL = null;
      client.pc = { close: jest.fn() };
      client.videoElement = { srcObject: {} };

      await expect(client.stop()).resolves.toBeUndefined();
    });

    test('should not throw if DELETE request fails', async () => {
      const WHEPClient = window.WHEPClient;
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new WHEPClient('http://localhost/test/whep', null);
      client.resourceURL = 'http://localhost/test/session';
      client.etag = 'test-etag';
      client.pc = { close: jest.fn() };

      // Should not throw
      await expect(client.stop()).resolves.toBeUndefined();
    });
  });

  describe('close()', () => {
    test('should close peer connection and clear timeout', () => {
      const WHEPClient = window.WHEPClient;
      const client = new WHEPClient('http://localhost/test/whep', null);

      const mockPc = { close: jest.fn() };
      client.pc = mockPc;
      client.restartTimeout = 123;

      client.close();

      expect(mockPc.close).toHaveBeenCalled();
      expect(clearTimeout).toHaveBeenCalledWith(123);
      expect(client.state).toBe('closed');
    });

    test('should handle close when no peer connection exists', () => {
      const WHEPClient = window.WHEPClient;
      const client = new WHEPClient('http://localhost/test/whep', null);

      client.pc = null;
      client.restartTimeout = null;

      // Should not throw
      expect(() => client.close()).not.toThrow();
      expect(client.state).toBe('closed');
    });
  });
});
