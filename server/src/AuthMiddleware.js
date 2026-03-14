const session = require('express-session');
const crypto = require('crypto');

/**
 * AuthMiddleware - Session-based authentication for admin panel
 * Uses express-session with in-memory store (suitable for single-instance deployment)
 */
class AuthMiddleware {
  constructor() {
    this.adminPassword = process.env.ADMIN_PASSWORD || 'admin';

    // Cookie secure setting: use environment variable, but default to false for development
    // When behind nginx (production), X-Forwarded-Proto will be set and cookies will work
    // For direct connections (development), secure: false allows cookies over HTTP
    const cookieSecure = process.env.USE_SECURE_COOKIES === 'true';

    this.sessionMiddleware = session({
      secret: process.env.SESSION_SECRET || this.generateSecret(),
      resave: false,
      saveUninitialized: false,
      proxy: true, // Trust the reverse proxy when setting cookie security
      cookie: {
        secure: cookieSecure,
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
   * Timing-safe password comparison to prevent timing attacks
   */
  safePasswordMatch(provided, stored) {
    const providedBuffer = Buffer.from(provided);
    const storedBuffer = Buffer.from(stored);

    // Use timingSafeEqual if both buffers are same length
    if (providedBuffer.length === storedBuffer.length) {
      return crypto.timingSafeEqual(providedBuffer, storedBuffer);
    }

    // For different lengths, pad and compare
    const maxLength = Math.max(providedBuffer.length, storedBuffer.length);
    const paddedProvided = Buffer.alloc(maxLength);
    const paddedStored = Buffer.alloc(maxLength);

    providedBuffer.copy(paddedProvided);
    storedBuffer.copy(paddedStored);

    return crypto.timingSafeEqual(paddedProvided, paddedStored);
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
    try {
      const { password } = req.body || {};

      if (!password) {
        return res.status(400).json({
          success: false,
          error: 'Password required'
        });
      }

      // Timing-safe password comparison
      if (this.safePasswordMatch(password, this.adminPassword)) {
        req.session.isAdmin = true;
        req.session.loggedInAt = new Date().toISOString();

        // Force session to be saved - express-session needs this with saveUninitialized: false
        req.session.touch(Date.now());

        console.log('[AuthMiddleware] Login successful, session modified:', req.session.id);

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
    } catch (error) {
      console.error('[AuthMiddleware] Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed - internal server error'
      });
    }
  }

  /**
   * Logout endpoint handler
   * POST /api/admin/logout
   */
  logout(req, res) {
    // Destroy session completely to prevent session fixation
    req.session.destroy((err) => {
      if (err) {
        console.error('[AuthMiddleware] Logout error:', err);
        return res.status(500).json({
          success: false,
          error: 'Logout failed'
        });
      }
      res.clearCookie('connect.sid');
      res.json({
        success: true,
        message: 'Logout successful'
      });
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
