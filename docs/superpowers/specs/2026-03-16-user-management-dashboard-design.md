# User Management Dashboard Design Specification

**Date:** 2026-03-16
**Author:** BreadCall Team
**Status:** Draft

## 1. Overview

### 1.1 Purpose
Add user management functionality to the existing Admin Dashboard, allowing administrators to create, view, modify, and delete user accounts with role assignment capabilities.

### 1.2 Problem Statement
The current Admin Dashboard only supports room management. Admins lack a dedicated interface to:
- View all system users
- Create new user accounts
- Assign or change user roles
- Delete user accounts
- Perform bulk operations on multiple users

### 1.3 Goals
- Integrate user management into existing `/admin` dashboard
- Support full CRUD operations for user accounts
- Enable bulk role changes and bulk deletion
- Provide search and filtering capabilities
- Maintain consistent UI with existing AdminDashboard styling

### 1.4 Non-Goals
- User self-service profile editing (separate feature)
- Password reset functionality (future enhancement)
- Email notifications for account creation (future enhancement)
- Audit logging of admin actions (future enhancement)

---

## 2. Architecture

### 2.1 System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                        Admin Dashboard                          │
│  ┌─────────────────────┐  ┌─────────────────────────────────┐  │
│  │   Rooms Tab         │  │      Users Tab (NEW)            │  │
│  │   - Room grid       │  │      - User list table          │  │
│  │   - Create room     │  │      - Create user modal        │  │
│  │   - Room management │  │      - Edit role modal          │  │
│  │                     │  │      - Bulk operations          │  │
│  └─────────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ REST API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Signaling Server                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Admin Routes (/api/admin)                                │  │
│  │    - GET    /users           → List all users             │  │
│  │    - POST   /users           → Create user                │  │
│  │    - PUT    /users/:id/role  → Update user role           │  │
│  │    - DELETE /users/:id       → Delete user                │  │
│  │    - POST   /users/bulk-delete  → Bulk delete             │  │
│  │    - POST   /users/bulk-role    → Bulk role change        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  UserManager                                              │  │
│  │    - createUser(userData)                                 │  │
│  │    - getAllUsers()                                        │  │
│  │    - updateUserRole(userId, newRole, actorId)             │  │
│  │    - deleteUser(userId, actorId)                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  RBACManager                                              │  │
│  │    - canAssignRole(actorRole, targetRole)                 │  │
│  │    - canAccessHigherRole(actorRole, targetRole)           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                        │
│  - users table                                                  │
│  - roles table                                                  │
│  - permissions table                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Layers

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| Frontend | AdminDashboard.js | UI rendering, user interactions, API calls |
| API | routes/admin.js | HTTP endpoints, authentication, validation |
| Business Logic | UserManager | User CRUD operations, password hashing |
| Authorization | RBACManager | Role hierarchy checks, permission validation |
| Data | PostgreSQL | Persistent storage of users, roles, permissions |

---

## 3. Frontend Design

### 3.1 Tab Navigation

Add Users tab to existing AdminDashboard:

```html
<div class="admin-tabs">
  <button class="tab-btn active" data-tab="rooms">Rooms</button>
  <button class="tab-btn" data-tab="users">Users</button>
</div>

<div class="tab-content active" id="rooms-tab">
  <!-- Existing room management content -->
</div>

<div class="tab-content" id="users-tab">
  <!-- New user management content -->
</div>
```

### 3.2 Users Tab Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Users                                          [+ Create User]│
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ [Search users...]  [Role: All ▼]  [Status: All ▼]       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ ☐ │ Username │ Role      │ Status  │ Created    │ Actions│ │
│  │───│──────────│───────────│─────────│────────────│────────│ │
│  │ ☐ │ admin    │ Admin     │ ● Active│ 2026-01-15 │ ⋮ ▼   │ │
│  │ ☐ │ alice    │ Director  │ ● Active│ 2026-02-20 │ ⋮ ▼   │ │
│  │ ☐ │ bob      │ Moderator │ ● Active│ 2026-03-01 │ ⋮ ▼   │ │
│  │ ☐ │ charlie  │ Operator  │ ○ Inactive│2026-03-10│ ⋮ ▼  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Selected: 2 users                                             │
│  [Change Role ▼]  [Delete Selected]                           │
│                                                                │
│  Showing 1-10 of 45 users   [< Prev] [1] [2] [3] [Next >]     │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 User Table Columns

| Column | Type | Description |
|--------|------|-------------|
| Checkbox | Checkbox | Bulk selection |
| Username | Text | Unique username |
| Role | Badge | Role badge (color-coded) |
| Status | Badge | Active (green) / Inactive (gray) |
| Created | Date | Account creation date |
| Actions | Dropdown | Edit role, Delete options |

