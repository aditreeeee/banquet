-- =============================================================================
-- Migration 012 — RBAC permission repair
-- Run AFTER 001..011
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Every non-super_admin role was found to be severely under-provisioned
-- versus database/seeds/001_seed_data.sql's documented intent (e.g.
-- business_owner had only 8 of the ~59 permissions it should hold; customer
-- had zero) — this silently 403'd entire modules (Command Center, dashboard,
-- bookings, etc.) for those roles. Re-applies the exact same grants the
-- original seed file specifies, idempotently (only adds what's missing).

-- Company Admin: everything except platform-level (companies:*, audit_logs:read)
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'company_admin'
  AND p.permission_key NOT IN ('companies:create','companies:read','companies:update','companies:delete','audit_logs:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Branch Manager
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'branch_manager'
  AND p.permission_key IN (
    'dashboard:read', 'banquets:read', 'halls:read',
    'bookings:create','bookings:read','bookings:update','bookings:cancel','bookings:confirm',
    'customers:create','customers:read','customers:update',
    'payments:create','payments:read',
    'invoices:create','invoices:read','invoices:send',
    'reports:read','reports:export', 'pricing:read',
    'availability:manage','availability:read',
    'resources:create','resources:read','resources:update', 'settings:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Booking Executive
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'booking_executive'
  AND p.permission_key IN (
    'dashboard:read', 'banquets:read', 'halls:read',
    'bookings:create','bookings:read','bookings:update','bookings:cancel',
    'customers:create','customers:read','customers:update',
    'payments:create','payments:read',
    'invoices:create','invoices:read','invoices:send',
    'availability:read', 'coupons:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Customer
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'customer'
  AND p.permission_key IN (
    'banquets:read','halls:read',
    'bookings:create','bookings:read','bookings:cancel',
    'invoices:read','payments:read','availability:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Business Owner: everything except platform-level (companies:*, audit_logs:read)
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'business_owner'
  AND p.permission_key NOT IN ('companies:create','companies:read','companies:update','companies:delete','audit_logs:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Operations Manager
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'operations_manager'
  AND p.permission_key IN (
    'dashboard:read','banquets:read','halls:read',
    'bookings:create','bookings:read','bookings:update','bookings:cancel','bookings:confirm',
    'customers:read','customers:update',
    'availability:manage','availability:read',
    'resources:create','resources:read','resources:update', 'reports:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Sales Manager
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'sales_manager'
  AND p.permission_key IN (
    'dashboard:read','banquets:read','halls:read',
    'bookings:create','bookings:read','bookings:update',
    'customers:create','customers:read','customers:update',
    'coupons:create','coupons:read','coupons:update',
    'availability:read','reports:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Finance Manager
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'finance_manager'
  AND p.permission_key IN (
    'dashboard:read','bookings:read',
    'payments:create','payments:read','payments:refund',
    'invoices:create','invoices:read','invoices:send',
    'reports:read','reports:export')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Staff
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'staff'
  AND p.permission_key IN ('dashboard:read','bookings:read','banquets:read','halls:read','availability:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

-- Receptionist
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM Roles r CROSS JOIN Permissions p
WHERE r.role_slug = 'receptionist'
  AND p.permission_key IN (
    'dashboard:read','banquets:read','halls:read',
    'bookings:create','bookings:read','bookings:update',
    'customers:create','customers:read','customers:update','availability:read')
  AND NOT EXISTS (SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO
