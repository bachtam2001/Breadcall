const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

class TokenManager {
  constructor(redisClient, database) {
    this.redis = redisClient;
    this.db = database;
    this.tokenSecret = process.env.TOKEN_SECRET || 'your-secret-key-change-in-production';
    this.tokenIssuer = 'breadcall-server';
    this.tokenAudience = 'breadcall-client';
    this.accessTokenExpiry = 15 * 60; // 15 minutes
    this.refreshTokenExpiry = 24 * 60 * 60; // 24 hours
  }

  async initialize() {
    if (!this.redis.isReady()) {
      throw new Error('Redis client not connected');
    }
    console.log('[TokenManager] Initialized');
  }

  /**
   * Generate a new access and refresh token pair
   */
  async generateTokenPair(options) {
    const tokenId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // Generate access token (JWT)
    const accessToken = this._generateAccessToken({
      tokenId,
      ...options
    }, now);

    // Generate refresh token data
    const refreshTokenData = {
      tokenId,
      type: options.type,
      roomId: options.roomId,
      userId: options.userId,
      expiresAt: Date.now() + (this.refreshTokenExpiry * 1000),
      revoked: false,
      rotatedTo: null
    };

    // Store in Redis
    await this.redis.setJson(
      `refresh:${tokenId}`,
      refreshTokenData,
      this.refreshTokenExpiry
    );

    // Store in Database
    await this.db.insertRefreshToken({
      tokenId,
      type: options.type,
      roomId: options.roomId,
      userId: options.userId,
      expiresAt: Date.now() + (this.refreshTokenExpiry * 1000),
      createdAt: Date.now()
    });

    return {
      accessToken,
      tokenId,
      expiresIn: this.accessTokenExpiry
    };
  }

  /**
   * Generate JWT access token
   */
  _generateAccessToken(payload, iat) {
    const jwtPayload = {
      iss: this.tokenIssuer,
      aud: this.tokenAudience,
      tokenId: payload.tokenId,
      type: payload.type,
      roomId: payload.roomId,
      userId: payload.userId,
      permissions: payload.permissions,
      iat,
      exp: iat + this.accessTokenExpiry
    };

    return jwt.sign(jwtPayload, this.tokenSecret, { algorithm: 'HS256' });
  }

  /**
   * Validate access token (stateless - no DB lookup)
   */
  async validateAccessToken(tokenString) {
    try {
      const decoded = jwt.verify(tokenString, this.tokenSecret);
      return {
        valid: true,
        payload: {
          tokenId: decoded.tokenId,
          type: decoded.type,
          roomId: decoded.roomId,
          userId: decoded.userId,
          permissions: decoded.permissions
        }
      };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return { valid: false, reason: 'expired' };
      }
      if (error.name === 'JsonWebTokenError') {
        return { valid: false, reason: 'invalid_signature' };
      }
      if (error.name === 'NotBeforeError') {
        return { valid: false, reason: 'not_before' };
      }
      return { valid: false, reason: 'invalid' };
    }
  }

  /**
   * Validate refresh token (stateful - checks Redis)
   */
  async validateRefreshToken(tokenId) {
    const tokenData = await this.redis.getJson(`refresh:${tokenId}`);

    if (!tokenData) {
      return { valid: false, reason: 'not_found' };
    }

    if (tokenData.revoked === true) {
      return { valid: false, reason: 'revoked' };
    }

    if (tokenData.rotatedTo !== null) {
      return { valid: false, reason: 'rotated' };
    }

    if (tokenData.expiresAt < Date.now()) {
      return { valid: false, reason: 'expired' };
    }

    return {
      valid: true,
      payload: {
        tokenId: tokenData.tokenId,
        type: tokenData.type,
        roomId: tokenData.roomId,
        userId: tokenData.userId
      }
    };
  }

  /**
   * Rotate refresh token - issue new pair and invalidate old
   */
  async rotateRefreshToken(oldTokenId) {
    // Get old token data
    const oldTokenData = await this.redis.getJson(`refresh:${oldTokenId}`);

    if (!oldTokenData) {
      return { success: false, error: 'not_found' };
    }

    if (oldTokenData.revoked || oldTokenData.rotatedTo) {
      return { success: false, error: 'already_used' };
    }

    // Generate new token pair
    const newResult = await this.generateTokenPair({
      type: oldTokenData.type,
      roomId: oldTokenData.roomId,
      userId: oldTokenData.userId,
      permissions: this._getDefaultPermissions(oldTokenData.type)
    });

    // Mark old token as rotated in Redis
    oldTokenData.rotatedTo = newResult.tokenId;
    await this.redis.setJson(`refresh:${oldTokenId}`, oldTokenData);

    // Update rotatedTo in database
    await this.db.rotateRefreshToken(oldTokenId, newResult.tokenId);

    return {
      success: true,
      tokenId: newResult.tokenId,
      accessToken: newResult.accessToken
    };
  }

  /**
   * Revoke a refresh token
   */
  async revokeToken(tokenId, reason = 'revoked') {
    const tokenData = await this.redis.getJson(`refresh:${tokenId}`);

    if (!tokenData) {
      return false;
    }

    // Mark as revoked in Redis
    tokenData.revoked = true;
    await this.redis.setJson(`refresh:${tokenId}`, tokenData);

    // Mark as revoked in Database
    await this.db.revokeRefreshToken(tokenId, reason);

    return true;
  }

  /**
   * Revoke all tokens for a room
   */
  async revokeTokensByRoom(roomId, reason = 'room deleted') {
    const tokenIds = await this._getTokenIdsByRoom(roomId);

    for (const tokenId of tokenIds) {
      await this.revokeToken(tokenId, reason);
    }

    return tokenIds.length;
  }

  /**
   * Get all token IDs for a room (from Redis)
   */
  async _getTokenIdsByRoom(roomId) {
    const tokenIds = [];
    let cursor = 0;

    do {
      const result = await this.redis.client.scan(cursor, 'MATCH', 'refresh:*', 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      for (const key of keys) {
        const tokenData = await this.redis.getJson(key);
        if (tokenData && tokenData.roomId === roomId) {
          tokenIds.push(tokenData.tokenId);
        }
      }
    } while (cursor !== 0);

    return tokenIds;
  }

  /**
   * Get default permissions by token type
   */
  _getDefaultPermissions(type) {
    switch (type) {
      case 'room_access':
        return ['join', 'send-audio', 'send-video', 'chat'];
      case 'director_access':
        return ['observe', 'chat'];
      case 'stream_access':
        return ['view'];
      case 'admin_token':
        return ['admin', 'revoke', 'delete-room'];
      default:
        return [];
    }
  }
}

module.exports = TokenManager;
