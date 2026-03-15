const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

class UserManager {
  constructor(database, rbacManager, redisClient) {
    this.db = database;
    this.rbac = rbacManager;
    this.redis = redisClient;
    this.passwordCost = 12;
    this.userCacheTtl = 5 * 60; // 5 minutes
  }

  async initialize() {
    console.log('[UserManager] Initialized');
  }

  /**
   * Check if Redis caching is available
   */
  _isRedisAvailable() {
    return this.redis && this.redis.isReady && this.redis.isReady();
  }

  /**
   * Get user by ID with Redis caching
   */
  async getUserById(userId) {
    // Try cache first if Redis is available
    if (this._isRedisAvailable()) {
      const cached = await this.redis.getJson(`user:${userId}`);
      if (cached) {
        return cached;
      }
    }

    // Fetch from database
    const user = await this.db.getUserById(userId);
    if (user && this._isRedisAvailable()) {
      // Cache the user
      await this.redis.setJson(`user:${userId}`, user, this.userCacheTtl);
    }
    return user;
  }

  /**
   * Get user by username with Redis caching
   */
  async getUserByUsername(username) {
    // Try cache first if Redis is available
    if (this._isRedisAvailable()) {
      const cached = await this.redis.getJson(`user:username:${username}`);
      if (cached) {
        return cached;
      }
    }

    // Fetch from database
    const user = await this.db.getUserByUsername(username);
    if (user && this._isRedisAvailable()) {
      // Cache the user by username
      await this.redis.setJson(`user:username:${username}`, user, this.userCacheTtl);
      // Also cache by ID
      await this.redis.setJson(`user:${user.id}`, user, this.userCacheTtl);
    }
    return user;
  }

  /**
   * Invalidate user cache by ID
   */
  async invalidateUserCache(userId) {
    if (!this._isRedisAvailable()) return;
    // Remove user by ID
    await this.redis.del(`user:${userId}`);
  }

  /**
   * Invalidate user cache by username (used when username is known)
   */
  async invalidateUserCacheByUsername(username) {
    if (!this._isRedisAvailable()) return;
    await this.redis.del(`user:username:${username}`);
  }

  async hashPassword(password) {
    return bcrypt.hash(password, this.passwordCost);
  }

  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  async createUser(userData) {
    const { username, password, role, displayName, email } = userData;

    const roleData = await this.db.getRole(role);
    if (!roleData) {
      throw new Error('Invalid role');
    }

    const existingUser = await this.getUserByUsername(username);
    if (existingUser) {
      throw new Error('Username already exists');
    }

    const passwordHash = await this.hashPassword(password);
    const userId = uuidv4();

    await this.db.insertUser({
      id: userId,
      username,
      password_hash: passwordHash,
      role,
      display_name: displayName || null,
      email: email || null
    });

    // Invalidate all users cache to force refresh
    if (this._isRedisAvailable()) {
      await this.redis.invalidate('user:*');
    }

    return {
      id: userId,
      username,
      role,
      displayName: displayName || null,
      email: email || null,
      createdAt: new Date().toISOString()
    };
  }

  async authenticateUser(username, password) {
    // Don't use cache for authentication - always fetch fresh
    const user = await this.db.getUserByUsername(username);

    if (!user) {
      return { success: false, error: 'Invalid credentials' };
    }

    const valid = await this.verifyPassword(password, user.password_hash);

    if (!valid) {
      return { success: false, error: 'Invalid credentials' };
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        email: user.email
      }
    };
  }

  async getAllUsers() {
    // Check if Redis is available and if we have cached all users
    if (this._isRedisAvailable()) {
      const cached = await this.redis.getJson('users:all');
      if (cached) {
        return cached;
      }
    }

    // Fetch from database
    const users = await this.db.getAllUsers();

    // Cache the result if Redis is available
    if (this._isRedisAvailable()) {
      await this.redis.setJson('users:all', users, 60); // 1 minute cache for all users
    }

    return users;
  }

  async updateUserRole(userId, newRole, actorId) {
    const actor = await this.getUserById(actorId);
    if (!actor) {
      throw new Error('Actor not found');
    }

    const canAssign = await this.rbac.canAssignRole(actor.role, newRole);
    if (!canAssign && actor.role !== 'super_admin') {
      throw new Error('Insufficient permissions to change role');
    }

    const roleData = await this.db.getRole(newRole);
    if (!roleData) {
      throw new Error('Invalid role');
    }

    await this.db.updateUserRole(userId, newRole);

    // Invalidate user cache
    await this.invalidateUserCache(userId);
    // Invalidate all users cache
    if (this._isRedisAvailable()) {
      await this.redis.del('users:all');
    }

    return {
      id: userId,
      role: newRole,
      updatedAt: new Date().toISOString()
    };
  }

  async deleteUser(userId, actorId = null) {
    if (actorId) {
      const actor = await this.getUserById(actorId);
      const target = await this.getUserById(userId);

      if (!actor || !target) {
        throw new Error('User not found');
      }

      const canDelete = await this.rbac.canAccessHigherRole(actor.role, target.role);
      if (!canDelete && actor.role !== 'super_admin') {
        throw new Error('Insufficient permissions to delete this user');
      }
    }

    // Get user before deleting to know what username to invalidate
    const user = await this.db.getUserById(userId);
    if (user) {
      await this.invalidateUserCache(userId);
      await this.invalidateUserCacheByUsername(user.username);
    }

    // Invalidate all users cache
    if (this._isRedisAvailable()) {
      await this.redis.del('users:all');
    }

    await this.db.deleteUser(userId);
    return true;
  }

  async createBootstrapAdmin(username, password) {
    const existingAdmin = await this.db.getUserByUsername(username);
    if (existingAdmin) {
      return { exists: true, user: existingAdmin };
    }

    return {
      exists: false,
      user: await this.createUser({
        username,
        password,
        role: 'super_admin',
        displayName: 'System Administrator'
      })
    };
  }
}

module.exports = UserManager;
