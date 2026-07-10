-- =============================================================================
-- Migration 015 — Multi-day catering session dates
-- Run AFTER 001..014
-- Mirrors the idempotent change applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Multi-day bookings (Bookings.event_date..event_end_date) previously had no
-- way to say which day a catering session belonged to — serving_time (TIME)
-- alone is ambiguous once an event spans more than one day (e.g. "Lunch at
-- 1pm" on a 3-day wedding could mean any of the three days). NULL means "the
-- booking's (start) event_date", so existing single-day sessions don't need
-- backfilling.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingCateringSessions') AND name = 'serving_date')
    ALTER TABLE BookingCateringSessions ADD serving_date DATE NULL;
GO
