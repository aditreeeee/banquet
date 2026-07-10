-- =============================================================================
-- SEED DATA — Banquet Hall Booking System
-- Run AFTER all migrations
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- SEED: Countries, States, Cities
-- =============================================================================
INSERT INTO countries (country_name, country_code, phone_code, currency_code, currency_symbol)
VALUES
    ('India', 'IN', '+91', 'INR', '₹'),
    ('United States', 'US', '+1', 'USD', '$'),
    ('United Arab Emirates', 'AE', '+971', 'AED', 'د.إ');
GO

INSERT INTO states (country_id, state_name, state_code)
VALUES
    (1, 'Maharashtra', 'MH'),
    (1, 'Delhi', 'DL'),
    (1, 'Karnataka', 'KA'),
    (1, 'Tamil Nadu', 'TN'),
    (1, 'Gujarat', 'GJ'),
    (1, 'Rajasthan', 'RJ'),
    (1, 'Uttar Pradesh', 'UP'),
    (1, 'Telangana', 'TS');
GO

INSERT INTO cities (state_id, city_name)
VALUES
    (1, 'Mumbai'), (1, 'Pune'), (1, 'Nagpur'), (1, 'Nashik'),
    (2, 'New Delhi'), (2, 'Noida'), (2, 'Gurugram'),
    (3, 'Bengaluru'), (3, 'Mysuru'),
    (4, 'Chennai'), (4, 'Coimbatore'),
    (5, 'Ahmedabad'), (5, 'Surat'),
    (6, 'Jaipur'), (6, 'Udaipur'),
    (7, 'Lucknow'), (7, 'Agra'),
    (8, 'Hyderabad'), (8, 'Warangal');
GO

-- =============================================================================
-- SEED: Roles
-- =============================================================================
INSERT INTO roles (role_name, role_slug, description, is_system)
VALUES
    ('Super Admin',       'super_admin',      'Full platform control. Manages all companies and tenants.', 1),
    ('Company Admin',     'company_admin',    'Manages a single company: branches, banquets, staff, reports.', 1),
    ('Branch Manager',    'branch_manager',   'Manages daily operations of a specific branch.', 1),
    ('Booking Executive', 'booking_executive','Creates and manages bookings, customers, invoices.', 1),
    ('Customer',          'customer',         'End-user who searches, books, and manages their bookings.', 1),
    ('Business Owner',      'business_owner',      'Owns the company: bookings, halls, customers, inventory, staff, analytics, reports.', 1),
    ('Operations Manager',  'operations_manager',  'Manages daily operations: bookings, scheduling, occupancy, event planning.', 1),
    ('Sales Manager',       'sales_manager',       'Manages inquiries, quotations, follow-ups, promotional campaigns, customers.', 1),
    ('Finance Manager',     'finance_manager',     'Manages invoices, payments, refunds, taxes, deposits.', 1),
    ('Staff',               'staff',               'Read-only operational dashboard, assigned events only.', 1),
    ('Receptionist',        'receptionist',        'Creates inquiries/bookings, edits customer details. Cannot delete bookings.', 1);
GO

