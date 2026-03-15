# PostgreSQL Migration Rollback Procedure

> **Purpose:** Step-by-step guide to rollback from PostgreSQL back to SQLite if critical issues arise during or after migration.

## When to Rollback

Consider rolling back if you experience:
- Persistent database connection issues that cannot be resolved
- Data corruption or inconsistency in PostgreSQL
- Performance degradation compared to SQLite
- Critical bugs in production that require immediate remediation

## Rollback Steps

### 1. Stop Services

```bash
docker compose down
```

### 2. Update Environment Variables

Edit `.env` and change:

```bash
# Change from PostgreSQL to SQLite
DATABASE_URL=postgres://breadcall:changeme@postgres:5432/breadcall
# To:
DATABASE_PATH=/app/data/breadcall.db
```

Remove PostgreSQL-specific variables if desired:
- `DB_PASSWORD`
- `DB_POOL_MIN`
- `DB_POOL_MAX`

### 3. Update docker-compose.yml (if reverting to pre-migration state)

If you want to remove PostgreSQL and Redis from your deployment:

```bash
git checkout <commit-before-migration> -- docker-compose.yml
```

Or manually edit `docker-compose.yml` to:
- Remove the `postgres:` service
- Remove the `redis:` service
- Remove `postgres-data` and `redis-data` volumes
- Update signaling service environment variables
- Remove `depends_on` entries for postgres and redis

### 4. Restore SQLite Database

If you have a backup of the SQLite database:

```bash
# Copy backup to data directory
cp /path/to/backup/breadcall.db ./data/breadcall.db

# Or if using Docker volume
docker cp /path/to/backup/breadcall.db <container-id>:/app/data/breadcall.db
```

If you don't have a backup, the database will be recreated empty on first run.

### 5. Update Application Code (if code was modified)

If you need to revert code changes:

```bash
git checkout <commit-before-migration>
```

Key files that were modified during migration:
- `server/src/database.js` - Rewritten for PostgreSQL
- `server/src/UserManager.js` - Updated for TIMESTAMPTZ
- `server/src/RBACManager.js` - Added Redis caching
- `server/src/RoomManager.js` - Added Redis caching
- `server/src/index.js` - Updated initialization
- `server/__tests__/*.test.js` - Updated to mock PostgreSQL

### 6. Restart Services

```bash
docker compose up -d
```

### 7. Verify Rollback

Check that the application is working:

```bash
# Check service health
docker compose ps

# Check logs
docker compose logs signaling

# Test endpoint
curl http://localhost:3000/api/health
```

## Data Migration Considerations

### If You Need to Preserve PostgreSQL Data

If you need to migrate data FROM PostgreSQL back TO SQLite:

1. Export PostgreSQL data:
```bash
docker compose exec postgres pg_dump -U breadcall breadcall > backup.sql
```

2. Convert PostgreSQL dump to SQLite format (manual process):
- Remove PostgreSQL-specific syntax
- Convert TIMESTAMPTZ to TEXT
- Convert UUID types to TEXT
- Adjust INSERT statements for SQLite compatibility

3. Import into SQLite:
```bash
sqlite3 ./data/breadcall.db < backup-sqlite.sql
```

**Note:** This is a complex process. It's recommended to:
- Maintain regular SQLite backups during the migration period
- Use a migration tool if bidirectional sync is needed
- Consider running both databases in parallel during transition

## Rollback Verification Checklist

- [ ] Services start without errors
- [ ] SQLite database file exists and is accessible
- [ ] User authentication works
- [ ] Room creation/joining works
- [ ] Token generation and validation works
- [ ] RBAC permissions are enforced
- [ ] No data loss for critical records
- [ ] Performance is acceptable

## Re-migrating to PostgreSQL

If you rollback and later want to re-attempt the PostgreSQL migration:

1. Fix any issues that caused the rollback
2. Ensure you have a fresh SQLite backup
3. Re-apply the migration commit:
```bash
git checkout <migration-commit>
```
4. Follow the migration guide in `docs/superpowers/specs/2026-03-15-postgres-migration-design.md`
5. Run schema migrations
6. Migrate data from SQLite to PostgreSQL
7. Verify before switching production traffic

## Support

For issues during rollback, check:
- Application logs: `docker compose logs signaling`
- PostgreSQL logs (if still running): `docker compose logs postgres`
- Redis logs (if still running): `docker compose logs redis`
