# User Management Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user management functionality to the existing Admin Dashboard, allowing administrators to create, view, modify, and delete user accounts with role assignment capabilities.

**Architecture:** Tab-based navigation within existing AdminDashboard, with 6 new backend API endpoints in server/src/index.js for user CRUD operations. UserManager already supports most operations; needs minor additions for bulk operations.

**Tech Stack:** Node.js/Express backend, PostgreSQL database, Vanilla JavaScript frontend, bcrypt for password hashing, Redis caching.

---

## Chunk 1: Backend API Endpoints

### Task 1: Add GET /api/admin/users endpoint

**Files:**
- Modify: `server/src/index.js` (around line 500, after existing admin routes)
- Test: `server/__tests__/AdminUsersAPI.test.js` (create)

- [ ] **Step 1: Write failing test for GET /api/admin/users**

Create `server/__tests__/AdminUsersAPI.test.js` with tests for:
- Returns 401 without authentication
- Returns 403 for non-admin user
- Returns 200 with users array for admin
- Excludes password_hash from response

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AdminUsersAPI`
Expected: FAIL with "Cannot GET /api/admin/users"

- [ ] **Step 3: Add GET /api/admin/users route in index.js**

Add after line 504 in `server/src/index.js`:
```javascript
// List all users (admin only)
app.get('/api/admin/users', requireAuth(), async (req, res) => {
  const hasPerm = await rbacManager.hasPermission(req.user.role, 'user:view_all');
  if (!hasPerm && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  }

  const { search, role, status, page = 1, limit = 20 } = req.query;
  const users = await userManager.getAllUsers();

  // Apply filters
  let filteredUsers = users;
  if (search) {
    const searchLower = search.toLowerCase();
    filteredUsers = filteredUsers.filter(u =>
      u.username.toLowerCase().includes(searchLower) ||
      (u.display_name && u.display_name.toLowerCase().includes(searchLower))
    );
  }
  if (role && role !== 'all') {
    filteredUsers = filteredUsers.filter(u => u.role === role);
  }
  if (status && status !== 'all') {
    filteredUsers = filteredUsers.filter(u => u.status === status);
  }

  // Pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const startIndex = (pageNum - 1) * limitNum;
  const endIndex = startIndex + limitNum;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  // Remove password_hash from response
  const safeUsers = paginatedUsers.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    email: u.email,
    display_name: u.display_name,
    status: u.status || 'active',
    created_at: u.created_at,
    updated_at: u.updated_at
  }));

  res.json({
    success: true,
    users: safeUsers,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: filteredUsers.length,
      totalPages: Math.ceil(filteredUsers.length / limitNum)
    }
  });
});
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 2: Add POST /api/admin/users endpoint

**Files:**
- Modify: `server/src/index.js`
- Test: `server/__tests__/AdminUsersAPI.test.js`

- [ ] **Step 1: Write failing test for POST /api/admin/users**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add POST /api/admin/users route** (includes validation for username, password, role)
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 3: Add PUT /api/admin/users/:id/role endpoint

**Files:**
- Modify: `server/src/index.js`
- Test: `server/__tests__/AdminUsersAPI.test.js`

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add PUT route** (uses userManager.updateUserRole)
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 4: Add DELETE /api/admin/users/:id endpoint

**Files:**
- Modify: `server/src/index.js`
- Test: `server/__tests__/AdminUsersAPI.test.js`

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add DELETE route** (blocks self-deletion, checks RBAC)
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

### Task 5: Add bulk operations endpoints

**Files:**
- Modify: `server/src/index.js`
- Modify: `server/src/UserManager.js` (add bulkDeleteUsers, bulkChangeRole methods)
- Test: `server/__tests__/AdminUsersAPI.test.js`

- [ ] **Step 1: Add bulk methods to UserManager**
- [ ] **Step 2: Write failing test for bulk endpoints**
- [ ] **Step 3: Run test to verify it fails**
- [ ] **Step 4: Add bulk operation routes** (POST /api/admin/users/bulk-delete, POST /api/admin/users/bulk-role)
- [ ] **Step 5: Run test to verify it passes**
- [ ] **Step 6: Commit**

---

## Chunk 2: Frontend Basic - Users Tab and CRUD

### Task 6: Add Users tab navigation to AdminDashboard

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add users tab state to constructor** (users, selectedUsers, userFilters)
- [ ] **Step 2: Add Users tab HTML to renderDashboard()**
- [ ] **Step 3: Add setupTabNavigation() method**
- [ ] **Step 4: Commit**

