const express = require('express');
const MediaMTXClient = require('../MediaMTXClient');

/**
 * SRT Configuration Router
 * Handles SRT push/pull mode configuration for director rooms
 */
function createSRTRouter(mediaMTXClient, roomManager) {
  const router = express.Router();

  /**
   * POST /:roomId/srt/configure
   * Configure SRT mode (push or pull) for a room
   */
  router.post('/:roomId/srt/configure', async (req, res) => {
    const { roomId } = req.params;
    const { mode, pullUrl } = req.body;

    try {
      // Validate room exists
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found'
        });
      }

      // Validate mode
      if (!mode || !['push', 'pull'].includes(mode)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid mode. Must be "push" or "pull"'
        });
      }

      // Validate pullUrl if mode is pull
      if (mode === 'pull' && !pullUrl) {
        return res.status(400).json({
          success: false,
          error: 'pullUrl is required for pull mode'
        });
      }

      // Validate pullUrl format if provided
      if (pullUrl && !pullUrl.startsWith('srt://')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid pullUrl format. Must be an SRT URL (srt://...)'
        });
      }

      // Stop current stream if switching modes
      if (room.srtMode && room.srtMode !== mode) {
        console.log(`[SRT] Stopping current ${room.srtMode} stream for room ${roomId}`);

        // For pull mode, stop the MediaMTX path
        if (room.srtMode === 'pull') {
          const pathName = `room/${roomId}`;
          try {
            await mediaMTXClient.stopPath(pathName);
            console.log(`[SRT] Stopped MediaMTX path: ${pathName}`);
          } catch (error) {
            console.error(`[SRT] Error stopping path: ${error.message}`);
            // Continue even if stop fails - path might not exist
          }
        }

        // Reset stream state
        room.srtStreamActive = false;
        room.srtConnectedAt = null;
      }

      // Configure based on mode
      if (mode === 'pull') {
        // Configure MediaMTX to pull from remote source
        const pathName = `room/${roomId}`;

        try {
          await mediaMTXClient.addPath({
            path: pathName,
            sourceUrl: pullUrl
          });
          console.log(`[SRT] Configured pull mode for room ${roomId}: ${pullUrl}`);

          room.srtStreamActive = true;
          room.srtConnectedAt = new Date().toISOString();
        } catch (error) {
          console.error(`[SRT] Error configuring pull mode: ${error.message}`);
          return res.status(500).json({
            success: false,
            error: 'Failed to configure pull mode. Ensure MediaMTX is available and URL is valid.'
          });
        }
      } else if (mode === 'push') {
        // For push mode, just update room state
        // External source will push to MediaMTX
        console.log(`[SRT] Configured push mode for room ${roomId}`);
      }

      // Update room state
      room.srtMode = mode;
      room.srtPullUrl = mode === 'pull' ? pullUrl : null;

      res.json({
        success: true,
        roomId,
        mode,
        pullUrl: room.srtPullUrl,
        streamActive: room.srtStreamActive
      });

    } catch (error) {
      console.error(`[SRT] Error configuring room ${roomId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to configure SRT mode'
      });
    }
  });

  /**
   * GET /:roomId/srt/config
   * Get current SRT configuration for a room
   */
  router.get('/:roomId/srt/config', async (req, res) => {
    const { roomId } = req.params;

    try {
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return res.status(404).json({
          success: false,
          error: 'Room not found'
        });
      }

      res.json({
        success: true,
        roomId,
        mode: room.srtMode,
        pullUrl: room.srtPullUrl,
        streamActive: room.srtStreamActive,
        connectedAt: room.srtConnectedAt
      });

    } catch (error) {
      console.error(`[SRT] Error fetching config for room ${roomId}: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch SRT configuration'
      });
    }
  });

  return router;
}

module.exports = createSRTRouter;
