# Room Ownership Model

## Overview

Rooms in BreadCall are owned by the director who creates them. Ownership determines who can manage the room.

## Access Control

| Action | Director | Admin |
|--------|----------|-------|
| Create room | ✓ (becomes owner) | ✓ |
| View rooms | Own rooms only | All rooms |
| Delete room | Own rooms only | All rooms |
| Update settings | Own rooms only | All rooms |
| Manage participants | Own rooms only | All rooms |

## API

All room operations go through `/api/rooms`:

- `GET /api/rooms` - List rooms (filtered by ownership for directors)
- `POST /api/rooms` - Create room (sets `owner_id` to current user)
- `DELETE /api/rooms/:id` - Delete room (owner or admin only)
- `PUT /api/rooms/:id/settings` - Update settings (owner or admin only)
- `GET /api/rooms/:id/participants` - Get participants (owner or admin only)

## Database

Rooms table has `owner_id` column referencing `users.id`:

```sql
ALTER TABLE rooms ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

When a room's owner is deleted, `owner_id` is set to NULL and the room becomes admin-managed only.
