# Token UI Compatibility Design

**Date:** 2026-03-14
**Status:** Approved
**Author:** Claude Code

## Overview

Align the AdminDashboard token generation UI with backend API capabilities, simplify the token flow, and add complete token management features.

## Problem Statement

The current AdminDashboard token UI has several gaps:
1. QR code feature unused but taking up UI space
2. Only 3 of 5 token types exposed to admins
3. No way to view or revoke existing tokens
4. "Copy Link" doesn't integrate with token generation

## Design Decisions

### 1. QR Code Removal

**Decision:** Remove QR code generation entirely from the token modal.

**Changes:**
- Remove QR code image container from modal HTML
- Remove "Download QR Code" button
- Remove `includeQrCode` logic from backend (keep qrcode package installed for potential future use)
- Simplify token result display to two fields: URL and token string

### 2. Show All 5 Token Types

**Decision:** Expose all backend-supported token types in the dropdown.

**Token Types:**
| Type | Description | Default Expiry | Use Case |
|------|-------------|----------------|----------|
| `room_access` | Participant Access | 24 hours | Regular users joining a room |
| `director_access` | Director Dashboard | 8 hours | Directors managing production |
| `stream_access` | Stream View | 1 hour | OBS Browser Source, read-only viewers |
| `action_token` | One-time Action | 5 minutes | Special one-off actions |
| `admin_token` | Admin Panel Access | 1 hour | Granting admin access |

**UI Changes:**
```javascript
'<option value="room_access">Participant Access (Join Room) - 24h default</option>'
'<option value="director_access">Director Access (Dashboard) - 8h default</option>'
'<option value="stream_access">Stream View (OBS Browser Source) - 1h default</option>'
'<option value="action_token">One-time Action - 5min default</option>'
'<option value="admin_token">Admin Panel Access - 1h default</option>'
```

### 3. Token Management System

**Decision:** Add full CRUD-like management for tokens (view + revoke).

**New Features:**

#### 3.1 Room Card Token Button
Add "Manage Tokens" button to room card actions:
```html
<button class="btn btn-secondary btn-sm manage-tokens-btn" data-room-id="...">
  Manage Tokens
</button>
```

#### 3.2 Manage Tokens Modal
New modal with token listing:

```html
<div class="modal-overlay" id="manage-tokens-modal">
  <div class="modal modal-large">
    <div class="modal-header">
      <h3>Manage Room Tokens</h3>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <!-- Filters -->
      <div class="token-filters">
        <select id="token-filter-type">
          <option value="all">All Types</option>
          <option value="room_access">Room Access</option>
          <option value="director_access">Director Access</option>
          <option value="stream_access">Stream Access</option>
          <option value="action_token">Action Token</option>
          <option value="admin_token">Admin Token</option>
        </select>
        <select id="token-filter-status">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>

      <!-- Token List -->
      <table class="tokens-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Created</th>
            <th>Expires</th>
            <th>Uses</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="tokens-table-body">
          <!-- Populated dynamically -->
        </tbody>
      </table>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="close-tokens-btn">Close</button>
    </div>
  </div>
</div>
```

#### 3.3 Token Table Row
```html
<tr data-token-id="...">
  <td><span class="token-type-badge">room_access</span></td>
  <td>2026-03-14 10:30</td>
  <td>2026-03-15 10:30</td>
  <td>2/10</td>
  <td><span class="status-badge active">Active</span></td>
  <td>
    <button class="btn btn-sm btn-secondary copy-url-btn">Copy URL</button>
    <button class="btn btn-sm btn-danger revoke-btn">Revoke</button>
  </td>
</tr>
```

**Backend API Used:**
- `GET /api/admin/rooms/:roomId/tokens` - List all tokens
- `DELETE /api/tokens/:tokenId` - Revoke token

### 4. Copy Link with Token Generation

**Decision:** "Copy Link" button will generate a token on-the-fly and copy the tokenized URL.

**Flow:**
1. Admin clicks "Copy Link" on room card
2. System generates a `room_access` token (8 hour expiry, unlimited uses)
3. Token URL is copied to clipboard
4. Toast notification shows "Token link copied! (expires in 8 hours)"

**Implementation:**
```javascript
async copyRoomLink(roomId, password) {
  // Generate token
  const response = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'room_access',
      roomId: roomId,
      options: { expiresAt: Date.now() + (8 * 3600 * 1000) }
    })
  });

  const data = await response.json();
  const tokenUrl = data.url;

  // Copy to clipboard
  navigator.clipboard.writeText(tokenUrl);
  this.showToast('Token link copied! (expires in 8 hours)', 'success');
}
```

**Note:** Password parameter becomes optional - if room has password, admin may want to generate token instead of sharing password link.

## Files to Modify

### Frontend
1. **`client/js/AdminDashboard.js`**
   - Update token modal HTML (remove QR code, add 2 new token types)
   - Update `showGenerateTokenModal()` - remove QR reset
   - Update `handleGenerateToken()` - remove QR handling
   - Remove `copyTokenUrl()`, `copyTokenString()`, `downloadQrCode()` methods
   - Add `showManageTokensModal(roomId)` method
   - Add `loadRoomTokens(roomId)` method
   - Add `revokeToken(tokenId)` method
   - Update `copyRoomLink()` to generate token
   - Add event bindings for manage tokens button

### Backend
No changes required - all APIs already exist. Optional cleanup:
- **`server/src/index.js`** - Could remove QR code generation if desired

## Error Handling

1. **Token Generation Fails:** Show toast "Failed to generate token: [error]"
2. **Token List Empty:** Show "No tokens generated yet" message
3. **Revoke Fails:** Show toast "Failed to revoke token"
4. **Copy Link Fails:** Fallback to regular room link, show warning

## Testing Checklist

- [ ] Generate token for each of 5 types
- [ ] Verify token URLs are correct format
- [ ] Copy Link generates token and copies URL
- [ ] Manage Tokens modal shows all tokens
- [ ] Filter tokens by type works
- [ ] Revoke token invalidates it (test in new incognito window)
- [ ] Expired tokens show correct status

## Migration Notes

- Existing tokens without QR codes will continue to work
- No database migration needed
- No breaking changes to API
