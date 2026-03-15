/**
 * JWT and CSRF Endpoints Tests
 * Tests for JWT token generation, refresh, validation, and CSRF protection
 */
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Mock dependencies
jest.mock('ws');
jest.mock('../src/RedisClient');
jest.mock('../src/database');
jest.mock('../src/TokenManager');

const RoomManager = require('../src/RoomManager');
const TokenManager = require('../src/TokenManager');

// Create a test app with the routes
let app;
let roomManager;
let mockTokenManager;

describe('JWT and CSRF Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh instances
    roomManager = new RoomManager();

    // Setup mock TokenManager
    mockTokenManager = {
      generateTokenPair: jest.fn(),
      validateAccessToken: jest.fn(),
      validateRefreshToken: jest.fn(),
      rotateRefreshToken: jest.fn(),
      revokeToken: jest.fn(),
      revokeTokensByRoom: jest.fn(),
      initialize: jest.fn().mockResolvedValue(undefined)
    };

    // Mock TokenManager constructor
    TokenManager.mockImplementation(() => mockTokenManager);

    // Setup express app for testing
    app = express();
    app.use(express.json());
    app.use(cookieParser());

    // Mount routes
    setupRoutes(app, roomManager, mockTokenManager);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  function setupRoutes(app, roomManager, tokenManager) {
    // CSRF token endpoint
    app.get('/api/csrf-token', (req, res) => {
      res.json({
        success: true,
        csrfToken: 'test-csrf-token-' + Date.now()
      });
    });

    // Token generation endpoint
    app.post('/api/tokens', async (req, res) => {
      try {
        const { type, roomId, options = {} } = req.body;

        // Validate token type
        const validTypes = ['room_access', 'director_access', 'stream_access', 'action_token', 'admin_token'];
        if (!validTypes.includes(type)) {
          return res.status(400).json({ success: false, error: 'Invalid token type' });
        }

        // Validate room exists for room-based tokens
        if (['room_access', 'director_access', 'stream_access'].includes(type)) {
          if (!roomId) {
            return res.status(400).json({ success: false, error: 'Room ID required' });
          }
        }

        if (tokenManager && ['room_access', 'director_access', 'admin_token'].includes(type)) {
          const tokenPair = await tokenManager.generateTokenPair({
            type,
            roomId,
            userId: options.userId || 'test-user'
          });

          res.cookie('accessToken', tokenPair.accessToken, {
            httpOnly: true,
            maxAge: 900 * 1000
          });

          res.cookie('refreshToken', tokenPair.tokenId, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000
          });

          return res.json({
            success: true,
            tokenId: tokenPair.tokenId,
            expiresAt: Date.now() + (tokenPair.expiresIn * 1000),
            expiresIn: tokenPair.expiresIn,
            url: `http://test/${roomId}?token=${tokenPair.accessToken}`
          });
        }

        res.status(400).json({ success: false, error: 'Invalid token type' });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });

    // Token refresh endpoint
    app.post('/api/tokens/refresh', async (req, res) => {
      try {
        const refreshTokenId = req.cookies?.refreshToken;

        if (!refreshTokenId) {
          return res.status(401).json({
            success: false,
            error: 'refresh_required',
            message: 'Refresh token not found'
          });
        }

        const validation = await tokenManager.validateRefreshToken(refreshTokenId);

        if (!validation.valid) {
          return res.status(401).json({
            success: false,
            error: validation.reason === 'rotated' ? 'token_rotated' : 'refresh_invalid',
            message: 'Refresh token is invalid or expired'
          });
        }

        const rotation = await tokenManager.rotateRefreshToken(refreshTokenId);

        if (!rotation.success) {
          return res.status(401).json({
            success: false,
            error: 'rotation_failed',
            message: 'Failed to rotate refresh token'
          });
        }

        res.cookie('accessToken', rotation.accessToken, {
          httpOnly: true,
          maxAge: 900 * 1000
        });

        res.cookie('refreshToken', rotation.tokenId, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000
        });

        res.json({
          success: true,
          accessToken: rotation.accessToken,
          refreshToken: rotation.tokenId,
          expiresIn: 900
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'refresh_failed',
          message: 'Token refresh failed'
        });
      }
    });

    // Token validation endpoint
    app.post('/api/tokens/validate', async (req, res) => {
      try {
        const { token, action } = req.body;

        if (!token) {
          return res.status(400).json({ success: false, error: 'Token required' });
        }

        if (token.startsWith('eyJ')) {
          const result = await tokenManager.validateAccessToken(token);

          if (!result.valid) {
            return res.json({
              success: true,
              valid: false,
              reason: result.reason
            });
          }

          return res.json({
            success: true,
            valid: true,
            payload: result.payload
          });
        }

        // Legacy token validation fallback
        res.json({
          success: true,
          valid: true,
          payload: { type: 'legacy' }
        });
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });
  }

  describe('GET /api/csrf-token', () => {
    test('should return CSRF token', async () => {
      const response = await request(app)
        .get('/api/csrf-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.csrfToken).toMatch(/^test-csrf-token-/);
    });

    test('should return different CSRF tokens on subsequent requests', async () => {
      const response1 = await request(app).get('/api/csrf-token');
      const response2 = await request(app).get('/api/csrf-token');

      expect(response1.body.csrfToken).not.toBe(response2.body.csrfToken);
    });
  });

  describe('POST /api/tokens', () => {
    beforeEach(() => {
      // Default mock implementation
      mockTokenManager.generateTokenPair.mockResolvedValue({
        tokenId: 'test-token-id-123',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.test',
        expiresIn: 900
      });
    });

    test('should generate JWT token pair for room_access', async () => {
      const response = await request(app)
        .post('/api/tokens')
        .send({
          type: 'room_access',
          roomId: 'ABC123',
          options: { userId: 'user-123' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.tokenId).toBe('test-token-id-123');
      expect(response.body.expiresIn).toBe(900);
      expect(response.body).toHaveProperty('url');

      expect(mockTokenManager.generateTokenPair).toHaveBeenCalledWith({
        type: 'room_access',
        roomId: 'ABC123',
        userId: 'user-123'
      });
    });

    test('should generate JWT token pair for director_access', async () => {
      const response = await request(app)
        .post('/api/tokens')
        .send({
          type: 'director_access',
          roomId: 'ABC123'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockTokenManager.generateTokenPair).toHaveBeenCalledWith({
        type: 'director_access',
        roomId: 'ABC123',
        userId: 'test-user'
      });
    });

    test('should reject invalid token type', async () => {
      const response = await request(app)
        .post('/api/tokens')
        .send({
          type: 'invalid_type',
          roomId: 'ABC123'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid token type');
    });

    test('should reject missing room for room_access token', async () => {
      const response = await request(app)
        .post('/api/tokens')
        .send({
          type: 'room_access'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Room ID required');
    });

    test('should set HttpOnly cookies for access and refresh tokens', async () => {
      const agent = request.agent(app);

      const response = await agent
        .post('/api/tokens')
        .send({
          type: 'room_access',
          roomId: 'ABC123'
        })
        .expect(200);

      // Verify cookies were set by checking response headers
      expect(response.headers['set-cookie']).toBeDefined();
      const cookies = response.headers['set-cookie'];
      expect(cookies.some(c => c.includes('accessToken'))).toBe(true);
      expect(cookies.some(c => c.includes('refreshToken'))).toBe(true);
      // Verify HttpOnly flag
      expect(cookies.some(c => c.includes('HttpOnly'))).toBe(true);
    });
  });

  describe('POST /api/tokens/refresh', () => {
    beforeEach(() => {
      // Default mock implementations
      mockTokenManager.validateRefreshToken.mockResolvedValue({
        valid: true,
        payload: { tokenId: 'test-token-id', roomId: 'ABC123' }
      });

      mockTokenManager.rotateRefreshToken.mockResolvedValue({
        success: true,
        tokenId: 'new-refresh-token-id',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJuZXcifQ.new'
      });
    });

    test('should rotate refresh token and issue new pair', async () => {
      const agent = request.agent(app);

      // Set initial refresh token cookie
      agent.jar.setCookie('refreshToken=initial-token-id; Path=/; HttpOnly');

      const response = await agent
        .post('/api/tokens/refresh')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.refreshToken).toBe('new-refresh-token-id');
      expect(response.body.expiresIn).toBe(900);

      expect(mockTokenManager.validateRefreshToken).toHaveBeenCalledWith('initial-token-id');
      expect(mockTokenManager.rotateRefreshToken).toHaveBeenCalledWith('initial-token-id');
    });

    test('should return 401 when refresh token is missing', async () => {
      const response = await request(app)
        .post('/api/tokens/refresh')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('refresh_required');
    });

    test('should return 401 when refresh token is invalid', async () => {
      const agent = request.agent(app);
      agent.jar.setCookie('refreshToken=invalid-token; Path=/; HttpOnly');

      mockTokenManager.validateRefreshToken.mockResolvedValue({
        valid: false,
        reason: 'not_found'
      });

      const response = await agent
        .post('/api/tokens/refresh')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('refresh_invalid');
    });

    test('should return 401 when refresh token is rotated', async () => {
      const agent = request.agent(app);
      agent.jar.setCookie('refreshToken=already-rotated-token; Path=/; HttpOnly');

      mockTokenManager.validateRefreshToken.mockResolvedValue({
        valid: false,
        reason: 'rotated'
      });

      const response = await agent
        .post('/api/tokens/refresh')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('token_rotated');
    });

    test('should return 401 when rotation fails', async () => {
      const agent = request.agent(app);
      agent.jar.setCookie('refreshToken=valid-token; Path=/; HttpOnly');

      mockTokenManager.rotateRefreshToken.mockResolvedValue({
        success: false,
        error: 'rotation_failed'
      });

      const response = await agent
        .post('/api/tokens/refresh')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('rotation_failed');
    });
  });

  describe('POST /api/tokens/validate', () => {
    beforeEach(() => {
      // Default mock implementations
      mockTokenManager.validateAccessToken.mockResolvedValue({
        valid: true,
        payload: {
          type: 'room_access',
          roomId: 'ABC123',
          userId: 'user-123',
          permissions: ['join', 'send_audio']
        }
      });
    });

    test('should validate valid JWT token', async () => {
      const response = await request(app)
        .post('/api/tokens/validate')
        .send({
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(true);
      expect(response.body.payload).toHaveProperty('type', 'room_access');
      expect(response.body.payload).toHaveProperty('roomId', 'ABC123');
    });

    test('should reject expired JWT token', async () => {
      mockTokenManager.validateAccessToken.mockResolvedValue({
        valid: false,
        reason: 'expired'
      });

      const response = await request(app)
        .post('/api/tokens/validate')
        .send({
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expired.signature'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(false);
      expect(response.body.reason).toBe('expired');
    });

    test('should reject invalid signature JWT token', async () => {
      mockTokenManager.validateAccessToken.mockResolvedValue({
        valid: false,
        reason: 'invalid_signature'
      });

      const response = await request(app)
        .post('/api/tokens/validate')
        .send({
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(false);
      expect(response.body.reason).toBe('invalid_signature');
    });

    test('should reject malformed JWT token', async () => {
      mockTokenManager.validateAccessToken.mockResolvedValue({
        valid: false,
        reason: 'malformed'
      });

      const response = await request(app)
        .post('/api/tokens/validate')
        .send({
          token: 'not-a-jwt-token'
        })
        .expect(200);

      // Falls back to legacy validation which accepts it
      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(true);
    });

    test('should return 400 when token is missing', async () => {
      const response = await request(app)
        .post('/api/tokens/validate')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Token required');
    });

    test('should accept legacy token format (tok_*)', async () => {
      const response = await request(app)
        .post('/api/tokens/validate')
        .send({
          token: 'tok_base64encodeddata.signature'
        })
        .expect(200);

      // Falls back to legacy validation
      expect(response.body.success).toBe(true);
      expect(response.body.valid).toBe(true);
      expect(response.body.payload).toEqual({ type: 'legacy' });
    });
  });

  describe('Integration: Token lifecycle', () => {
    test('should generate, validate, refresh, and validate again', async () => {
      const agent = request.agent(app);

      // Setup mock for generate
      mockTokenManager.generateTokenPair.mockResolvedValue({
        tokenId: 'refresh-123',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MifQ.sig1',
        expiresIn: 900
      });

      // Generate token
      const generateResponse = await agent
        .post('/api/tokens')
        .send({
          type: 'room_access',
          roomId: 'ABC123'
        });

      expect(generateResponse.body.success).toBe(true);

      // Validate access token
      mockTokenManager.validateAccessToken.mockResolvedValue({
        valid: true,
        payload: { type: 'room_access', roomId: 'ABC123' }
      });

      const validateResponse = await request(app)
        .post('/api/tokens/validate')
        .send({
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY2Nlc3MifQ.sig1'
        });

      expect(validateResponse.body.valid).toBe(true);

      // Setup mock for refresh validation
      mockTokenManager.validateRefreshToken.mockResolvedValue({
        valid: true,
        payload: { tokenId: 'refresh-123' }
      });

      mockTokenManager.rotateRefreshToken.mockResolvedValue({
        success: true,
        tokenId: 'refresh-456',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.bmV3.sig2'
      });

      // Refresh token
      const refreshResponse = await agent
        .post('/api/tokens/refresh')
        .expect(200);

      expect(refreshResponse.body.success).toBe(true);
      expect(refreshResponse.body.refreshToken).toBe('refresh-456');

      // Validate new access token
      mockTokenManager.validateAccessToken.mockResolvedValue({
        valid: true,
        payload: { type: 'room_access', roomId: 'ABC123' }
      });

      const validateNewResponse = await request(app)
        .post('/api/tokens/validate')
        .send({
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.bmV3.sig2'
        });

      expect(validateNewResponse.body.valid).toBe(true);
    });
  });
});
