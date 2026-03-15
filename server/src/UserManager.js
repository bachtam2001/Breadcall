const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

class UserManager {
  constructor(database, rbacManager) {
    this.db = database;
    this.rbac = rbacManager;
    this.passwordCost = 12;
  }

  async initialize() {
    console.log('[UserManager] Initialized');
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

    const existingUser = await this.db.getUserByUsername(username);
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

  async getUserById(userId) {
    return this.db.getUserById(userId);
  }

  async getAllUsers() {
    return this.db.getAllUsers();
  }

  async updateUserRole(userId, newRole, actorId) {
    const actor = await this.db.getUserById(actorId);
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

    return {
      id: userId,
      role: newRole,
      updatedAt: new Date().toISOString()
    };
  }

  async deleteUser(userId, actorId = null) {
    if (actorId) {
      const actor = await this.db.getUserById(actorId);
      const target = await this.db.getUserById(userId);

      if (!actor || !target) {
        throw new Error('User not found');
      }

      const canDelete = await this.rbac.canAccessHigherRole(actor.role, target.role);
      if (!canDelete && actor.role !== 'super_admin') {
        throw new Error('Insufficient permissions to delete this user');
      }
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
