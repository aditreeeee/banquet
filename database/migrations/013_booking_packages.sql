-- =============================================================================
-- Migration 013 — Booking duration packages (Item 1 of the booking
-- packages/overtime/dynamic-pricing feature)
-- Run AFTER 001..012
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Company-scoped rental packages (2 Hours / Half Day / Full Day for
-- corporate events; Breakfast/Lunch/High Tea/Dinner/Reception/Wedding
-- Ceremony/Full Wedding for social events). Mirrors CateringPackages'
-- company-scoped CRUD shape. A booking that references a package snapshots
-- its own setup/cleanup/cooloff/base_price at booking time (see Bookings
-- columns below) — a later edit to the package here never retroactively
-- reprices an existing booking, consistent with every other snapshot-pricing
-- decision made this session (operational charges, catering line items).
IF OBJECT_ID(N'dbo.BookingPackages', N'U') IS NULL
BEGIN
    CREATE TABLE BookingPackages (
        package_id              INT             NOT NULL IDENTITY(1,1),
        company_id              INT             NOT NULL,
        package_name            NVARCHAR(200)   NOT NULL,
        package_category        NVARCHAR(20)    NOT NULL, -- 'corporate' | 'social'
        calc_type               NVARCHAR(20)    NOT NULL, -- 'hourly' | 'half_day' | 'full_day' | 'fixed_session'
        included_hours          DECIMAL(5,2)    NULL,     -- NULL for fixed_session (e.g. "Wedding Ceremony") packages
        base_price              DECIMAL(12,2)   NOT NULL DEFAULT 0,
        overtime_rate_per_hour  DECIMAL(10,2)   NOT NULL DEFAULT 0,
        max_extension_hours     DECIMAL(5,2)    NOT NULL DEFAULT 0,
        default_setup_minutes   INT             NOT NULL DEFAULT 0,
        default_cleanup_minutes INT             NOT NULL DEFAULT 0,
        default_cooloff_minutes INT             NOT NULL DEFAULT 0,
        description             NVARCHAR(500)   NULL,
        is_active               BIT             NOT NULL DEFAULT 1,
        created_at              DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at              DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_booking_packages PRIMARY KEY (package_id),
        CONSTRAINT FK_bp_company FOREIGN KEY (company_id) REFERENCES Companies(company_id),
        CONSTRAINT CHK_bp_category CHECK (package_category IN ('corporate','social')),
        CONSTRAINT CHK_bp_calc_type CHECK (calc_type IN ('hourly','half_day','full_day','fixed_session'))
    );
    CREATE INDEX IX_bp_company ON BookingPackages(company_id, is_active);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_id')
    ALTER TABLE Bookings ADD package_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_bookings_package')
    ALTER TABLE Bookings ADD CONSTRAINT FK_bookings_package FOREIGN KEY (package_id) REFERENCES BookingPackages(package_id);
GO
-- Snapshot of the package's overtime rate/allowance at booking time (Item 3
-- reads these, not the live BookingPackages row, so a later package-rate
-- change never retroactively affects an already-created booking).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_overtime_rate')
    ALTER TABLE Bookings ADD package_overtime_rate DECIMAL(10,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_max_extension_hours')
    ALTER TABLE Bookings ADD package_max_extension_hours DECIMAL(5,2) NULL;
GO
-- Snapshot of the package's own base_price at booking time — recalculateBookingTotal
-- reads this, not a live BookingPackages join, so a later package price change
-- never retroactively reprices an existing booking (same principle as the two
-- columns above).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'package_base_price')
    ALTER TABLE Bookings ADD package_base_price DECIMAL(12,2) NULL;
GO

-- Permissions — reuse bookings:read/create/update (packages are configured
-- as part of managing bookings, same permission surface, no new grants
-- needed); only the CRUD routes below are new.

-- Soft-delete, same pattern as Halls/Banquets/Users/Companies (migration 008/011).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('BookingPackages') AND name = 'deleted_at')
    ALTER TABLE BookingPackages ADD deleted_at DATETIME2 NULL;
GO

