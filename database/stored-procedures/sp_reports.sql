-- =============================================================================
-- STORED PROCEDURES: REPORTS & ANALYTICS MODULE
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- SP 1: Revenue Report
-- Flexible date range, group by day/week/month/year
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_RevenueReport
    @company_id     INT,
    @branch_id      INT  = NULL,
    @from_date      DATE = NULL,
    @to_date        DATE = NULL,
    @group_by       NVARCHAR(10) = 'month',  -- 'day','week','month','quarter','year'
    @payment_method NVARCHAR(30) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), 1, 1);
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    -- Summary totals
    SELECT
        SUM(p.amount)               AS total_revenue,
        COUNT(*)                    AS total_transactions,
        COUNT(DISTINCT p.booking_id) AS total_bookings,
        AVG(p.amount)               AS avg_transaction,
        SUM(CASE WHEN p.payment_method = 'cash'          THEN p.amount ELSE 0 END) AS cash_revenue,
        SUM(CASE WHEN p.payment_method = 'card'          THEN p.amount ELSE 0 END) AS card_revenue,
        SUM(CASE WHEN p.payment_method = 'upi'           THEN p.amount ELSE 0 END) AS upi_revenue,
        SUM(CASE WHEN p.payment_method = 'bank_transfer' THEN p.amount ELSE 0 END) AS bank_revenue,
        SUM(CASE WHEN p.payment_method = 'cheque'        THEN p.amount ELSE 0 END) AS cheque_revenue,
        SUM(CASE WHEN p.payment_method = 'online'        THEN p.amount ELSE 0 END) AS online_revenue
    FROM payments p
    INNER JOIN bookings b ON b.booking_id = p.booking_id
    WHERE p.company_id = @company_id
      AND p.payment_date BETWEEN @from_date AND @to_date
      AND p.payment_status = 'completed'
      AND (@branch_id      IS NULL OR b.branch_id = @branch_id)
      AND (@payment_method IS NULL OR p.payment_method = @payment_method);

    -- Trend data (group by period)
    SELECT
        CASE @group_by
            WHEN 'day'     THEN FORMAT(p.payment_date, 'dd MMM yyyy')
            WHEN 'week'    THEN 'W' + CAST(DATEPART(ISO_WEEK, p.payment_date) AS NVARCHAR) + ' ' + CAST(YEAR(p.payment_date) AS NVARCHAR)
            WHEN 'month'   THEN FORMAT(p.payment_date, 'MMM yyyy')
            WHEN 'quarter' THEN 'Q' + CAST(DATEPART(QUARTER, p.payment_date) AS NVARCHAR) + ' ' + CAST(YEAR(p.payment_date) AS NVARCHAR)
            WHEN 'year'    THEN CAST(YEAR(p.payment_date) AS NVARCHAR(4))
        END AS period_label,
        YEAR(p.payment_date)    AS yr,
        MONTH(p.payment_date)   AS mo,
        DAY(p.payment_date)     AS dy,
        SUM(p.amount)           AS revenue,
        COUNT(*)                AS transactions,
        COUNT(DISTINCT p.booking_id) AS bookings
    FROM payments p
    INNER JOIN bookings b ON b.booking_id = p.booking_id
    WHERE p.company_id = @company_id
      AND p.payment_date BETWEEN @from_date AND @to_date
      AND p.payment_status = 'completed'
      AND (@branch_id      IS NULL OR b.branch_id = @branch_id)
      AND (@payment_method IS NULL OR p.payment_method = @payment_method)
    GROUP BY
        CASE @group_by
            WHEN 'day'     THEN FORMAT(p.payment_date, 'dd MMM yyyy')
            WHEN 'week'    THEN 'W' + CAST(DATEPART(ISO_WEEK, p.payment_date) AS NVARCHAR) + ' ' + CAST(YEAR(p.payment_date) AS NVARCHAR)
            WHEN 'month'   THEN FORMAT(p.payment_date, 'MMM yyyy')
            WHEN 'quarter' THEN 'Q' + CAST(DATEPART(QUARTER, p.payment_date) AS NVARCHAR) + ' ' + CAST(YEAR(p.payment_date) AS NVARCHAR)
            WHEN 'year'    THEN CAST(YEAR(p.payment_date) AS NVARCHAR(4))
        END,
        YEAR(p.payment_date), MONTH(p.payment_date), DAY(p.payment_date)
    ORDER BY yr, mo, dy;

    -- Revenue by event type
    SELECT
        et.type_name AS event_type,
        COUNT(DISTINCT b.booking_id) AS booking_count,
        SUM(p.amount) AS revenue,
        CAST(100.0 * SUM(p.amount) / NULLIF(SUM(SUM(p.amount)) OVER (), 0) AS DECIMAL(5,2)) AS revenue_pct
    FROM payments p
    INNER JOIN bookings b ON b.booking_id = p.booking_id
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    WHERE p.company_id = @company_id
      AND p.payment_date BETWEEN @from_date AND @to_date
      AND p.payment_status = 'completed'
      AND (@branch_id IS NULL OR b.branch_id = @branch_id)
    GROUP BY et.type_name
    ORDER BY revenue DESC;