-- =============================================================================
-- SEED: Permissions
-- =============================================================================
INSERT INTO permissions (module, action, permission_key, description)
VALUES
-- Dashboard
('dashboard', 'read', 'dashboard:read', 'View dashboard and KPIs'),
-- Companies
('companies', 'create', 'companies:create', 'Create new company'),
('companies', 'read',   'companies:read',   'View companies'),
('companies', 'update', 'companies:update', 'Update company details'),
('companies', 'delete', 'companies:delete', 'Delete company'),
-- Branches
('branches', 'create', 'branches:create', 'Create branch'),
('branches', 'read',   'branches:read',   'View branches'),
('branches', 'update', 'branches:update', 'Update branch'),
('branches', 'delete', 'branches:delete', 'Delete branch'),
-- Banquets
('banquets', 'create', 'banquets:create', 'Create banquet hall'),
('banquets', 'read',   'banquets:read',   'View banquet halls'),
('banquets', 'update', 'banquets:update', 'Update banquet details'),
('banquets', 'delete', 'banquets:delete', 'Delete banquet'),
-- Halls
('halls', 'create', 'halls:create', 'Create hall'),
('halls', 'read',   'halls:read',   'View halls'),
('halls', 'update', 'halls:update', 'Update hall'),
('halls', 'delete', 'halls:delete', 'Delete hall'),
-- Bookings
('bookings', 'create',   'bookings:create',   'Create new booking'),
('bookings', 'read',     'bookings:read',     'View bookings'),
('bookings', 'update',   'bookings:update',   'Modify booking'),
('bookings', 'cancel',   'bookings:cancel',   'Cancel booking'),
('bookings', 'confirm',  'bookings:confirm',  'Confirm booking'),
-- Customers
('customers', 'create', 'customers:create', 'Add customer'),
('customers', 'read',   'customers:read',   'View customers'),
('customers', 'update', 'customers:update', 'Edit customer'),
('customers', 'delete', 'customers:delete', 'Delete customer'),
-- Payments
('payments', 'create',  'payments:create',  'Record payment'),
('payments', 'read',    'payments:read',    'View payments'),
('payments', 'refund',  'payments:refund',  'Process refund'),
-- Invoices
('invoices', 'create',  'invoices:create',  'Generate invoice'),
('invoices', 'read',    'invoices:read',    'View invoices'),
('invoices', 'send',    'invoices:send',    'Email invoice to customer'),
-- Reports
('reports', 'read',    'reports:read',    'View reports'),
('reports', 'export',  'reports:export',  'Export reports (PDF/Excel)'),
-- Pricing
('pricing', 'create',  'pricing:create',  'Create pricing rules'),
('pricing', 'read',    'pricing:read',    'View pricing'),
('pricing', 'update',  'pricing:update',  'Update pricing'),
-- Users
('users', 'create',  'users:create',  'Add user'),
('users', 'read',    'users:read',    'View users'),
('users', 'update',  'users:update',  'Edit user'),
('users', 'delete',  'users:delete',  'Deactivate user'),
-- Settings
('settings', 'read',   'settings:read',   'View settings'),
('settings', 'update', 'settings:update', 'Update settings'),
-- Audit Logs
('audit_logs', 'read', 'audit_logs:read', 'View audit trail'),
-- Coupons
('coupons', 'create', 'coupons:create', 'Create coupons'),
('coupons', 'read',   'coupons:read',   'View coupons'),
('coupons', 'update', 'coupons:update', 'Edit coupons'),
-- Availability
('availability', 'manage', 'availability:manage', 'Block/unblock dates'),
('availability', 'read',   'availability:read',   'View availability calendar'),
-- Resources
('resources', 'create', 'resources:create', 'Add resource/inventory'),
('resources', 'read',   'resources:read',   'View resources'),
('resources', 'update', 'resources:update', 'Update resources');
GO

-- =============================================================================
-- SEED: Role Permissions Mapping
-- =============================================================================

-- Super Admin: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, permission_id FROM permissions;
GO

-- Company Admin: Most permissions except system-level
INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, permission_id FROM permissions
WHERE permission_key NOT IN (
    'companies:create', 'companies:delete', 'audit_logs:read'
);
GO

-- Branch Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT 3, permission_id FROM permissions
WHERE permission_key IN (
    'dashboard:read',
    'banquets:read', 'halls:read',
    'bookings:create', 'bookings:read', 'bookings:update', 'bookings:cancel', 'bookings:confirm',
    'customers:create', 'customers:read', 'customers:update',
    'payments:create', 'payments:read',
    'invoices:create', 'invoices:read', 'invoices:send',
    'reports:read', 'reports:export',
    'pricing:read',
    'availability:manage', 'availability:read',
    'resources:create', 'resources:read', 'resources:update',
    'settings:read'
);
GO

-- Booking Executive
INSERT INTO role_permissions (role_id, permission_id)
SELECT 4, permission_id FROM permissions
WHERE permission_key IN (
    'dashboard:read',
    'banquets:read', 'halls:read',
    'bookings:create', 'bookings:read', 'bookings:update', 'bookings:cancel',
    'customers:create', 'customers:read', 'customers:update',
    'payments:create', 'payments:read',
    'invoices:create', 'invoices:read', 'invoices:send',
    'availability:read',
    'coupons:read'
);
GO

