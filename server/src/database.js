const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  async initialize() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable not set');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connection with retry logic
    const maxRetries = 5;
    const retryDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        await client.release();
        this.connected = true;
        console.log('[Database] Connected to PostgreSQL');
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          console.error('[Database] Failed to connect after', maxRetries, 'attempts');
          throw error;
        }
        console.warn(`[Database] Connection attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Execute parameterized query and return all rows
   */
  async query(text, params = []) {
    const result = await this.pool.query(text, params);
    return result.rows;
  }

  /**
   * Execute parameterized query and return single row or null
   */
  async queryOne(text, params = []) {
    const result = await this.pool.query(text, params);
    return result.rows[0] || null;
  }

  /**
   * Shutdown hook - close all pool connections
   */
  async shutdown() {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
      console.log('[Database] Pool closed');
    }
  }

  // ===========================================================================
  // Refresh Token Methods
  // ===========================================================================

  async insertRefreshToken(tokenData) {
    console.log('[Database] insertRefreshToken called for tokenId:', tokenData.tokenId);
    const result = await this.query(
      `INSERT INTO refresh_tokens
       (token_id, type, room_id, user_id, expires_at, created_at, revoked_at, revoked_reason, rotated_to, rotated_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (token_id) DO UPDATE SET
         type = EXCLUDED.type,
         room_id = EXCLUDED.room_id,
         user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at,
         created_at = EXCLUDED.created_at,
         revoked_at = EXCLUDED.revoked_at,
         revoked_reason = EXCLUDED.revoked_reason,
         rotated_to = EXCLUDED.rotated_to,
         rotated_from = EXCLUDED.rotated_from`,
      [
        tokenData.tokenId,
        tokenData.type,
        tokenData.roomId,
        tokenData.userId,
        new Date(tokenData.expiresAt),
        new Date(tokenData.createdAt || Date.now()),
        tokenData.revokedAt ? new Date(tokenData.revokedAt) : null,
        tokenData.revokedReason || null,
        tokenData.rotatedTo || null,
        tokenData.rotatedFrom || null
      ]
    );
    console.log('[Database] insertRefreshToken complete for tokenId:', tokenData.tokenId);
    return result;
  }

  async getRefreshToken(tokenId) {
    return await this.queryOne(
      'SELECT * FROM refresh_tokens WHERE token_id = $1',
      [tokenId]
    );
  }

  async revokeRefreshToken(tokenId, reason = 'revoked') {
    await this.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = $1 WHERE token_id = $2',
      [reason, tokenId]
    );
  }

  async rotateRefreshToken(oldTokenId, newTokenId) {
    await this.query(
      'UPDATE refresh_tokens SET rotated_to = $1 WHERE token_id = $2',
      [newTokenId, oldTokenId]
    );
  }

  async getTokensByRoom(roomId) {
    return await this.query(
      `SELECT * FROM refresh_tokens
       WHERE room_id = $1 AND revoked_at IS NULL AND rotated_to IS NULL`,
      [roomId]
    );
  }

  async revokeTokensByRoom(roomId, reason = 'room deleted') {
    const result = await this.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = $1 WHERE room_id = $2',
      [reason, roomId]
    );
    return result.rowCount;
  }

  async cleanupExpiredTokens() {
    const result = await this.query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
    );
    return result.rowCount;
  }

  // ===========================================================================
  // User Methods
  // ===========================================================================

  async insertUser(user) {
    await this.query(
      `INSERT INTO users
       (id, username, password_hash, role, email, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         updated_at = NOW()`,
      [
        user.id,
        user.username,
        user.password_hash,
        user.role,
        user.email || null,
        user.display_name || null,
        user.created_at ? new Date(user.created_at) : new Date(),
        user.updated_at ? new Date(user.updated_at) : new Date()
      ]
    );
  }

  async getUserById(id) {
    return await this.queryOne(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
  }

  async getUserByUsername(username) {
    return await this.queryOne(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
  }

  async getAllUsers() {
    return await this.query(
      'SELECT id, username, role, email, display_name, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
  }

  async updateUserRole(userId, newRole) {
    await this.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
      [newRole, userId]
    );
  }

  async deleteUser(userId) {
    await this.query(
      'DELETE FROM users WHERE id = $1',
      [userId]
    );
  }

  // ===========================================================================
  // Role Methods
  // ===========================================================================

  async getRole(name) {
    return await this.queryOne(
      'SELECT * FROM roles WHERE name = $1',
      [name]
    );
  }

  async getAllRoles() {
    return await this.query(
      'SELECT * FROM roles ORDER BY hierarchy DESC'
    );
  }

  async getPermissionsForRole(role) {
    return await this.query(
      'SELECT * FROM role_permissions WHERE role = $1',
      [role]
    );
  }

  // ===========================================================================
  // Room Assignment Methods
  // ===========================================================================

  async insertRoomAssignment(assignment) {
    await this.query(
      `INSERT INTO room_assignments
       (id, user_id, room_id, assignment_role, granted_by, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, room_id) DO UPDATE SET
         assignment_role = EXCLUDED.assignment_role,
         granted_by = EXCLUDED.granted_by,
         granted_at = EXCLUDED.granted_at,
         expires_at = EXCLUDED.expires_at`,
      [
        assignment.id,
        assignment.user_id,
        assignment.room_id,
        assignment.assignment_role,
        assignment.granted_by || null,
        assignment.granted_at ? new Date(assignment.granted_at) : new Date(),
        assignment.expires_at ? new Date(assignment.expires_at) : null
      ]
    );
  }

  async getRoomAssignmentsForUser(userId) {
    return await this.query(
      `SELECT * FROM room_assignments
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
  }

  async getRoomAssignments(roomId) {
    return await this.query(
      `SELECT ra.*, u.username FROM room_assignments ra
       JOIN users u ON ra.user_id = u.id
       WHERE ra.room_id = $1`,
      [roomId]
    );
  }

  async removeRoomAssignment(userId, roomId) {
    await this.query(
      'DELETE FROM room_assignments WHERE user_id = $1 AND room_id = $2',
      [userId, roomId]
    );
  }

  // ===========================================================================
  // Stream Access Methods
  // ===========================================================================

  async grantStreamAccess(access) {
    await this.query(
      `INSERT INTO stream_access
       (id, user_id, stream_id, granted_by, granted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, stream_id) DO UPDATE SET
         granted_by = EXCLUDED.granted_by,
         granted_at = EXCLUDED.granted_at,
         expires_at = EXCLUDED.expires_at`,
      [
        access.id,
        access.user_id,
        access.stream_id,
        access.granted_by || null,
        access.granted_at ? new Date(access.granted_at) : new Date(),
        access.expires_at ? new Date(access.expires_at) : null
      ]
    );
  }

  async getStreamAccessForUser(userId) {
    return await this.query(
      `SELECT * FROM stream_access
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
  }

  async getStreamAccess(streamId) {
    return await this.query(
      `SELECT sa.*, u.username FROM stream_access sa
       JOIN users u ON sa.user_id = u.id
       WHERE sa.stream_id = $1`,
      [streamId]
    );
  }

  async revokeStreamAccess(userId, streamId) {
    await this.query(
      'DELETE FROM stream_access WHERE user_id = $1 AND stream_id = $2',
      [userId, streamId]
    );
  }

  // ===========================================================================
  // Seed Data
  // ===========================================================================

  async loadSeedData(seedFilePath) {
    const fs = require('fs');
    const sql = fs.readFileSync(seedFilePath, 'utf8');
    await this.query(sql);
    console.log('[Database] Seed data loaded from', seedFilePath);
  }

  // ===========================================================================
  // Legacy SQLite Methods (for backward compatibility - throw error if called)
  // ===========================================================================

  async getAllTables() {
    throw new Error('getAllTables not implemented for PostgreSQL');
  }

  async close() {
    console.warn('[Database] close() is deprecated, use shutdown() instead');
    await this.shutdown();
  }
}

module.exports = Database;
