# Room-Scoped Authentication Design

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove token from shared room URLs and generate room-scoped tokens automatically when users join with correct password.

**Architecture:** Shift from pre-generated token URLs to on-demand token generation at join time. Tokens are JWT-based with room ID in payload, making them only valid for the specific room they were issued for.

**Tech Stack:**
- Server: Node.js/Express with JWT (TokenManager.js)
- Client: Vanilla JS (AdminDashboard.js, app.js)
- Storage: HttpOnly session cookies for token transport

---

## Current Problems

1. **Token in URL**: Admin shares `https://domain.com/?token=xxx` - token visible in URL history, bookmarks, server logs
2. **Token management overhead**: Admin must manage token lifecycle, revocation, expiry
3. **`/room/:roomId` broken**: Direct navigation to room URL doesn't auto-fill room ID or show password prompt
4. **Security concern**: Tokens could potentially be reused across rooms if not properly validated

## Solution

1. **Plain room URLs**: Admin shares `https://domain.com/room/ABCD` - no token in URL
2. **On-join token generation**: Token created when user enters correct password
3. **Room-scoped JWT**: Token payload includes `roomId` - server validates on every request
4. **Fix routing**: `/room/:roomId` properly extracts room ID and shows password prompt

## Token Security Model

### JWT Payload Structure
```json
{
  "type": "room_access",
  "roomId": "ABCD",
  "userId": "uuid-here",
  "permissions": ["join", "send_audio", "send_video", "chat"],
  "iat": 1234567890,
  "exp": 1234571490
}
```

### Validation Points
1. Token signature validated (TOKEN_SECRET)
2. Expiration checked (exp claim)
3. **roomId in token must match room being joined** - critical security boundary
4. Permissions checked for requested actions

### Why This Is Secure
- Token is cryptographically bound to specific room via roomId claim
- Even if user copies their token, it only works for room ABCD
- Server validates roomId on every protected operation
- HttpOnly cookie prevents JavaScript access (XSS protection)

## Files to Modify

| File | Changes |
|------|---------|
| `client/js/AdminDashboard.js` | Replace `copyRoomLink()` to copy plain URL without token |
| `client/js/app.js` | Fix `/room/:roomId` routing to auto-fill room ID and show password prompt |
| `public/admin.html` | Update UI to remove token generation from "Copy Link" button |
| `server/src/RoomManager.js` | Verify token generation includes roomId in payload (already does) |
| `server/src/TokenManager.js` | Verify token validation checks roomId matches (already does) |

## Files No Changes Needed

- `server/src/index.js` - Token validation already checks roomId
- `server/src/AuthMiddleware.js` - Permission checks already room-scoped

## Testing Strategy

1. **Unit Tests**: Verify JWT payload includes roomId
2. **Unit Tests**: Verify token validation rejects wrong roomId
3. **Integration Tests**: Test `/room/:roomId` direct navigation
4. **Integration Tests**: Test password-protected room join flow
5. **E2E Tests**: Admin creates room → copies plain URL → user joins with password

## Success Criteria

- [ ] Admin "Copy Link" copies plain URL (no token)
- [ ] Direct navigation to `/room/ABCD` shows join dialog with room ID pre-filled
- [ ] Password-protected rooms require password before token generation
- [ ] Generated token only works for the specific room it was issued for
- [ ] All existing tests pass (322 tests)
