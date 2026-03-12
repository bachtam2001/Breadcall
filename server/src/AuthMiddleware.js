const session = require('express-session');

/**
 * AuthMiddleware - Session-based authentication for admin panel
 * Uses express-session with in-memory store (suitable for single-instance deployment)
 */
class AuthMiddleware {
  constructor() {
    this.adminPassword = process.env.ADMIN_PASSWORD || 'admin';
    this.sessionMiddleware = session({
      secret: process.env.SESSION_SECRET || this.generateSecret(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.USE_SECURE_COOKIES === 'true',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    });
  }

  /**
   * Generate a random secret if not provided
   */
  generateSecret() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Get the session middleware
   */
  getSessionMiddleware() {
    return this.sessionMiddleware;
  }

  /**
   * Check if user is authenticated as admin
   */
  isAuthenticated(req, res, next) {
    if (req.session && req.session.isAdmin) {
      return next();
    }
    res.status(401).json({
      success: false,
      error: 'Unauthorized - Admin login required'
    });
  }

  /**
   * Login endpoint handler
   * POST /api/admin/login
   */
  login(req, res) {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password required'
      });
    }

    // Simple password comparison (use bcrypt for production)
    if (password === this.adminPassword) {
      req.session.isAdmin = true;
      req.session.loggedInAt = new Date().toISOString();

      res.json({
        success: true,
        message: 'Login successful'
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Invalid password'
      });
    }
  }

  /**
   * Logout endpoint handler
   * POST /api/admin/logout
   */
  logout(req, res) {
    if (req.session) {
      req.session.isAdmin = false;
    }
    res.json({
      success: true,
      message: 'Logout successful'
    });
  }

  /**
   * Get current admin status
   * GET /api/admin/me
   */
  getCurrentUser(req, res) {
    if (req.session && req.session.isAdmin) {
      res.json({
        success: true,
        isAdmin: true,
        loggedInAt: req.session.loggedInAt
      });
    } else {
      res.json({
        success: true,
        isAdmin: false
      });
    }
  }
}

module.exports = AuthMiddleware;
