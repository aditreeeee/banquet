-- =============================================================================
-- INDEX OPTIMIZATION SCRIPTS
-- Banquet Hall Booking & Management System
-- Run AFTER all tables are created (migration 001)
-- =============================================================================
USE BanquetDB;
GO

-- ═══════════════════════════════════════════════════════════════════
-- BOOKINGS TABLE — Highest traffic table, most critical indexes
-- ═══════════════════════════════════════════════════════════════════

-- Already in migration, but re-stated for clarity:
-- IX_bookings_date_hall       — primary availability check
-- IX_bookings_customer        — customer booking history
-- IX_bookings_company_date    — admin listing + revenue queries
-- IX_bookings_status          — status filter (active/cancelled)

-- Additional booking indexes:
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bookings_ref' AND object_id = OBJECT_ID('bookings'))
    CREATE UNIQUE INDEX IX_bookings_ref
    ON bookings(booking_ref)
    INCLUDE (booking_id, booking_status, company_id);
GO

-- Covering index for dashboard "today's events"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bookings_today_events' AND object_id = OBJECT_ID('bookings'))
    CREATE INDEX IX_bookings_today_events
    ON bookings(booking_date, company_id, booking_status)
    INCLUDE (booking_id, booking_ref, hall_id, customer_id, start_time, end_time, expected_guests, grand_total);
GO

-- Filtered index for active (non-cancelled) bookings
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bookings_active' AND object_id = OBJECT_ID('bookings'))
    CREATE INDEX IX_bookings_active
    ON bookings(company_id, branch_id, booking_date)
    INCLUDE (booking_id, hall_id, customer_id, grand_total, advance_paid, balance_due)
    WHERE booking_status NOT IN ('cancelled', 'draft');
GO

-- Index for pending balance queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bookings_pending_balance' AND object_id = OBJECT_ID('bookings'))
    CREATE INDEX IX_bookings_pending_balance
    ON bookings(company_id, booking_date, balance_due)
    INCLUDE (booking_ref, customer_id, booking_status)
    WHERE balance_due > 0 AND booking_status IN ('confirmed', 'advance_paid');
GO

-- Index for hold expiry cleanup job
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bookings_hold_expiry' AND object_id = OBJECT_ID('bookings'))
    CREATE INDEX IX_bookings_hold_expiry
    ON bookings(hold_expires_at)
    INCLUDE (booking_id, booking_status)
    WHERE booking_status = 'draft' AND hold_expires_at IS NOT NULL;
GO

-- ═══════════════════════════════════════════════════════════════════
-- PAYMENTS TABLE
-- ═══════════════════════════════════════════════════════════════════

-- Covering index for payment listing by company + date
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_payments_company_date_cover' AND object_id = OBJECT_ID('payments'))
    CREATE INDEX IX_payments_company_date_cover
    ON payments(company_id, payment_date DESC)
    INCLUDE (payment_ref, booking_id, customer_id, amount, payment_type, payment_method, payment_status);
GO

-- Index for revenue reporting (completed payments only)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_payments_revenue_report' AND object_id = OBJECT_ID('payments'))
    CREATE INDEX IX_payments_revenue_report
    ON payments(company_id, payment_date, amount)
    WHERE payment_status = 'completed';
GO

-- Index for customer payment history
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_payments_customer' AND object_id = OBJECT_ID('payments'))
    CREATE INDEX IX_payments_customer
    ON payments(customer_id, payment_date DESC)
    INCLUDE (payment_ref, amount, payment_method, payment_status);
GO

-- Unique index on payment reference
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_payments_ref_uq' AND object_id = OBJECT_ID('payments'))
    CREATE UNIQUE INDEX IX_payments_ref_uq ON payments(payment_ref);
GO

-- ═══════════════════════════════════════════════════════════════════
-- USERS TABLE
-- ═══════════════════════════════════════════════════════════════════

-- Email lookup (login — most frequent query)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_email_cover' AND object_id = OBJECT_ID('users'))
    CREATE UNIQUE INDEX IX_users_email_cover
    ON users(email)
    INCLUDE (user_id, password_hash, role_id, company_id, branch_id, is_active, is_email_verified, locked_until, failed_login_count);