### 3.4 Role Badge Colors

| Role | Color |
|------|-------|
| admin | Red (#dc3545) |
| room_admin | Purple (#6f42c1) |
| director | Blue (#007bff) |
| moderator | Green (#28a745) |
| operator | Orange (#fd7e14) |

### 3.5 Create User Modal

```
┌─────────────────────────────────────────┐
│  Create New User                    [X] │
├─────────────────────────────────────────┤
│                                         │
│  Username *                             │
│  ┌───────────────────────────────────┐ │
│  │                                   │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Password *                             │
│  ┌───────────────────────────────────┐ │
│  │                                   │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Role *                                 │
│  ┌───────────────────────────────────┐ │
│  │ Select role...              ▼    │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌─────────────────┐ ┌───────────────┐ │
│  │     Cancel      │ │   Create User │ │
│  └─────────────────┘ └───────────────┘ │
└─────────────────────────────────────────┘
```

### 3.6 Edit Role Modal

```
┌─────────────────────────────────────────┐
│  Change Role: alice                 [X] │
├─────────────────────────────────────────┤
│                                         │
│  Current Role: Director                 │
│                                         │
│  New Role *                             │
│  ┌───────────────────────────────────┐ │
│  │ Moderator                   ▼    │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌─────────────────┐ ┌───────────────┐ │
│  │     Cancel      │ │   Save Change │ │
│  └─────────────────┘ └───────────────┘ │
└─────────────────────────────────────────┘
```

### 3.7 Class Methods (AdminDashboard.js)

**New Properties:**
```javascript
this.users = [];           // Cached user list
this.selectedUsers = [];   // Selected user IDs for bulk ops
this.userFilters = {       // Filter state
  search: '',
  role: 'all',
  status: 'all'
};
```

**New Methods:**
```javascript
// Data loading
async loadUsers()                    // Fetch users from API
async refreshUsers()                 // Reload with current filters

// Rendering
renderUsersTab()                     // Render users tab content
renderUsersTable(users)              // Render user table rows
renderUserFilters()                  // Render filter controls
renderBulkActions()                  // Render bulk action toolbar

// CRUD operations
async createUser(username, password, role)
async updateUserRole(userId, newRole)
async deleteUser(userId)

// Bulk operations
async bulkDeleteUsers(userIds)
async bulkChangeRole(userIds, newRole)
toggleUserSelection(userId)          // Toggle single selection
toggleSelectAll()                    // Toggle select all
clearSelection()                     // Clear all selections

// Filtering
applyFilters()                       // Apply current filters to user list
setFilter(type, value)               // Set filter value

// Modals
showCreateUserModal()
showEditUserModal(userId, currentRole)
hideModal()
```

---

## 4. Backend API Design

### 4.1 New Routes (server/src/routes/admin.js)

All routes require `admin` role authentication via `AuthMiddleware`.

#### 4.1.1 GET /api/admin/users

List all users with optional filtering.

**Request:**
```
GET /api/admin/users?search=admin&role=director&status=active&page=1&limit=20
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| search | string | - | Search username (case-insensitive) |
| role | string | all | Filter by role name |
| status | string | all | Filter: active, inactive |
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |

**Response (200 OK):**
```json
{
  "success": true,
  "users": [
    {
      "id": "uuid-v4",
      "username": "admin",
      "role": "admin",
      "displayName": "System Administrator",
      "email": "admin@example.com",
      "status": "active",
      "createdAt": "2026-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - User lacks admin role

#### 4.1.2 POST /api/admin/users

Create a new user account.

**Request:**
```
POST /api/admin/users
Content-Type: application/json

{
  "username": "newuser",
  "password": "securepassword123",
  "role": "moderator",
  "displayName": "New User",
  "email": "newuser@example.com"
}
```

**Body Parameters:**
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| username | string | Yes | 3-32 chars, alphanumeric + underscore |
| password | string | Yes | Min 8 characters |
| role | string | Yes | Must be valid role name |
| displayName | string | No | Max 100 chars |
| email | string | No | Valid email format |

**Response (201 Created):**
```json
{
  "success": true,
  "user": {
    "id": "uuid-v4",
    "username": "newuser",
    "role": "moderator",
    "displayName": "New User",
    "email": "newuser@example.com",
    "createdAt": "2026-03-16T14:30:00Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Validation error (username exists, weak password, invalid role)
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - User lacks admin role

#### 4.1.3 PUT /api/admin/users/:id/role

Update a user's role.

**Request:**
```
PUT /api/admin/users/uuid-v4/role
Content-Type: application/json

{
  "role": "director"
}
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| id | string | User UUID |

**Body Parameters:**
| Parameter | Type | Required | Constraints |
|-----------|------|----------|-------------|
| role | string | Yes | Must be valid role name |

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "uuid-v4",
    "username": "alice",
    "role": "director",
    "updatedAt": "2026-03-16T14:30:00Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid role
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Cannot assign role higher than own hierarchy
- `404 Not Found` - User not found

#### 4.1.4 DELETE /api/admin/users/:id

Delete a user account.

**Request:**
```
DELETE /api/admin/users/uuid-v4
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

**Error Responses:**
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Cannot delete self or higher role
- `404 Not Found` - User not found

#### 4.1.5 POST /api/admin/users/bulk-delete

Delete multiple users.

**Request:**
```
POST /api/admin/users/bulk-delete
Content-Type: application/json

{
  "userIds": ["uuid-1", "uuid-2", "uuid-3"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "deleted": 3,
  "failed": [
    {
      "userId": "uuid-2",
      "error": "Cannot delete user with higher role"
    }
  ]
}
```

#### 4.1.6 POST /api/admin/users/bulk-role

Change role for multiple users.

**Request:**
```
POST /api/admin/users/bulk-role
Content-Type: application/json

{
  "userIds": ["uuid-1", "uuid-2", "uuid-3"],
  "role": "moderator"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "updated": 3,
  "failed": []
}
```

---

## 5. Security & Authorization

### 5.1 Access Control

| Operation | Required Role | Additional Checks |
|-----------|--------------|-------------------|
| List users | admin | - |
| Create user | admin | - |
| Change role | admin | `canAssignRole(actorRole, targetRole)` |
| Delete user | admin | `canAccessHigherRole(actorRole, targetRole)` |
| Bulk delete | admin | Per-user `canAccessHigherRole` check |
| Bulk role change | admin | `canAssignRole` for target role |

### 5.2 Role Hierarchy

```
admin (highest)
  ↓
room_admin
  ↓
director
  ↓
moderator
  ↓
operator (lowest)
```

### 5.3 Protection Rules

1. **Cannot delete self** - Admin cannot delete their own account
2. **Cannot delete higher roles** - Can only delete users with lower hierarchy
3. **Cannot assign higher role** - Can only assign roles at or below own level
4. **Username uniqueness** - Enforced at database level
5. **Password hashing** - bcrypt with cost factor 12

---

## 6. Data Flow

### 6.1 Load Users Flow

```
User clicks "Users" tab
         │
         ▼
AdminDashboard.renderUsersTab()
         │
         ▼
AdminDashboard.loadUsers()
         │
         ▼
GET /api/admin/users (Authorization: Bearer <token>)
         │
         ▼
AuthMiddleware.validateToken()
         │
         ▼
RBACManager.hasPermission('admin', 'user:view_all')
         │
         ▼
UserManager.getAllUsers()
         │
         ▼
PostgreSQL: SELECT * FROM users
         │
         ▼
Return users (without password_hash)
         │
         ▼
AdminDashboard.renderUsersTable(users)
         │
         ▼
Display in DOM
```

### 6.2 Create User Flow

```
User fills form → clicks "Create User"
         │
         ▼
AdminDashboard.createUser(username, password, role)
         │
         ▼
POST /api/admin/users
         │
         ▼
AuthMiddleware.validateToken()
         │
         ▼
Validation: username format, password length, role exists
         │
         ▼
UserManager.createUser({ username, password, role })
         │
         ▼
bcrypt.hash(password, 12)
         │
         ▼
PostgreSQL: INSERT INTO users
         │
         ▼
Redis: invalidate user cache
         │
         ▼
Return new user (without password_hash)
         │
         ▼
AdminDashboard.loadUsers() (refresh list)
         │
         ▼
Show success toast
```

---

## 7. Error Handling

### 7.1 Frontend Error Handling

| Error Type | User Message | Action |
|------------|--------------|--------|
| 401 Unauthorized | "Session expired. Please log in." | Redirect to /login |
| 403 Forbidden | "Access denied. Insufficient permissions." | Stay on page |
| 400 Bad Request | Display validation error | Keep modal open |
| 404 Not Found | "User not found." | Refresh list |
| Network error | "Connection error. Please try again." | Retry button |
| Unknown error | "An unexpected error occurred." | Log to console |

### 7.2 Backend Error Responses

```javascript
// Validation error
{
  "success": false,
  "error": "Username must be 3-32 characters",
  "field": "username"
}

// Authorization error
{
  "success": false,
  "error": "Cannot assign role higher than your own"
}

// Not found
{
  "success": false,
  "error": "User not found"
}
```

---

## 8. Validation Rules

### 8.1 Username Validation

- Minimum length: 3 characters
- Maximum length: 32 characters
- Allowed characters: a-z, A-Z, 0-9, underscore (_)
- Must start with letter
- Case-insensitive uniqueness

### 8.2 Password Validation

- Minimum length: 8 characters
- No maximum length (limit to 128 for hashing)
- No complexity requirements (future enhancement)

### 8.3 Role Validation

- Must be existing role name from `roles` table
- Actor's role hierarchy must be >= target role hierarchy

---

## 9. Database Schema

### 9.1 Users Table (existing)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL REFERENCES roles(name),
  display_name VARCHAR(255),
  email VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 9.2 Roles Table (existing)

```sql
CREATE TABLE roles (
  name VARCHAR(50) PRIMARY KEY,
  hierarchy INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 9.3 Permissions Table (existing)

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 9.4 Role Permissions Table (existing)

```sql
CREATE TABLE role_permissions (
  role_name VARCHAR(50) REFERENCES roles(name) ON DELETE CASCADE,
  permission_name VARCHAR(100) REFERENCES permissions(name) ON DELETE CASCADE,
  PRIMARY KEY (role_name, permission_name)
);
```

---

## 10. Testing Strategy

### 10.1 Unit Tests (Server)

**UserManager Tests:**
- `createUser()` - Creates user with hashed password
- `createUser()` - Rejects duplicate username
- `getAllUsers()` - Returns users without password_hash
- `updateUserRole()` - Updates role and invalidates cache
- `deleteUser()` - Deletes user and invalidates cache

**RBACManager Tests:**
- `canAssignRole()` - Allows assigning lower/equal roles
- `canAssignRole()` - Denies assigning higher roles
- `canAccessHigherRole()` - Correct hierarchy comparison

### 10.2 Integration Tests (API)

**GET /api/admin/users:**
- Returns 401 without auth
- Returns 403 with non-admin role
- Returns 200 with users array for admin

**POST /api/admin/users:**
- Creates user with valid data
- Returns 400 for duplicate username
- Returns 400 for weak password
- Returns 400 for invalid role

**PUT /api/admin/users/:id/role:**
- Updates role successfully
- Returns 403 for higher role assignment
- Returns 404 for non-existent user

**DELETE /api/admin/users/:id:**
- Deletes user successfully
- Returns 403 for self-deletion
- Returns 403 for higher role deletion

### 10.3 Frontend Tests

**AdminDashboard Tests:**
- `loadUsers()` - Fetches and displays users
- `createUser()` - Shows success toast on creation
- `createUser()` - Shows error toast on failure
- `updateUserRole()` - Updates UI after role change
- `deleteUser()` - Confirms before deletion
- Bulk operations - Handles multiple selections

---

## 11. Implementation Phases

### Phase 1: Backend API
1. Add GET /api/admin/users endpoint
2. Add POST /api/admin/users endpoint
3. Add PUT /api/admin/users/:id/role endpoint
4. Add DELETE /api/admin/users/:id endpoint
5. Add bulk operation endpoints
6. Write unit and integration tests

### Phase 2: Frontend - Basic
1. Add Users tab to AdminDashboard
2. Implement user list table
3. Implement Create User modal
4. Implement Edit Role modal
5. Wire up CRUD operations

### Phase 3: Frontend - Advanced
1. Implement bulk selection
2. Implement bulk delete
3. Implement bulk role change
4. Add search functionality
5. Add filter controls
6. Add pagination

### Phase 4: Polish
1. Add loading states
2. Add error toasts
3. Add success toasts
4. Add confirmation dialogs
5. Test all edge cases
6. Performance optimization

---

## 12. Open Questions

1. Should we add email notifications when accounts are created?
2. Should we add password reset functionality?
3. Should we add user activity/audit logging?
4. Should we add account deactivation (vs. deletion)?

---

## 13. Appendix

### 13.1 Existing AdminDashboard Structure

Current file: `client/js/AdminDashboard.js`
- Lines: ~1000+
- Methods: ~30+
- Already includes: Room management, token generation, settings

### 13.2 Related Files

| File | Purpose |
|------|---------|
| `server/src/UserManager.js` | User CRUD operations |
| `server/src/RBACManager.js` | Role/permission checks |
| `server/src/routes/admin.js` | Admin API routes |
| `server/src/AuthMiddleware.js` | Token validation |
| `client/js/AuthService.js` | Frontend authentication |

### 13.3 Design Decisions

1. **Tab-based navigation** - Chosen over sidebar for simplicity and consistency with existing dashboard
2. **Simple form creation** - Chosen over email onboarding for MVP speed
3. **Bulk operations** - Included based on explicit user request
4. **Match existing style** - Avoids introducing new UI dependencies
