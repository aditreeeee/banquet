-- =============================================================================
-- Migration 003 — Multi-role support (UserRoles many-to-many)
-- Run AFTER 001_create_schema.sql / 002_inventory_sync_and_lifecycle.sql
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserRoles')
BEGIN
    CREATE TABLE UserRoles (
        user_id     INT             NOT NULL,
        role_id     INT             NOT NULL,
        assigned_by INT             NULL,
        assigned_at DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_user_roles PRIMARY KEY (user_id, role_id),
        CONSTRAINT FK_ur_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
        CONSTRAINT FK_ur_role FOREIGN KEY (role_id) REFERENCES Roles(role_id)
    );
END
GO

-- Backfill: every existing user's single Users.role_id becomes their first UserRoles row.
-- Users.role_id is kept as the "primary/default role" for display purposes; it is no
-- longer the sole source of a user's permissions once auth.js reads from UserRoles.
INSERT INTO UserRoles (user_id, role_id)
SELECT u.user_id, u.role_id FROM Users u
WHERE NOT EXISTS (SELECT 1 FROM UserRoles ur WHERE ur.user_id = u.user_id AND ur.role_id = u.role_id);
GO
