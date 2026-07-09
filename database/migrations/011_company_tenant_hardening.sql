-- =============================================================================
-- Migration 011 — Company (tenant) hardening for multi-tenant SaaS
-- Run AFTER 001..010
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Companies already functions as the tenant model (company_id is already the
-- FK on every business table) — this just brings it up to the same
-- soft-delete standard as Halls/Banquets/Users (migration 008).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Companies') AND name = 'deleted_at')
    ALTER TABLE Companies ADD deleted_at DATETIME2 NULL;
GO

-- companies:create/read/update/delete were already defined as constants
-- (backend/src/constants.js) and referenced by the old company.routes.js
-- stub, but never actually seeded — so no role, including company_admin,
-- ever held them; the routes relied solely on requireRole(), not permission
-- checks. Seed them now for defense-in-depth (the routes still keep
-- requireRole('super_admin') as the primary guard).
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:create')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','create','companies:create','Create tenant companies (platform)');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:read')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','read','companies:read','View tenant companies (platform)');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:update')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','update','companies:update','Edit/suspend/activate tenant companies (platform)');
IF NOT EXISTS (SELECT 1 FROM Permissions WHERE permission_key = 'companies:delete')
    INSERT INTO Permissions (module, action, permission_key, description) VALUES ('companies','delete','companies:delete','Delete tenant companies (platform)');
GO

-- Defensive: revoke companies:* from every non-super_admin role first. A
-- tenant admin (company_admin/business_owner/etc.) must never be able to
-- read/manage OTHER tenants' Companies rows — this permission is
-- platform-only, never tenant-scoped.
DELETE rp FROM RolePermissions rp
JOIN Roles r ON r.role_id = rp.role_id
JOIN Permissions p ON p.permission_id = rp.permission_id
WHERE r.role_slug <> 'super_admin' AND p.permission_key LIKE 'companies:%';
GO

-- Only Super Admin gets these — company_admin/business_owner explicitly stay
-- excluded since a tenant must never manage other tenants.
INSERT INTO RolePermissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM Roles r
CROSS JOIN Permissions p
WHERE r.role_slug = 'super_admin'
  AND p.permission_key IN ('companies:create','companies:read','companies:update','companies:delete')
  AND NOT EXISTS (
      SELECT 1 FROM RolePermissions rp WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
  );
GO
