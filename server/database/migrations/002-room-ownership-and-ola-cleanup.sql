-- Migration: 002-room-ownership-and-ola-cleanup
-- Date: 2026-03-29
-- Description: Add room ownership via owner_id column, remove unused OLA tables

-- Add owner_id to rooms table
ALTER TABLE rooms ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_owner_id ON rooms(owner_id);

-- Drop unused OLA tables
DROP TABLE IF EXISTS room_assignments;
DROP TABLE IF EXISTS stream_access;
