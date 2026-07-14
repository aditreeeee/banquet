-- =============================================================================
-- Migration 021 — Property Token
-- Run AFTER 001..020
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
-- Banquets (the bookable venue — what the product already calls a "Property"
-- in public-facing search/inquiry/QR/booking contexts, distinct from the
-- Company/tenant boundary) get an opaque, immutable public identifier so
-- future public URLs, QR codes and integrations never need to expose the
-- internal auto-increment banquet_id. NEWID() backfills every existing row
-- automatically as part of adding the column.
-- =============================================================================
USE BanquetDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Banquets') AND name = 'property_token')
    ALTER TABLE Banquets ADD property_token UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Banquets_property_token DEFAULT NEWID();
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('Banquets') AND name = 'UQ_Banquets_property_token')
    CREATE UNIQUE INDEX UQ_Banquets_property_token ON Banquets(property_token);
GO
