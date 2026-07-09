-- =============================================================================
-- Migration 007 — Persist the remaining operational-charge components on Bookings
-- Run AFTER 001..006
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Bookings already stored cleanup_charge/late_exit_charge, but
-- operationalCharge.service.js:calculateBookingCharges computes 7 components
-- (setup/decoration/cleanup/cleaning/late_exit/extended_usage/cooloff) — the
-- other 5 were only ever computed transiently for the wizard's price preview
-- and folded into total_amount at creation with no way to recover them later.
-- That made total_amount impossible to safely recalculate after the fact
-- (e.g. after a resource/catering edit) without silently dropping these
-- charges. Persist all of them so total_amount can always be reconstructed
-- from the booking's own stored fields.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'setup_charge')
    ALTER TABLE Bookings ADD setup_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'decoration_charge')
    ALTER TABLE Bookings ADD decoration_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'cleaning_charge')
    ALTER TABLE Bookings ADD cleaning_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'extended_usage_charge')
    ALTER TABLE Bookings ADD extended_usage_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'cooloff_charge')
    ALTER TABLE Bookings ADD cooloff_charge DECIMAL(12,2) NOT NULL DEFAULT 0;
GO