-- Customer: Only their own data (enforced at API level)
INSERT INTO role_permissions (role_id, permission_id)
SELECT 5, permission_id FROM permissions
WHERE permission_key IN (
    'banquets:read', 'halls:read',
    'bookings:create', 'bookings:read', 'bookings:cancel',
    'invoices:read',
    'payments:read',
    'availability:read'
);
GO

-- Business Owner: everything except platform-level admin actions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 6, permission_id FROM permissions
WHERE permission_key NOT IN ('companies:create', 'companies:delete', 'audit_logs:read');
GO

-- Operations Manager: daily ops — bookings, scheduling, occupancy, resources
INSERT INTO role_permissions (role_id, permission_id)
SELECT 7, permission_id FROM permissions
WHERE permission_key IN (
    'dashboard:read', 'banquets:read', 'halls:read',
    'bookings:create', 'bookings:read', 'bookings:update', 'bookings:cancel', 'bookings:confirm',
    'customers:read', 'customers:update',
    'availability:manage', 'availability:read',
    'resources:create', 'resources:read', 'resources:update',
    'reports:read'
);
GO

-- Sales Manager: inquiries, quotations, follow-ups, campaigns, customers
INSERT INTO role_permissions (role_id, permission_id)
SELECT 8, permission_id FROM permissions
WHERE permission_key IN (
    'dashboard:read', 'banquets:read', 'halls:read',
    'bookings:create', 'bookings:read', 'bookings:update',
    'customers:create', 'customers:read', 'customers:update',
    'coupons:create', 'coupons:read', 'coupons:update',
    'availability:read', 'reports:read'
);
GO

-- Finance Manager: invoices, payments, refunds, taxes, deposits
INSERT INTO role_permissions (role_id, permission_id)
SELECT 9, permission_id FROM permissions
WHERE permission_key IN (
    'dashboard:read', 'bookings:read',
    'payments:create', 'payments:read', 'payments:refund',
    'invoices:create', 'invoices:read', 'invoices:send',
    'reports:read', 'reports:export'
);
GO

-- Staff: read-only operational dashboard
INSERT INTO role_permissions (role_id, permission_id)
SELECT 10, permission_id FROM permissions
WHERE permission_key IN (
    'dashboard:read', 'bookings:read', 'banquets:read', 'halls:read', 'availability:read'
);
GO

-- Receptionist: create inquiry/booking, edit customers — no cancel/delete
INSERT INTO role_permissions (role_id, permission_id)
SELECT 11, permission_id FROM permissions
WHERE permission_key IN (
    'dashboard:read', 'banquets:read', 'halls:read',
    'bookings:create', 'bookings:read', 'bookings:update',
    'customers:create', 'customers:read', 'customers:update',
    'availability:read'
);
GO

-- =============================================================================
-- SEED: Event Types
-- =============================================================================
INSERT INTO event_types (type_name, type_slug, icon_class, sort_order)
VALUES
    ('Wedding',           'wedding',           'fas fa-rings-wedding',    1),
    ('Reception',         'reception',         'fas fa-champagne-glasses', 2),
    ('Birthday Party',    'birthday',          'fas fa-birthday-cake',    3),
    ('Corporate Event',   'corporate',         'fas fa-briefcase',        4),
    ('Conference',        'conference',        'fas fa-microphone',       5),
    ('Seminar',           'seminar',           'fas fa-chalkboard-teacher', 6),
    ('Anniversary',       'anniversary',       'fas fa-heart',            7),
    ('Baby Shower',       'baby_shower',       'fas fa-baby',             8),
    ('Engagement',        'engagement',        'fas fa-gem',              9),
    ('Religious Event',   'religious',         'fas fa-pray',             10),
    ('Private Party',     'private_party',     'fas fa-glass-cheers',     11),
    ('Cultural Event',    'cultural',          'fas fa-theater-masks',    12),
    ('Award Ceremony',    'award_ceremony',    'fas fa-trophy',           13),
    ('Product Launch',    'product_launch',    'fas fa-rocket',           14),
    ('Custom Event',      'custom',            'fas fa-star',             15);
GO

