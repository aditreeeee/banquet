-- =============================================================================
-- DATABASE VIEWS — Banquet Hall Booking System
-- Dialect: Microsoft SQL Server (T-SQL)
-- Converted from MySQL. Column/table references have been reconciled against
-- the authoritative schema in database/migrations/001_create_schema.sql.
--
-- Key reconciliations vs. the legacy/MySQL view definitions:
--   - Customers holds first_name/last_name/email/phone directly; there is no
--     Customers.user_id -> Users join (Users are staff/admin accounts, not
--     customer accounts). All "customer_name/email/phone" columns now read
--     straight off Customers instead of joining Users.
--   - Bookings has no banquet_id column; Banquets is reached via
--     Halls.banquet_id (b.hall_id -> h.banquet_id -> bq.banquet_id).
--   - Bookings.event_type is a plain NVARCHAR column (no event_type_id FK to
--     EventTypes), so it is selected directly instead of joined.
--   - Column renames: booking_status -> status, booking_date -> event_date,
--     start_time/end_time -> event_time_start/event_time_end,
--     expected_guests -> guest_count, grand_total -> total_amount.
--     balance_due is not a stored column; it is computed as
--     (total_amount - amount_paid).
--   - Payments.payment_status -> Payments.status.
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- VIEW 1: Booking Summary (Main reporting view)
-- =============================================================================
CREATE OR ALTER VIEW vw_booking_summary AS
SELECT
    b.booking_id,
    b.booking_ref,
    b.event_date AS booking_date,
    b.event_time_start AS start_time,
    b.event_time_end AS end_time,
    b.status AS booking_status,
    b.guest_count AS expected_guests,
    b.total_amount AS grand_total,
    b.advance_paid,
    (b.total_amount - b.amount_paid) AS balance_due,
    b.special_requests,
    b.created_at AS booked_at,
    -- Customer (Customers stores contact details directly)
    cust.first_name + ' ' + ISNULL(cust.last_name, '') AS customer_name,
    cust.email AS customer_email,
    cust.phone AS customer_phone,
    -- Event
    b.event_type,
    b.event_name,
    -- Hall
    h.hall_name,
    h.hall_type,
    h.capacity_seated,
    -- Banquet (reached via Halls, Bookings has no banquet_id)
    bq.banquet_name,
    bq.address_line1 AS banquet_address,
    -- Company / Branch
    c.company_name,
    br.branch_name,
    -- Booked by (Bookings.created_by -> Users)
    ub.first_name + ' ' + ub.last_name AS booked_by_name
FROM Bookings b
INNER JOIN Customers cust ON cust.customer_id = b.customer_id
INNER JOIN Halls h ON h.hall_id = b.hall_id
INNER JOIN Banquets bq ON bq.banquet_id = h.banquet_id
INNER JOIN Companies c ON c.company_id = b.company_id
INNER JOIN Branches br ON br.branch_id = b.branch_id
INNER JOIN Users ub ON ub.user_id = b.created_by;
GO

-- =============================================================================
-- VIEW 2: Revenue Report View
-- =============================================================================
CREATE OR ALTER VIEW vw_revenue_report AS
SELECT
    p.payment_id,
    p.payment_ref,
    p.payment_date,
    p.amount,
    p.payment_type,
    p.payment_method,
    p.status AS payment_status,
    p.transaction_id,
    -- Booking
    b.booking_ref,
    b.event_date AS event_date,
    b.total_amount AS booking_amount,
    -- Customer
    cust.first_name + ' ' + ISNULL(cust.last_name, '') AS customer_name,
    cust.email AS customer_email,
    -- Hall & Venue
    h.hall_name,
    bq.banquet_name,
    -- Company & Branch
    c.company_id,
    c.company_name,
    br.branch_id,
    br.branch_name,
    -- Date dimensions for reporting
    YEAR(p.payment_date) AS payment_year,
    MONTH(p.payment_date) AS payment_month,
    DAY(p.payment_date) AS payment_day,
    DATEPART(QUARTER, p.payment_date) AS payment_quarter,
    FORMAT(p.payment_date, 'MMM yyyy') AS month_label
FROM Payments p
INNER JOIN Bookings b ON b.booking_id = p.booking_id
INNER JOIN Customers cust ON cust.customer_id = p.customer_id
INNER JOIN Halls h ON h.hall_id = b.hall_id
INNER JOIN Banquets bq ON bq.banquet_id = h.banquet_id
INNER JOIN Companies c ON c.company_id = p.company_id
INNER JOIN Branches br ON br.branch_id = b.branch_id
WHERE p.status = 'completed';
GO

-- =============================================================================
-- VIEW 3: Hall Occupancy View
-- =============================================================================
CREATE OR ALTER VIEW vw_hall_occupancy AS
SELECT
    h.hall_id,
    h.hall_name,
    h.hall_type,
    h.capacity_seated,
    bq.banquet_id,
    bq.banquet_name,
    br.branch_id,
    br.branch_name,
    c.company_id,
    b.event_date AS booking_date,
    COUNT(b.booking_id) AS bookings_count,
    SUM(b.total_amount) AS date_revenue,
    FORMAT(b.event_date, 'MMM yyyy') AS month_label,
    YEAR(b.event_date) AS booking_year,
    MONTH(b.event_date) AS booking_month
