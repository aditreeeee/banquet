# BanquetPro — Deployment, Backup & Rollback Guide

This fills the gap flagged in the production-readiness audit: there was no
written deployment runbook, and no backup/recovery or rollback plan. It
documents the process as it actually exists in this repo today (PM2 +
IIS/`web.config`, MSSQL, `backend/scripts/setup.js`) — it does not introduce
new tooling.

## 1. First-time environment setup

1. Copy `backend/.env.example` to `backend/.env` and fill in real values —
   at minimum `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `CORS_ORIGINS`, and
   `SUPER_ADMIN_PASSWORD`. **Never commit this file** (already gitignored).
2. Set `NODE_ENV=production` in the environment that actually runs the
   process — this is what gates secure cookies, CORS restriction, and error
   detail suppression (see `backend/src/api/v1/middleware/errorHandler.js`,
   `backend/src/api/v1/controllers/auth.controller.js`, `backend/src/app.js`).
3. Create the database and schema:
   ```
   cd backend
   npm run db:setup
   ```
   `scripts/setup.js` is idempotent (guards every table/column/index creation
   with `IF NOT EXISTS`), so re-running it is safe. **Never run
   `npm run db:setup:reset`** against a database that has real data — it
   drops and recreates the entire database.
4. Install dependencies and start the app:
   ```
   npm ci
   pm2 start ecosystem.config.js          # defaults to NODE_ENV=production
   ```
   To run in development mode locally instead, use
   `pm2 start ecosystem.config.js --env development`.
5. If deploying under IIS instead of/in addition to PM2, `backend/web.config`
   already points `iisnode` at `server.js` and disables dev error pages —
   confirm the IIS site's app-pool environment sets `node_env=production`
   (the file reads it from `%node_env%`).

## 2. Ongoing deploys (code changes)

1. `git pull` / deploy the new commit to the server.
2. `npm ci` (not `npm install`) to install exactly what's in the lockfile.
3. If the change includes a database migration, run it manually against
   production (see §4 — there is no automatic migration runner; migrations
   under `database/migrations/` are applied by hand in order).
4. `pm2 restart banquetpro-api` (or `npm run pm2:restart`).
5. Tail `pm2 logs banquetpro-api` (or `backend/logs/app-YYYY-MM-DD.log`) for
   a minute to confirm a clean start before considering the deploy done.

## 3. Database backups

There is no automated backup job checked into this repo — set one up at the
SQL Server/infrastructure level using native MSSQL backup, on this schedule
at minimum:

- **Full backup**: daily, off-peak hours.
- **Transaction log backup**: every 15–60 minutes if the recovery model is
  `FULL` (recommended for a booking system — point-in-time recovery matters
  when a bad deploy corrupts data mid-day).

Native backup command (run via `sqlcmd`, a SQL Agent job, or your managed
SQL Server's built-in backup schedule):

```sql
BACKUP DATABASE BanquetDB
TO DISK = 'D:\Backups\BanquetDB_full.bak'
WITH FORMAT, COMPRESSION, STATS = 10;
```

Restore (to a new/renamed database first, verify, then swap):

```sql
RESTORE DATABASE BanquetDB_Restore
FROM DISK = 'D:\Backups\BanquetDB_full.bak'
WITH MOVE 'BanquetDB' TO 'D:\Data\BanquetDB_Restore.mdf',
     MOVE 'BanquetDB_log' TO 'D:\Data\BanquetDB_Restore_log.ldf',
     STATS = 10;
```

Retention: keep at least 30 days of full backups and 7 days of transaction
log backups, matching the app-log retention already configured in
`backend/src/utils/logger.js`.

**Never restore or point a backup job at `database/seeds/002_seed_demo_data.sql`
in production** — it seeds ~50 demo accounts that all share one password
hash, and is now gated behind an explicit `CONFIRM_DEMO_SEED=YES` flag for
exactly this reason (see the file header).

## 4. Migrations — forward-only, applied by hand

`database/migrations/001`–`014` are plain `.sql` files with **no down/rollback
scripts** — this is a deliberate forward-only migration set. Apply them in
numeric order via `sqlcmd` or SSMS against the target database. There is no
migration-tracking table/runner in this repo yet, so keep a record (e.g. a
shared doc or the SQL Server instance's own history) of which migration
number a given environment is currently on.

## 5. Rollback plan

**Application code:** PM2 keeps the previous build on disk until you deploy
over it — roll back by checking out the previous git commit/tag and running
`pm2 restart banquetpro-api`. Keep at least the last 3 deployed commits
tagged for fast reference.

**Database:** because migrations are forward-only, a schema rollback is a
**restore from backup**, not a scripted "down" migration:

1. Stop the app (`pm2 stop banquetpro-api`) to prevent writes during restore.
2. Restore the most recent full backup + any transaction log backups up to
   just before the bad change, into a new database name first.
3. Verify row counts/spot-check data on the restored copy.
4. Rename the restored database into place (or repoint `DB_NAME`), then
   `pm2 start banquetpro-api`.

Because this is destructive and can lose writes made after the backup point,
always restore to a **new** database name and verify before swapping —
never `RESTORE` directly over the live `BanquetDB`.

## 6. Known operational gaps (tracked, not yet built)

- No automated backup job is included in this repo — must be configured at
  the infrastructure/SQL Server level per §3.
- No migration-tracking table — track applied migration numbers manually
  until one is added.
- PM2 runs a single instance (no cluster mode) — fine for moderate load, but
  should move to `exec_mode: 'cluster'` with `instances: 'max'` before a
  high-concurrency launch.
