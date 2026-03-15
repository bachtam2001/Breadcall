const UserManager = require('../src/UserManager');
const Database = require('../src/database');
const RBACManager = require('../src/RBACManager');

describe('UserManager', () => {
  let userManager;
  let db;
  let rbac;

  beforeAll(async () => {
    db = new Database(':memory:');
    await db.initialize();

    await db.db.exec(`
      INSERT INTO roles (name, hierarchy, description) VALUES
        ('super_admin', 100, 'Full system access'),
        ('room_admin', 80, 'Create and manage own rooms'),
        ('moderator', 60, 'Manage participants in assigned rooms'),
        ('participant', 20, 'Join rooms, send audio/video');
    `);

    rbac = new RBACManager(db);
    await rbac.initialize();

    userManager = new UserManager(db, rbac);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe('createUser', () => {
    test('creates a new user with hashed password', async () => {
      const user = await userManager.createUser({
        username: 'testuser',
        password: 'securepassword123',
        role: 'participant',
        displayName: 'Test User'
      });

      expect(user).toBeTruthy();
      expect(user.username).toBe('testuser');
      expect(user.role).toBe('participant');
    });

    test('throws error for duplicate username', async () => {
      await userManager.createUser({
        username: 'duplicate',
        password: 'password1',
        role: 'participant'
      });

      await expect(userManager.createUser({
        username: 'duplicate',
        password: 'password2',
        role: 'participant'
      })).rejects.toThrow('Username already exists');
    });

    test('throws error for invalid role', async () => {
      await expect(userManager.createUser({
        username: 'badrole',
        password: 'password1',
        role: 'nonexistent'
      })).rejects.toThrow('Invalid role');
    });
  });

  describe('authenticateUser', () => {
    test('authenticates valid credentials', async () => {
      await userManager.createUser({
        username: 'loginuser',
        password: 'correctpassword',
        role: 'participant'
      });

      const result = await userManager.authenticateUser('loginuser', 'correctpassword');
      expect(result.success).toBe(true);
      expect(result.user.username).toBe('loginuser');
    });

    test('rejects wrong password', async () => {
      const result = await userManager.authenticateUser('loginuser', 'wrongpassword');
      expect(result.success).toBe(false);
    });
  });
});
