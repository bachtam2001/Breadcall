# JWT Token Migration Design Specification

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from custom HMAC-signed tokens to JWT-based access/refresh token system with stateless validation and Redis-backed revocation.

**Architecture:** Two-token system with short-lived JWT access tokens (30 min) for stateless validation and long-lived refresh tokens (24h) stored in Redis+DB for revocation.

**Tech Stack:** jsonwebtoken library, Redis for revocation cache, SQLite for persistent audit trail.

---

## 1. Token Structure

### 1.1 Access Token (JWT)

**Format:** Standard JWT with `header.payload.signature`

**Header:**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload Claims:**
```json
{
  "iss": "breadcall-server",
  "aud": "breadcall-client",
  "tokenId": "uuid-v4-string",
  "type": "room_access | director_access | stream_access | admin_token",
  "roomId": "4-char-room-id",
  "userId": "uuid-v4-string",
  "permissions": ["join", "send-audio", "send-video", "chat"],
  "iat": 1710432000,
  "exp": 1710433800
}
```

**Note:** `nbf` (not before) claim is intentionally omitted since access tokens are short-lived (30 min) and issued for immediate use.

**Signature:** HMAC-SHA256 using `TOKEN_SECRET` environment variable

**Transmission:** `Authorization: Bearer <jwt>` header

### 1.2 Refresh Token (Opaque)

**Format:** Random UUID v4 (no prefix in storage)

**Cookie Value:** `refresh_<uuid-v4>` (prefix added only for cookie transmission)

**Storage Key (Redis):** `refresh:{tokenId}` (bare UUID, no prefix)

**Redis Value (JSON):**
```json
{
  "tokenId": "uuid-v4",
  "type": "room_access",
  "roomId": "ABC123",
  "userId": "user-uuid",
  "expiresAt": 1710518400000,
  "revoked": false
}
```

**Redis TTL:** `expiresAt - currentTime` (auto-expires)

**Database Table:** `refresh_tokens`
```sql
CREATE TABLE refresh_tokens (
  tokenId TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  roomId TEXT NOT NULL,
  userId TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  revokedAt INTEGER,
  revokedReason TEXT
);
```

**Transmission:** HttpOnly cookie (`refreshToken`)

---

## 2. Validation Flow

### 2.1 Access Token Validation (Stateless)

```
Request with Authorization header
         │
         ▼
┌─────────────────────────┐
│ jwt.verify(token, sec)  │ ← Verifies signature
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
Invalid/Fail   Valid (decoded payload)
    │               │
    ▼               ▼
401 Unauthorized  Check exp claim
                      │
              ┌───────┴───────┐
              │               │
              ▼               ▼
         Expired?        Not Expired
              │               │
              ▼               ▼
         401 + hint    Return decoded
         (refresh)     payload to route
```

**Key Point:** No Redis/DB lookup for access token validation. All checks are local:
1. Signature verification (jsonwebtoken lib)
2. Expiration check (exp claim)

### 2.2 Refresh Token Validation (Stateful)

```
Request with refreshToken cookie
         │
         ▼
┌─────────────────────────┐
│ GET Redis: refresh:{id} │
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
Not Found      Found (JSON)
    │               │
    ▼               ▼
401 Unauthorized  Check revoked flag
                      │
              ┌───────┴───────┐
              │               │
              ▼               ▼
         Revoked?        Not Revoked
              │               │
              ▼               ▼
         401 (re-auth)   Check expiresAt
                            │
                    ┌───────┴───────┐
                    │               │
                    ▼               ▼
               Expired?        Valid
                    │               │
                    ▼               ▼
               401 (re-auth)   Issue new access token
```

### 2.3 Token Refresh Endpoint

**Endpoint:** `POST /api/tokens/refresh`

**Request:**
```http
POST /api/tokens/refresh
Cookie: refreshToken=refresh_<uuid>
```

**Success Response (200):**
```json
{
  "success": true,
  "accessToken": "<new-jwt>",
  "expiresIn": 1800
}
```

**Error Responses:**

```json
// HTTP 401 Unauthorized
// Refresh token not found or revoked
{ "success": false, "error": "refresh_required" }

// HTTP 401 Unauthorized
// Refresh token expired
{ "success": false, "error": "session_expired" }
```

---

## 3. Token Generation Flow

### 3.1 Initial Token Generation (Existing Flow)

```
POST /api/tokens
Authorization: Bearer <admin-jwt>
Body: { type, roomId, options }
         │
         ▼
┌─────────────────────────────────────┐
│ RoomManager.generateTokenPair()     │
│  1. Generate access token (JWT)     │
│  2. Generate refresh token (UUID)   │
│  3. Store refresh in Redis + DB     │
│  4. Return both tokens              │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Response:                           │
│ { accessToken, refreshToken,        │
│   expiresAt, url, qrCode? }         │
└─────────────────────────────────────┘
```

### 3.2 Auto-Generated Join Tokens

When a user joins a room via `joinRoom()` with `autoGenerateToken=true`:
1. Generate token pair (access + refresh)
2. Set refresh token as HttpOnly cookie in response
3. Return access token in response body (or set as cookie)

---

## 4. Revocation System

