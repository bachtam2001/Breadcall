class RBACManager {
  constructor(database, redisClient) {
    this.db = database;
    this.redis = redisClient;
    this.roleCache = new Map();
    this.permissionsCacheTtl = 60 * 60; // 1 hour
  }

  async initialize() {
    // Try to load from Redis cache first
    if (this._isRedisAvailable()) {
      const cachedRoles = await this.redis.getJson('rbac:roles');
      if (cachedRoles && cachedRoles.length > 0) {
        for (const role of cachedRoles) {
          this.roleCache.set(role.name, role);
        }
        console.log(`[RBACManager] Loaded ${this.roleCache.size} roles from Redis cache`);
        return;
      }
    }

    // Load from database
    const roles = await this.db.getAllRoles();
    for (const role of roles) {
      const permissions = await this.db.getPermissionsForRole(role.name);
      const roleData = {
        ...role,
        permissions
      };
      this.roleCache.set(role.name, roleData);
    }

    // Cache in Redis
    if (this._isRedisAvailable()) {
      await this.redis.setJson('rbac:roles', Array.from(this.roleCache.values()), this.permissionsCacheTtl);
    }

    console.log(`[RBACManager] Initialized with ${this.roleCache.size} roles`);
  }

  /**
   * Check if Redis is available
   */
  _isRedisAvailable() {
    return this.redis && this.redis.isReady && this.redis.isReady();
  }

  /**
   * Invalidate RBAC cache (called when permissions change)
   */
  async invalidateCache() {
    if (this._isRedisAvailable()) {
      await this.redis.del('rbac:roles');
    }
    this.roleCache.clear();
  }

  /**
   * Reload roles from database and update cache
   */
  async reloadRoles() {
    // Clear existing cache
    this.roleCache.clear();

    // Load from database
    const roles = await this.db.getAllRoles();
    for (const role of roles) {
      const permissions = await this.db.getPermissionsForRole(role.name);
      const roleData = {
        ...role,
        permissions
      };
      this.roleCache.set(role.name, roleData);
    }

    // Update Redis cache
    if (this._isRedisAvailable()) {
      await this.redis.setJson('rbac:roles', Array.from(this.roleCache.values()), this.permissionsCacheTtl);
    }

    console.log(`[RBACManager] Reloaded ${this.roleCache.size} roles`);
  }

  /**
   * Get the hierarchy level for a role
   * @param {string} roleName - The role name
   * @returns {Promise<number|null>} - The hierarchy level or null if role doesn't exist
   */
  async getRoleHierarchy(roleName) {
    const role = this.roleCache.get(roleName);
    if (!role) {
      const dbRole = await this.db.getRole(roleName);
      if (dbRole) {
        this.roleCache.set(roleName, dbRole);
        return dbRole.hierarchy;
      }
      return null;
    }
    return role.hierarchy;
  }

  /**
   * Check if a role has a specific permission
   * @param {string} roleName - The role name
   * @param {string} permission - The permission to check
   * @param {string} objectType - The object type (room, stream, user, system)
   * @returns {Promise<boolean>} - True if the role has the permission
   */
  async hasPermission(roleName, permission, objectType) {
    const role = this.roleCache.get(roleName);
    if (!role) return false;

    // Super admin has all permissions
    if (roleName === 'super_admin') return true;

    // Check for wildcard permissions on this object type or system-wide
    const hasWildcard = role.permissions.some(
      p => p.permission === '*' && (p.object_type === objectType || p.object_type === 'system')
    );
    if (hasWildcard) return true;

    // Check for specific permission
    return role.permissions.some(
      p => p.permission === permission && (p.object_type === objectType || p.object_type === 'system')
    );
  }

  /**
   * Check if an actor role can access a target role (actor must have higher hierarchy)
   * @param {string} actorRole - The actor's role
   * @param {string} targetRole - The target role to access
   * @returns {Promise<boolean>} - True if actor can access target
   */
  async canAccessHigherRole(actorRole, targetRole) {
    const actorHierarchy = await this.getRoleHierarchy(actorRole);
    const targetHierarchy = await this.getRoleHierarchy(targetRole);

    if (actorHierarchy === null || targetHierarchy === null) return false;

    // Must be strictly greater (cannot access same level)
    return actorHierarchy > targetHierarchy;
  }

  /**
   * Check if an actor role can assign a target role to someone
   * @param {string} actorRole - The actor's role
   * @param {string} targetRole - The role being assigned
   * @returns {Promise<boolean>} - True if actor can assign the target role
   */
  async canAssignRole(actorRole, targetRole) {
    const hasAssignPerm = await this.hasPermission(actorRole, 'assign', 'room');
    const canPromote = await this.hasPermission(actorRole, 'promote', 'user');
    const canAccess = await this.canAccessHigherRole(actorRole, targetRole);

    return (hasAssignPerm || canPromote) && canAccess;
  }

  /**
   * Get all permissions for a role
   * @param {string} roleName - The role name
   * @returns {Promise<Array>} - Array of permission objects
   */
  async getAllPermissions(roleName) {
    const role = this.roleCache.get(roleName);
    if (!role) return [];
    return role.permissions;
  }

  /**
   * Get all roles with their hierarchy levels
   * @returns {Array} - Array of role objects ordered by hierarchy descending
   */
  getAllRoles() {
    return Array.from(this.roleCache.values())
      .map(r => ({
        name: r.name,
        hierarchy: r.hierarchy,
        description: r.description
      }))
      .sort((a, b) => b.hierarchy - a.hierarchy);
  }
}

module.exports = RBACManager;
