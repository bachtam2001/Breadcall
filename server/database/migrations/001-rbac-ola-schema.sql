-- Migration: 001-rbac-ola-schema
-- Date: 2026-03-14
-- Description: Create RBAC and OLA database schema

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  name VARCHAR(50) PRIMARY KEY,
  hierarchy INTEGER NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE RESTRICT,
  email VARCHAR(255),
  display_name VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Role permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(50) NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  object_type VARCHAR(50) NOT NULL,
  PRIMARY KEY (role, permission, object_type)
);

-- Room assignments table (OLA)
CREATE TABLE IF NOT EXISTS room_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id VARCHAR(10) NOT NULL,
  assignment_role VARCHAR(50) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  UNIQUE(user_id, room_id)
);

-- Stream access table (OLA)
CREATE TABLE IF NOT EXISTS stream_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stream_id VARCHAR(255) NOT NULL,
  granted_by TEXT REFERENCES users(id),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  UNIQUE(user_id, stream_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_room_assignments_user ON room_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id);
CREATE INDEX IF NOT EXISTS idx_stream_access_user ON stream_access(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_access_stream ON stream_access(stream_id);
