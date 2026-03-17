const express = require('express');
const rateLimit = require('express-rate-limit');

/**
 * SRT Routes - Handle MediaMTX webhooks for SRT authentication
 * @param {RoomManager} roomManager - RoomManager instance
 * @returns {express.Router} Router instance
 */
function createSrtRoutes(roomManager) {
  const router = express.Router();

  // Rate limiting for SRT auth webhook (prevent brute-force)
  const srtAuthLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute per IP
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
    const streamIdMatch = query?.match(/^streamid=publish:room\/([A-Z0-9]+)\/([a-f0-9]+)$/);
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
   * Log SRT auth attempt for audit trail
   */
  function logSrtAuthAttempt({ roomId, ip, userAgent, result, reason }) {
    console.log(JSON.stringify({
      event: 'srt_auth_attempt',
      roomId,
      ip,
      userAgent,
      result,
      reason,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * POST /api/srt/auth - MediaMTX SRT authentication webhook
   * Validates SRT publish secret before allowing connection
   */
  function handleSrtAuth(req, res) {
    try {
      const { action, ip, user_agent } = req.body;

      // Only support publish action
      if (action !== 'publish') {
        return res.json({ allow: false, reason: 'unsupported_action' });
      }

      // Parse request
      const parseResult = parseSrtAuthRequest(req);
      if (!parseResult.valid) {
        logSrtAuthAttempt({
          roomId: 'unknown',
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
        logSrtAuthAttempt({
          roomId,
          ip,
          userAgent: user_agent,
          result: 'rejected',
          reason: 'room_not_found'
        });
        return res.json({ allow: false, reason: 'room_not_found' });
      }

      // Validate secret
      if (secret !== room.srtPublishSecret) {
        logSrtAuthAttempt({
          roomId,
          ip,
          userAgent: user_agent,
          result: 'rejected',
          reason: 'invalid_secret'
        });
        return res.json({ allow: false, reason: 'invalid_secret' });
      }

      // Auth successful
      logSrtAuthAttempt({
        roomId,
        ip,
        userAgent: user_agent,
        result: 'allowed',
        reason: null
      });

      res.json({ allow: true });
    } catch (error) {
      console.error('[SRT Auth] Error:', error.message);
      res.json({ allow: false, reason: 'internal_error' });
    }
  }

  /**
   * POST /api/srt/stream-event - MediaMTX stream start/end webhook
   * Tracks SRT stream state and notifies directors
   */
  function handleStreamEvent(req, res) {
    try {
      const { room, event } = req.body;

      // Extract roomId from path (e.g., "room/ABCD" -> "ABCD")
      const roomId = room.replace('room/', '');
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

        console.log(`[SRT] Stream started for room ${roomId}`);
      } else if (event === 'publish_end') {
        roomData.srtStreamActive = false;
        roomData.srtConnectedAt = null;

        // Notify all directors in this room
        roomManager.notifyDirectors(roomId, {
          type: 'srt-feed-updated',
          active: false,
          connectedAt: null
        });

        console.log(`[SRT] Stream ended for room ${roomId}`);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[SRT Stream Event] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Routes
  router.post('/auth', srtAuthLimiter, handleSrtAuth);
  router.post('/stream-event', handleStreamEvent);

  return router;
}

module.exports = createSrtRoutes;
