/**
 * BanquetPro — Database Setup Script
 * Creates banquet_booking database, imports schema, seeds essential data,
 * and creates the Super Administrator account.
 *
 * Usage:
 *   node scripts/setup.js
 *   node scripts/setup.js --reset   (drops and recreates the DB — DANGEROUS)
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sql    = require('mssql');
const bcrypt = require('bcrypt');
const path   = require('path');
const fs     = require('fs');

const DB_NAME = process.env.DB_NAME || 'banquet_booking';
const RESET   = process.argv.includes('--reset');

// Connection used for server-level operations (CREATE/DROP DATABASE) —
// deliberately does not specify an initial `database` so it connects to master.
const masterConfig = {
    server:   process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 1433,
    user:     process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: 'master',
    options: {
        encrypt:                String(process.env.DB_ENCRYPT).toLowerCase() === 'true',
        trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
    },
};

// Connection used once the target database exists.
const dbConfig = {
    ...masterConfig,
    database: DB_NAME,
};

// ─── Logging ──────────────────────────────────────────────────────────────────
const log  = (msg)  => console.log(`  [INFO]  ${msg}`);
const ok   = (msg)  => console.log(`  [OK]    ${msg}`);
const warn = (msg)  => console.log(`  [WARN]  ${msg}`);
const fail = (msg)  => { console.error(`  [ERROR] ${msg}`); process.exit(1); };

/**
 * Run a batch of SQL. MSSQL requires each CREATE PROCEDURE/FUNCTION/TRIGGER/VIEW
 * statement to be alone in its own batch, so scripts use `GO` as the batch
 * separator (not a T-SQL keyword — the mssql driver doesn't understand it,
 * so we split on it ourselves before executing).
 */
