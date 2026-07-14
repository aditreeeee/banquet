-- =============================================================================
-- Migration 022 — Public property inquiries
-- Run AFTER 001..021
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
-- Leads.created_by was NOT NULL (FK to Users), which assumed every lead was
-- entered by a staff member. A public, unauthenticated inquiry submitted from
-- a QR-code/property-token landing page has no user — relax the constraint
-- so those leads can be recorded with created_by = NULL, distinguishable
-- from staff-entered leads via source = 'qr_code'.
-- =============================================================================
USE BanquetDB;
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('Leads') AND name = 'created_by' AND is_nullable = 0
)
BEGIN
    ALTER TABLE Leads ALTER COLUMN created_by INT NULL;
END
GO
