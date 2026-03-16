-- Seed Data: Roles and Permissions (Simplified RBAC)
-- Date: 2026-03-16
-- Changes:
--   - super_admin -> admin (creates users, full access)
--   - removed room_admin role
--   - director can create rooms
--   - publisher has participant + view permissions (Google Meet style)
--   - user registration disabled (admin creates all users)

-- ============================================================================
-- SYSTEM ROLES (Global permissions)
-- ============================================================================
INSERT INTO roles (name, hierarchy, description) VALUES
  ('admin', 100, 'Full system access - creates users, manages everything'),
  ('operator', 40, 'Read-only monitoring and analytics access')
ON CONFLICT (name) DO UPDATE SET
  hierarchy = EXCLUDED.hierarchy,
  description = EXCLUDED.description;

-- ============================================================================
-- OBJECT-LEVEL ROLES (Assigned per-room)
-- ============================================================================
INSERT INTO roles (name, hierarchy, description) VALUES
  ('director', 70, 'Can create rooms, full control over assigned rooms'),
  ('co_director', 60, 'Can assist director - switch scenes, moderate chat'),
  ('moderator', 50, 'Can mute/kick participants, manage chat'),
  ('publisher', 30, 'Can publish media, view others (Google Meet style)'),
  ('participant', 20, 'Can join room, send audio/video, chat'),
  ('viewer', 10, 'View-only access to streams')
ON CONFLICT (name) DO UPDATE SET
  hierarchy = EXCLUDED.hierarchy,
  description = EXCLUDED.description;

-- ============================================================================
-- SYSTEM ROLE PERMISSIONS
-- ============================================================================

-- Admin: Full wildcard permission on everything + user management
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('admin', '*', 'system'),
  ('admin', '*', 'room'),
  ('admin', '*', 'user'),
  ('admin', '*', 'stream'),
  ('admin', '*', 'analytics'),
  ('admin', 'user:create', 'system'),
  ('admin', 'user:delete', 'system'),
  ('admin', 'user:assign_role', 'system')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Operator: Read-only system access
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('operator', 'analytics:view', 'system'),
  ('operator', 'monitoring:view', 'system'),
  ('operator', 'room:view_all', 'system')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- ============================================================================
-- OBJECT-LEVEL ROLE PERMISSIONS
-- ============================================================================

-- Director: Can create rooms + full room control
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('director', 'room:create', 'system'),
  ('director', 'room:delete', 'room'),
  ('director', 'room:update', 'room'),
  ('director', 'room:view', 'room'),
  ('director', 'room:manage_settings', 'room'),
  ('director', 'user:kick', 'room'),
  ('director', 'user:mute', 'room'),
  ('director', 'stream:switch_scene', 'room'),
  ('director', 'stream:generate_srt', 'room'),
  ('director', 'stream:view_all', 'room'),
  ('director', 'stream:publish', 'room'),
  ('director', 'chat:moderate', 'room'),
  ('director', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Co-Director: Can assist with scenes and chat
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('co_director', 'room:view', 'room'),
  ('co_director', 'user:mute', 'room'),
  ('co_director', 'stream:switch_scene', 'room'),
  ('co_director', 'stream:view_all', 'room'),
  ('co_director', 'stream:publish', 'room'),
  ('co_director', 'chat:moderate', 'room'),
  ('co_director', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Moderator: Chat and participant management
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('moderator', 'room:view', 'room'),
  ('moderator', 'user:kick', 'room'),
  ('moderator', 'user:mute', 'room'),
  ('moderator', 'chat:moderate', 'room'),
  ('moderator', 'chat:send', 'room'),
  ('moderator', 'stream:view_all', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Publisher: Participant + view others (Google Meet style)
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('publisher', 'room:view', 'room'),
  ('publisher', 'stream:publish', 'room'),
  ('publisher', 'stream:view_all', 'room'),
  ('publisher', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Participant: Join and participate
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('participant', 'room:view', 'room'),
  ('participant', 'stream:publish', 'room'),
  ('participant', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Viewer: View-only
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('viewer', 'room:view', 'room'),
  ('viewer', 'stream:view', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- ============================================================================
-- CLEANUP: Remove old roles and permissions
-- ============================================================================

-- Delete old room_admin role permissions
DELETE FROM role_permissions WHERE role = 'room_admin';

-- Delete old super_admin permissions (admin now has these)
DELETE FROM role_permissions WHERE role = 'super_admin';

-- Delete old generic permissions
DELETE FROM role_permissions WHERE permission IN (
  'create', 'delete', 'update', 'assign', 'promote', 'mute', 'kick',
  'view_all', 'switch_scenes', 'generate_srt', 'view_analytics',
  'view_monitoring', 'join', 'send_audio', 'send_video', 'chat', 'view_solo',
  'view'
) AND object_type IN ('room', 'stream', 'user', 'system');

-- Note: room_admin and super_admin roles remain in DB for backward compatibility
-- but have no permissions. New code should use 'admin' role.
