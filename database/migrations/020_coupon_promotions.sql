-- =============================================================================
-- Migration 020 — Promotion & Coupon Management (Packages & Promotions)
-- Run AFTER 001..019
-- Mirrors the idempotent changes applied by backend/scripts/setup.js
-- =============================================================================
-- Coupons already existed (discount type/value, min booking amount, usage
-- limit, date validity) but with no way to actually redeem one against a
-- booking (no CouponUsage history, no coupon_id on Bookings — used_count was
-- an orphaned counter nothing ever incremented) and no package/branch/
-- property scoping. This closes both gaps.
-- =============================================================================
USE BanquetDB;
GO

-- ─── Scoping columns on Coupons ──────────────────────────────────────────────
-- applicable_halls/applicable_events already existed but were write-only
-- (never enforced) — now actually read by coupon.service.js validate().
-- NULL/empty means "no restriction" for every scoping column, consistent
-- with how applicable_halls/applicable_events already behaved.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Coupons') AND name = 'applicable_packages')
    ALTER TABLE Coupons ADD applicable_packages NVARCHAR(MAX) NULL; -- JSON array of BookingPackages.package_id
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Coupons') AND name = 'applicable_branches')
    ALTER TABLE Coupons ADD applicable_branches NVARCHAR(MAX) NULL; -- JSON array of Branches.branch_id
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Coupons') AND name = 'applicable_properties')
    ALTER TABLE Coupons ADD applicable_properties NVARCHAR(MAX) NULL; -- JSON array of Banquets.banquet_id
GO

-- ─── Coupon usage history — one row per redemption, the actual audit trail
-- "used_count" alone never provided (who used it, on which booking, when,
-- how much was discounted). Per-customer usage_per_user is enforced by
-- counting this table, not a separate counter. ────────────────────────────
IF OBJECT_ID(N'dbo.CouponUsage', N'U') IS NULL
BEGIN
    CREATE TABLE CouponUsage (
        usage_id         BIGINT          NOT NULL IDENTITY(1,1),
        coupon_id        INT             NOT NULL,
        company_id       INT             NOT NULL,
        booking_id       BIGINT          NOT NULL,
        customer_id      INT             NULL,
        discount_amount  DECIMAL(14,2)   NOT NULL,
        used_at          DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_coupon_usage PRIMARY KEY (usage_id),
        CONSTRAINT FK_cu_coupon  FOREIGN KEY (coupon_id)  REFERENCES Coupons(coupon_id),
        CONSTRAINT FK_cu_booking FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
        CONSTRAINT FK_cu_customer FOREIGN KEY (customer_id) REFERENCES Customers(customer_id),
        -- One redemption per booking, not per coupon-globally — a booking can
        -- only ever have had one coupon applied to it (see Bookings.coupon_id
        -- below), so this also guards against a retried request double-
        -- recording the same redemption.
        CONSTRAINT UQ_cu_booking UNIQUE (booking_id)
    );
    CREATE INDEX IX_cu_coupon_customer ON CouponUsage(coupon_id, customer_id);
END
GO

-- ─── Applied-coupon linkage on Bookings — discount_amount already existed
-- (generic manual discount); coupon_id/coupon_code record WHICH coupon (if
-- any) produced it, for booking detail display, revenue reports grouped by
-- coupon, and so a booking can't be double-redeemed against a second coupon
-- without first clearing the first. coupon_code is a denormalized snapshot
-- (like every other snapshot-pricing decision in this codebase) so the
-- booking's own record is unaffected if the coupon is later edited. ───────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'coupon_id')
    ALTER TABLE Bookings ADD coupon_id INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_bookings_coupon')
    ALTER TABLE Bookings ADD CONSTRAINT FK_bookings_coupon FOREIGN KEY (coupon_id) REFERENCES Coupons(coupon_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Bookings') AND name = 'coupon_code')
    ALTER TABLE Bookings ADD coupon_code NVARCHAR(50) NULL;
GO
