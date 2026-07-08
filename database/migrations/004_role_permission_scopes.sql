-- =============================================================================
-- Migration 004 — Branch/hall scoped permission grants (RolePermissionScopes)
-- Run AFTER 001_create_schema.sql / 002 / 003_user_roles.sql
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Foundation for future multi-location deployments: a role+permission grant is
-- tenant-wide unless scope rows exist here, in which case it's restricted to the
-- listed branches/halls. No rows for a role+permission = unrestricted (non-breaking).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RolePermissionScopes')
BEGIN
    CREATE TABLE RolePermissionScopes (
        scope_id      INT             NOT NULL IDENTITY(1,1),
        role_id       INT             NOT NULL,
        permission_id INT             NOT NULL,
        branch_id     INT             NULL,
        hall_id       INT             NULL,
        created_at    DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_role_permission_scopes PRIMARY KEY (scope_id),
        CONSTRAINT FK_rps_role FOREIGN KEY (role_id) REFERENCES Roles(role_id) ON DELETE CASCADE,
        CONSTRAINT FK_rps_permission FOREIGN KEY (permission_id) REFERENCES Permissions(permission_id) ON DELETE CASCADE,
        CONSTRAINT FK_rps_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id),
        CONSTRAINT FK_rps_hall FOREIGN KEY (hall_id) REFERENCES Halls(hall_id)
    );
    CREATE INDEX IX_rps_lookup ON RolePermissionScopes(role_id, permission_id);
END
GO
