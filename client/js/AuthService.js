/**
 * AuthService - Handles user authentication for BreadCall
 * Manages login, logout, token refresh, and session persistence using HttpOnly cookies
 */
class AuthService {
  constructor() {
    this.currentUser = null;
    this.authCheckPromise = null;
  }

  /**
   * Initialize auth service and check for existing session
   * @returns {Promise<boolean>} - Whether user is authenticated
   */
  async init() {
    // Prevent duplicate auth checks
    if (this.authCheckPromise) {
      return this.authCheckPromise;
    }

    this.authCheckPromise = this.checkAuthStatus();
    return this.authCheckPromise;
  }

  /**
   * Check if user has valid session
   * @returns {Promise<boolean>} - Whether user is authenticated
   */
  async checkAuthStatus() {
    try {
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include' // Include cookies
      });

      if (!response.ok) {
        this.currentUser = null;
        return false;
      }

      const data = await response.json();
      if (data.success && data.user) {
        this.currentUser = data.user;
        return true;
      }

      this.currentUser = null;
      return false;
    } catch (error) {
      console.error('[AuthService] Auth check failed:', error);
      this.currentUser = null;
      return false;
    }
  }

  /**
   * Login with username and password
   * @param {string} username - User's username
   * @param {string} password - User's password
   * @returns {Promise<{success: boolean, user?: Object, error?: string}>}
   */
  async login(username, password) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for HttpOnly JWT storage
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (data.success) {
        this.currentUser = data.user;
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      console.error('[AuthService] Login error:', error);
      return { success: false, error: 'Connection error' };
    }
  }

  /**
   * Logout current user
   * @returns {Promise<{success: boolean}>}
   */
  async logout() {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();
      if (data.success) {
        this.currentUser = null;
        return { success: true };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('[AuthService] Logout error:', error);
      return { success: false, error: 'Logout failed' };
    }
  }

  /**
   * Get current authenticated user
   * @returns {Object|null} - Current user object or null
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Check if user has specific role
   * @param {string} role - Role to check (e.g., 'super_admin', 'room_admin')
   * @returns {boolean}
   */
  hasRole(role) {
    return this.currentUser?.role === role;
  }

  /**
   * Check if user has specific permission
   * @param {string} permission - Permission to check (e.g., 'create', 'delete')
   * @param {string} objectType - Object type (e.g., 'room', 'stream')
   * @returns {boolean}
   */
  hasPermission(permission, objectType) {
    if (!this.currentUser?.permissions) {
      return false;
    }
    return this.currentUser.permissions.includes(permission);
  }

  /**
   * Check if user is admin
   * @returns {boolean}
   */
  isAdmin() {
    return this.currentUser?.role === 'admin';
  }

  /**
   * Check if user has admin access (admin role only)
   * @returns {boolean}
   */
  hasAdminAccess() {
    return this.currentUser?.role === 'admin';
  }

  /**
   * Check for existing room session (for auto-rejoin)
   * @returns {Promise<{hasRoom: boolean, roomId?: string}>}
   */
  async checkRoomSession() {
    try {
      const response = await fetch('/api/session/room', {
        credentials: 'include'
      });

      const data = await response.json();
      if (data.success) {
        return {
          hasRoom: data.hasRoom,
          roomId: data.roomId || null
        };
      }
      return { hasRoom: false };
    } catch (error) {
      console.error('[AuthService] Room session check failed:', error);
      return { hasRoom: false };
    }
  }
}

// Export singleton instance
window.authService = new AuthService();
