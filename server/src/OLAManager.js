class OLAManager {
  constructor(database, rbacManager) {
    this.db = database;
    this.rbac = rbacManager;
  }

  async initialize() {
    console.log('[OLAManager] Initialized');
  }

  /**
   * Assign a user to a room with a specific role
   * @param {string} userId - The user ID
   * @param {string} roomId - The room ID
   * @param {string} assignmentRole - The role to assign (e.g., 'director', 'participant')
   * @param {string} grantedBy - The user ID of who is granting this assignment
   * @param {string} [expiresAt] - Optional expiration date (ISO string)
   * @returns {Promise<Object>} - The created assignment object
   */
  async assignRoom(userId, roomId, assignmentRole, grantedBy, expiresAt = null) {
    const id = `assignment_${userId}_${roomId}_${Date.now()}`;

    const assignment = {
      id,
      user_id: userId,
      room_id: roomId,
      assignment_role: assignmentRole,
      granted_by: grantedBy,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt
    };

    await this.db.insertRoomAssignment(assignment);
    console.log(`[OLAManager] Assigned user ${userId} to room ${roomId} as ${assignmentRole}`);
    return assignment;
  }

  /**
   * Remove a room assignment for a user
   * @param {string} userId - The user ID
   * @param {string} roomId - The room ID
   * @returns {Promise<void>}
   */
  async removeRoomAssignment(userId, roomId) {
    await this.db.removeRoomAssignment(userId, roomId);
    console.log(`[OLAManager] Removed room assignment for user ${userId} in room ${roomId}`);
  }

  /**
   * Get all room assignments for a user
   * @param {string} userId - The user ID
   * @returns {Promise<Array>} - Array of room assignment objects
   */
  async getUserRoomAssignments(userId) {
    return await this.db.getRoomAssignmentsForUser(userId);
  }

  /**
   * Get all assignments for a specific room
   * @param {string} roomId - The room ID
   * @returns {Promise<Array>} - Array of room assignment objects with user info
   */
  async getRoomAssignments(roomId) {
    return await this.db.getRoomAssignments(roomId);
  }

  /**
   * Check if a user can access a room
   * @param {string} userId - The user ID
   * @param {string} roomId - The room ID
   * @returns {Promise<boolean>} - True if user can access the room
   */
  async canAccessRoom(userId, roomId) {
    // Get user to check their role
    const user = await this.db.getUserById(userId);
    if (!user) return false;

    // Admin has access to all rooms
    if (user.role === 'admin') return true;

    // Check if user has any valid room assignments for this room
    const assignments = await this.getUserRoomAssignments(userId);
    const hasAssignment = assignments.some(
      a => a.room_id === roomId
    );

    return hasAssignment;
  }

  /**
   * Grant a user access to a specific stream
   * @param {string} userId - The user ID
   * @param {string} streamId - The stream ID (e.g., 'roomId_participantId')
   * @param {string} grantedBy - The user ID of who is granting access
   * @param {string} [expiresAt] - Optional expiration date (ISO string)
   * @returns {Promise<Object>} - The created stream access object
   */
  async grantStreamAccess(userId, streamId, grantedBy, expiresAt = null) {
    const id = `stream_${userId}_${streamId}_${Date.now()}`;

    const access = {
      id,
      user_id: userId,
      stream_id: streamId,
      granted_by: grantedBy,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt
    };

    await this.db.grantStreamAccess(access);
    console.log(`[OLAManager] Granted user ${userId} access to stream ${streamId}`);
    return access;
  }

  /**
   * Check if a user can access a specific stream
   * @param {string} userId - The user ID
   * @param {string} streamId - The stream ID
   * @returns {Promise<boolean>} - True if user can access the stream
   */
  async canAccessStream(userId, streamId) {
    // Get user to check for super admin bypass
    const user = await this.db.getUserById(userId);
    if (!user) return false;

    // Admin has access to all streams
    if (user.role === 'admin') return true;

    // Check if user has valid stream access
    const streams = await this.db.getStreamAccessForUser(userId);
    const hasAccess = streams.some(
      s => s.stream_id === streamId
    );

    return hasAccess;
  }

  /**
   * Revoke a user's access to a stream
   * @param {string} userId - The user ID
   * @param {string} streamId - The stream ID
   * @returns {Promise<void>}
   */
  async revokeStreamAccess(userId, streamId) {
    await this.db.revokeStreamAccess(userId, streamId);
    console.log(`[OLAManager] Revoked user ${userId} access to stream ${streamId}`);
  }
}

module.exports = OLAManager;
