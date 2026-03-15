const Database = require('./database');
const RBACManager = require('./RBACManager');
const UserManager = require('./UserManager');

async function bootstrap() {
  const db = new Database();

  try {
    await db.initialize();
    console.log('[Bootstrap] Database initialized');

    const rbac = new RBACManager(db, null); // No Redis in bootstrap
    await rbac.initialize();

    const userManager = new UserManager(db, rbac);
    await userManager.initialize();

    const adminUsername = process.env.SUPER_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.warn('[Bootstrap] WARNING: No SUPER_ADMIN_PASSWORD or ADMIN_PASSWORD set');
      console.warn('[Bootstrap] Please set these environment variables for security!');
      return null;
    }

    const result = await userManager.createBootstrapAdmin(adminUsername, adminPassword);

    if (result.exists) {
      console.log(`[Bootstrap] Super admin user '${adminUsername}' already exists`);
    } else {
      console.log(`[Bootstrap] Created super admin user '${adminUsername}'`);
    }

    return { username: adminUsername, exists: result.exists };
  } catch (error) {
    console.error('[Bootstrap] Error:', error.message);
    throw error;
  }
}

module.exports = bootstrap;
