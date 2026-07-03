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

const mysql  = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path   = require('path');
const fs     = require('fs');

const DB_NAME = process.env.DB_NAME || 'banquet_booking';
const RESET   = process.argv.includes('--reset');

const connConfig = {
    host:             process.env.DB_HOST     || 'localhost',
    port:             parseInt(process.env.DB_PORT, 10) || 3306,
    user:             process.env.DB_USER     || 'root',
    password:         process.env.DB_PASSWORD || 'eglobe',
    multipleStatements: true,
    timezone:         '+00:00',
};

// ─── Logging ──────────────────────────────────────────────────────────────────
const log  = (msg)  => console.log(`  [INFO]  ${msg}`);
const ok   = (msg)  => console.log(`  [OK]    ${msg}`);
const warn = (msg)  => console.log(`  [WARN]  ${msg}`);
const fail = (msg)  => { console.error(`  [ERROR] ${msg}`); process.exit(1); };

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    console.log('\n=============================================================');
    console.log('  BanquetPro — Database Setup');
    console.log('=============================================================\n');

    let conn;
    try {
        conn = await mysql.createConnection(connConfig);
        log(`Connected to MySQL at ${connConfig.host}:${connConfig.port}`);
    } catch (err) {
        fail(`Cannot connect to MySQL: ${err.message}\n  Check .env credentials (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD).`);
    }

    // ── 1. Create / reset database ───────────────────────────────────────────
    if (RESET) {
        warn(`--reset flag detected. Dropping database "${DB_NAME}" …`);
        await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
        ok(`Database "${DB_NAME}" dropped.`);
    }

    await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
         DEFAULT CHARACTER SET utf8mb4
         DEFAULT COLLATE utf8mb4_unicode_ci`
    );
    ok(`Database "${DB_NAME}" ready.`);

    await conn.query(`USE \`${DB_NAME}\``);

    // ── 2. Import schema ─────────────────────────────────────────────────────
    const schemaPath = path.resolve(__dirname, '../../database/migrations/001_create_schema.sql');
    if (fs.existsSync(schemaPath)) {
        log('Importing schema …');
        let schemaSql = fs.readFileSync(schemaPath, 'utf8');
        // Remove the CREATE DATABASE / USE directives — we already selected the DB
        schemaSql = schemaSql
            .replace(/CREATE\s+DATABASE[^;]+;/gi, '')
            .replace(/USE\s+\w+\s*;/gi, '');
        await conn.query(schemaSql);
        ok('Schema imported.');
    } else {
        warn(`Schema file not found at ${schemaPath} — skipping.`);
    }

    // ── 3. Add Resources table (if not in main schema) ───────────────────────
    await conn.query(`
        CREATE TABLE IF NOT EXISTS Resources (
            resource_id         INT             NOT NULL AUTO_INCREMENT,
            company_id          INT             NOT NULL,
            branch_id           INT             NULL,
            resource_name       VARCHAR(200)    NOT NULL,
            resource_type       VARCHAR(100)    NULL,
            unit_price          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
            quantity_available  INT             NOT NULL DEFAULT 0,
            is_active           TINYINT(1)      NOT NULL DEFAULT 1,
            created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT PK_resources PRIMARY KEY (resource_id),
            CONSTRAINT FK_resources_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    ok('Resources table ensured.');

    // ── 4. Seed reference / lookup data ─────────────────────────────────────
    log('Seeding reference data …');

    // Countries
    await conn.query(`
        INSERT IGNORE INTO Countries (country_id, country_name, country_code, phone_code, currency_code, currency_symbol)
        VALUES
            (1, 'India', 'IN', '+91', 'INR', '₹'),
            (2, 'United States', 'US', '+1', 'USD', '$'),
            (3, 'United Arab Emirates', 'AE', '+971', 'AED', 'د.إ')
    `);

    // States
    await conn.query(`
        INSERT IGNORE INTO States (state_id, country_id, state_name, state_code) VALUES
            (1, 1, 'Maharashtra', 'MH'),
            (2, 1, 'Delhi', 'DL'),
            (3, 1, 'Karnataka', 'KA'),
            (4, 1, 'Tamil Nadu', 'TN'),
            (5, 1, 'Gujarat', 'GJ'),
            (6, 1, 'Rajasthan', 'RJ'),
            (7, 1, 'Uttar Pradesh', 'UP'),
            (8, 1, 'Telangana', 'TS')
    `);

    // Cities
    await conn.query(`
        INSERT IGNORE INTO Cities (city_id, state_id, city_name) VALUES
            (1,  1, 'Mumbai'),  (2,  1, 'Pune'),      (3,  1, 'Nagpur'),
            (4,  2, 'New Delhi'),(5,  2, 'Noida'),    (6,  2, 'Gurugram'),
            (7,  3, 'Bengaluru'),(8,  3, 'Mysuru'),
            (9,  4, 'Chennai'), (10, 4, 'Coimbatore'),
            (11, 5, 'Ahmedabad'),(12, 5, 'Surat'),
            (13, 6, 'Jaipur'),  (14, 6, 'Udaipur'),
            (15, 7, 'Lucknow'), (16, 7, 'Agra'),
            (17, 8, 'Hyderabad'),(18, 8, 'Warangal')
    `);

    // Roles
    await conn.query(`
        INSERT IGNORE INTO Roles (role_id, role_name, role_slug, description, is_system) VALUES
            (1, 'Super Admin',       'super_admin',       'Full platform control. Manages all companies and tenants.', 1),
            (2, 'Company Admin',     'company_admin',     'Manages a single company: branches, banquets, staff, reports.', 1),
            (3, 'Branch Manager',    'branch_manager',    'Manages daily operations of a specific branch.', 1),
            (4, 'Booking Executive', 'booking_executive', 'Creates and manages bookings, customers, invoices.', 1),
            (5, 'Customer',          'customer',          'End-user who searches, books, and manages their bookings.', 1)
    `);

    // Permissions
    await conn.query(`
        INSERT IGNORE INTO Permissions (module, action, permission_key, description) VALUES
            ('dashboard',    'read',   'dashboard:read',    'View dashboard and KPIs'),
            ('companies',    'create', 'companies:create',  'Create new company'),
            ('companies',    'read',   'companies:read',    'View companies'),
            ('companies',    'update', 'companies:update',  'Update company details'),
            ('companies',    'delete', 'companies:delete',  'Delete company'),
            ('branches',     'create', 'branches:create',   'Create branch'),
            ('branches',     'read',   'branches:read',     'View branches'),
            ('branches',     'update', 'branches:update',   'Update branch'),
            ('branches',     'delete', 'branches:delete',   'Delete branch'),
            ('banquets',     'create', 'banquets:create',   'Create banquet hall'),
            ('banquets',     'read',   'banquets:read',     'View banquet halls'),
            ('banquets',     'update', 'banquets:update',   'Update banquet details'),
            ('banquets',     'delete', 'banquets:delete',   'Delete banquet'),
            ('halls',        'create', 'halls:create',      'Create hall'),
            ('halls',        'read',   'halls:read',        'View halls'),
            ('halls',        'update', 'halls:update',      'Update hall'),
            ('halls',        'delete', 'halls:delete',      'Delete hall'),
            ('bookings',     'create', 'bookings:create',   'Create new booking'),
            ('bookings',     'read',   'bookings:read',     'View bookings'),
            ('bookings',     'update', 'bookings:update',   'Modify booking'),
            ('bookings',     'cancel', 'bookings:cancel',   'Cancel booking'),
            ('bookings',     'confirm','bookings:confirm',  'Confirm booking'),
            ('customers',    'create', 'customers:create',  'Add customer'),
            ('customers',    'read',   'customers:read',    'View customers'),
            ('customers',    'update', 'customers:update',  'Edit customer'),
            ('customers',    'delete', 'customers:delete',  'Delete customer'),
            ('payments',     'create', 'payments:create',   'Record payment'),
            ('payments',     'read',   'payments:read',     'View payments'),
            ('payments',     'refund', 'payments:refund',   'Process refund'),
            ('invoices',     'create', 'invoices:create',   'Generate invoice'),
            ('invoices',     'read',   'invoices:read',     'View invoices'),
            ('invoices',     'send',   'invoices:send',     'Email invoice to customer'),
            ('reports',      'read',   'reports:read',      'View reports'),
            ('reports',      'export', 'reports:export',    'Export reports (PDF/Excel)'),
            ('pricing',      'create', 'pricing:create',    'Create pricing rules'),
            ('pricing',      'read',   'pricing:read',      'View pricing'),
            ('pricing',      'update', 'pricing:update',    'Update pricing'),
            ('users',        'create', 'users:create',      'Add user'),
            ('users',        'read',   'users:read',        'View users'),
            ('users',        'update', 'users:update',      'Edit user'),
            ('users',        'delete', 'users:delete',      'Deactivate user'),
            ('settings',     'read',   'settings:read',     'View settings'),
            ('settings',     'update', 'settings:update',   'Update settings'),
            ('audit_logs',   'read',   'audit_logs:read',   'View audit trail'),
            ('coupons',      'create', 'coupons:create',    'Create coupons'),
            ('coupons',      'read',   'coupons:read',      'View coupons'),
            ('coupons',      'update', 'coupons:update',    'Edit coupons'),
            ('availability', 'manage', 'availability:manage','Block/unblock dates'),
            ('availability', 'read',   'availability:read', 'View availability calendar'),
            ('resources',    'create', 'resources:create',  'Add resource/inventory'),
            ('resources',    'read',   'resources:read',    'View resources'),
            ('resources',    'update', 'resources:update',  'Update resources')
    `);

    // Role → Permission mappings
    // Super Admin: ALL permissions
    await conn.query(`
        INSERT IGNORE INTO RolePermissions (role_id, permission_id)
        SELECT 1, permission_id FROM Permissions
    `);

    // Company Admin: most permissions
    await conn.query(`
        INSERT IGNORE INTO RolePermissions (role_id, permission_id)
        SELECT 2, permission_id FROM Permissions
        WHERE permission_key NOT IN ('companies:create','companies:delete','audit_logs:read')
    `);

    // Branch Manager
    await conn.query(`
        INSERT IGNORE INTO RolePermissions (role_id, permission_id)
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
        )
    `);

    // Booking Executive
    await conn.query(`
        INSERT IGNORE INTO RolePermissions (role_id, permission_id)
        SELECT 4, permission_id FROM Permissions
        WHERE permission_key IN (
            'dashboard:read','banquets:read','halls:read',
            'bookings:create','bookings:read','bookings:update','bookings:cancel',
            'customers:create','customers:read','customers:update',
            'payments:create','payments:read',
            'invoices:create','invoices:read','invoices:send',
            'availability:read','coupons:read'
        )
    `);

    // Event types
    await conn.query(`
        INSERT IGNORE INTO EventTypes (event_type_id, type_name, type_slug, sort_order) VALUES
            (1,  'Wedding',         'wedding',         1),
            (2,  'Reception',       'reception',       2),
            (3,  'Birthday Party',  'birthday',        3),
            (4,  'Corporate Event', 'corporate',       4),
            (5,  'Conference',      'conference',      5),
            (6,  'Anniversary',     'anniversary',     6),
            (7,  'Engagement',      'engagement',      7),
            (8,  'Baby Shower',     'baby_shower',     8),
            (9,  'Religious Event', 'religious',       9),
            (10, 'Private Party',   'private_party',   10)
    `);

    // Amenity types
    await conn.query(`
        INSERT IGNORE INTO AmenityTypes (amenity_type_id, amenity_name, category, is_active) VALUES
            (1,  'Air Conditioning',   'comfort',     1),
            (2,  'Power Backup',       'utilities',   1),
            (3,  'Parking',            'facilities',  1),
            (4,  'Catering Kitchen',   'catering',    1),
            (5,  'Stage',              'events',      1),
            (6,  'Bridal Room',        'rooms',       1),
            (7,  'Green Room',         'rooms',       1),
            (8,  'Valet Parking',      'facilities',  1),
            (9,  'WiFi',               'utilities',   1),
            (10, 'Audio/Visual System','events',      1)
    `);

    ok('Reference data seeded.');

    // ── 5. Demo company + branch ─────────────────────────────────────────────
    log('Seeding demo company & branch …');

    await conn.query(`
        INSERT IGNORE INTO Companies
            (company_id, company_name, company_slug, email, phone, address_line1,
             country_id, currency_code, timezone, is_active, is_verified, subscription_plan)
        VALUES
            (1, 'BanquetPro Demo', 'banquetpro-demo',
             'admin@banquetpro.com', '+91-9876543210',
             '101, Corporate Tower, Bandra Kurla Complex',
             1, 'INR', 'Asia/Kolkata', 1, 1, 'enterprise')
    `);

    await conn.query(`
        INSERT IGNORE INTO Branches
            (branch_id, company_id, branch_name, branch_code, address_line1, is_main_branch, is_active)
        VALUES
            (1, 1, 'Mumbai Head Office', 'MUM-HQ', '101, Corporate Tower, BKC, Mumbai', 1, 1)
    `);

    ok('Demo company and branch created.');

    // ── 6. Super Admin user ──────────────────────────────────────────────────
    log('Creating Super Admin account …');
    const SUPER_ADMIN_EMAIL    = 'superadmin@banquetpro.com';
    const SUPER_ADMIN_PASSWORD = 'Admin@123456';
    const SALT_ROUNDS = 12;

    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);

    await conn.query(`
        INSERT IGNORE INTO Users
            (user_id, company_id, branch_id, role_id,
             first_name, last_name, email,
             password_hash, is_active, is_email_verified, created_at, updated_at)
        VALUES
            (1, NULL, NULL, 1,
             'Super', 'Admin', ?,
             ?, 1, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    `, [SUPER_ADMIN_EMAIL, passwordHash]);

    ok('Super Admin account created.');

    // ── 7. Company Admin user ────────────────────────────────────────────────
    log('Creating Company Admin account …');
    const COMPANY_ADMIN_EMAIL    = 'admin@banquetpro.com';
    const COMPANY_ADMIN_PASSWORD = 'Manager@123';
    const caHash = await bcrypt.hash(COMPANY_ADMIN_PASSWORD, SALT_ROUNDS);

    await conn.query(`
        INSERT IGNORE INTO Users
            (user_id, company_id, branch_id, role_id,
             first_name, last_name, email,
             password_hash, is_active, is_email_verified, created_at, updated_at)
        VALUES
            (2, 1, 1, 2,
             'Rajesh', 'Kumar', ?,
             ?, 1, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    `, [COMPANY_ADMIN_EMAIL, caHash]);

    ok('Company Admin account created.');

    // ── 8. Demo banquet + halls ──────────────────────────────────────────────
    log('Seeding demo banquet and halls …');

    await conn.query(`
        INSERT IGNORE INTO Banquets
            (banquet_id, company_id, branch_id, banquet_name, banquet_slug,
             address_line1, city, state, phone, email,
             total_capacity, parking_capacity, has_valet, is_active, is_featured)
        VALUES
            (1, 1, 1, 'The Grand Pavilion', 'the-grand-pavilion',
             'Plot 42, Linking Road, Bandra West', 'Mumbai', 'Maharashtra',
             '+91-22-66001234', 'info@grandpavilion.com',
             2500, 300, 1, 1, 1),
            (2, 1, 1, 'Royal Garden Banquet', 'royal-garden-banquet',
             'Sector 17, Vashi, Navi Mumbai', 'Mumbai', 'Maharashtra',
             '+91-22-77001234', 'info@royalgarden.com',
             1200, 150, 0, 1, 0)
    `);

    await conn.query(`
        INSERT IGNORE INTO Halls
            (hall_id, banquet_id, company_id, branch_id,
             hall_name, hall_code, capacity, capacity_seated, base_price,
             weekend_surcharge_pct, has_ac, has_power_backup, has_stage,
             has_kitchen, has_parking, is_active)
        VALUES
            (1, 1, 1, 1, 'Crystal Ballroom',   'CB-001', 1200, 1000, 150000.00, 15.00, 1, 1, 1, 1, 1, 1),
            (2, 1, 1, 1, 'Diamond Hall',        'DH-001',  600,  500,  85000.00, 10.00, 1, 1, 1, 1, 1, 1),
            (3, 1, 1, 1, 'Pearl Terrace',       'PT-001',  300,  250,  45000.00, 10.00, 1, 1, 0, 0, 1, 1),
            (4, 2, 1, 1, 'Garden Arena',        'GA-001',  800,  700,  75000.00, 12.00, 0, 1, 1, 1, 1, 1),
            (5, 2, 1, 1, 'Conference Suite A',  'CSA-001',  80,   70,  18000.00,  0.00, 1, 1, 0, 0, 0, 1)
    `);

    ok('Demo banquets and halls seeded.');

    // ── 9. Demo customers ────────────────────────────────────────────────────
    log('Seeding demo customers …');

    await conn.query(`
        INSERT IGNORE INTO Customers
            (customer_id, company_id, branch_id, first_name, last_name,
             email, phone, city, state, source, is_active)
        VALUES
            (1, 1, 1, 'Aditya',   'Sharma',   'aditya.sharma@email.com',   '+91-9823456789', 'Mumbai',    'Maharashtra', 'direct',   1),
            (2, 1, 1, 'Priya',    'Mehta',    'priya.mehta@email.com',     '+91-9812345678', 'Pune',      'Maharashtra', 'referral', 1),
            (3, 1, 1, 'Rahul',    'Gupta',    'rahul.gupta@email.com',     '+91-9856781234', 'Mumbai',    'Maharashtra', 'online',   1),
            (4, 1, 1, 'Sneha',    'Patel',    'sneha.patel@email.com',     '+91-9845671234', 'Ahmedabad', 'Gujarat',     'direct',   1),
            (5, 1, 1, 'Vikram',   'Singh',    'vikram.singh@email.com',    '+91-9867453210', 'Mumbai',    'Maharashtra', 'online',   1),
            (6, 1, 1, 'Kavita',   'Joshi',    'kavita.joshi@email.com',    '+91-9834567890', 'Nashik',    'Maharashtra', 'direct',   1),
            (7, 1, 1, 'Manish',   'Agarwal',  'manish.agarwal@email.com',  '+91-9876543100', 'Mumbai',    'Maharashtra', 'referral', 1),
            (8, 1, 1, 'Anjali',   'Nair',     'anjali.nair@email.com',     '+91-9812367890', 'Bengaluru', 'Karnataka',   'online',   1)
    `);

    ok('Demo customers seeded.');

    // ── 10. Demo bookings ────────────────────────────────────────────────────
    log('Seeding demo bookings …');

    await conn.query(`
        INSERT IGNORE INTO Bookings
            (booking_id, booking_ref, company_id, branch_id, hall_id, customer_id,
             event_name, event_type, event_date, event_time_start, event_time_end,
             guest_count, status, total_amount, advance_paid, amount_paid,
             created_by, created_at)
        VALUES
            (1,  'BKG-2026-00001', 1, 1, 1, 1, 'Sharma-Mehta Wedding Reception', 'wedding',
             '2026-08-15', '18:00:00', '23:00:00', 850, 'fully_paid',
             175000.00, 87500.00, 175000.00, 2, NOW()),
            (2,  'BKG-2026-00002', 1, 1, 2, 2, 'Priya Birthday Celebration',    'birthday',
             '2026-07-20', '19:00:00', '23:00:00', 200, 'confirmed',
              95000.00, 47500.00, 47500.00, 2, NOW()),
            (3,  'BKG-2026-00003', 1, 1, 1, 3, 'Gupta Engagement Ceremony',     'engagement',
             '2026-08-28', '10:00:00', '15:00:00', 300, 'advance_paid',
             158500.00, 79250.00, 79250.00, 2, NOW()),
            (4,  'BKG-2026-00004', 1, 1, 3, 4, 'TechCorp Annual Meet',          'corporate',
             '2026-07-25', '09:00:00', '18:00:00', 250, 'confirmed',
              52000.00, 26000.00, 26000.00, 2, NOW()),
            (5,  'BKG-2026-00005', 1, 1, 4, 5, 'Singh-Kapoor Reception',        'reception',
             '2026-09-05', '18:00:00', '23:00:00', 600, 'confirmed',
              86000.00, 43000.00, 43000.00, 2, NOW()),
            (6,  'BKG-2026-00006', 1, 1, 2, 6, 'Joshi Anniversary Dinner',      'anniversary',
             '2026-07-10', '20:00:00', '23:00:00', 120, 'completed',
              97750.00, 97750.00, 97750.00, 2, NOW()),
            (7,  'BKG-2026-00007', 1, 1, 5, 7, 'Agarwal Investor Meet',         'conference',
             '2026-07-18', '10:00:00', '17:00:00',  60, 'completed',
              18000.00, 18000.00, 18000.00, 2, NOW()),
            (8,  'BKG-2026-00008', 1, 1, 1, 8, 'Nair Golden Jubilee',           'anniversary',
             '2026-10-12', '18:00:00', '23:00:00', 500, 'draft',
             165000.00, 0.00, 0.00, 2, NOW())
    `);

    ok('Demo bookings seeded.');

    // ── 11. Demo payments ────────────────────────────────────────────────────
    log('Seeding demo payments …');

    await conn.query(`
        INSERT IGNORE INTO Payments
            (payment_id, payment_ref, company_id, booking_id, customer_id,
             payment_type, payment_method, amount, status, payment_date, created_by, created_at)
        VALUES
            (1,  'PAY-2026-00001', 1, 1, 1, 'advance', 'upi',           87500.00, 'completed', '2026-06-15', 2, NOW()),
            (2,  'PAY-2026-00002', 1, 1, 1, 'full',    'bank_transfer',  87500.00, 'completed', '2026-07-01', 2, NOW()),
            (3,  'PAY-2026-00003', 1, 2, 2, 'advance', 'cash',           47500.00, 'completed', '2026-06-20', 2, NOW()),
            (4,  'PAY-2026-00004', 1, 3, 3, 'advance', 'cheque',         79250.00, 'completed', '2026-06-25', 2, NOW()),
            (5,  'PAY-2026-00005', 1, 4, 4, 'advance', 'upi',            26000.00, 'completed', '2026-06-10', 2, NOW()),
            (6,  'PAY-2026-00006', 1, 5, 5, 'advance', 'bank_transfer',  43000.00, 'completed', '2026-06-30', 2, NOW()),
            (7,  'PAY-2026-00007', 1, 6, 6, 'full',    'upi',            97750.00, 'completed', '2026-07-05', 2, NOW()),
            (8,  'PAY-2026-00008', 1, 7, 7, 'full',    'cash',           18000.00, 'completed', '2026-07-15', 2, NOW())
    `);

    ok('Demo payments seeded.');

    // ── 12. Catering packages ────────────────────────────────────────────────
    await conn.query(`
        INSERT IGNORE INTO CateringPackages
            (package_id, company_id, package_name, package_type, price_per_plate, min_plates, is_active)
        VALUES
            (1, 1, 'Classic Veg Menu',    'veg',     750.00,  100, 1),
            (2, 1, 'Premium Veg Menu',    'veg',    1100.00,  100, 1),
            (3, 1, 'Non-Veg Standard',    'non_veg',  950.00,  100, 1),
            (4, 1, 'Non-Veg Premium',     'non_veg', 1400.00,  100, 1),
            (5, 1, 'Jain Special Menu',   'jain',     850.00,   50, 1),
            (6, 1, 'Fusion Buffet',       'mixed',   1250.00,  150, 1)
    `);

    // Resources
    await conn.query(`
        INSERT IGNORE INTO Resources
            (resource_id, company_id, resource_name, resource_type, unit_price, quantity_available, is_active)
        VALUES
            (1, 1, 'PA Sound System',   'audio',      5000.00, 5, 1),
            (2, 1, 'LED Video Wall',    'visual',    15000.00, 2, 1),
            (3, 1, 'Flower Decoration', 'decor',     25000.00, 10, 1),
            (4, 1, 'Generator 100KVA',  'power',      8000.00, 3, 1),
            (5, 1, 'Tables (Round)',    'furniture',   200.00, 200, 1),
            (6, 1, 'Chairs (Banquet)',  'furniture',    50.00, 2000, 1),
            (7, 1, 'Projector + Screen','visual',     3500.00, 5, 1),
            (8, 1, 'Photo Booth',       'entertainment',8000.00, 2, 1)
    `);

    // Company Settings
    await conn.query(`
        INSERT IGNORE INTO CompanySettings (company_id, setting_key, setting_value, setting_group)
        VALUES
            (1, 'currency',         'INR',              'general'),
            (1, 'timezone',         'Asia/Kolkata',     'general'),
            (1, 'date_format',      'DD/MM/YYYY',       'general'),
            (1, 'advance_pct',      '50',               'booking'),
            (1, 'cancellation_hrs', '72',               'booking'),
            (1, 'gst_rate',         '18',               'tax'),
            (1, 'invoice_prefix',   'INV',              'invoice'),
            (1, 'booking_prefix',   'BKG',              'booking')
    `);

    ok('Demo data seeded (catering, resources, settings).');

    // ── Done ─────────────────────────────────────────────────────────────────
    await conn.end();

    console.log('\n=============================================================');
    console.log('  Setup Complete!');
    console.log('=============================================================');
    console.log('');
    console.log('  Database : banquet_booking');
    console.log('  Host     : localhost:3306');
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
    console.log('  Frontend       :  Open frontend/pages/auth/login.html');
    console.log('  API Health     :  http://localhost:3000/api/v1/health');
    console.log('');

})().catch((err) => {
    console.error('\n[FATAL]', err.message);
    process.exit(1);
});