### Task 7: Implement loadUsers and renderUsersTable

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add loadUsers() method** (fetches from API with filters/pagination)
- [ ] **Step 2: Add renderUsersTable() method** (renders table with role badges, status, checkboxes)
- [ ] **Step 3: Add escapeHtml() helper method**
- [ ] **Step 4: Commit**

### Task 8: Implement Create User modal

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add showCreateUserModal() method**
- [ ] **Step 2: Add hideCreateUserModal() method**
- [ ] **Step 3: Add handleCreateUser() method**
- [ ] **Step 4: Bind create user button**
- [ ] **Step 5: Commit**

### Task 9: Implement Edit Role modal

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add editUserRole() method**
- [ ] **Step 2: Add hideEditRoleModal() method**
- [ ] **Step 3: Add handleEditRole() method**
- [ ] **Step 4: Commit**

### Task 10: Implement deleteUser method

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add deleteUser() method** (with confirmation dialog)
- [ ] **Step 2: Add setupDropdownListeners() helper**
- [ ] **Step 3: Add closeAllDropdowns() helper**
- [ ] **Step 4: Commit**

---

## Chunk 3: Frontend Advanced - Bulk Operations and Filtering

### Task 11: Implement user selection and bulk actions

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add setupUserCheckboxListeners() method**
- [ ] **Step 2: Add toggleUserSelection(), toggleSelectAll(), clearSelection() methods**
- [ ] **Step 3: Add renderBulkActions() method**
- [ ] **Step 4: Add bulkDeleteUsers() method**
- [ ] **Step 5: Add showBulkRoleModal() and handleBulkRoleChange() methods**
- [ ] **Step 6: Bind bulk action buttons**
- [ ] **Step 7: Commit**

### Task 12: Implement search and filter functionality

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add setupUserFilterListeners() method**
- [ ] **Step 2: Add setFilter() and applyFilters() methods**
- [ ] **Step 3: Bind filter listeners**
- [ ] **Step 4: Commit**

### Task 13: Implement pagination

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add renderPagination() method**
- [ ] **Step 2: Bind pagination buttons**
- [ ] **Step 3: Commit**

---

## Chunk 4: Polish - Loading States and Error Handling

### Task 14: Add loading states and error toasts

**Files:**
- Modify: `client/js/AdminDashboard.js`

- [ ] **Step 1: Add loading state to renderUsersTable()**
- [ ] **Step 2: Add specific error toasts for validation errors**
- [ ] **Step 3: Commit**

### Task 15: Add CSS styles for new components

**Files:**
- Modify: `client/css/admin.css`

- [ ] **Step 1: Add tab navigation styles**
- [ ] **Step 2: Add filter and search input styles**
- [ ] **Step 3: Add data table styles**
- [ ] **Step 4: Add role badge and status badge styles**
- [ ] **Step 5: Add dropdown menu styles**
- [ ] **Step 6: Add bulk actions bar styles**
- [ ] **Step 7: Add pagination styles**
- [ ] **Step 8: Rebuild CSS bundle** (`npm run build`)
- [ ] **Step 9: Commit**

### Task 16: Update cache-busting version

**Files:**
- Modify: `public/admin.html`

- [ ] **Step 1: Update version numbers** (admin.min.css and AdminDashboard.bundle.min.js to ?v=2026031605)
- [ ] **Step 2: Commit**

---

## Testing Summary

After implementation, run:

```bash
# Run all tests
npm test

# Run specific API tests
npm test -- AdminUsersAPI

# Build and verify no errors
npm run build
```

## Manual Testing Checklist

**Backend API:**
- [ ] GET /api/admin/users returns users list
- [ ] POST /api/admin/users creates user
- [ ] PUT /api/admin/users/:id/role updates role
- [ ] DELETE /api/admin/users/:id deletes user
- [ ] Bulk endpoints work correctly

**Frontend:**
- [ ] Users tab displays correctly
- [ ] User table renders with data
- [ ] Create User modal works
- [ ] Edit Role modal works
- [ ] Delete confirmation works
- [ ] Bulk selection works
- [ ] Bulk delete works
- [ ] Bulk role change works
- [ ] Search filtering works
- [ ] Role filtering works
- [ ] Status filtering works
- [ ] Pagination works
- [ ] Loading states display
- [ ] Error toasts display

## Security Verification

- [ ] Only admin users can access endpoints
- [ ] RBAC checks prevent privilege escalation
- [ ] Self-deletion is blocked
- [ ] Password hashing is applied
- [ ] Input validation prevents injection
