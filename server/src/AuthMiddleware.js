/**
 * AuthMiddleware - JWT-based authentication middleware
 * Validates JWT tokens and enforces RBAC permissions
 */
class AuthMiddleware {
  constructor(database, rbacManager, tokenManager) {
    this.db = database;
    this.rbac = rbacManager;
    this.tokenManager = tokenManager;
  }

  /**
   * Authenticate a request using JWT token
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} - { authenticated: boolean, user?: Object, tokenPayload?: Object, error?: string }
   */
  async authenticate(req) {
    let token = null;

    // Try to get token from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    // If no token in header, try to get from cookie
    if (!token && req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      return { authenticated: false, error: 'No token provided' };
    }

    const validation = await this.tokenManager.validateAccessToken(token);

    if (!validation.valid) {
      return { authenticated: false, error: `Token ${validation.reason}` };
    }

    const user = await this.db.getUserById(validation.payload.userId);

    if (!user) {
      return { authenticated: false, error: 'User not found' };
    }

    return {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        permissions: validation.payload.permissions
      },
      tokenPayload: validation.payload
    };
  }

  /**
   * Express middleware function that requires authentication
   * @returns {Function} - Express middleware function
   */
  requireAuth() {
    return async (req, res, next) => {
      const result = await this.authenticate(req);

      if (!result.authenticated) {
        return res.status(401).json({
          success: false,
          error: `Unauthorized - ${result.error}`
        });
      }

      req.user = result.user;
      req.tokenPayload = result.tokenPayload;
      next();
    };
  }

  /**
   * Express middleware function that requires a specific permission
   * Supports both legacy format and new resource:action format
   * @param {string} permission - The permission required (e.g., 'room:create', 'user:kick')
   * @param {string} objectType - Optional object type for legacy compatibility
   * @returns {Function} - Express middleware function
   */
  requirePermission(permission, objectType = null) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const hasPermission = await this.rbac.hasPermission(req.user.role, permission, objectType);

      if (!hasPermission) {
        const permString = permission.includes(':') ? permission : `${objectType}:${permission}`;
        return res.status(403).json({
          success: false,
          error: `Forbidden - ${req.user.role} role does not have ${permString} permission`
        });
      }

      next();
    };
  }

  /**
   * Express middleware for room-specific permissions
   * Checks both system role and room assignment permissions
   * @param {string} permission - The permission required
   * @returns {Function} - Express middleware function
   */
  requireRoomPermission(permission) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Get room role from request (set by previous middleware or from body/params)
      const roomRole = req.roomRole || req.user.roomRole;

      const hasPermission = await this.rbac.hasRoomPermission(
        req.user.role,
        roomRole,
        permission
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: `Forbidden - insufficient permissions for this room`
        });
      }

      next();
    };
  }
}

module.exports = AuthMiddleware;