END;
GO

-- =============================================================================
-- SP 2: Booking Report
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_BookingReport
    @company_id     INT,
    @branch_id      INT  = NULL,
    @hall_id        INT  = NULL,
    @from_date      DATE = NULL,
    @to_date        DATE = NULL,
    @booking_status NVARCHAR(30) = NULL,
    @event_type_id  INT  = NULL,
    @page           INT  = 1,
    @limit          INT  = 50
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), 1, 1);
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    DECLARE @offset INT = (@page - 1) * @limit;

    -- Summary
    SELECT
        COUNT(*)                        AS total_bookings,
        SUM(b.grand_total)              AS total_value,
        SUM(b.advance_paid)             AS total_collected,
        SUM(b.balance_due)              AS total_outstanding,
        AVG(b.expected_guests)          AS avg_guests,
        SUM(CASE WHEN b.booking_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
        SUM(CASE WHEN b.booking_status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN b.booking_status IN ('confirmed','advance_paid','fully_paid') THEN 1 ELSE 0 END) AS active_count
    FROM bookings b
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND (@branch_id      IS NULL OR b.branch_id     = @branch_id)
      AND (@hall_id        IS NULL OR b.hall_id        = @hall_id)
      AND (@booking_status IS NULL OR b.booking_status = @booking_status)
      AND (@event_type_id  IS NULL OR b.event_type_id  = @event_type_id);

    -- Breakdown by event type
    SELECT
        et.type_name AS event_type,
        COUNT(*) AS bookings,
        SUM(b.grand_total) AS revenue,
        AVG(b.expected_guests) AS avg_guests
    FROM bookings b
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND b.booking_status NOT IN ('cancelled','draft')
      AND (@branch_id IS NULL OR b.branch_id = @branch_id)
    GROUP BY et.type_name
    ORDER BY bookings DESC;

    -- Paged detail records
    SELECT COUNT(*) AS detail_total
    FROM bookings b
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND (@branch_id      IS NULL OR b.branch_id     = @branch_id)
      AND (@hall_id        IS NULL OR b.hall_id        = @hall_id)
      AND (@booking_status IS NULL OR b.booking_status = @booking_status)
      AND (@event_type_id  IS NULL OR b.event_type_id  = @event_type_id);

    SELECT
        b.booking_id, b.booking_ref, b.booking_date, b.start_time, b.end_time,
        b.booking_status, b.expected_guests, b.grand_total, b.advance_paid, b.balance_due,
        u.first_name + ' ' + u.last_name AS customer_name,
        u.phone AS customer_phone,
        et.type_name AS event_type, b.event_name,
        h.hall_name, bq.banquet_name, br.branch_name,
        b.created_at AS booked_at
    FROM bookings b
    INNER JOIN customers c ON c.customer_id = b.customer_id
    INNER JOIN users u ON u.user_id = c.user_id
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    INNER JOIN halls h ON h.hall_id = b.hall_id
    INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
    INNER JOIN branches br ON br.branch_id = b.branch_id
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND (@branch_id      IS NULL OR b.branch_id     = @branch_id)
      AND (@hall_id        IS NULL OR b.hall_id        = @hall_id)
      AND (@booking_status IS NULL OR b.booking_status = @booking_status)
      AND (@event_type_id  IS NULL OR b.event_type_id  = @event_type_id)
    ORDER BY b.booking_date DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
END;
GO

-- =============================================================================
-- SP 3: Hall Occupancy Report
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_OccupancyReport
    @company_id     INT,
    @branch_id      INT  = NULL,
    @from_date      DATE = NULL,
    @to_date        DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    IF @to_date   IS NULL SET @to_date   = EOMONTH(GETDATE());

    DECLARE @total_days INT = DATEDIFF(DAY, @from_date, @to_date) + 1;

    -- Per-hall occupancy
    SELECT
        h.hall_id,
        h.hall_name,
        h.hall_type,
        h.capacity_seated,
        bq.banquet_name,
        br.branch_name,
        COUNT(b.booking_id)             AS total_bookings,
        @total_days                     AS total_available_days,
        CAST(100.0 * COUNT(b.booking_id) / NULLIF(@total_days, 0) AS DECIMAL(5,2)) AS occupancy_rate,
        ISNULL(SUM(b.grand_total), 0)   AS revenue_generated,
        ISNULL(SUM(b.expected_guests), 0) AS total_guests_hosted,
        ISNULL(AVG(b.grand_total), 0)   AS avg_booking_value
    FROM halls h
    INNER JOIN banquets bq ON bq.banquet_id = h.banquet_id
    INNER JOIN branches br ON br.branch_id = bq.branch_id
    LEFT JOIN bookings b ON b.hall_id = h.hall_id
        AND b.booking_date BETWEEN @from_date AND @to_date
        AND b.booking_status NOT IN ('cancelled','draft')
    WHERE h.company_id = @company_id AND h.is_active = 1
      AND (@branch_id IS NULL OR br.branch_id = @branch_id)
    GROUP BY h.hall_id, h.hall_name, h.hall_type, h.capacity_seated, bq.banquet_name, br.branch_name
    ORDER BY occupancy_rate DESC;

    -- Monthly occupancy trend (last 6 months)
    SELECT
        FORMAT(b.booking_date, 'MMM yyyy') AS month_label,
        YEAR(b.booking_date)  AS yr,
        MONTH(b.booking_date) AS mo,
        COUNT(*) AS bookings,
        COUNT(DISTINCT b.hall_id) AS halls_used,
        ISNULL(SUM(b.grand_total), 0) AS revenue
    FROM bookings b
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND b.booking_status NOT IN ('cancelled','draft')
      AND (@branch_id IS NULL OR b.branch_id = @branch_id)
    GROUP BY FORMAT(b.booking_date, 'MMM yyyy'), YEAR(b.booking_date), MONTH(b.booking_date)
    ORDER BY yr, mo;

    -- Peak days analysis
    SELECT
        DATENAME(WEEKDAY, b.booking_date) AS day_name,
        DATEPART(WEEKDAY, b.booking_date) AS day_number,
        COUNT(*) AS booking_count,
        ISNULL(SUM(b.grand_total), 0) AS revenue
    FROM bookings b
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND b.booking_status NOT IN ('cancelled','draft')
      AND (@branch_id IS NULL OR b.branch_id = @branch_id)
    GROUP BY DATENAME(WEEKDAY, b.booking_date), DATEPART(WEEKDAY, b.booking_date)
    ORDER BY day_number;
END;
GO

-- =============================================================================
-- SP 4: Customer Growth Report
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CustomerGrowthReport
    @company_id INT,
    @from_date  DATE = NULL,
    @to_date    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), 1, 1);
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    -- Summary
    SELECT
        COUNT(*) AS total_customers,
        SUM(CASE WHEN c.created_at >= @from_date AND c.created_at <= @to_date THEN 1 ELSE 0 END) AS new_customers,
        SUM(CASE WHEN c.total_bookings > 1 THEN 1 ELSE 0 END) AS repeat_customers,
        AVG(CAST(c.total_bookings AS DECIMAL(10,2))) AS avg_bookings_per_customer,
        AVG(c.total_spend) AS avg_spend_per_customer,
        SUM(c.total_spend) AS total_customer_spend
    FROM customers c
    WHERE c.company_id = @company_id;

    -- Monthly new customer registrations
    SELECT
        FORMAT(c.created_at, 'MMM yyyy') AS month_label,
        YEAR(c.created_at)  AS yr,
        MONTH(c.created_at) AS mo,
        COUNT(*) AS new_customers
    FROM customers c
    WHERE c.company_id = @company_id
      AND CAST(c.created_at AS DATE) BETWEEN @from_date AND @to_date
    GROUP BY FORMAT(c.created_at, 'MMM yyyy'), YEAR(c.created_at), MONTH(c.created_at)
    ORDER BY yr, mo;

    -- Top customers by spend
    SELECT TOP 20
        c.customer_id, c.customer_code,
        u.first_name + ' ' + u.last_name AS customer_name,
        u.phone, u.email,
        c.total_bookings, c.total_spend, c.loyalty_points,
        c.source, c.created_at AS customer_since
    FROM customers c
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE c.company_id = @company_id
    ORDER BY c.total_spend DESC;

    -- Customer source analysis
    SELECT
        ISNULL(c.source, 'unknown') AS source,
        COUNT(*) AS customers,
        CAST(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0) AS DECIMAL(5,2)) AS source_pct,
        SUM(c.total_spend) AS total_revenue
    FROM customers c
    WHERE c.company_id = @company_id
    GROUP BY c.source
    ORDER BY customers DESC;