const runBatches = async (pool, script) => {
    const batches = script
        .split(/^\s*GO\s*$/im)
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

    for (const batch of batches) {
        await pool.request().batch(batch);
    }
};

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    console.log('\n=============================================================');
    console.log('  BanquetPro — Database Setup');
    console.log('=============================================================\n');

    let masterPool;
    try {
        masterPool = await new sql.ConnectionPool(masterConfig).connect();
        log(`Connected to MSSQL at ${masterConfig.server}:${masterConfig.port}`);
    } catch (err) {
        fail(`Cannot connect to MSSQL: ${err.message}\n  Check .env credentials (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD).`);
        return;
    }

    // ── 1. Create / reset database ───────────────────────────────────────────
    if (RESET) {
        warn(`--reset flag detected. Dropping database "${DB_NAME}" …`);
        await masterPool.request().batch(`
            IF DB_ID(N'${DB_NAME}') IS NOT NULL
            BEGIN
                ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                DROP DATABASE [${DB_NAME}];
            END
        `);
        ok(`Database "${DB_NAME}" dropped.`);
    }

    await masterPool.request().batch(`
        IF DB_ID(N'${DB_NAME}') IS NULL
        BEGIN
            CREATE DATABASE [${DB_NAME}];
        END
    `);
    ok(`Database "${DB_NAME}" ready.`);

    await masterPool.close();

    const pool = await new sql.ConnectionPool(dbConfig).connect();

    // ── 2. Import schema ─────────────────────────────────────────────────────
    const schemaPath = path.resolve(__dirname, '../../database/migrations/001_create_schema.sql');
    if (fs.existsSync(schemaPath)) {
        log('Importing schema …');
        let schemaSql = fs.readFileSync(schemaPath, 'utf8');
        // Remove CREATE DATABASE / USE directives — we already selected the DB.
        schemaSql = schemaSql
            .replace(/CREATE\s+DATABASE[^;]+;/gi, '')
            .replace(/^\s*USE\s+\[?\w+\]?\s*;?\s*$/gim, '');
        await runBatches(pool, schemaSql);
        ok('Schema imported.');
    } else {
        warn(`Schema file not found at ${schemaPath} — skipping.`);
    }

    // ── 3. Add Resources table (if not in main schema) ───────────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Resources')
        BEGIN
            CREATE TABLE Resources (
                resource_id         INT             NOT NULL IDENTITY(1,1),
                company_id          INT             NOT NULL,
                branch_id           INT             NULL,
                resource_name       NVARCHAR(200)   NOT NULL,
                resource_type       NVARCHAR(100)   NULL,
                unit_price          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
                quantity_available  INT             NOT NULL DEFAULT 0,
                is_active           BIT             NOT NULL DEFAULT 1,
                created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                updated_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT PK_resources PRIMARY KEY (resource_id),
                CONSTRAINT FK_resources_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
            );
        END
    `);
    ok('Resources table ensured.');

    // ── 4. Seed reference / lookup data ─────────────────────────────────────
    log('Seeding reference data …');

    // Helper: MERGE-based "insert if not exists" for seed rows with explicit IDs.
    const insertIfNotExists = async (table, idCol, rowsSql) => {
        await pool.request().batch(`
            SET IDENTITY_INSERT ${table} ON;
            MERGE INTO ${table} AS target
            USING (VALUES ${rowsSql}) AS src(${idCol})
            ON target.${idCol} = src.${idCol}
            WHEN NOT MATCHED THEN
                INSERT DEFAULT VALUES;
            SET IDENTITY_INSERT ${table} OFF;
        `);
    };

    // Countries
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Countries WHERE country_id = 1)
        BEGIN
            SET IDENTITY_INSERT Countries ON;
            INSERT INTO Countries (country_id, country_name, country_code, phone_code, currency_code, currency_symbol)
            VALUES
                (1, N'India', 'IN', '+91', 'INR', N'₹'),
                (2, N'United States', 'US', '+1', 'USD', N'$'),
                (3, N'United Arab Emirates', 'AE', '+971', 'AED', N'د.إ');
            SET IDENTITY_INSERT Countries OFF;
        END
    `);

    // States
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM States WHERE state_id = 1)
        BEGIN
            SET IDENTITY_INSERT States ON;
            INSERT INTO States (state_id, country_id, state_name, state_code) VALUES
                (1, 1, N'Maharashtra', 'MH'),
                (2, 1, N'Delhi', 'DL'),
                (3, 1, N'Karnataka', 'KA'),
                (4, 1, N'Tamil Nadu', 'TN'),
                (5, 1, N'Gujarat', 'GJ'),
                (6, 1, N'Rajasthan', 'RJ'),
                (7, 1, N'Uttar Pradesh', 'UP'),
                (8, 1, N'Telangana', 'TS');
            SET IDENTITY_INSERT States OFF;
        END
    `);

    // Cities
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Cities WHERE city_id = 1)
        BEGIN
            SET IDENTITY_INSERT Cities ON;
            INSERT INTO Cities (city_id, state_id, city_name) VALUES
                (1,  1, N'Mumbai'),  (2,  1, N'Pune'),      (3,  1, N'Nagpur'),
                (4,  2, N'New Delhi'),(5,  2, N'Noida'),    (6,  2, N'Gurugram'),
                (7,  3, N'Bengaluru'),(8,  3, N'Mysuru'),
                (9,  4, N'Chennai'), (10, 4, N'Coimbatore'),
                (11, 5, N'Ahmedabad'),(12, 5, N'Surat'),
                (13, 6, N'Jaipur'),  (14, 6, N'Udaipur'),
                (15, 7, N'Lucknow'), (16, 7, N'Agra'),
                (17, 8, N'Hyderabad'),(18, 8, N'Warangal');
            SET IDENTITY_INSERT Cities OFF;
        END
    `);

    // Roles
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Roles WHERE role_id = 1)
        BEGIN
            SET IDENTITY_INSERT Roles ON;
            INSERT INTO Roles (role_id, role_name, role_slug, description, is_system) VALUES
                (1, N'Super Admin',       'super_admin',       N'Full platform control. Manages all companies and tenants.', 1),
                (2, N'Company Admin',     'company_admin',     N'Manages a single company: branches, banquets, staff, reports.', 1),
                (3, N'Branch Manager',    'branch_manager',    N'Manages daily operations of a specific branch.', 1),
                (4, N'Booking Executive', 'booking_executive', N'Creates and manages bookings, customers, invoices.', 1),
                (5, N'Customer',          'customer',          N'End-user who searches, books, and manages their bookings.', 1);
            SET IDENTITY_INSERT Roles OFF;
        END
    `);

    // Permissions
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Permissions)
        BEGIN
            INSERT INTO Permissions (module, action, permission_key, description) VALUES
                ('dashboard',    'read',   'dashboard:read',    N'View dashboard and KPIs'),
                ('companies',    'create', 'companies:create',  N'Create new company'),
                ('companies',    'read',   'companies:read',    N'View companies'),
                ('companies',    'update', 'companies:update',  N'Update company details'),
                ('companies',    'delete', 'companies:delete',  N'Delete company'),
                ('branches',     'create', 'branches:create',   N'Create branch'),
                ('branches',     'read',   'branches:read',     N'View branches'),
                ('branches',     'update', 'branches:update',   N'Update branch'),
                ('branches',     'delete', 'branches:delete',   N'Delete branch'),
                ('banquets',     'create', 'banquets:create',   N'Create banquet hall'),
                ('banquets',     'read',   'banquets:read',     N'View banquet halls'),
                ('banquets',     'update', 'banquets:update',   N'Update banquet details'),
                ('banquets',     'delete', 'banquets:delete',   N'Delete banquet'),
                ('halls',        'create', 'halls:create',      N'Create hall'),
                ('halls',        'read',   'halls:read',        N'View halls'),
                ('halls',        'update', 'halls:update',      N'Update hall'),
                ('halls',        'delete', 'halls:delete',      N'Delete hall'),
                ('bookings',     'create', 'bookings:create',   N'Create new booking'),
                ('bookings',     'read',   'bookings:read',     N'View bookings'),
                ('bookings',     'update', 'bookings:update',   N'Modify booking'),
                ('bookings',     'cancel', 'bookings:cancel',   N'Cancel booking'),
                ('bookings',     'confirm','bookings:confirm',  N'Confirm booking'),
                ('customers',    'create', 'customers:create',  N'Add customer'),
                ('customers',    'read',   'customers:read',    N'View customers'),
                ('customers',    'update', 'customers:update',  N'Edit customer'),
                ('customers',    'delete', 'customers:delete',  N'Delete customer'),
                ('payments',     'create', 'payments:create',   N'Record payment'),
                ('payments',     'read',   'payments:read',     N'View payments'),
                ('payments',     'refund', 'payments:refund',   N'Process refund'),
                ('invoices',     'create', 'invoices:create',   N'Generate invoice'),
                ('invoices',     'read',   'invoices:read',     N'View invoices'),
                ('invoices',     'send',   'invoices:send',     N'Email invoice to customer'),
                ('reports',      'read',   'reports:read',      N'View reports'),
                ('reports',      'export', 'reports:export',    N'Export reports (PDF/Excel)'),
                ('pricing',      'create', 'pricing:create',    N'Create pricing rules'),
                ('pricing',      'read',   'pricing:read',      N'View pricing'),
                ('pricing',      'update', 'pricing:update',    N'Update pricing'),
                ('users',        'create', 'users:create',      N'Add user'),
                ('users',        'read',   'users:read',        N'View users'),
                ('users',        'update', 'users:update',      N'Edit user'),
                ('users',        'delete', 'users:delete',      N'Deactivate user'),
                ('settings',     'read',   'settings:read',     N'View settings'),
                ('settings',     'update', 'settings:update',   N'Update settings'),
                ('audit_logs',   'read',   'audit_logs:read',   N'View audit trail'),
                ('coupons',      'create', 'coupons:create',    N'Create coupons'),
                ('coupons',      'read',   'coupons:read',      N'View coupons'),
                ('coupons',      'update', 'coupons:update',    N'Edit coupons'),
                ('availability', 'manage', 'availability:manage',N'Block/unblock dates'),
                ('availability', 'read',   'availability:read', N'View availability calendar'),
                ('resources',    'create', 'resources:create',  N'Add resource/inventory'),
                ('resources',    'read',   'resources:read',    N'View resources'),
                ('resources',    'update', 'resources:update',  N'Update resources');
        END
    `);

    // Role → Permission mappings
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 1)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 1, permission_id FROM Permissions;
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 2)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 2, permission_id FROM Permissions
        WHERE permission_key NOT IN ('companies:create','companies:delete','audit_logs:read');
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 3)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 3, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel','bookings:confirm',
            'customers:create','customers:read','customers:update',
            'payments:create','payments:read',
            'invoices:create','invoices:read','invoices:send',
            'reports:read','reports:export','pricing:read',
            'availability:manage','availability:read',
            'resources:create','resources:read','resources:update',
            'settings:read'
        );
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM RolePermissions WHERE role_id = 4)
        INSERT INTO RolePermissions (role_id, permission_id)
        SELECT 4, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel',
            'customers:create','customers:read','customers:update',
            'payments:create','payments:read',
            'invoices:create','invoices:read','invoices:send',
            'availability:read','coupons:read'
        );
    `);

    // Event types
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM EventTypes WHERE event_type_id = 1)
        BEGIN
            SET IDENTITY_INSERT EventTypes ON;
            INSERT INTO EventTypes (event_type_id, type_name, type_slug, sort_order) VALUES
                (1,  N'Wedding',         'wedding',         1),
                (2,  N'Reception',       'reception',       2),
                (3,  N'Birthday Party',  'birthday',        3),
                (4,  N'Corporate Event', 'corporate',       4),
                (5,  N'Conference',      'conference',      5),
                (6,  N'Anniversary',     'anniversary',     6),
                (7,  N'Engagement',      'engagement',      7),
                (8,  N'Baby Shower',     'baby_shower',     8),
                (9,  N'Religious Event', 'religious',       9),
                (10, N'Private Party',   'private_party',   10);
            SET IDENTITY_INSERT EventTypes OFF;
        END
    `);

    // Amenity types
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM AmenityTypes WHERE amenity_type_id = 1)
        BEGIN
            SET IDENTITY_INSERT AmenityTypes ON;
            INSERT INTO AmenityTypes (amenity_type_id, amenity_name, category, is_active) VALUES
                (1,  N'Air Conditioning',   'comfort',     1),
                (2,  N'Power Backup',       'utilities',   1),
                (3,  N'Parking',            'facilities',  1),
                (4,  N'Catering Kitchen',   'catering',    1),
                (5,  N'Stage',              'events',      1),
                (6,  N'Bridal Room',        'rooms',       1),
                (7,  N'Green Room',         'rooms',       1),
                (8,  N'Valet Parking',      'facilities',  1),
                (9,  N'WiFi',               'utilities',   1),
                (10, N'Audio/Visual System','events',      1);
            SET IDENTITY_INSERT AmenityTypes OFF;
        END
    `);

    ok('Reference data seeded.');

    // ── 5. Demo company + branch ─────────────────────────────────────────────
    log('Seeding demo company & branch …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Companies WHERE company_id = 1)
        BEGIN
            SET IDENTITY_INSERT Companies ON;
            INSERT INTO Companies
                (company_id, company_name, company_slug, email, phone, address_line1,
                 country_id, currency_code, timezone, is_active, is_verified, subscription_plan)
            VALUES
                (1, N'BanquetPro Demo', 'banquetpro-demo',
                 'admin@banquetpro.com', '+91-9876543210',
                 N'101, Corporate Tower, Bandra Kurla Complex',
                 1, 'INR', 'Asia/Kolkata', 1, 1, 'enterprise');
            SET IDENTITY_INSERT Companies OFF;
        END
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Branches WHERE branch_id = 1)
        BEGIN
            SET IDENTITY_INSERT Branches ON;
            INSERT INTO Branches
                (branch_id, company_id, branch_name, branch_code, address_line1, is_main_branch, is_active)
            VALUES
                (1, 1, N'Mumbai Head Office', 'MUM-HQ', N'101, Corporate Tower, BKC, Mumbai', 1, 1);
            SET IDENTITY_INSERT Branches OFF;
        END
    `);

    ok('Demo company and branch created.');

    // ── 6. Super Admin user ──────────────────────────────────────────────────
    log('Creating Super Admin account …');
    const SUPER_ADMIN_EMAIL    = 'superadmin@banquetpro.com';
    const SUPER_ADMIN_PASSWORD = 'Admin@123456';
    const SALT_ROUNDS = 12;

    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);

    await pool.request()
        .input('email', sql.NVarChar, SUPER_ADMIN_EMAIL)
        .input('passwordHash', sql.NVarChar, passwordHash)
        .query(`
            IF NOT EXISTS (SELECT 1 FROM Users WHERE user_id = 1)
            BEGIN
                SET IDENTITY_INSERT Users ON;
                INSERT INTO Users
                    (user_id, company_id, branch_id, role_id,
                     first_name, last_name, email,
                     password_hash, is_active, is_email_verified, created_at, updated_at)
                VALUES
                    (1, NULL, NULL, 1,
                     N'Super', N'Admin', @email,
                     @passwordHash, 1, 1, GETUTCDATE(), GETUTCDATE());
                SET IDENTITY_INSERT Users OFF;
            END
        `);

    ok('Super Admin account created.');

    // ── 7. Company Admin user ────────────────────────────────────────────────
    log('Creating Company Admin account …');
    const COMPANY_ADMIN_EMAIL    = 'admin@banquetpro.com';
    const COMPANY_ADMIN_PASSWORD = 'Manager@123';
    const caHash = await bcrypt.hash(COMPANY_ADMIN_PASSWORD, SALT_ROUNDS);

    await pool.request()
        .input('email', sql.NVarChar, COMPANY_ADMIN_EMAIL)
        .input('passwordHash', sql.NVarChar, caHash)
        .query(`
            IF NOT EXISTS (SELECT 1 FROM Users WHERE user_id = 2)
            BEGIN
                SET IDENTITY_INSERT Users ON;
                INSERT INTO Users
                    (user_id, company_id, branch_id, role_id,
                     first_name, last_name, email,
                     password_hash, is_active, is_email_verified, created_at, updated_at)
                VALUES
                    (2, 1, 1, 2,
                     N'Rajesh', N'Kumar', @email,
                     @passwordHash, 1, 1, GETUTCDATE(), GETUTCDATE());
                SET IDENTITY_INSERT Users OFF;
            END
        `);

    ok('Company Admin account created.');

    // ── 8. Demo banquet + halls ──────────────────────────────────────────────
    log('Seeding demo banquet and halls …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Banquets WHERE banquet_id = 1)
        BEGIN
            SET IDENTITY_INSERT Banquets ON;
            INSERT INTO Banquets
                (banquet_id, company_id, branch_id, banquet_name, banquet_slug,
                 address_line1, city, state, phone, email,
                 total_capacity, parking_capacity, has_valet, is_active, is_featured)
            VALUES
                (1, 1, 1, N'The Grand Pavilion', 'the-grand-pavilion',
                 N'Plot 42, Linking Road, Bandra West', N'Mumbai', N'Maharashtra',
                 '+91-22-66001234', 'info@grandpavilion.com',
                 2500, 300, 1, 1, 1),
                (2, 1, 1, N'Royal Garden Banquet', 'royal-garden-banquet',
                 N'Sector 17, Vashi, Navi Mumbai', N'Mumbai', N'Maharashtra',
                 '+91-22-77001234', 'info@royalgarden.com',
                 1200, 150, 0, 1, 0);
            SET IDENTITY_INSERT Banquets OFF;
        END
    `);

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Halls WHERE hall_id = 1)
        BEGIN
            SET IDENTITY_INSERT Halls ON;
            INSERT INTO Halls
                (hall_id, banquet_id, company_id, branch_id,
                 hall_name, hall_code, capacity, capacity_seated, base_price,
                 weekend_surcharge_pct, has_ac, has_power_backup, has_stage,
                 has_kitchen, has_parking, is_active)
            VALUES
                (1, 1, 1, 1, N'Crystal Ballroom',   'CB-001', 1200, 1000, 150000.00, 15.00, 1, 1, 1, 1, 1, 1),
                (2, 1, 1, 1, N'Diamond Hall',        'DH-001',  600,  500,  85000.00, 10.00, 1, 1, 1, 1, 1, 1),
                (3, 1, 1, 1, N'Pearl Terrace',       'PT-001',  300,  250,  45000.00, 10.00, 1, 1, 0, 0, 1, 1),
                (4, 2, 1, 1, N'Garden Arena',        'GA-001',  800,  700,  75000.00, 12.00, 0, 1, 1, 1, 1, 1),
                (5, 2, 1, 1, N'Conference Suite A',  'CSA-001',  80,   70,  18000.00,  0.00, 1, 1, 0, 0, 0, 1);
            SET IDENTITY_INSERT Halls OFF;
        END
    `);

    ok('Demo banquets and halls seeded.');

    // ── 9. Demo customers ────────────────────────────────────────────────────
    log('Seeding demo customers …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Customers WHERE customer_id = 1)
        BEGIN
            SET IDENTITY_INSERT Customers ON;
            INSERT INTO Customers
                (customer_id, company_id, branch_id, first_name, last_name,
                 email, phone, city, state, source, is_active)
            VALUES
                (1, 1, 1, N'Aditya',   N'Sharma',   'aditya.sharma@email.com',   '+91-9823456789', N'Mumbai',    N'Maharashtra', 'direct',   1),
                (2, 1, 1, N'Priya',    N'Mehta',    'priya.mehta@email.com',     '+91-9812345678', N'Pune',      N'Maharashtra', 'referral', 1),
                (3, 1, 1, N'Rahul',    N'Gupta',    'rahul.gupta@email.com',     '+91-9856781234', N'Mumbai',    N'Maharashtra', 'online',   1),
                (4, 1, 1, N'Sneha',    N'Patel',    'sneha.patel@email.com',     '+91-9845671234', N'Ahmedabad', N'Gujarat',     'direct',   1),
                (5, 1, 1, N'Vikram',   N'Singh',    'vikram.singh@email.com',    '+91-9867453210', N'Mumbai',    N'Maharashtra', 'online',   1),
                (6, 1, 1, N'Kavita',   N'Joshi',    'kavita.joshi@email.com',    '+91-9834567890', N'Nashik',    N'Maharashtra', 'direct',   1),
                (7, 1, 1, N'Manish',   N'Agarwal',  'manish.agarwal@email.com',  '+91-9876543100', N'Mumbai',    N'Maharashtra', 'referral', 1),
                (8, 1, 1, N'Anjali',   N'Nair',     'anjali.nair@email.com',     '+91-9812367890', N'Bengaluru', N'Karnataka',   'online',   1);
            SET IDENTITY_INSERT Customers OFF;
        END
    `);

    ok('Demo customers seeded.');

    // ── 10. Demo bookings ────────────────────────────────────────────────────
    log('Seeding demo bookings …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Bookings WHERE booking_id = 1)
        BEGIN
            SET IDENTITY_INSERT Bookings ON;
            INSERT INTO Bookings
                (booking_id, booking_ref, company_id, branch_id, hall_id, customer_id,
                 event_name, event_type, event_date, event_time_start, event_time_end,
                 guest_count, status, total_amount, advance_paid, amount_paid,
                 created_by, created_at)
            VALUES
                (1,  'BKG-2026-00001', 1, 1, 1, 1, N'Sharma-Mehta Wedding Reception', 'wedding',
                 '2026-08-15', '18:00:00', '23:00:00', 850, 'fully_paid',
                 175000.00, 87500.00, 175000.00, 2, GETDATE()),
                (2,  'BKG-2026-00002', 1, 1, 2, 2, N'Priya Birthday Celebration',    'birthday',
                 '2026-07-20', '19:00:00', '23:00:00', 200, 'confirmed',
                  95000.00, 47500.00, 47500.00, 2, GETDATE()),
                (3,  'BKG-2026-00003', 1, 1, 1, 3, N'Gupta Engagement Ceremony',     'engagement',
                 '2026-08-28', '10:00:00', '15:00:00', 300, 'advance_paid',
                 158500.00, 79250.00, 79250.00, 2, GETDATE()),
                (4,  'BKG-2026-00004', 1, 1, 3, 4, N'TechCorp Annual Meet',          'corporate',
                 '2026-07-25', '09:00:00', '18:00:00', 250, 'confirmed',
                  52000.00, 26000.00, 26000.00, 2, GETDATE()),
                (5,  'BKG-2026-00005', 1, 1, 4, 5, N'Singh-Kapoor Reception',        'reception',
                 '2026-09-05', '18:00:00', '23:00:00', 600, 'confirmed',
                  86000.00, 43000.00, 43000.00, 2, GETDATE()),
                (6,  'BKG-2026-00006', 1, 1, 2, 6, N'Joshi Anniversary Dinner',      'anniversary',
                 '2026-07-10', '20:00:00', '23:00:00', 120, 'completed',
                  97750.00, 97750.00, 97750.00, 2, GETDATE()),
                (7,  'BKG-2026-00007', 1, 1, 5, 7, N'Agarwal Investor Meet',         'conference',
                 '2026-07-18', '10:00:00', '17:00:00',  60, 'completed',
                  18000.00, 18000.00, 18000.00, 2, GETDATE()),
                (8,  'BKG-2026-00008', 1, 1, 1, 8, N'Nair Golden Jubilee',           'anniversary',
                 '2026-10-12', '18:00:00', '23:00:00', 500, 'draft',
                 165000.00, 0.00, 0.00, 2, GETDATE());
            SET IDENTITY_INSERT Bookings OFF;
        END
    `);

    ok('Demo bookings seeded.');

    // ── 11. Demo payments ────────────────────────────────────────────────────
    log('Seeding demo payments …');

    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Payments WHERE payment_id = 1)
        BEGIN
            SET IDENTITY_INSERT Payments ON;
            INSERT INTO Payments
                (payment_id, payment_ref, company_id, booking_id, customer_id,
                 payment_type, payment_method, amount, status, payment_date, created_by, created_at)
            VALUES
                (1,  'PAY-2026-00001', 1, 1, 1, 'advance', 'upi',           87500.00, 'completed', '2026-06-15', 2, GETDATE()),
                (2,  'PAY-2026-00002', 1, 1, 1, 'full',    'bank_transfer',  87500.00, 'completed', '2026-07-01', 2, GETDATE()),
                (3,  'PAY-2026-00003', 1, 2, 2, 'advance', 'cash',           47500.00, 'completed', '2026-06-20', 2, GETDATE()),
                (4,  'PAY-2026-00004', 1, 3, 3, 'advance', 'cheque',         79250.00, 'completed', '2026-06-25', 2, GETDATE()),
                (5,  'PAY-2026-00005', 1, 4, 4, 'advance', 'upi',            26000.00, 'completed', '2026-06-10', 2, GETDATE()),
                (6,  'PAY-2026-00006', 1, 5, 5, 'advance', 'bank_transfer',  43000.00, 'completed', '2026-06-30', 2, GETDATE()),
                (7,  'PAY-2026-00007', 1, 6, 6, 'full',    'upi',            97750.00, 'completed', '2026-07-05', 2, GETDATE()),
                (8,  'PAY-2026-00008', 1, 7, 7, 'full',    'cash',           18000.00, 'completed', '2026-07-15', 2, GETDATE());
            SET IDENTITY_INSERT Payments OFF;
        END
    `);

    ok('Demo payments seeded.');

    // ── 12. Catering packages ────────────────────────────────────────────────
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM CateringPackages WHERE package_id = 1)
        BEGIN
            SET IDENTITY_INSERT CateringPackages ON;
            INSERT INTO CateringPackages
                (package_id, company_id, package_name, package_type, price_per_plate, min_plates, is_active)
            VALUES
                (1, 1, N'Classic Veg Menu',    'veg',     750.00,  100, 1),
                (2, 1, N'Premium Veg Menu',    'veg',    1100.00,  100, 1),
                (3, 1, N'Non-Veg Standard',    'non_veg',  950.00,  100, 1),
                (4, 1, N'Non-Veg Premium',     'non_veg', 1400.00,  100, 1),
                (5, 1, N'Jain Special Menu',   'jain',     850.00,   50, 1),
                (6, 1, N'Fusion Buffet',       'mixed',   1250.00,  150, 1);
            SET IDENTITY_INSERT CateringPackages OFF;
        END
    `);

    // Resources
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM Resources WHERE resource_id = 1)
        BEGIN
            SET IDENTITY_INSERT Resources ON;
            INSERT INTO Resources
                (resource_id, company_id, resource_name, resource_type, unit_price, quantity_available, is_active)
            VALUES
                (1, 1, N'PA Sound System',   'audio',      5000.00, 5, 1),
                (2, 1, N'LED Video Wall',    'visual',    15000.00, 2, 1),
                (3, 1, N'Flower Decoration', 'decor',     25000.00, 10, 1),
                (4, 1, N'Generator 100KVA',  'power',      8000.00, 3, 1),
                (5, 1, N'Tables (Round)',    'furniture',   200.00, 200, 1),
                (6, 1, N'Chairs (Banquet)',  'furniture',    50.00, 2000, 1),
                (7, 1, N'Projector + Screen','visual',     3500.00, 5, 1),
                (8, 1, N'Photo Booth',       'entertainment',8000.00, 2, 1);
            SET IDENTITY_INSERT Resources OFF;
        END
    `);

    // Company Settings
    await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM CompanySettings WHERE company_id = 1 AND setting_key = 'currency')
        INSERT INTO CompanySettings (company_id, setting_key, setting_value, setting_group)
        VALUES
            (1, 'currency',         'INR',              'general'),
            (1, 'timezone',         'Asia/Kolkata',     'general'),
            (1, 'date_format',      'DD/MM/YYYY',       'general'),
            (1, 'advance_pct',      '50',               'booking'),
            (1, 'cancellation_hrs', '72',               'booking'),
            (1, 'gst_rate',         '18',               'tax'),
            (1, 'invoice_prefix',   'INV',              'invoice'),
            (1, 'booking_prefix',   'BKG',              'booking');
    `);

    ok('Demo data seeded (catering, resources, settings).');

    // ── Done ─────────────────────────────────────────────────────────────────
    await pool.close();

    console.log('\n=============================================================');
    console.log('  Setup Complete!');
    console.log('=============================================================');
    console.log('');
    console.log('  Database : banquet_booking');
    console.log(`  Host     : ${dbConfig.server}:${dbConfig.port}`);
    console.log('');
    console.log('  Super Admin Account');
    console.log(`  Email    : ${SUPER_ADMIN_EMAIL}`);
    console.log(`  Password : ${SUPER_ADMIN_PASSWORD}`);
    console.log('');
    console.log('  Company Admin Account');
    console.log(`  Email    : ${COMPANY_ADMIN_EMAIL}`);
    console.log(`  Password : ${COMPANY_ADMIN_PASSWORD}`);
    console.log('');
    console.log('  Start Backend  :  cd backend && node server.js');
    console.log('  Frontend       :  Open frontend/src/pages/auth/login.html');
    console.log('  API Health     :  http://localhost:3000/api/v1/health');
    console.log('');

})().catch((err) => {
    console.error('\n[FATAL]', err.message);
    process.exit(1);
});
