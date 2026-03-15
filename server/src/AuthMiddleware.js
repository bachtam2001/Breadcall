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
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { authenticated: false, error: 'No token provided' };
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

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
   * @param {string} permission - The permission required (e.g., 'create', 'delete')
   * @param {string} objectType - The object type (e.g., 'room', 'stream', 'user')
   * @returns {Function} - Express middleware function
   */
  requirePermission(permission, objectType) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const hasPermission = await this.rbac.hasPermission(req.user.role, permission, objectType);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: `Forbidden - ${req.user.role} role does not have ${permission} permission for ${objectType}`
        });
      }

      next();
    };
  }
}

module.exports = AuthMiddleware;
