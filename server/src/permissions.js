/**
 * Token Permissions - Default permissions by token type
 * Shared utility for both TokenManager and RoomManager
 */

/**
 * Get default permissions by token type
 * @param {string} type - Token type
 * @returns {Array} Default permissions
 */
function getDefaultPermissions(type) {
  switch (type) {
    case 'room_access':
      return ['join', 'send_audio', 'send_video', 'chat'];
    case 'director_access':
      return ['view_all', 'mute', 'room_settings'];
    case 'stream_access':
      return ['view'];
    case 'action_token':
      return ['execute'];
    case 'admin_token':
      return ['create', 'delete', 'update', 'assign'];
    default:
      return [];
  }
}

module.exports = { getDefaultPermissions };
