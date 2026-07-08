-- =============================================================================
-- Migration 005 — Inventory pricing strategy (Resources.is_billable)
-- Run AFTER 001_create_schema.sql / 002 / 003 / 004
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Inventory pricing decision: inventory (Resources) remains an internal
-- operational cost by default (is_billable = 0), matching how every existing
-- item already behaved — unit_price/cost_price were tracked for logistics and
-- owner-analytics margin reporting only, never added to a booking's total.
-- A manager can now opt individual premium/consumable items (e.g. specialty
-- decor, favors) into being billed to the customer via this flag, surfaced in
-- inventory/index.html. This is additive and non-breaking: no existing
-- booking's total_amount changes as a result of this migration.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Resources') AND name = 'is_billable')
    ALTER TABLE Resources ADD is_billable BIT NOT NULL DEFAULT 0;
GO
