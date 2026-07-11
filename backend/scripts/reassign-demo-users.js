/**
 * BanquetPro — Demo-Assignment Cleanup Script
 *
 * Historically, every newly created user silently defaulted onto
 * company_id=1 ("BanquetPro Demo") — see user.service.js's old create()
 * (fixed) for the root cause. This script finds users who ended up on that
 * tenant because of the bug (not because they're supposed to be there) and
 * unassigns them, so they show up as "unassigned" for the Super Admin to
 * explicitly place into the correct Company/Property/Branch via the
 * User Management page.
 *
 * It never guesses a destination tenant — only a human (Super Admin) should
 * decide that. All this script does is stop pretending an unintentional
 * default assignment was a real one.
 *
 * Usage:
 *   node scripts/reassign-demo-users.js            (dry run — report only)
 *   node scripts/reassign-demo-users.js --unassign (clears company_id/branch_id
 *                                                    for every flagged user)
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sql = require('mssql');

const DB_NAME = process.env.DB_NAME || 'banquet_booking';
const APPLY   = process.argv.includes('--unassign');

const dbConfig = {
    server:   process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 1433,
    database: DB_NAME,
    user:     process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
        encrypt:                String(process.env.DB_ENCRYPT).toLowerCase() === 'true',
        trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
    },
};

// Accounts setup.js seeds ON PURPOSE against company_id=1 — these are real,
// intentional demo users and must never be touched by this cleanup.
const PRESERVE_EMAILS = [
    'superadmin@banquetpro.com', // Super Admin — company_id is NULL anyway
    'admin@banquetpro.com',      // seeded Company Admin for the Demo tenant
];

const log  = (msg) => console.log(`  [INFO]  ${msg}`);
const ok   = (msg) => console.log(`  [OK]    ${msg}`);
const warn = (msg) => console.log(`  [WARN]  ${msg}`);
const fail = (msg) => { console.error(`  [ERROR] ${msg}`); process.exit(1); };

(async () => {
    let pool;
    try {
        pool = await new sql.ConnectionPool(dbConfig).connect();
    } catch (err) {
        fail(`Could not connect to ${DB_NAME}: ${err.message}`);
        return;
    }

    try {
        console.log(`\nBanquetPro — Demo-Assignment Cleanup (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);

        const preserveList = PRESERVE_EMAILS.map((e) => `'${e.replace(/'/g, "''")}'`).join(',');
        const flagged = await pool.request().query(`
            SELECT u.user_id, u.first_name, u.last_name, u.email, r.role_slug, u.branch_id, u.created_at
            FROM Users u
            JOIN Roles r ON r.role_id = u.role_id
            WHERE u.company_id = 1
              AND u.deleted_at IS NULL
              AND u.email NOT IN (${preserveList})
            ORDER BY u.created_at ASC
        `);

        if (!flagged.recordset.length) {
            ok('No users found on the Demo tenant outside the seeded demo accounts. Nothing to do.');
            return;
        }

        log(`Found ${flagged.recordset.length} user(s) on "BanquetPro Demo" (company_id=1) that aren't seeded demo accounts:`);
        flagged.recordset.forEach((u) => {
            console.log(`    #${u.user_id}  ${u.first_name} ${u.last_name || ''}  <${u.email}>  role=${u.role_slug}  branch_id=${u.branch_id ?? '—'}  created=${u.created_at.toISOString()}`);
        });

        if (!APPLY) {
            warn('Dry run only — no changes made. Re-run with --unassign to clear these users\' company/branch so a Super Admin can explicitly reassign them.');
            return;
        }

        const ids = flagged.recordset.map((u) => u.user_id);
        const idList = ids.join(',');
        await pool.request().query(`
            UPDATE Users SET company_id = NULL, branch_id = NULL, updated_at = GETUTCDATE()
            WHERE user_id IN (${idList})
        `);

        // Best-effort audit trail entry per user — AuditLogs.company_id is
        // nullable-tolerant here since these users no longer belong to any
        // tenant until reassigned.
        for (const u of flagged.recordset) {
            await pool.request()
                .input('userId', sql.Int, u.user_id)
                .input('description', sql.NVarChar, `${u.email} unassigned from BanquetPro Demo (unintentional default) — pending Super Admin reassignment`)
                .query(`
                    INSERT INTO AuditLogs (company_id, user_id, action, entity_type, entity_id, description, created_at)
                    VALUES (NULL, NULL, 'user.demo_assignment_cleared', 'user', @userId, @description, GETUTCDATE())
                `);
        }

        ok(`Unassigned ${ids.length} user(s). They will show with no Company/Property/Branch until a Super Admin assigns them via User Management.`);
    } catch (err) {
        fail(err.message);
    } finally {
        await pool.close();
    }
})();
