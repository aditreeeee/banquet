-- =============================================================================
-- DATABASE VIEWS — Banquet Hall Booking System
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
    b.booking_date,
    b.start_time,
    b.end_time,
    b.booking_status,
    b.expected_guests,
    b.grand_total,
    b.advance_paid,
    b.balance_due,
    b.special_requests,
    b.created_at AS booked_at,
    -- Customer
    u.first_name + ' ' + u.last_name AS customer_name,
    u.email AS customer_email,
    u.phone AS customer_phone,
    -- Event
    et.type_name AS event_type,
    b.event_name,
    -- Hall
    h.hall_name,
    h.hall_type,
    h.capacity_seated,
    -- Banquet
    bq.banquet_name,
    bq.address_line1 AS banquet_address,
    -- Company / Branch
    c.company_name,
    br.branch_name,
    -- Booked by
    ub.first_name + ' ' + ub.last_name AS booked_by_name
FROM bookings b
INNER JOIN customers cust ON cust.customer_id = b.customer_id
INNER JOIN users u ON u.user_id = cust.user_id
INNER JOIN event_types et ON et.event_type_id = b.event_type_id
INNER JOIN halls h ON h.hall_id = b.hall_id
INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
INNER JOIN companies c ON c.company_id = b.company_id
INNER JOIN branches br ON br.branch_id = b.branch_id
INNER JOIN users ub ON ub.user_id = b.booked_by;
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
    p.payment_status,
    p.transaction_id,
    -- Booking
    b.booking_ref,
    b.booking_date AS event_date,
    b.grand_total AS booking_amount,
    -- Customer
    u.first_name + ' ' + u.last_name AS customer_name,
    u.email AS customer_email,
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
FROM payments p
INNER JOIN bookings b ON b.booking_id = p.booking_id
INNER JOIN customers cust ON cust.customer_id = p.customer_id
INNER JOIN users u ON u.user_id = cust.user_id
INNER JOIN halls h ON h.hall_id = b.hall_id
INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
INNER JOIN companies c ON c.company_id = p.company_id
INNER JOIN branches br ON br.branch_id = b.branch_id
WHERE p.payment_status = 'completed';
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
    b.booking_date,
    COUNT(b.booking_id) AS bookings_count,
    SUM(b.grand_total) AS date_revenue,
    FORMAT(b.booking_date, 'MMM yyyy') AS month_label,
    YEAR(b.booking_date) AS booking_year,
    MONTH(b.booking_date) AS booking_month
FROM halls h
INNER JOIN banquets bq ON bq.banquet_id = h.banquet_id
INNER JOIN branches br ON br.branch_id = bq.branch_id
INNER JOIN companies c ON c.company_id = h.company_id
LEFT JOIN bookings b ON b.hall_id = h.hall_id
    AND b.booking_status NOT IN ('cancelled', 'draft')
WHERE h.is_active = 1
GROUP BY
    h.hall_id, h.hall_name, h.hall_type, h.capacity_seated,
    bq.banquet_id, bq.banquet_name, br.branch_id, br.branch_name,
    c.company_id, b.booking_date, FORMAT(b.booking_date, 'MMM yyyy'),
    YEAR(b.booking_date), MONTH(b.booking_date);
GO

-- =============================================================================
-- VIEW 4: Customer Summary View
-- =============================================================================
CREATE OR ALTER VIEW vw_customer_summary AS
SELECT
    cust.customer_id,
    cust.customer_code,
    u.first_name,
    u.last_name,
    u.first_name + ' ' + u.last_name AS full_name,
    u.email,
    u.phone,
    u.avatar_url,
    u.is_active,
    u.last_login_at,
    cust.company_id,
    c.company_name,
    cust.total_bookings,
    cust.total_spend,
    cust.loyalty_points,
    cust.source,
    cust.preferred_event,
    cust.created_at AS customer_since,
    -- Last booking
    lb.last_booking_date,
    lb.last_event_type,
    lb.last_booking_status
FROM customers cust
INNER JOIN users u ON u.user_id = cust.user_id
INNER JOIN companies c ON c.company_id = cust.company_id
OUTER APPLY (
    SELECT TOP 1
        b.booking_date AS last_booking_date,
        et.type_name AS last_event_type,
        b.booking_status AS last_booking_status
    FROM bookings b
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    WHERE b.customer_id = cust.customer_id
    ORDER BY b.booking_date DESC
) lb;
GO

-- =============================================================================
-- VIEW 5: Today's Events (Operations View for Branch Manager)
-- =============================================================================
CREATE OR ALTER VIEW vw_todays_events AS
SELECT
    b.booking_id,
    b.booking_ref,
    b.start_time,
    b.end_time,
    b.expected_guests,
    b.booking_status,
    b.special_requests,
    u.first_name + ' ' + u.last_name AS customer_name,
    u.phone AS customer_phone,
    et.type_name AS event_type,
    b.event_name,
    h.hall_name,
    h.floor_number,
    bq.banquet_name,
    br.branch_id,
    c.company_id,
    b.balance_due
FROM bookings b
INNER JOIN customers cust ON cust.customer_id = b.customer_id
INNER JOIN users u ON u.user_id = cust.user_id
INNER JOIN event_types et ON et.event_type_id = b.event_type_id
INNER JOIN halls h ON h.hall_id = b.hall_id
INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
INNER JOIN branches br ON br.branch_id = b.branch_id
INNER JOIN companies c ON c.company_id = b.company_id
WHERE b.booking_date = CAST(GETDATE() AS DATE)
AND b.booking_status IN ('confirmed','advance_paid','fully_paid');
GO

-- =============================================================================
-- VIEW 6: Pending Payments View
-- =============================================================================
CREATE OR ALTER VIEW vw_pending_payments AS
SELECT
    b.booking_id,
    b.booking_ref,
    b.booking_date,
    b.booking_status,
    b.grand_total,
    b.advance_paid,
    b.balance_due,
    u.first_name + ' ' + u.last_name AS customer_name,
    u.phone AS customer_phone,
    u.email AS customer_email,
    h.hall_name,
    bq.banquet_name,
    c.company_id,
    br.branch_id,
    et.type_name AS event_type,
    DATEDIFF(DAY, GETDATE(), b.booking_date) AS days_until_event
FROM bookings b
INNER JOIN customers cust ON cust.customer_id = b.customer_id
INNER JOIN users u ON u.user_id = cust.user_id
INNER JOIN event_types et ON et.event_type_id = b.event_type_id
INNER JOIN halls h ON h.hall_id = b.hall_id
INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
INNER JOIN companies c ON c.company_id = b.company_id
INNER JOIN branches br ON br.branch_id = b.branch_id
WHERE b.balance_due > 0
AND b.booking_status IN ('confirmed','advance_paid')
AND b.booking_date >= CAST(GETDATE() AS DATE);
GO

PRINT 'Views created successfully.';
GO
