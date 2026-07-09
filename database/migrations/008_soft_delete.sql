-- =============================================================================
-- Migration 008 — Soft delete, distinct from is_active (Halls/Banquets/Users)
-- Run AFTER 001..007
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- `is_active`/`deactivate` already meant "hidden from normal operations, can be
-- reactivated" — that's unchanged. `deleted_at` is a distinct, separate concept:
-- "permanently hidden, blocked unless business rules allow, row + audit history
-- + FK integrity preserved (soft delete only, never a hard DB delete)."
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Halls') AND name = 'deleted_at')
    ALTER TABLE Halls ADD deleted_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Banquets') AND name = 'deleted_at')
    ALTER TABLE Banquets ADD deleted_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'deleted_at')
    ALTER TABLE Users ADD deleted_at DATETIME2 NULL;
GO
