/**
 * AuthService - Handles user authentication for BreadCall
 * Manages login, logout, token refresh, and session persistence
 * Access token is stored in sessionStorage for persistence across page reloads
 * Refresh token is stored in HttpOnly cookie by server
 */
class AuthService {
  constructor() {
    this.currentUser = null;
    this.accessToken = null;
    this.tokenExpiry = null;
    this.refreshTimer = null;
    this.authCheckPromise = null;

    // Restore access token from sessionStorage if available
    this._restoreTokenFromStorage();
  }

  /**
   * Restore access token and user data from sessionStorage
   * @private
   */
  _restoreTokenFromStorage() {
    try {
      const storedData = sessionStorage.getItem('authToken');
      if (storedData) {
        const { accessToken, tokenExpiry, user } = JSON.parse(storedData);

        // Check if token is still valid
        if (tokenExpiry && Date.now() < tokenExpiry) {
          this.accessToken = accessToken;
          this.tokenExpiry = tokenExpiry;
          this.currentUser = user;
          console.log('[AuthService] Restored token from sessionStorage');

          // Re-schedule token refresh
          const remainingTime = Math.floor((tokenExpiry - Date.now()) / 1000);
          this._scheduleTokenRefresh(remainingTime);
        } else {
          // Token expired, clear storage
          sessionStorage.removeItem('authToken');
        }
      }
    } catch (error) {
      console.error('[AuthService] Failed to restore token from storage:', error);
      sessionStorage.removeItem('authToken');
    }
  }

  /**
   * Save access token to sessionStorage
   * @private
   */
  _saveTokenToStorage() {
    try {
      sessionStorage.setItem('authToken', JSON.stringify({
        accessToken: this.accessToken,
        tokenExpiry: this.tokenExpiry,
        user: this.currentUser
      }));
    } catch (error) {
      console.error('[AuthService] Failed to save token to storage:', error);
    }
  }

  /**
   * Clear token from sessionStorage
   * @private
   */
  _clearTokenFromStorage() {
    try {
      sessionStorage.removeItem('authToken');
    } catch (error) {
      console.error('[AuthService] Failed to clear token from storage:', error);
    }
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
    console.log('[AuthService] Checking auth status...');
    try {
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include', // Include cookies for refresh token
        headers: this._getAuthHeaders()
      });

      console.log('[AuthService] /api/auth/me response status:', response.status);

