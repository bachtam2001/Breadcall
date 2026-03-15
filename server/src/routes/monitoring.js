const express = require('express');

/**
 * Monitoring Routes - System monitoring and status endpoints
 * Mounted at /api/monitoring
 * Requires admin or monitoring role
 */

/**
 * GET /api/monitoring/status
 * Get overall system status including active rooms and total participants
 */
function createMonitoringRouter(roomManager) {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    const rbacManager = req.app.locals.rbacManager;
    const hasPermission = await rbacManager.hasPermission(req.user.role, 'view', 'system');
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    try {
      const rooms = roomManager.getAllRooms();
      const activeRooms = rooms.length;

      // Calculate total participants across all rooms
      let totalParticipants = 0;
      for (const room of rooms) {
        totalParticipants += room.participantCount;
      }

      res.json({
        success: true,
        activeRooms,
        totalParticipants
      });
    } catch (error) {
      console.error('[Monitoring API] Error fetching status:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monitoring status'
      });
    }
  });

  /**
   * GET /api/monitoring/rooms
   * Get detailed information about all active rooms
   */
  router.get('/rooms', async (req, res) => {
    const rbacManager = req.app.locals.rbacManager;
    const hasPermission = await rbacManager.hasPermission(req.user.role, 'view', 'system');
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    try {
      const rooms = roomManager.getAllRooms();

      const roomDetails = rooms.map(room => {
        // Determine stream status based on participant count
        let streamStatus = 'idle';
        if (room.participantCount > 0) {
          streamStatus = 'live';
        }

        return {
          roomId: room.id,
          name: room.name || `Room ${room.id}`,
          participantCount: room.participantCount,
          streamStatus
        };
      });

      res.json({
        success: true,
        rooms: roomDetails
      });
    } catch (error) {
      console.error('[Monitoring API] Error fetching rooms:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch room monitoring data'
      });
    }
  });

  return router;
}

module.exports = createMonitoringRouter;
