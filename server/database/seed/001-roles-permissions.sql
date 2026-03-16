-- Seed Data: Roles and Permissions (New RBAC Design)
-- Date: 2026-03-16
-- Uses resource:action permission format

-- ============================================================================
-- SYSTEM ROLES (Global permissions)
-- ============================================================================
INSERT INTO roles (name, hierarchy, description) VALUES
  ('super_admin', 100, 'Full system access - can do everything'),
  ('room_admin', 80, 'Can create and manage rooms, assign directors'),
  ('operator', 40, 'Read-only monitoring and analytics access')
ON CONFLICT (name) DO UPDATE SET
  hierarchy = EXCLUDED.hierarchy,
  description = EXCLUDED.description;

-- ============================================================================
-- OBJECT-LEVEL ROLES (Assigned per-room)
-- ============================================================================
INSERT INTO roles (name, hierarchy, description) VALUES
  ('director', 60, 'Full control over assigned rooms - scenes, SRT, mute/kick'),
  ('co_director', 50, 'Can assist director - switch scenes, moderate chat'),
  ('moderator', 40, 'Can mute/kick participants, manage chat'),
  ('publisher', 30, 'Can publish audio/video streams'),
  ('participant', 20, 'Can join room, send audio/video, chat'),
  ('viewer', 10, 'View-only access to streams')
ON CONFLICT (name) DO UPDATE SET
  hierarchy = EXCLUDED.hierarchy,
  description = EXCLUDED.description;

-- ============================================================================
-- SYSTEM ROLE PERMISSIONS (resource:action format)
-- ============================================================================

-- Super Admin: Has wildcard permission on everything
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('super_admin', '*', 'system'),
  ('super_admin', '*', 'room'),
  ('super_admin', '*', 'user'),
  ('super_admin', '*', 'stream'),
  ('super_admin', '*', 'analytics')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Room Admin: Can manage rooms and assign directors
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('room_admin', 'room:create', 'system'),
  ('room_admin', 'room:delete', 'system'),
  ('room_admin', 'room:update', 'system'),
  ('room_admin', 'room:view_all', 'system'),
  ('room_admin', 'room:assign_director', 'system'),
  ('room_admin', 'user:view', 'system'),
  ('room_admin', 'user:manage_roles', 'system')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Operator: Read-only system access
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('operator', 'analytics:view', 'system'),
  ('operator', 'monitoring:view', 'system'),
  ('operator', 'room:view_all', 'system')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- ============================================================================
-- OBJECT-LEVEL ROLE PERMISSIONS (for room-specific operations)
-- ============================================================================

-- Director: Full room control
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('director', 'room:view', 'room'),
  ('director', 'room:manage_settings', 'room'),
  ('director', 'user:kick', 'room'),
  ('director', 'user:mute', 'room'),
  ('director', 'stream:switch_scene', 'room'),
  ('director', 'stream:generate_srt', 'room'),
  ('director', 'stream:view_all', 'room'),
  ('director', 'chat:moderate', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Co-Director: Can assist with scenes and chat
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('co_director', 'room:view', 'room'),
  ('co_director', 'user:mute', 'room'),
  ('co_director', 'stream:switch_scene', 'room'),
  ('co_director', 'stream:view_all', 'room'),
  ('co_director', 'chat:moderate', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Moderator: Chat and participant management
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('moderator', 'room:view', 'room'),
  ('moderator', 'user:kick', 'room'),
  ('moderator', 'user:mute', 'room'),
  ('moderator', 'chat:moderate', 'room'),
  ('moderator', 'chat:send', 'room')
ON CONFLICT (role, permission, object_type) DO NOTHING;

-- Publisher: Can publish media
INSERT INTO role_permissions (role, permission, object_type) VALUES
  ('publisher', 'room:view', 'room'),
  ('publisher', 'stream:publish', 'room'),
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
-- CLEANUP: Delete old permissions that are no longer used
-- ============================================================================
DELETE FROM role_permissions WHERE permission IN (
  'create', 'delete', 'update', 'assign', 'promote', 'mute', 'kick',
  'view_all', 'switch_scenes', 'generate_srt', 'view_analytics',
  'view_monitoring', 'join', 'send_audio', 'send_video', 'chat', 'view_solo',
  'view'  -- Old generic view permission
) AND object_type IN ('room', 'stream', 'user', 'system');