END;
GO

-- =============================================================================
-- SP 5: Tax Report (GST Liability)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_TaxReport
    @company_id INT,
    @from_date  DATE = NULL,
    @to_date    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    IF @to_date   IS NULL SET @to_date   = EOMONTH(GETDATE());

    SELECT
        i.invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.taxable_amount,
        i.cgst_rate,  i.cgst_amount,
        i.sgst_rate,  i.sgst_amount,
        i.igst_rate,  i.igst_amount,
        i.total_tax,
        i.grand_total,
        i.payment_status,
        u.first_name + ' ' + u.last_name AS customer_name,
        b.booking_ref,
        et.type_name AS event_type
    FROM invoices i
    INNER JOIN bookings b ON b.booking_id = i.booking_id
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    INNER JOIN customers c ON c.customer_id = i.customer_id
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE i.company_id = @company_id
      AND i.invoice_date BETWEEN @from_date AND @to_date
      AND i.is_cancelled = 0
    ORDER BY i.invoice_date;

    -- GST Summary
    SELECT
        SUM(i.taxable_amount)   AS total_taxable_value,
        SUM(i.cgst_amount)      AS total_cgst,
        SUM(i.sgst_amount)      AS total_sgst,
        SUM(i.igst_amount)      AS total_igst,
        SUM(i.total_tax)        AS total_gst_liability,
        SUM(i.grand_total)      AS total_invoice_value
    FROM invoices i
    WHERE i.company_id = @company_id
      AND i.invoice_date BETWEEN @from_date AND @to_date
      AND i.is_cancelled = 0;