GO

-- Company + role filter (admin user listing)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_company_role' AND object_id = OBJECT_ID('users'))
    CREATE INDEX IX_users_company_role
    ON users(company_id, role_id, is_active)
    INCLUDE (user_id, first_name, last_name, email, phone, last_login_at);
GO

-- Phone lookup
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_phone' AND object_id = OBJECT_ID('users'))
    CREATE INDEX IX_users_phone
    ON users(phone)
    INCLUDE (user_id, company_id, is_active)
    WHERE phone IS NOT NULL;
GO

-- ═══════════════════════════════════════════════════════════════════
-- CUSTOMERS TABLE
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_company_code' AND object_id = OBJECT_ID('customers'))
    CREATE UNIQUE INDEX IX_customers_company_code
    ON customers(company_id, customer_code);
GO

-- Top customers by spend (for reports)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_spend' AND object_id = OBJECT_ID('customers'))
    CREATE INDEX IX_customers_spend
    ON customers(company_id, total_spend DESC)
    INCLUDE (customer_id, customer_code, user_id, total_bookings, loyalty_points);
GO

-- ═══════════════════════════════════════════════════════════════════
-- INVOICES TABLE
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_invoices_company_date' AND object_id = OBJECT_ID('invoices'))
    CREATE INDEX IX_invoices_company_date
    ON invoices(company_id, invoice_date DESC)
    INCLUDE (invoice_number, booking_id, customer_id, grand_total, amount_paid, balance_due, payment_status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_invoices_booking' AND object_id = OBJECT_ID('invoices'))
    CREATE INDEX IX_invoices_booking
    ON invoices(booking_id, company_id)
    WHERE is_cancelled = 0;
GO

-- Pending invoices filter
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_invoices_pending' AND object_id = OBJECT_ID('invoices'))
    CREATE INDEX IX_invoices_pending
    ON invoices(company_id, due_date)
    INCLUDE (invoice_id, invoice_number, grand_total, balance_due)
    WHERE payment_status IN ('pending', 'partial') AND is_cancelled = 0;
GO

-- ═══════════════════════════════════════════════════════════════════
-- HALLS & AVAILABILITY
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_halls_company_banquet' AND object_id = OBJECT_ID('halls'))
    CREATE INDEX IX_halls_company_banquet
    ON halls(company_id, banquet_id, is_active)
    INCLUDE (hall_id, hall_name, hall_type, capacity_seated, has_ac, has_stage, has_kitchen);
GO

-- Composite index for availability check (joins bookings on hall+date)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_blocked_dates_hall_date_full' AND object_id = OBJECT_ID('hall_blocked_dates'))
    CREATE INDEX IX_blocked_dates_hall_date_full
    ON hall_blocked_dates(hall_id, blocked_date)
    INCLUDE (start_time, end_time, reason);
GO

-- ═══════════════════════════════════════════════════════════════════
-- HALL PRICING
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_hall_pricing_hall_active' AND object_id = OBJECT_ID('hall_pricing'))
    CREATE INDEX IX_hall_pricing_hall_active
    ON hall_pricing(hall_id, is_active, valid_from DESC)
    INCLUDE (pricing_id, base_price, pricing_type, weekend_multiplier, advance_percentage);
GO

-- ═══════════════════════════════════════════════════════════════════
-- REFRESH TOKENS
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_refresh_tokens_hash' AND object_id = OBJECT_ID('refresh_tokens'))
    CREATE INDEX IX_refresh_tokens_hash
    ON refresh_tokens(token_hash)
    INCLUDE (user_id, expires_at, is_revoked)
    WHERE is_revoked = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_refresh_tokens_user' AND object_id = OBJECT_ID('refresh_tokens'))
    CREATE INDEX IX_refresh_tokens_user
    ON refresh_tokens(user_id, is_revoked, expires_at)
    WHERE is_revoked = 0;
GO

-- ═══════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════════

-- Already has IX_notifications_user — add covering
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notifications_pending_send' AND object_id = OBJECT_ID('notifications'))
    CREATE INDEX IX_notifications_pending_send
    ON notifications(delivery_status, created_at)
    INCLUDE (notification_id, company_id, user_id, channel, title, body)
    WHERE delivery_status = 'pending';
GO

-- ═══════════════════════════════════════════════════════════════════
-- AUDIT LOGS
-- ═══════════════════════════════════════════════════════════════════

-- Composite for company timeline
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_company_action_date' AND object_id = OBJECT_ID('audit_logs'))
    CREATE INDEX IX_audit_company_action_date
    ON audit_logs(company_id, action, created_at DESC)
    INCLUDE (user_id, entity_type, entity_id, ip_address);
GO

-- ═══════════════════════════════════════════════════════════════════
-- REVIEWS
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reviews_banquet_approved' AND object_id = OBJECT_ID('reviews'))
    CREATE INDEX IX_reviews_banquet_approved
    ON reviews(banquet_id, is_approved, created_at DESC)
    INCLUDE (review_id, rating, title);
GO

-- ═══════════════════════════════════════════════════════════════════
-- BANQUETS
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_banquets_company_featured' AND object_id = OBJECT_ID('banquets'))
    CREATE INDEX IX_banquets_company_featured
    ON banquets(company_id, is_active, is_featured DESC, average_rating DESC)
    INCLUDE (banquet_id, banquet_name, banquet_slug, cover_image_url, total_capacity, total_halls);
GO

-- City-based search (public listing)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_banquets_city_active' AND object_id = OBJECT_ID('banquets'))
    CREATE INDEX IX_banquets_city_active
    ON banquets(city_id, is_active, average_rating DESC)
    INCLUDE (banquet_id, banquet_name, total_capacity, parking_capacity);
GO

-- ═══════════════════════════════════════════════════════════════════
-- COUPONS
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_coupons_company_code_active' AND object_id = OBJECT_ID('coupons'))
    CREATE INDEX IX_coupons_company_code_active
    ON coupons(company_id, coupon_code, is_active)
    INCLUDE (coupon_id, discount_type, discount_value, max_discount_amount, valid_from, valid_to, usage_limit, used_count)
    WHERE is_active = 1;
GO

-- ═══════════════════════════════════════════════════════════════════
-- OTP VERIFICATIONS
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_otp_email_purpose' AND object_id = OBJECT_ID('otp_verifications'))
    CREATE INDEX IX_otp_email_purpose
    ON otp_verifications(email, purpose, is_used, expires_at)
    WHERE is_used = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_otp_user_purpose' AND object_id = OBJECT_ID('otp_verifications'))
    CREATE INDEX IX_otp_user_purpose
    ON otp_verifications(user_id, purpose, is_used, expires_at)
    WHERE is_used = 0 AND user_id IS NOT NULL;
GO

-- ═══════════════════════════════════════════════════════════════════
-- SPECIAL PRICING
-- ═══════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_special_pricing_date' AND object_id = OBJECT_ID('special_pricing'))
    CREATE INDEX IX_special_pricing_date
    ON special_pricing(company_id, special_date, is_active)
    INCLUDE (special_id, hall_id, multiplier, flat_price);
GO

-- ═══════════════════════════════════════════════════════════════════
-- STATISTICS UPDATE (run weekly in production)
-- ═══════════════════════════════════════════════════════════════════
-- UPDATE STATISTICS bookings;
-- UPDATE STATISTICS payments;
-- UPDATE STATISTICS users;
-- UPDATE STATISTICS customers;
-- UPDATE STATISTICS invoices;

PRINT '✅ All indexes created successfully.';
PRINT '';
PRINT 'Summary of indexes created:';
SELECT
    OBJECT_NAME(i.object_id) AS table_name,
    i.name AS index_name,
    i.type_desc,
    i.is_unique,
    i.filter_definition
FROM sys.indexes i
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
  AND i.name LIKE 'IX_%'
ORDER BY table_name, index_name;
GO