FROM Halls h
INNER JOIN Banquets bq ON bq.banquet_id = h.banquet_id
INNER JOIN Branches br ON br.branch_id = bq.branch_id
INNER JOIN Companies c ON c.company_id = h.company_id
LEFT JOIN Bookings b ON b.hall_id = h.hall_id
    AND b.status NOT IN ('cancelled', 'draft')
WHERE h.is_active = 1
GROUP BY
    h.hall_id, h.hall_name, h.hall_type, h.capacity_seated,
    bq.banquet_id, bq.banquet_name, br.branch_id, br.branch_name,
    c.company_id, b.event_date, FORMAT(b.event_date, 'MMM yyyy'),
    YEAR(b.event_date), MONTH(b.event_date);
GO

-- =============================================================================
-- VIEW 4: Customer Summary View
-- NOTE: Customers has no linked Users account (no user_id), and does not
-- store total_bookings/total_spend/preferred_event/avatar_url/last_login_at
-- as stored columns. Those aggregates are now computed via correlated
-- subqueries / OUTER APPLY against Bookings instead of being read as
-- precomputed columns.
-- =============================================================================
CREATE OR ALTER VIEW vw_customer_summary AS
SELECT
    cust.customer_id,
    cust.customer_code,
    cust.first_name,
    cust.last_name,
    cust.first_name + ' ' + ISNULL(cust.last_name, '') AS full_name,
    cust.email,
    cust.phone,
    cust.is_active,
    cust.company_id,
    c.company_name,
    bstats.total_bookings,
    bstats.total_spend,
    cust.loyalty_points,
    cust.source,
    lb.last_event_type AS preferred_event,
    cust.created_at AS customer_since,
    -- Last booking
    lb.last_booking_date,
    lb.last_event_type,
    lb.last_booking_status
FROM Customers cust
INNER JOIN Companies c ON c.company_id = cust.company_id
OUTER APPLY (
    SELECT
        COUNT(*) AS total_bookings,
        ISNULL(SUM(b2.total_amount), 0) AS total_spend
    FROM Bookings b2
    WHERE b2.customer_id = cust.customer_id
      AND b2.status NOT IN ('cancelled', 'draft')
) bstats
OUTER APPLY (
    SELECT TOP 1
        b.event_date AS last_booking_date,
        b.event_type AS last_event_type,
        b.status AS last_booking_status
    FROM Bookings b
    WHERE b.customer_id = cust.customer_id
    ORDER BY b.event_date DESC
) lb;
GO

-- =============================================================================
-- VIEW 5: Today's Events (Operations View for Branch Manager)
-- =============================================================================
CREATE OR ALTER VIEW vw_todays_events AS
SELECT
    b.booking_id,
    b.booking_ref,
    b.event_time_start AS start_time,
    b.event_time_end AS end_time,
    b.guest_count AS expected_guests,
    b.status AS booking_status,
    b.special_requests,
    cust.first_name + ' ' + ISNULL(cust.last_name, '') AS customer_name,
    cust.phone AS customer_phone,
    b.event_type,
    b.event_name,
    h.hall_name,
    h.floor_number,
    bq.banquet_name,
    br.branch_id,
    c.company_id,
    (b.total_amount - b.amount_paid) AS balance_due
FROM Bookings b
INNER JOIN Customers cust ON cust.customer_id = b.customer_id
INNER JOIN Halls h ON h.hall_id = b.hall_id
INNER JOIN Banquets bq ON bq.banquet_id = h.banquet_id
INNER JOIN Branches br ON br.branch_id = b.branch_id
INNER JOIN Companies c ON c.company_id = b.company_id
WHERE b.event_date = CAST(GETDATE() AS DATE)
AND b.status IN ('confirmed', 'advance_paid', 'fully_paid');
GO

-- =============================================================================
-- VIEW 6: Pending Payments View
-- =============================================================================
CREATE OR ALTER VIEW vw_pending_payments AS
SELECT
    b.booking_id,
    b.booking_ref,
    b.event_date AS booking_date,
    b.status AS booking_status,
    b.total_amount AS grand_total,
    b.advance_paid,
    (b.total_amount - b.amount_paid) AS balance_due,
    cust.first_name + ' ' + ISNULL(cust.last_name, '') AS customer_name,
    cust.phone AS customer_phone,
    cust.email AS customer_email,
    h.hall_name,
    bq.banquet_name,
    c.company_id,
    br.branch_id,
    b.event_type,
    DATEDIFF(DAY, GETDATE(), b.event_date) AS days_until_event
FROM Bookings b
INNER JOIN Customers cust ON cust.customer_id = b.customer_id
INNER JOIN Halls h ON h.hall_id = b.hall_id
INNER JOIN Banquets bq ON bq.banquet_id = h.banquet_id
INNER JOIN Companies c ON c.company_id = b.company_id
INNER JOIN Branches br ON br.branch_id = b.branch_id
WHERE (b.total_amount - b.amount_paid) > 0
AND b.status IN ('confirmed', 'advance_paid')
AND b.event_date >= CAST(GETDATE() AS DATE);
GO

PRINT 'Views created successfully.';
GO
