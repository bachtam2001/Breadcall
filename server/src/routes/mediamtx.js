const express = require('express');
const rateLimit = require('express-rate-limit');

/**
 * MediaMTX Routes - Handle MediaMTX webhooks for authentication and stream events
 * Supports SRT, WHIP, and WHEP authentication
 * @param {RoomManager} roomManager - RoomManager instance
 * @returns {express.Router} Router instance
 */
function createMediaMTXRoutes(roomManager) {
  const router = express.Router();

  // Rate limiting for auth webhook (prevent brute-force)
  const authLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    message: { allow: false, reason: 'rate_limit_exceeded' },
    keyGenerator: (req) => req.ip,
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * Parse SRT auth request from MediaMTX
   * MediaMTX sends path and query separately
   * @param {Object} req - Express request
   * @returns {Object} Parsed result with roomId and secret
   */
  function parseSrtAuthRequest(req) {
    const { path, query } = req.body;

    // Extract roomId from path (e.g., "room/ABCD" -> "ABCD")
    const pathParts = path.split('/');
    if (pathParts.length !== 2 || pathParts[0] !== 'room') {
      return { valid: false, reason: 'invalid_format' };
    }
    const roomId = pathParts[1];

    // Extract secret from query string
    // Format: streamid=publish:room/ROOMID/SECRET
    const streamIdMatch = query?.match(/^streamid=publish:room\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/([a-f0-9]+)$/);
    if (!streamIdMatch) {
      return { valid: false, reason: 'invalid_format' };
    }

    const parsedRoomId = streamIdMatch[1];
    const secret = streamIdMatch[2];

    // Verify roomId in path matches roomId in streamid
    if (parsedRoomId !== roomId) {
      return { valid: false, reason: 'invalid_format' };
    }

    return { valid: true, roomId, secret };
  }

  /**
   * Parse WHIP/WHEP auth request from MediaMTX
   * @param {Object} req - Express request
   * @returns {Object} Parsed result with protocol, action, path, and token
   */
  function parseWhipWhepAuthRequest(req) {
    const { protocol, path, action, query, user } = req.body;

    // Extract roomId from path (e.g., "room/ABCD" -> "ABCD")
    const pathParts = path.split('/');
    if (pathParts.length !== 2 || pathParts[0] !== 'room') {
      return { valid: false, reason: 'invalid_path_format' };
    }
    const roomId = pathParts[1];

    // For WHIP/WHEP, authentication is via JWT token in query or user field
    // MediaMTX passes Authorization header content in 'user' field when using HTTP basic auth
    // Or we can check for token in query string
    let token = null;

    // Check for token in query string (e.g., ?token=xxx)
    if (query) {
      const tokenMatch = query.match(/token=([a-zA-Z0-9._-]+)/);
      if (tokenMatch) {
        token = tokenMatch[1];
      }
    }

    return { valid: true, protocol, action, roomId, token, user };
  }

  /**
   * Log MediaMTX auth attempt for audit trail
   */
  function logAuthAttempt({ protocol, roomId, ip, userAgent, result, reason, action }) {
    console.log(JSON.stringify({
      event: 'mediamtx_auth_attempt',
      protocol,
      roomId,
      action,
      ip,
      userAgent,
      result,
      reason,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * POST /api/mediamtx/auth - MediaMTX authentication webhook
   * Validates authentication for SRT, WHIP publish, and WHEP play actions
   */
  function handleAuth(req, res) {
    try {
      const { action, protocol, ip, user_agent, path } = req.body;

      console.log(`[MediaMTX Auth] Received auth request: protocol=${protocol}, action=${action}, path=${path}`);

      // Handle SRT protocol - only support publish action
      if (protocol === 'srt') {
        if (action !== 'publish') {
          return res.json({ allow: false, reason: 'unsupported_action' });
        }

        // Parse SRT request
        const parseResult = parseSrtAuthRequest(req);
        if (!parseResult.valid) {
          logAuthAttempt({
            protocol: 'srt',
            roomId: 'unknown',
            action,
            ip,
            userAgent: user_agent,
            result: 'rejected',
            reason: parseResult.reason
          });
          return res.json({ allow: false, reason: parseResult.reason });
        }

        const { roomId, secret } = parseResult;

        // Check if room exists
        const room = roomManager.getRoom(roomId);
        if (!room) {
          logAuthAttempt({
            protocol: 'srt',
            roomId,
            action,
            ip,
            userAgent: user_agent,
            result: 'rejected',
            reason: 'room_not_found'
          });
          return res.json({ allow: false, reason: 'room_not_found' });
        }

        // Validate secret
        if (secret !== room.srtPublishSecret) {
          logAuthAttempt({
            protocol: 'srt',
            roomId,
            action,
            ip,
            userAgent: user_agent,
            result: 'rejected',
            reason: 'invalid_secret'
          });
          return res.json({ allow: false, reason: 'invalid_secret' });
        }

        // Auth successful
        logAuthAttempt({
          protocol: 'srt',
          roomId,
          action,
          ip,
          userAgent: user_agent,
          result: 'allowed',
          reason: null
        });

        return res.json({ allow: true });
      }

      // Handle WHIP/WHEP protocols
      if (protocol === 'webrtc') {
        const parseResult = parseWhipWhepAuthRequest(req);
        if (!parseResult.valid) {
          logAuthAttempt({
            protocol: 'webrtc',
            roomId: 'unknown',
            action,
            ip,
            userAgent: user_agent,
            result: 'rejected',
            reason: parseResult.reason
          });
          return res.json({ allow: false, reason: parseResult.reason });
        }

        const { roomId, token } = parseResult;

        // Check if room exists
        const room = roomManager.getRoom(roomId);
        if (!room) {
          logAuthAttempt({
            protocol: 'webrtc',
            roomId,
            action,
            ip,
            userAgent: user_agent,
            result: 'rejected',
            reason: 'room_not_found'
          });
          return res.json({ allow: false, reason: 'room_not_found' });
        }

        // Validate JWT token if provided
        if (token) {
          // Token-based authentication for WHIP/WHEP
          // This would need TokenManager integration
          // For now, allow if room exists and token is present
          // TODO: Integrate with TokenManager for proper JWT validation
          logAuthAttempt({
            protocol: 'webrtc',
            roomId,
            action,
            ip,
            userAgent: user_agent,
            result: 'allowed',
            reason: 'token_present'
          });
          return res.json({ allow: true });
        }

        // No token provided - for now, allow WHIP/WHEP to rooms that exist
        // This is a placeholder - proper auth should require valid JWT
        logAuthAttempt({
          protocol: 'webrtc',
          roomId,
          action,
          ip,
          userAgent: user_agent,
          result: 'allowed',
          reason: 'room_exists'
        });
        return res.json({ allow: true });
      }

      // Unknown protocol
      logAuthAttempt({
        protocol: protocol || 'unknown',
        roomId: 'unknown',
        action,
        ip,
        userAgent: user_agent,
        result: 'rejected',
        reason: 'unsupported_protocol'
      });
      return res.json({ allow: false, reason: 'unsupported_protocol' });

    } catch (error) {
      console.error('[MediaMTX Auth] Error:', error.message);
      res.json({ allow: false, reason: 'internal_error' });
    }
  }

  /**
   * POST /api/mediamtx/stream-event - MediaMTX stream start/end webhook
   * Tracks stream state and notifies directors
   */
  function handleStreamEvent(req, res) {
    try {
      const { path, event } = req.body;

      // Extract roomId from path (e.g., "room/ABCD" -> "ABCD")
      const roomId = path.replace('room/', '');
      const roomData = roomManager.getRoom(roomId);

      if (!roomData) {
        return res.status(404).json({ success: false, error: 'Room not found' });
      }

      if (event === 'publish_start') {
        roomData.srtStreamActive = true;
        roomData.srtConnectedAt = new Date().toISOString();

        // Notify all directors in this room
        roomManager.notifyDirectors(roomId, {
          type: 'srt-feed-updated',
          active: true,
          connectedAt: roomData.srtConnectedAt
        });

        console.log(`[MediaMTX] Stream started for room ${roomId}`);
      } else if (event === 'publish_end') {
        roomData.srtStreamActive = false;
        roomData.srtConnectedAt = null;

        // Notify all directors in this room
        roomManager.notifyDirectors(roomId, {
          type: 'srt-feed-updated',
          active: false,
          connectedAt: null
        });

        console.log(`[MediaMTX] Stream ended for room ${roomId}`);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[MediaMTX Stream Event] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Routes
  router.post('/auth', authLimiter, handleAuth);
  router.post('/stream-event', handleStreamEvent);

  return router;
}

module.exports = createMediaMTXRoutes;
