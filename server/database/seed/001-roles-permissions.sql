-- Seed Data: Roles and Permissions
-- Date: 2026-03-14

-- Roles (hierarchy: higher = more privileged)
INSERT INTO roles (name, hierarchy, description) VALUES
  ('super_admin', 100, 'Full system access'),
  ('room_admin', 80, 'Create and manage own rooms'),
  ('moderator', 60, 'Manage participants in assigned rooms'),
  ('director', 50, 'View and control streams, generate SRT'),
  ('operator', 40, 'Read-only monitoring'),
  ('participant', 20, 'Join rooms, send audio/video'),
  ('viewer', 10, 'View single stream, SoloView, SRT link')
ON CONFLICT (name) DO UPDATE SET
  hierarchy = EXCLUDED.hierarchy,
  description = EXCLUDED.description;

-- Role Permissions
INSERT INTO role_permissions (role, permission, object_type) VALUES
  -- Super Admin (all permissions)
  ('super_admin', '*', 'system'),
  ('super_admin', '*', 'room'),
  ('super_admin', '*', 'stream'),
  ('super_admin', '*', 'user'),

  -- Room Admin
  ('room_admin', 'create', 'room'),
  ('room_admin', 'delete', 'room'),
  ('room_admin', 'update', 'room'),
  ('room_admin', 'assign', 'room'),
  ('room_admin', 'promote', 'user'),

  -- Moderator
  ('moderator', 'mute', 'room'),
  ('moderator', 'kick', 'room'),
  ('moderator', 'update_settings', 'room'),

  -- Director
  ('director', 'view_all', 'room'),
  ('director', 'switch_scenes', 'room'),
  ('director', 'generate_srt', 'room'),

  -- Operator
  ('operator', 'view_analytics', 'system'),
  ('operator', 'view_monitoring', 'system'),

  -- Participant
  ('participant', 'join', 'room'),
  ('participant', 'send_audio', 'room'),
  ('participant', 'send_video', 'room'),
  ('participant', 'chat', 'room'),

  -- Viewer
  ('viewer', 'view', 'stream'),
  ('viewer', 'generate_srt', 'stream'),
  ('viewer', 'view_solo', 'stream')
ON CONFLICT (role, permission, object_type) DO NOTHING;