END;
GO

-- =============================================================================
-- SP 6: Employee Performance Report
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_EmployeePerformanceReport
    @company_id INT,
    @branch_id  INT  = NULL,
    @from_date  DATE = NULL,
    @to_date    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    IF @to_date   IS NULL SET @to_date   = EOMONTH(GETDATE());

    SELECT
        u.user_id,
        u.first_name + ' ' + u.last_name AS staff_name,
        r.role_name,
        br.branch_name,
        COUNT(b.booking_id)             AS bookings_created,
        SUM(b.grand_total)              AS revenue_generated,
        AVG(b.grand_total)              AS avg_booking_value,
        SUM(b.expected_guests)          AS total_guests_managed,
        SUM(CASE WHEN b.booking_status = 'cancelled' THEN 1 ELSE 0 END) AS cancellations,
        SUM(p.amount)                   AS payments_collected,
        COUNT(DISTINCT p.payment_id)    AS payment_transactions
    FROM users u
    INNER JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN branches br ON br.branch_id = u.branch_id
    LEFT JOIN bookings b ON b.booked_by = u.user_id
        AND b.created_at >= @from_date AND b.created_at <= @to_date
    LEFT JOIN payments p ON p.collected_by = u.user_id
        AND p.payment_date BETWEEN @from_date AND @to_date
        AND p.payment_status = 'completed'
    WHERE u.company_id = @company_id
      AND r.role_slug IN ('branch_manager','booking_executive')
      AND (@branch_id IS NULL OR u.branch_id = @branch_id)
    GROUP BY u.user_id, u.first_name, u.last_name, r.role_name, br.branch_name
    ORDER BY revenue_generated DESC;
