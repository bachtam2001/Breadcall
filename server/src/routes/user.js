const express = require('express');

/**
 * User Routes - User-specific API endpoints
 * Mounted at /api/user
 */

/**
 * GET /api/user/rooms
 * Get all rooms assigned to the current user
 * Returns room details including participant count and assignment role
 */
function createUserRouter(olaManager, roomManager) {
  const router = express.Router();

  router.get('/rooms', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const rbacManager = req.app.locals.rbacManager;
    const hasPermission = await rbacManager.hasPermission(req.user.role, 'view', 'room');
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    try {

      // Get user's room assignments from OLAManager
      const assignments = await olaManager.getUserRoomAssignments(userId);

      // Build room details for each assignment
      const rooms = [];
      for (const assignment of assignments) {
        const roomId = assignment.room_id;
        const room = roomManager.getRoom(roomId);

        if (room) {
          rooms.push({
            roomId: room.id,
            name: room.name || `Room ${room.id}`,
            participantCount: room.participants.size,
            assignmentRole: assignment.assignment_role
          });
        }
      }

      res.json({
        success: true,
        rooms
      });
    } catch (error) {
      console.error('[User API] Error fetching user rooms:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user rooms'
      });
    }
  });

  return router;
}

module.exports = createUserRouter;
