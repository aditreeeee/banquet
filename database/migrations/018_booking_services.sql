-- =============================================================================
-- Migration 018 — Booking Services with negotiated pricing
-- Run AFTER 001..017
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
-- Step 7's "Additional Services" (Sound System, Photography, DJ, etc.) were
-- previously a frontend-only checkbox list — selected services were priced
-- into the wizard's on-screen total but never actually sent to the backend,
-- so nothing was persisted and nothing could be recalled for editing.
-- This table gives each selected service a real row, snapshotting the
-- catalog price at selection time (never overwritten) alongside a separately
-- editable negotiated price/discount, so the original list price stays
-- available for comparison and audit history even after negotiation.
-- =============================================================================
USE BanquetDB;
GO

IF OBJECT_ID(N'dbo.BookingServices', N'U') IS NULL
BEGIN
    CREATE TABLE BookingServices (
        booking_service_id  INT             NOT NULL IDENTITY(1,1),
        booking_id          BIGINT          NOT NULL,
        service_key         NVARCHAR(50)    NULL,   -- catalog id, e.g. from the static SERVICES list
        service_name        NVARCHAR(150)   NOT NULL,
        catalog_price        DECIMAL(12,2)   NOT NULL,  -- original list price at time of selection — never modified afterward
        negotiated_price      DECIMAL(12,2)   NOT NULL,  -- staff-agreed price before discount, defaults to catalog_price
        discount_amount       DECIMAL(12,2)   NOT NULL DEFAULT 0,
        final_price           DECIMAL(12,2)   NOT NULL,  -- negotiated_price - discount_amount, what's actually billed
        created_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_booking_services PRIMARY KEY (booking_service_id),
        CONSTRAINT FK_bs_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT CHK_bs_final_price CHECK (final_price >= 0)
    );
    CREATE INDEX IX_bs_booking ON BookingServices(booking_id);
END
GO
