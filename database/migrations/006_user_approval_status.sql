-- =============================================================================
-- Migration 006 — User registration approval workflow (Users.approval_status)
-- Run AFTER 001_create_schema.sql / 002 / 003 / 004 / 005
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Separate from is_active (which stays the "disabled" toggle for already-
-- approved accounts) — default 'approved' so every existing user is
-- unaffected; self-registered users are inserted with 'pending' explicitly.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'approval_status')
    ALTER TABLE Users ADD approval_status NVARCHAR(20) NOT NULL DEFAULT 'approved';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_user_approval_status')
BEGIN
    ALTER TABLE Users ADD CONSTRAINT CHK_user_approval_status
        CHECK (approval_status IN ('pending','approved','rejected'));
END
GO
