-- =============================================================================
-- Migration 019 — Notifications v2: RBAC scoping, dedupe, preferences, email
-- Run AFTER 001..018
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
-- Notifications previously had no branch/property scoping (Branch/Property
-- Manager RBAC couldn't be enforced at write time), no dedupe key (retrying
-- the same event created duplicate rows), and no per-category email/in-app
-- preference. This closes all three gaps.
-- =============================================================================
USE BanquetDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Notifications') AND name = 'branch_id')
    ALTER TABLE Notifications ADD branch_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_notif_branch')
    ALTER TABLE Notifications ADD CONSTRAINT FK_notif_branch FOREIGN KEY (branch_id) REFERENCES Branches(branch_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Notifications') AND name = 'property_id')
    ALTER TABLE Notifications ADD property_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_notif_property')
    ALTER TABLE Notifications ADD CONSTRAINT FK_notif_property FOREIGN KEY (property_id) REFERENCES Banquets(banquet_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Notifications') AND name = 'category')
    ALTER TABLE Notifications ADD category NVARCHAR(30) NULL;
GO
-- Dedupe key — same event notifying the same user twice (e.g. a retried
-- request, or two code paths firing for one action) is a no-op instead of a
-- duplicate row. Unique per (user_id, dedupe_key), not globally, since many
-- different users legitimately get one row each for the same event.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Notifications') AND name = 'dedupe_key')
    ALTER TABLE Notifications ADD dedupe_key NVARCHAR(200) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_notif_user_dedupe')
    CREATE UNIQUE INDEX UQ_notif_user_dedupe ON Notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Notifications') AND name = 'email_sent')
    ALTER TABLE Notifications ADD email_sent BIT NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Notifications') AND name = 'email_sent_at')
    ALTER TABLE Notifications ADD email_sent_at DATETIME2 NULL;
GO

-- Per-user, per-category channel toggle (In-App / Email). No row for a given
-- (user_id, category) means "both enabled" (the default), so existing users
-- are unaffected until they explicitly opt out of something.
IF OBJECT_ID(N'dbo.NotificationPreferences', N'U') IS NULL
BEGIN
    CREATE TABLE NotificationPreferences (
        preference_id   INT             NOT NULL IDENTITY(1,1),
        user_id         INT             NOT NULL,
        category        NVARCHAR(30)    NOT NULL,
        in_app_enabled  BIT             NOT NULL DEFAULT 1,
        email_enabled   BIT             NOT NULL DEFAULT 1,
        updated_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_notification_preferences PRIMARY KEY (preference_id),
        CONSTRAINT FK_np_user FOREIGN KEY (user_id) REFERENCES Users(user_id),
        CONSTRAINT UQ_np_user_category UNIQUE (user_id, category)
    );
END
GO