-- =============================================================================
-- SEED: Amenity Types
-- =============================================================================
INSERT INTO amenity_types (amenity_name, icon_class, category)
VALUES
    -- Facilities
    ('Air Conditioning',    'fas fa-snowflake',        'facility'),
    ('Power Backup',        'fas fa-bolt',             'facility'),
    ('Parking',             'fas fa-parking',          'facility'),
    ('Valet Parking',       'fas fa-car',              'facility'),
    ('WiFi',                'fas fa-wifi',             'facility'),
    ('Bridal Room',         'fas fa-female',           'facility'),
    ('Green Room',          'fas fa-door-closed',      'facility'),
    ('Prayer Room',         'fas fa-pray',             'facility'),
    ('First Aid',           'fas fa-first-aid',        'facility'),
    -- Technical
    ('Stage',               'fas fa-theater-masks',    'technical'),
    ('LED Screen',          'fas fa-tv',               'technical'),
    ('Projector',           'fas fa-film',             'technical'),
    ('Sound System',        'fas fa-volume-up',        'technical'),
    ('DJ Console',          'fas fa-headphones',       'technical'),
    ('Lighting Setup',      'fas fa-lightbulb',        'technical'),
    ('Podium',              'fas fa-microphone-alt',   'technical'),
    ('Video Recording',     'fas fa-video',            'technical'),
    -- Services
    ('In-house Catering',   'fas fa-utensils',         'service'),
    ('External Catering',   'fas fa-truck',            'service'),
    ('Decoration',          'fas fa-candy-cane',       'service'),
    ('Photography',         'fas fa-camera',           'service'),
    ('Security',            'fas fa-shield-alt',       'service'),
    ('Housekeeping',        'fas fa-broom',            'service'),
    ('Reception Desk',      'fas fa-concierge-bell',   'service');
GO

-- =============================================================================
-- SEED: Demo Company & Super Admin
-- =============================================================================

-- Demo Company
INSERT INTO companies (
    company_name, company_slug, legal_name, gst_number,
    email, phone, address_line1, city_id, state_id, country_id,
    pincode, currency_code, timezone, is_active, is_verified, subscription_plan
)
VALUES (
    'Grand Events Pvt Ltd', 'grand-events', 'Grand Events Private Limited', '27AAACG1234A1Z5',
    'admin@grandevents.com', '+91-9876543210', '45 Business Park, Andheri East',
    1, 1, 1, '400069', 'INR', 'Asia/Kolkata', 1, 1, 'enterprise'
);
GO

-- Branch
INSERT INTO branches (company_id, branch_name, branch_code, email, phone, address_line1, city_id, state_id, pincode, is_main_branch)
VALUES (1, 'Andheri Branch', 'AND-001', 'andheri@grandevents.com', '+91-9876543211', '45 Business Park, Andheri East', 1, 1, '400069', 1);
GO

-- Super Admin User (password: Admin@1234 — bcrypt hash)
INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash, is_email_verified, is_active)
VALUES (1, 'Super', 'Admin', 'superadmin@banquetsys.com', '+91-9000000001',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1);
GO

-- Company Admin
INSERT INTO users (company_id, branch_id, role_id, first_name, last_name, email, phone, password_hash, is_email_verified, is_active)
VALUES (1, 1, 2, 'Rajesh', 'Sharma', 'admin@grandevents.com', '+91-9876543210',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1);
GO

-- Branch Manager
INSERT INTO users (company_id, branch_id, role_id, first_name, last_name, email, phone, password_hash, is_email_verified, is_active)
VALUES (1, 1, 3, 'Priya', 'Mehta', 'manager@grandevents.com', '+91-9876543212',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1);
GO

