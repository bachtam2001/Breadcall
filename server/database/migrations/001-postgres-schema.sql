-- Migration: 001-postgres-schema
-- Date: 2026-03-15
-- Description: PostgreSQL schema for BreadCall RBAC/OLA

-- refresh_tokens table (created first without FK constraints)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  rotated_to TEXT,
  rotated_from TEXT
);

-- roles table
CREATE TABLE IF NOT EXISTS roles (
  name VARCHAR(50) PRIMARY KEY,
  hierarchy INTEGER NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  email VARCHAR(255),
  display_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  object_type VARCHAR(50) NOT NULL,
  PRIMARY KEY (role, permission, object_type)
);

-- room_assignments table (for persistent room ownership/management)
CREATE TABLE IF NOT EXISTS room_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id VARCHAR(10) NOT NULL,
  assignment_role VARCHAR(50) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, room_id)
);

-- room_participants table (supports both registered users and guest sessions)
CREATE TABLE IF NOT EXISTS room_participants (
  id TEXT PRIMARY KEY,
  room_id VARCHAR(10) NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,  -- NULL for guests
  guest_session_id TEXT,  -- For non-registered users
  role VARCHAR(50) NOT NULL,  -- director, co_director, moderator, publisher, participant, viewer
  display_name VARCHAR(255),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(room_id, user_id),  -- One active role per registered user per room
  UNIQUE(room_id, guest_session_id)  -- One active role per guest session per room
);

-- stream_access table
CREATE TABLE IF NOT EXISTS stream_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_id VARCHAR(255) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, stream_id)
);

-- Add self-referential foreign keys after table exists
ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_rotated_to
  FOREIGN KEY (rotated_to) REFERENCES refresh_tokens(token_id);

ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_rotated_from
  FOREIGN KEY (rotated_from) REFERENCES refresh_tokens(token_id);

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Refresh token indexes (critical for auth performance)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_rotated ON refresh_tokens(rotated_to);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_type ON refresh_tokens(type);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked ON refresh_tokens(revoked_at);

-- Room assignment indexes
CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id);

-- Stream access indexes
CREATE INDEX IF NOT EXISTS idx_stream_access_user ON stream_access(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_access_stream ON stream_access(stream_id);

-- Room participant indexes
CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user ON room_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_guest ON room_participants(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_active ON room_participants(room_id, is_active);