### 4.1 Revocation Check (Using revoked Flag)

**Note:** Revocation status is stored in the `revoked` flag within the refresh token Redis object (Section 1.2), not a separate revocation list key.

**Check Operation:**
```javascript
async isRevoked(tokenId) {
  const tokenData = await redis.get(`refresh:${tokenId}`);
  if (!tokenData) return true; // Not found = revoked/expired
  return tokenData.revoked === true;
}
```

### 4.2 Revocation API

**Endpoint:** `DELETE /api/tokens/:tokenId`

**Auth:** Admin only (`isAuthenticated` middleware)

**Operation:**
1. Look up token in DB
2. Mark `revokedAt = Date.now()` in DB
3. Update Redis `refresh:{tokenId}`.revoked = true with existing TTL
4. Return success

**Cascading Revocation:**
- Delete room → revoke all tokens for that room
- Admin panel: "Revoke All" button for a room

---

## 5. Client-Side Changes

### 5.1 Token Storage

| Token Type | Storage | Transmission |
|------------|---------|--------------|
| Access Token | Memory (JS variable) | `Authorization: Bearer <token>` header |
| Refresh Token | HttpOnly cookie (automatic) | Cookie header (automatic) |

### 5.2 Token Initialization

**Initial Token Retrieval:**
- After token generation via `/api/tokens` POST, response includes both `accessToken` and `refreshToken`
- Client stores `accessToken` in memory variable
- `refreshToken` is automatically stored by browser via `Set-Cookie` header (HttpOnly)

**Page Reload Handling:**
- On page reload, `accessToken` memory is lost
- Client must call `POST /api/tokens/refresh` to obtain new access token
- Refresh cookie persists across page reloads (subject to expiry/revocation)
- If refresh fails (401), redirect to login/admin for re-authentication

### 5.3 Client Flow (Pseudocode)

```javascript
class BreadCallApp {
  async fetchWithAuth(url, options = {}) {
    // Add access token to request
    if (this.accessToken) {
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${this.accessToken}`
      };
    }

    let response = await fetch(url, options);

    // Handle 401 (expired access token)
    if (response.status === 401) {
      await this.refreshAccessToken();
      // Retry with new token
      options.headers.Authorization = `Bearer ${this.accessToken}`;
      response = await fetch(url, options);
    }

    return response;
  }

  async refreshAccessToken() {
    const response = await fetch('/api/tokens/refresh', {
      method: 'POST',
      credentials: 'include' // Send refresh cookie
    });

    const data = await response.json();
    if (data.success) {
      this.accessToken = data.accessToken;
    } else {
      // Full re-auth required
      this.logout();
    }
  }
}
```

---

## 6. Files to Modify

| File | Changes |
|------|---------|
| `server/src/RoomManager.js` | Replace `generateToken()`, `validateToken()` with JWT versions. Add `generateTokenPair()`, `validateAccessToken()`, `validateRefreshToken()` |
| `server/src/AuthMiddleware.js` | Add JWT validation middleware, refresh token guard |
| `server/src/index.js` | Add `/api/tokens/refresh` endpoint |
| `server/package.json` | Add `jsonwebtoken` dependency |
| `client/js/app.js` | Add `fetchWithAuth()` wrapper, token refresh logic |
| `server/src/database.js` | Create `refresh_tokens` table |

---

## 7. Migration Strategy

### Phase 1: Parallel Support (Backward Compatible)
- Support both custom tokens and JWT simultaneously
- Detect format by token prefix: `tok_` = custom HMAC token, `eyJ` = JWT (base64-encoded header)
- Route to appropriate validator based on detection

### Phase 2: Gradual Cutover
- New tokens issued as JWT only
- Existing custom tokens remain valid until expiration (24h max)
- After 48h, disable custom token validator

### Phase 3: Cleanup
- Remove custom token code paths
- Remove legacy API routes

---

## 8. Security Considerations

1. **TOKEN_SECRET** must be set in environment (min 32 chars)
2. **HTTPS required** in production (cookies marked `secure`)
3. **SameSite=strict** on refresh cookie
4. **HttpOnly** on refresh cookie (no JS access)
5. **Short access token lifetime** (30 min) limits exposure window
6. **Revocation check** on refresh token prevents misuse

---

## 9. Testing Requirements

1. **Unit Tests:**
   - `generateTokenPair()` returns valid JWT + refresh token
   - `validateAccessToken()` validates JWT without DB lookup
   - `validateRefreshToken()` checks Redis + DB
   - Revoked refresh token returns 401

2. **Integration Tests:**
   - Token refresh flow (expired access → refresh → retry)
   - Admin revokes token → client gets 401 on refresh
   - Room deletion → all tokens revoked

3. **E2E Tests:**
   - Join room with token → access token expires → refresh → continue in room
   - Director revokes participant → participant gets 401

---

## 10. Success Criteria

- [ ] All token operations use JWT format
- [ ] Access token validation is stateless (no Map/DB lookup)
- [ ] Refresh token revocation works via Redis
- [ ] Client auto-refresh on 401
- [ ] Backward compatible migration path
- [ ] All existing tests pass
- [ ] New token tests pass