      if (!response.ok) {
        // If 401, try to refresh the token (refresh token may exist in cookie even if access token is missing)
        if (response.status === 401) {
          console.log('[AuthService] 401 received, attempting token refresh...');
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            return this.checkAuthStatus();
          }
        }
        this.currentUser = null;
        this.accessToken = null;
        this._clearTokenFromStorage();
        return false;
      }

      const data = await response.json();
      if (data.success && data.user) {
        this.currentUser = data.user;
        console.log('[AuthService] Authenticated as:', data.user.username);
        return true;
      }

      this.currentUser = null;
      return false;
    } catch (error) {
      console.error('[AuthService] Auth check failed:', error);
      this.currentUser = null;
      this.authCheckPromise = null; // Reset to allow retry
      return false;
    } finally {
      // Clear the promise after completion to allow future checks
      this.authCheckPromise = null;
    }
  }

  /**
   * Login with username and password
   * @param {string} username - User's username
   * @param {string} password - User's password
   * @returns {Promise<{success: boolean, user?: Object, error?: string}>}
   */
  async login(username, password) {
    console.log('[AuthService] Login attempt for user:', username);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for refresh token
        body: JSON.stringify({ username, password })
      });

      console.log('[AuthService] Login response status:', response.status);
      const data = await response.json();
      console.log('[AuthService] Login response:', data.success ? 'SUCCESS' : 'FAILED', data.error || '');

      if (data.success) {
        this.currentUser = data.user;
        this.accessToken = data.accessToken;
        this.tokenExpiry = Date.now() + (data.expiresIn * 1000);
        console.log('[AuthService] Logged in as:', data.user.username, 'role:', data.user.role);

        // Save token to sessionStorage for persistence across page reloads
        this._saveTokenToStorage();

        // Schedule token refresh
        this._scheduleTokenRefresh(data.expiresIn);

        // Clear cached auth check so subsequent init() calls re-check with new token
        this.authCheckPromise = null;
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
   * Refresh access token using refresh token cookie
   * @returns {Promise<boolean>} - Whether refresh was successful
   */
  async refreshAccessToken() {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include', // Include cookies for refresh token
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (data.success) {
        this.accessToken = data.accessToken;
        this.tokenExpiry = Date.now() + (data.expiresIn * 1000);

        // Save refreshed token to sessionStorage
        this._saveTokenToStorage();

        // Schedule next token refresh
        this._scheduleTokenRefresh(data.expiresIn);

        console.log('[AuthService] Access token refreshed successfully');
        return true;
      } else {
        console.error('[AuthService] Token refresh failed:', data.error);
        // Clear stored token as it's no longer valid
        this.accessToken = null;
        this.tokenExpiry = null;
        this.currentUser = null;
        this._clearTokenFromStorage();
        return false;
      }
    } catch (error) {
      console.error('[AuthService] Token refresh error:', error);
      return false;
    }
  }

  /**
   * Schedule automatic token refresh before expiry
   * @param {number} expiresIn - Token expiry time in seconds
   * @private
   */
  _scheduleTokenRefresh(expiresIn) {
    // Clear any existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Refresh 1 minute before expiry
    const refreshDelay = Math.max(0, (expiresIn - 60) * 1000);

    this.refreshTimer = setTimeout(() => {
      this.refreshAccessToken();
    }, refreshDelay);

    console.log(`[AuthService] Token refresh scheduled in ${Math.round(refreshDelay / 1000)}s`);
  }

  /**
   * Get authentication headers for API requests
   * @returns {Object} - Headers object with Authorization if token exists
   * @private
   */
  _getAuthHeaders() {
    const headers = {};
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /**
   * Fetch with automatic authentication and 401 retry
   * Implements the "Silent Refresh" pattern from the JWT + HttpOnly Cookie spec
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} - Fetch response
   */
  async fetchWithAuth(url, options = {}) {
    // Merge auth headers with provided headers
    const headers = {
      ...this._getAuthHeaders(),
      ...options.headers
    };

    // First attempt
    let response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include' // Always include cookies for refresh token
    });

    // If 401 Unauthorized, token may be expired - try to refresh
    if (response.status === 401 && this.accessToken) {
      console.log('[AuthService] Received 401, attempting token refresh...');

      const refreshed = await this.refreshAccessToken();

      if (refreshed) {
        // Retry the original request with new token
        console.log('[AuthService] Token refreshed, retrying request...');
        response = await fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${this.accessToken}`
          },
          credentials: 'include'
        });
      } else {
        // Refresh failed - clear auth state and redirect to login
        console.error('[AuthService] Token refresh failed, redirecting to login');
        this.accessToken = null;
        this.currentUser = null;
        window.location.href = '/login';
        throw new Error('Session expired');
      }
    }

    return response;
  }

  /**
   * Logout current user
   * @returns {Promise<{success: boolean}>}
   */
  async logout() {
    try {
      // Clear token refresh timer
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }

      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();

      // Clear local auth state
      this.accessToken = null;
      this.tokenExpiry = null;
      this.currentUser = null;
      this._clearTokenFromStorage();

      if (data.success) {
        return { success: true };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('[AuthService] Logout error:', error);
      // Still clear local state on error
      this.accessToken = null;
      this.tokenExpiry = null;
      this.currentUser = null;
      this._clearTokenFromStorage();
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
   * Get current access token
   * @returns {string|null} - Access token or null
   */
  getAccessToken() {
    return this.accessToken;
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
        credentials: 'include',
        headers: this._getAuthHeaders()
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

  /**
   * Get WebSocket URL with token for authenticated connections
   * @returns {string} - WebSocket URL with token query param if authenticated
   */
  getWebSocketUrl() {
    const baseUrl = `ws://${window.location.host}/ws`;
    if (this.accessToken) {
      return `${baseUrl}?token=${encodeURIComponent(this.accessToken)}`;
    }
    return baseUrl;
  }
}

// Export singleton instance
window.authService = new AuthService();
