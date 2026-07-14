-- =============================================================================
-- Migration 016 — HSN/SAC code + configurable per-item tax
-- Run AFTER 001..015
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
-- Replaces the hardcoded 18% GST assumption with a per-item HSN (goods) /
-- SAC (services) code + tax rate, captured at the catalog level so it flows
-- into booking line items, quotations, invoices and revenue reports without
-- a central "tax rate" constant. tax_type distinguishes an HSN code (goods —
-- catering, decoration stock, inventory resources) from an SAC code
-- (services — booking packages, service charges).
-- =============================================================================
USE BanquetDB;
GO

-- ─── MenuItems (catering — goods) ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'hsn_sac_code')
    ALTER TABLE MenuItems ADD hsn_sac_code NVARCHAR(15) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'tax_type')
    ALTER TABLE MenuItems ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_mi_tax_type CHECK (tax_type IN ('hsn','sac'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('MenuItems') AND name = 'tax_percent')
    ALTER TABLE MenuItems ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
GO

-- ─── CateringPackages (goods) ────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CateringPackages') AND name = 'hsn_sac_code')
    ALTER TABLE CateringPackages ADD hsn_sac_code NVARCHAR(15) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CateringPackages') AND name = 'tax_type')
    ALTER TABLE CateringPackages ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_cp_tax_type CHECK (tax_type IN ('hsn','sac'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CateringPackages') AND name = 'tax_percent')
    ALTER TABLE CateringPackages ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
GO

-- ─── DecorationItems (goods) — table may not exist yet on a fresh DB that
-- hasn't run backend/scripts/setup.js's decoration bootstrap; guard the whole
-- block so this migration stays a no-op until that table shows up. ─────────
IF OBJECT_ID(N'dbo.DecorationItems', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('DecorationItems') AND name = 'hsn_sac_code')
        ALTER TABLE DecorationItems ADD hsn_sac_code NVARCHAR(15) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('DecorationItems') AND name = 'tax_type')
        ALTER TABLE DecorationItems ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_di_tax_type CHECK (tax_type IN ('hsn','sac'));
    -- tax_percent already exists on DecorationItems (see backend/scripts/setup.js)
END
GO

-- ─── Resources (inventory — goods) ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'hsn_sac_code')
    ALTER TABLE Resources ADD hsn_sac_code NVARCHAR(15) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'tax_type')
    ALTER TABLE Resources ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'hsn' CONSTRAINT CHK_res_tax_type CHECK (tax_type IN ('hsn','sac'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'tax_percent')
    ALTER TABLE Resources ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
GO

-- ─── BookingPackages (services — hall rental duration packages) ─────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'hsn_sac_code')
    ALTER TABLE BookingPackages ADD hsn_sac_code NVARCHAR(15) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'tax_type')
    ALTER TABLE BookingPackages ADD tax_type NVARCHAR(10) NOT NULL DEFAULT 'sac' CONSTRAINT CHK_bp_tax_type CHECK (tax_type IN ('hsn','sac'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'tax_percent')
    ALTER TABLE BookingPackages ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
GO

-- ─── QuotationItems — carry the code/type forward so a quotation line item
-- traces back to the catalog item's tax classification, not just its % ─────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('QuotationItems') AND name = 'hsn_sac_code')
    ALTER TABLE QuotationItems ADD hsn_sac_code NVARCHAR(15) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('QuotationItems') AND name = 'tax_type')
    ALTER TABLE QuotationItems ADD tax_type NVARCHAR(10) NULL CONSTRAINT CHK_qi_tax_type CHECK (tax_type IN ('hsn','sac') OR tax_type IS NULL);
GO

-- ─── Invoices — HSN/SAC-grouped tax breakdown for Revenue Reports. Invoices
-- already stores cgst/sgst/igst rate+amount at the invoice level; this adds
-- the per-code rollup as a JSON breakdown column so Reports can group
-- collected tax by HSN/SAC without re-deriving it from line items on every
-- query. NULL means "pre-migration invoice, fall back to the flat rate". ──
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Invoices') AND name = 'hsn_sac_breakdown')
    ALTER TABLE Invoices ADD hsn_sac_breakdown NVARCHAR(MAX) NULL;
GO
