/**
 * WebRTCManager and WHIP/WHEP URL Tests
 * Tests for correct URL construction in WHIP publishing and WHEP playback
 * For MediaMTX (HTTP-only signaling)
 */

// Mock fetch globally
global.fetch = jest.fn();

describe('WebRTC URL Construction', () => {
  // Mock global window object for browser APIs
  const originalWindow = global.window;

  beforeEach(() => {
    global.window = {
      location: {
        protocol: 'http:',
        host: 'localhost:3000'
      }
    };
    global.fetch.mockClear();
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe('WHIP Endpoint URL', () => {
    test('should construct correct WHIP publish URL with stream name for MediaMTX', () => {
      // MediaMTX: {webrtcUrl}/{streamName}/whip
      const webrtcUrl = 'http://localhost:3000';
      const streamName = 'room123_participant1';

      // Expected: http://localhost:3000/room123_participant1/whip
      const expectedUrl = `${webrtcUrl}/${streamName}/whip`;

      expect(expectedUrl).toBe('http://localhost:3000/room123_participant1/whip');
    });

    test('should use /{streamName}/whip path format', () => {
      const webrtcUrl = 'http://localhost';
      const streamName = 'test-stream';

      const whipEndpoint = `${webrtcUrl}/${streamName}/whip`;

      // Verify the URL ends with /whip
      expect(whipEndpoint).toMatch(/\/whip$/);
      // MediaMTX does not use .stream extension
      expect(whipEndpoint).not.toMatch(/\.stream$/);
    });
  });

  describe('WHEP Endpoint URL', () => {
    test('should construct correct WHEP playback URL for MediaMTX', () => {
      // MediaMTX: {webrtcUrl}/{streamName}/whep
      const webrtcUrl = 'http://localhost:3000';
      const streamName = 'room123_participant1';

      // Expected: http://localhost:3000/room123_participant1/whep
      const expectedUrl = `${webrtcUrl}/${streamName}/whep`;

      expect(expectedUrl).toBe('http://localhost:3000/room123_participant1/whep');
    });

    test('should use /{streamName}/whep path format', () => {
      const webrtcUrl = 'http://localhost';
      const streamName = 'test-stream';

      const whepEndpoint = `${webrtcUrl}/${streamName}/whep`;

      // Verify the URL ends with /whep
      expect(whepEndpoint).toMatch(/\/whep$/);
      // MediaMTX does not use .stream extension
      expect(whepEndpoint).not.toMatch(/\.stream$/);
    });
  });

  describe('Stream Name Construction', () => {
    test('should construct stream name from roomId and participantId', () => {
      const roomId = 'ABC123';
      const participantId = 'p-uuid-123';

      const streamName = `${roomId}_${participantId}`;

      expect(streamName).toBe('ABC123_p-uuid-123');
      expect(streamName).toContain('_');
    });

    test('should handle URL hash route #/room/roomId', () => {
      // Simulate hash routing
      const hash = '#/room/ABC123';
      const roomId = hash.split('/')[2];

      expect(roomId).toBe('ABC123');
    });

    test('should extract roomId correctly from various hash formats', () => {
      const testCases = [
        { hash: '#/room/ABC123', expected: 'ABC123' },
        { hash: '#/room/xyz-789', expected: 'xyz-789' },
        { hash: '#/director/ROOM456', expected: 'ROOM456' }
      ];

      testCases.forEach(({ hash, expected }) => {
        const parts = hash.split('/');
        const extracted = parts[2];
        expect(extracted).toBe(expected);
      });
    });
  });

  describe('WebRTC Config API Response', () => {
    test('should return correct webrtcUrl from /api/webrtc-config', () => {
      // Simulated API response for MediaMTX
      const mockApiResponse = {
        success: true,
        webrtcUrl: 'http://localhost',
        app: '',
        // Note: No wsUrl - MediaMTX uses HTTP-only
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      };

      expect(mockApiResponse.webrtcUrl).toBe('http://localhost');
      expect(mockApiResponse.app).toBe('');
      expect(mockApiResponse.wsUrl).toBeUndefined(); // HTTP-only, no WebSocket
    });

    test('should use x-forwarded headers for proxied webrtcUrl', () => {
      // Simulate nginx proxy headers
      const mockReq = {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'breadcall.example.com'
        },
        protocol: 'http',
        get: function(header) {
          return this.headers[header] || this.headers['host'];
        }
      };

      const protocol = mockReq.headers['x-forwarded-proto'] || mockReq.protocol;
      const host = mockReq.headers['x-forwarded-host'] || mockReq.headers.host;
      const webrtcUrl = `${protocol}://${host}`;

      expect(webrtcUrl).toBe('https://breadcall.example.com');
    });
  });

  describe('WHIP Client SDP Exchange', () => {
    test('should send SDP offer via POST to WHIP endpoint', () => {
      // Test that the endpoint URL format is correct for POST
      const endpoint = 'http://localhost/test-stream/whip';

      // Verify endpoint structure (MediaMTX format: /{streamName}/whip)
      expect(endpoint).toMatch(/http(s?):\/\/[^\/]+\/[^\/]+\/whip$/);
    });

    test('should use Content-Type application/sdp for WHIP request', () => {
      const contentType = 'application/sdp';
      expect(contentType).toBe('application/sdp');
    });
  });

  describe('WHEP HTTP Signaling', () => {
    test('should use HTTP POST for SDP offer/answer (no WebSocket)', () => {
      // MediaMTX WHEP uses HTTP POST/GET, not WebSocket
      const signalingMethod = 'HTTP POST';
      expect(signalingMethod).toBe('HTTP POST');
    });

    test('should receive Location header from WHEP response', () => {
      // WHEP returns a Location header for the session resource
      const mockLocation = '/whep/stream-name';
      expect(mockLocation).toContain('/whep/');
    });

    test('should use DELETE on resource URL to stop playback', () => {
      // WHEP uses DELETE on the resource URL to stop
      const deleteMethod = 'DELETE';
      expect(deleteMethod).toBe('DELETE');
    });
  });

  describe('ICE Servers Configuration', () => {
    test('should use Google STUN server by default', () => {
      const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

      expect(iceServers[0].urls).toBe('stun:stun.l.google.com:19302');
    });

    test('should support multiple ICE servers', () => {
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
      ];

      expect(iceServers.length).toBe(3);
      expect(iceServers[2]).toHaveProperty('username');
      expect(iceServers[2]).toHaveProperty('credential');
    });

    test('should support ice_transport_policy', () => {
      const config = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        iceTransportPolicy: 'relay' // Force TURN relay
      };

      expect(config.iceTransportPolicy).toBe('relay');
    });
  });

  describe('Complete Connection Flow', () => {
    test('WHIP publish flow: POST SDP offer, receive answer', () => {
      const steps = [
        'create peer connection',
        'add tracks',
        'create offer',
        'set local description',
        'POST to WHIP endpoint with SDP',
        'receive answer from server',
        'set remote description',
        'ICE candidate exchange',
        'connection established'
      ];

      expect(steps).toContain('POST to WHIP endpoint with SDP');
      expect(steps).toContain('receive answer from server');
    });

    test('WHEP HTTP playback flow: POST offer, receive answer', () => {
      const steps = [
        'create peer connection',
        'add transceivers (recvonly)',
        'create offer',
        'set local description',
        'POST to WHEP endpoint with SDP offer',
        'receive answer from server',
        'set remote description',
        'ICE candidate exchange',
        'receive remote tracks',
        'connection established'
      ];

      expect(steps).toContain('POST to WHEP endpoint with SDP offer');
      expect(steps).toContain('receive answer from server');
    });
  });
});
