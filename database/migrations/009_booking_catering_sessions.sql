-- =============================================================================
-- Migration 009 — Per-booking catering plans with multiple sessions
-- Run AFTER 001..008
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
USE BanquetDB;
GO

-- Master Menu / CateringPackages remain company-wide templates. Before this,
-- there was no way to attach a customized, multi-session catering plan
-- (Welcome Drinks / Breakfast / Lunch / Dinner / ...) to one specific booking
-- — only a single flat catering_package_id reference on Bookings. These two
-- tables let each booking build its own session-by-session plan, optionally
-- starting from a Master Menu item, while snapshotting price/tax at add-time
-- (same reasoning as Bookings' own operational-charge columns — a later
-- Master Menu price change must never retroactively reprice an existing
-- booking's already-priced catering).
IF OBJECT_ID(N'dbo.BookingCateringSessions', N'U') IS NULL
BEGIN
    CREATE TABLE BookingCateringSessions (
        session_id      BIGINT          NOT NULL IDENTITY(1,1),
        booking_id      BIGINT          NOT NULL,
        company_id      INT             NOT NULL,
        session_type    NVARCHAR(50)    NOT NULL,
        serving_time    TIME            NULL,
        guest_count     INT             NULL, -- NULL = falls back to Bookings.guest_count
        notes           NVARCHAR(500)   NULL,
        created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_booking_catering_sessions PRIMARY KEY (session_id),
        CONSTRAINT FK_bcs_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_bcs_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
    );
    CREATE INDEX IX_bcs_booking ON BookingCateringSessions(booking_id);
END
GO

IF OBJECT_ID(N'dbo.BookingCateringItems', N'U') IS NULL
BEGIN
    CREATE TABLE BookingCateringItems (
        item_row_id     BIGINT          NOT NULL IDENTITY(1,1),
        session_id      BIGINT          NOT NULL,
        item_id         INT             NULL, -- nullable: a custom line item not tied to the Master Menu is allowed
        item_name       NVARCHAR(200)   NOT NULL, -- snapshotted so the line survives a Master Menu item rename/delete
        quantity        DECIMAL(10,2)   NOT NULL DEFAULT 1, -- plates
        unit_price      DECIMAL(10,2)   NOT NULL DEFAULT 0, -- snapshot from MenuItems.base_price at add-time
        tax_percent     DECIMAL(5,2)    NOT NULL DEFAULT 0, -- snapshot from MenuItems.tax_percent at add-time
        created_at      DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_booking_catering_items PRIMARY KEY (item_row_id),
        CONSTRAINT FK_bci_session FOREIGN KEY (session_id) REFERENCES BookingCateringSessions(session_id),
        CONSTRAINT FK_bci_item FOREIGN KEY (item_id) REFERENCES MenuItems(item_id)
    );
    CREATE INDEX IX_bci_session ON BookingCateringItems(session_id);
END
GO