END;
GO

-- =============================================================================
-- SP 7: Resource Usage Report
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ResourceUsageReport
    @company_id INT,
    @banquet_id INT  = NULL,
    @from_date  DATE = NULL,
    @to_date    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), 1, 1);
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    SELECT
        res.resource_id,
        res.resource_name,
        res.resource_type,
        res.total_quantity,
        bq.banquet_name,
        COUNT(br.allocation_id)         AS times_allocated,
        SUM(br.quantity)                AS total_units_used,
        SUM(br.charge)                  AS total_revenue,
        AVG(br.charge)                  AS avg_charge_per_use
    FROM resources res
    INNER JOIN banquets bq ON bq.banquet_id = res.banquet_id
    LEFT JOIN booking_resources br ON br.resource_id = res.resource_id
    LEFT JOIN bookings b ON b.booking_id = br.booking_id
        AND b.booking_date BETWEEN @from_date AND @to_date
        AND b.booking_status NOT IN ('cancelled','draft')
    WHERE res.company_id = @company_id
      AND (@banquet_id IS NULL OR res.banquet_id = @banquet_id)
    GROUP BY res.resource_id, res.resource_name, res.resource_type, res.total_quantity, bq.banquet_name
    ORDER BY times_allocated DESC;
END;
GO

-- =============================================================================
-- SP 8: Catering / Food Sales Report
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_FoodSalesReport
    @company_id INT,
    @branch_id  INT  = NULL,
    @from_date  DATE = NULL,
    @to_date    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = DATEFROMPARTS(YEAR(GETDATE()), 1, 1);
    IF @to_date   IS NULL SET @to_date   = CAST(GETDATE() AS DATE);

    -- Summary
    SELECT
        COUNT(bc.catering_id)           AS total_catering_bookings,
        SUM(bc.plate_count)             AS total_plates_served,
        SUM(bc.catering_total)          AS total_catering_revenue,
        AVG(bc.price_per_plate)         AS avg_price_per_plate,
        SUM(CASE WHEN bc.food_type = 'veg'     THEN bc.plate_count ELSE 0 END) AS veg_plates,
        SUM(CASE WHEN bc.food_type = 'non_veg' THEN bc.plate_count ELSE 0 END) AS non_veg_plates
    FROM booking_catering bc
    INNER JOIN bookings b ON b.booking_id = bc.booking_id
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND b.booking_status NOT IN ('cancelled','draft')
      AND (@branch_id IS NULL OR b.branch_id = @branch_id);

    -- Package-wise breakdown
    SELECT
        ISNULL(cp.package_name, 'Custom') AS package_name,
        cp.package_type,
        COUNT(*) AS orders,
        SUM(bc.plate_count) AS total_plates,
        SUM(bc.catering_total) AS revenue
    FROM booking_catering bc
    INNER JOIN bookings b ON b.booking_id = bc.booking_id
    LEFT JOIN catering_packages cp ON cp.package_id = bc.package_id
    WHERE b.company_id = @company_id
      AND b.booking_date BETWEEN @from_date AND @to_date
      AND b.booking_status NOT IN ('cancelled','draft')
      AND (@branch_id IS NULL OR b.branch_id = @branch_id)
    GROUP BY cp.package_name, cp.package_type
    ORDER BY revenue DESC;
END;
GO

PRINT 'Report stored procedures created successfully.';
GO