-- Booking Executive
INSERT INTO users (company_id, branch_id, role_id, first_name, last_name, email, phone, password_hash, is_email_verified, is_active)
VALUES (1, 1, 4, 'Amit', 'Kumar', 'executive@grandevents.com', '+91-9876543213',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMeBb08/x7HLJKR1dDxRwH.iqW', 1, 1);
GO

-- Demo Banquet
INSERT INTO banquets (
    company_id, branch_id, banquet_name, banquet_slug, description,
    address_line1, city_id, state_id, pincode,
    phone, email, gst_number, total_capacity, parking_capacity,
    has_valet, check_in_time, check_out_time, is_active
)
VALUES (
    1, 1, 'Grand Palace Banquet', 'grand-palace',
    'A luxurious banquet hall perfect for weddings, corporate events, and celebrations. Features state-of-the-art facilities and impeccable service.',
    '45 Business Park, Andheri East', 1, 1, '400069',
    '+91-9876543210', 'info@grandpalace.com', '27AAACG1234A1Z5',
    1200, 200, 1, '07:00', '23:00', 1
);
GO

-- Demo Halls
INSERT INTO halls (banquet_id, company_id, hall_name, hall_code, floor_number, hall_type, capacity_seated, capacity_standing, area_sqft, has_ac, has_power_backup, has_kitchen, has_stage, has_parking, has_washroom)
VALUES
    (1, 1, 'Royal Ballroom', 'RB-001', 1, 'main_hall', 500, 800, 8000.00, 1, 1, 1, 1, 1, 1),
    (1, 1, 'Crystal Hall', 'CH-001', 1, 'main_hall', 300, 500, 5000.00, 1, 1, 1, 1, 1, 1),
    (1, 1, 'Garden Lawn', 'GL-001', 0, 'lawn', 400, 700, 12000.00, 0, 1, 1, 1, 1, 1),
    (1, 1, 'Executive Suite', 'ES-001', 2, 'conference', 80, 150, 2000.00, 1, 1, 0, 1, 0, 1),
    (1, 1, 'Terrace Lounge', 'TL-001', 3, 'terrace', 150, 250, 3500.00, 0, 1, 0, 0, 0, 1);
GO

-- Hall Pricing lived in its own table pre-migration-014; that table was
-- dropped as unused (pricing now lives directly on Halls.base_price, already
-- seeded above), so there is nothing left to insert here.

-- Tax Config
INSERT INTO tax_config (company_id, tax_name, tax_type, rate, applies_to, effective_from)
VALUES
    (1, 'CGST', 'gst', 9.00, 'all', '2024-01-01'),
    (1, 'SGST', 'gst', 9.00, 'all', '2024-01-01');
GO

-- Company Settings
INSERT INTO company_settings (company_id, setting_key, setting_value, setting_group)
VALUES
    (1, 'invoice_prefix',       'INV',          'invoice'),
    (1, 'invoice_series',       '1',            'invoice'),
    (1, 'advance_percentage',   '25',           'booking'),
    (1, 'hold_duration_mins',   '15',           'booking'),
    (1, 'cancellation_days',    '7',            'booking'),
    (1, 'reminder_days_before', '3',            'notification'),
    (1, 'smtp_host',            '',             'email'),
    (1, 'smtp_port',            '587',          'email'),
    (1, 'default_language',     'en',           'localization'),
    (1, 'date_format',          'DD/MM/YYYY',   'localization');
GO

-- Catering Packages
INSERT INTO catering_packages (company_id, package_name, package_type, price_per_plate, min_plates, description)
VALUES
    (1, 'Veg Standard',    'veg',      450.00,  100, 'Standard vegetarian menu with 15+ dishes'),
    (1, 'Veg Premium',     'veg',      650.00,   75, 'Premium vegetarian with live counters and desserts'),
    (1, 'Non-Veg Standard','non_veg',  600.00,  100, 'Standard non-veg menu with variety'),
    (1, 'Non-Veg Premium', 'non_veg',  850.00,   75, 'Premium non-veg with seafood and BBQ'),
    (1, 'Jain Special',    'veg',      500.00,   50, 'Specially crafted Jain vegetarian menu');
GO

-- Demo Sample Coupon
INSERT INTO coupons (company_id, coupon_code, coupon_name, discount_type, discount_value, max_discount_amount, min_booking_amount, usage_limit, valid_from, valid_to)
VALUES (1, 'GRAND20', 'Grand Launch Offer', 'percentage', 20.00, 15000.00, 50000.00, 100,
    '2026-01-01 00:00:00', '2026-12-31 23:59:59');
GO

PRINT 'Seed data inserted successfully.';
PRINT 'Default credentials:';
PRINT '  Super Admin: superadmin@banquetsys.com / Admin@1234';
PRINT '  Company Admin: admin@grandevents.com / Admin@1234';
PRINT '  Branch Manager: manager@grandevents.com / Admin@1234';
PRINT '  Booking Executive: executive@grandevents.com / Admin@1234';
GO
