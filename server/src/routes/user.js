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
function createUserRouter(roomManager) {
  const router = express.Router();

  router.get('/rooms', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const rbacManager = req.app.locals.rbacManager;
    const hasPermission = await rbacManager.hasPermission(req.user.role, 'room:view') ||
                          await rbacManager.hasPermission(req.user.role, 'room:view_all');
    if (!hasPermission) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    try {
      // OLAManager removed - returning empty rooms array
      const rooms = [];

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
