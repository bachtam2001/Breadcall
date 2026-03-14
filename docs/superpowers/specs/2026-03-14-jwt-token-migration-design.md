# JWT Token Migration Design Specification

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from custom HMAC-signed tokens to JWT-based access/refresh token system with stateless validation and Redis-backed revocation.

**Architecture:** Two-token system with short-lived JWT access tokens (15 min) for stateless validation and long-lived refresh tokens (24h) with rotation stored in Redis+DB for revocation. Access tokens stored in HttpOnly cookies with CSRF protection.

**Tech Stack:** jsonwebtoken library, Redis for revocation cache, SQLite for persistent audit trail, CSRF tokens for mutation requests.

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
  "exp": 1710432900
}
```

**Note:** `nbf` (not before) claim is intentionally omitted since access tokens are short-lived (15 min) and issued for immediate use.

**Signature:** HMAC-SHA256 using `TOKEN_SECRET` environment variable

**Transmission:** HttpOnly cookie (`accessToken`) with CSRF token in `X-CSRF-Token` header for mutation requests

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
  "revoked": false,
  "rotatedTo": null
}
```

**Redis TTL:** `expiresAt - currentTime` (auto-expires)

**Refresh Token Rotation:** On each refresh token use, a new refresh token is issued and the old one is marked with `rotatedTo` pointing to the new token ID. This limits the window of token reuse and detects token theft.

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

**CSRF Protection:** CSRF token stored in `csrfToken` cookie (SameSite=Lax, no HttpOnly) and validated via `X-CSRF-Token` header on mutation requests (POST, PUT, DELETE, PATCH)

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
  "refreshToken": "refresh_<new-uuid>",
  "expiresIn": 900
}
```

**Note:** Refresh token rotation issues a new refresh token on each use. The old refresh token is marked as rotated and becomes invalid.

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

When a user joins a room via `joinRoom()` (autoGenerateToken is always enabled):
1. Generate token pair (access + refresh)
2. Set both tokens as HttpOnly cookies in response (with CSRF token)
3. Return success response (tokens transmitted via cookies)

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
| Access Token | HttpOnly cookie (`accessToken`) | Cookie header (automatic), CSRF token in `X-CSRF-Token` header |
| Refresh Token | HttpOnly cookie (`refreshToken`) | Cookie header (automatic) |
| CSRF Token | Non-HttpOnly cookie (`csrfToken`) | `X-CSRF-Token` header on mutation requests |

### 5.2 Token Initialization

**Initial Token Retrieval:**
- After token generation via `/api/tokens` POST, response includes both `accessToken` and `refreshToken`
- Client stores `accessToken` in memory variable
- `refreshToken` is automatically stored by browser via `Set-Cookie` header (HttpOnly)

**Page Reload Handling:**
- On page reload, both access and refresh cookies persist
- Client must read CSRF token from cookie and include in subsequent mutation requests
- If access token expires, call `POST /api/tokens/refresh` to obtain new access token
- Refresh cookie persists across page reloads (subject to expiry/revocation)
- If refresh fails (401), redirect to login/admin for re-authentication

### 5.3 Client Flow (Pseudocode)

```javascript
class BreadCallApp {
  // Get CSRF token from cookie
  getCsrfToken() {
    const match = document.cookie.match(/csrfToken=([^;]+)/);
    return match ? match[1] : null;
  }

  async fetchWithAuth(url, options = {}) {
    // Add CSRF token to mutation requests
    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method?.toUpperCase());
    if (isMutation) {
      options.headers = {
        ...options.headers,
        'X-CSRF-Token': this.getCsrfToken()
      };
    }

    // Credentials included automatically via cookie
    options.credentials = 'include';

    let response = await fetch(url, options);

    // Handle 401 (expired access token)
    if (response.status === 401) {
      await this.refreshAccessToken();
      // Retry with new token (cookies sent automatically)
      if (isMutation) {
        options.headers['X-CSRF-Token'] = this.getCsrfToken();
      }
      response = await fetch(url, options);
    }

    return response;
  }

  async refreshAccessToken() {
    const response = await fetch('/api/tokens/refresh', {
      method: 'POST',
      credentials: 'include', // Send refresh cookie
      headers: {
        'X-CSRF-Token': this.getCsrfToken()
      }
    });

    const data = await response.json();
    if (data.success) {
      // Access token cookie is set automatically by server
      // New refresh token cookie also set (rotation)
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
| `server/src/RoomManager.js` | Replace `generateToken()`, `validateToken()` with JWT versions. Add `generateTokenPair()`, `validateAccessToken()`, `validateRefreshToken()`, `rotateRefreshToken()`. Remove `autoGenerateToken` option (always enabled) |
| `server/src/AuthMiddleware.js` | Add JWT validation middleware, refresh token guard, CSRF protection middleware |
| `server/src/index.js` | Add `/api/tokens/refresh` endpoint, update `/api/tokens` to return cookies |
| `server/package.json` | Add `jsonwebtoken`, `csrf-csrf` dependencies |
| `client/js/app.js` | Update to use cookie-based auth, add CSRF token handling, update auto-refresh logic |
| `server/src/database.js` | Create `refresh_tokens` table with `rotatedTo` column |

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
3. **SameSite=strict** on refresh and access cookies
4. **HttpOnly** on access and refresh cookies (no JS access)
5. **Short access token lifetime** (15 min) limits exposure window
6. **Revocation check** on refresh token prevents misuse
7. **Refresh token rotation** detects token theft via reuse detection
8. **CSRF protection** required on all mutation requests via `X-CSRF-Token` header

---

## 9. Testing Requirements

1. **Unit Tests:**
   - `generateTokenPair()` returns valid JWT + refresh token
   - `validateAccessToken()` validates JWT without DB lookup
   - `validateRefreshToken()` checks Redis + DB
   - `rotateRefreshToken()` issues new token and invalidates old one
   - Revoked refresh token returns 401
   - CSRF validation passes/fails appropriately

2. **Integration Tests:**
   - Token refresh flow with rotation (expired access → refresh → new tokens)
   - Admin revokes token → client gets 401 on refresh
   - Room deletion → all tokens revoked
   - CSRF token missing/invalid → 403 on mutation requests

3. **E2E Tests:**
   - Join room with token → access token expires → refresh → continue in room
   - Director revokes participant → participant gets 401
   - Token rotation detects reuse attack (stolen token usage)

---

## 10. Success Criteria

- [ ] All token operations use JWT format
- [ ] Access token validation is stateless (no Map/DB lookup)
- [ ] Refresh token revocation works via Redis
- [ ] Client auto-refresh on 401
- [ ] Backward compatible migration path
- [ ] All existing tests pass
- [ ] New token tests pass
- [ ] Access token stored in HttpOnly cookie (not Authorization header)
- [ ] CSRF protection enforced on mutation requests
- [ ] Refresh token rotation issues new token on each refresh
- [ ] Token reuse detection (rotated token usage alerts/revokes)
- [ ] `joinRoom()` always generates tokens (no option parameter)
