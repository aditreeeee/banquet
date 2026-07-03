-- =============================================================================
-- STORED PROCEDURES: BOOKING ENGINE
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- SP 1: Check Hall Availability
-- Checks if a hall is available for a given date/time range
-- Returns: 1 = Available, 0 = Not Available + reason
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CheckHallAvailability
    @hall_id        INT,
    @booking_date   DATE,
    @start_time     TIME,
    @end_time       TIME,
    @exclude_booking_id BIGINT = NULL  -- for editing an existing booking
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @is_available BIT = 1;
    DECLARE @reason NVARCHAR(200) = NULL;
    DECLARE @conflict_booking_ref NVARCHAR(20) = NULL;

    -- Check if hall is active
    IF NOT EXISTS (
        SELECT 1 FROM halls
        WHERE hall_id = @hall_id AND is_active = 1 AND is_under_maintenance = 0
    )
    BEGIN
        SELECT 0 AS is_available, 'Hall is inactive or under maintenance' AS reason, NULL AS conflict_ref;
        RETURN;
    END

    -- Check blocked dates
    IF EXISTS (
        SELECT 1 FROM hall_blocked_dates
        WHERE hall_id = @hall_id
        AND blocked_date = @booking_date
        AND (
            (start_time IS NULL) OR  -- full day block
            (@start_time < end_time AND @end_time > start_time)  -- time overlap
        )
    )
    BEGIN
        SELECT 0 AS is_available, 'Hall is blocked for this date/time' AS reason, NULL AS conflict_ref;
        RETURN;
    END

    -- Check conflicting bookings (with row-level locking)
    SELECT TOP 1 @conflict_booking_ref = booking_ref
    FROM bookings WITH (UPDLOCK, ROWLOCK)
    WHERE hall_id = @hall_id
    AND booking_date = @booking_date
    AND booking_status NOT IN ('cancelled', 'draft')
    AND (booking_id <> ISNULL(@exclude_booking_id, -1))
    AND (
        @start_time < end_time AND @end_time > start_time
    );

    IF @conflict_booking_ref IS NOT NULL
    BEGIN
        SELECT 0 AS is_available,
               'Hall is already booked (Ref: ' + @conflict_booking_ref + ')' AS reason,
               @conflict_booking_ref AS conflict_ref;
        RETURN;
    END

    SELECT 1 AS is_available, NULL AS reason, NULL AS conflict_ref;
END;
GO

-- =============================================================================
-- SP 2: Calculate Booking Price
-- Dynamic pricing calculation based on date, slot, add-ons
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CalculateBookingPrice
    @hall_id            INT,
    @booking_date       DATE,
    @slot_id            INT = NULL,
    @plate_count        INT = 0,
    @catering_package_id INT = NULL,
    @coupon_code        NVARCHAR(50) = NULL,
    @company_id         INT,
    @decoration_total   DECIMAL(14,2) = 0,
    @services_total     DECIMAL(14,2) = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @base_price         DECIMAL(14,2) = 0;
    DECLARE @slot_price         DECIMAL(14,2) = 0;
    DECLARE @special_price      DECIMAL(14,2) = 0;
    DECLARE @catering_total     DECIMAL(14,2) = 0;
    DECLARE @discount_amount    DECIMAL(14,2) = 0;
    DECLARE @subtotal           DECIMAL(14,2) = 0;
    DECLARE @tax_amount         DECIMAL(14,2) = 0;
    DECLARE @grand_total        DECIMAL(14,2) = 0;
    DECLARE @pricing_id         INT;
    DECLARE @day_of_week        TINYINT;
    DECLARE @weekend_mult       DECIMAL(5,2) = 1.00;
    DECLARE @special_mult       DECIMAL(5,2) = 1.00;
    DECLARE @tax_rate           DECIMAL(5,2) = 18.00;  -- GST default
    DECLARE @coupon_id          INT = NULL;
    DECLARE @price_per_plate    DECIMAL(10,2) = 0;

    -- Get day of week (1=Sunday, 7=Saturday)
    SET @day_of_week = DATEPART(WEEKDAY, @booking_date);

    -- Get active pricing for hall
    SELECT TOP 1
        @pricing_id     = pricing_id,
        @base_price     = base_price,
        @weekend_mult   = weekend_multiplier
    FROM hall_pricing
    WHERE hall_id = @hall_id AND is_active = 1
    AND (valid_from IS NULL OR valid_from <= @booking_date)
    AND (valid_to IS NULL OR valid_to >= @booking_date)
    ORDER BY valid_from DESC;

    -- Apply weekend multiplier (Saturday=7, Sunday=1)
    IF @day_of_week IN (1, 7)
        SET @base_price = @base_price * @weekend_mult;

    -- Check special / festival pricing
    SELECT TOP 1
        @special_mult = multiplier,
        @special_price = ISNULL(flat_price, 0)
    FROM special_pricing
    WHERE (hall_id = @hall_id OR hall_id IS NULL)
    AND company_id = @company_id
    AND special_date = @booking_date
    AND is_active = 1
    ORDER BY hall_id DESC;  -- prefer hall-specific over all-halls

    IF @special_price > 0
        SET @base_price = @special_price;  -- flat override
    ELSE IF @special_mult > 1
        SET @base_price = @base_price * @special_mult;

    -- Get slot price if slot-based booking
    IF @slot_id IS NOT NULL
    BEGIN
        SELECT @slot_price = slot_price
        FROM pricing_slots
        WHERE slot_id = @slot_id AND pricing_id = @pricing_id AND is_active = 1;

        IF @slot_price > 0
            SET @base_price = @slot_price;
    END;

    -- Catering calculation
    IF @catering_package_id IS NOT NULL AND @plate_count > 0
    BEGIN
        SELECT @price_per_plate = price_per_plate
        FROM catering_packages
        WHERE package_id = @catering_package_id AND is_active = 1;

        SET @catering_total = @price_per_plate * @plate_count;
    END;

    -- Subtotal before discount
    SET @subtotal = @base_price + @catering_total + @decoration_total + @services_total;

    -- Apply coupon
    IF @coupon_code IS NOT NULL AND @coupon_code <> ''
    BEGIN
        DECLARE @discount_type NVARCHAR(20);
        DECLARE @discount_value DECIMAL(10,2);
        DECLARE @max_discount DECIMAL(10,2);
        DECLARE @min_amount DECIMAL(10,2);
        DECLARE @usage_limit INT;
        DECLARE @used_count INT;

        SELECT
            @coupon_id      = coupon_id,
            @discount_type  = discount_type,
            @discount_value = discount_value,
            @max_discount   = max_discount_amount,
            @min_amount     = min_booking_amount,
            @usage_limit    = usage_limit,
            @used_count     = used_count
        FROM coupons
        WHERE company_id = @company_id
        AND coupon_code = @coupon_code
        AND is_active = 1
        AND valid_from <= GETUTCDATE()
        AND valid_to >= GETUTCDATE();

        IF @coupon_id IS NOT NULL AND @subtotal >= @min_amount
            AND (@usage_limit IS NULL OR @used_count < @usage_limit)
        BEGIN
            IF @discount_type = 'percentage'
                SET @discount_amount = (@subtotal * @discount_value) / 100;
            ELSE
                SET @discount_amount = @discount_value;

            -- Cap at max_discount
            IF @max_discount IS NOT NULL AND @discount_amount > @max_discount
                SET @discount_amount = @max_discount;
        END;
    END;

    -- Tax calculation (GST 18%)
    DECLARE @taxable_amount DECIMAL(14,2) = @subtotal - @discount_amount;

    SELECT TOP 1 @tax_rate = rate
    FROM tax_config
    WHERE company_id = @company_id AND is_active = 1
    AND effective_from <= GETDATE()
    AND (effective_to IS NULL OR effective_to >= GETDATE())
    ORDER BY effective_from DESC;

    SET @tax_amount = (@taxable_amount * @tax_rate) / 100;
    SET @grand_total = @taxable_amount + @tax_amount;

    -- Return price breakdown
    SELECT
        @base_price         AS hall_price,
        @catering_total     AS catering_total,
        @decoration_total   AS decoration_total,
        @services_total     AS services_total,
        @subtotal           AS subtotal,
        @discount_amount    AS discount_amount,
        @taxable_amount     AS taxable_amount,
        @tax_rate           AS tax_rate,
        @tax_amount         AS tax_amount,
        @grand_total        AS grand_total,
        @coupon_id          AS coupon_id,
        CEILING(@grand_total * 0.25) AS advance_required;  -- 25% advance
END;
GO

-- =============================================================================
-- SP 3: Create Booking (Transactional)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CreateBooking
    @company_id         INT,
    @branch_id          INT,
    @banquet_id         INT,
    @hall_id            INT,
    @customer_id        INT,
    @pricing_id         INT,
    @slot_id            INT = NULL,
    @event_type_id      INT,
    @event_name         NVARCHAR(200) = NULL,
    @booking_date       DATE,
    @start_time         TIME,
    @end_time           TIME,
    @expected_guests    INT,
    @grand_total        DECIMAL(14,2),
    @advance_paid       DECIMAL(14,2) = 0,
    @coupon_id          INT = NULL,
    @coupon_code        NVARCHAR(50) = NULL,
    @special_requests   NVARCHAR(MAX) = NULL,
    @booked_by          INT,
    @booking_id         BIGINT OUTPUT,
    @booking_ref        NVARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Final availability check (within transaction)
        DECLARE @is_available BIT;
        EXEC sp_CheckHallAvailability
            @hall_id = @hall_id,
            @booking_date = @booking_date,
            @start_time = @start_time,
            @end_time = @end_time;

        -- Generate booking reference: BNQ-YYYY-XXXXXX
        DECLARE @year NVARCHAR(4) = CAST(YEAR(@booking_date) AS NVARCHAR(4));
        DECLARE @seq INT;

        SELECT @seq = ISNULL(MAX(booking_id), 0) + 1 FROM bookings WITH (TABLOCKX);
        SET @booking_ref = 'BNQ-' + @year + '-' + RIGHT('000000' + CAST(@seq AS NVARCHAR(6)), 6);

        -- Insert booking
        INSERT INTO bookings (
            booking_ref, company_id, branch_id, banquet_id, hall_id,
            customer_id, pricing_id, slot_id, event_type_id, event_name,
            booking_status, booking_date, start_time, end_time,
            expected_guests, grand_total, advance_paid,
            balance_due, coupon_id, coupon_code,
            special_requests, booked_by,
            hold_expires_at, step_completed
        )
        VALUES (
            @booking_ref, @company_id, @branch_id, @banquet_id, @hall_id,
            @customer_id, @pricing_id, @slot_id, @event_type_id, @event_name,
            'confirmed', @booking_date, @start_time, @end_time,
            @expected_guests, @grand_total, @advance_paid,
            @grand_total - @advance_paid, @coupon_id, @coupon_code,
            @special_requests, @booked_by,
            DATEADD(MINUTE, 15, GETUTCDATE()), 8
        );

        SET @booking_id = SCOPE_IDENTITY();

        -- Update coupon usage count
        IF @coupon_id IS NOT NULL
            UPDATE coupons SET used_count = used_count + 1 WHERE coupon_id = @coupon_id;

        -- Update customer stats
        UPDATE customers
        SET total_bookings = total_bookings + 1,
            total_spend = total_spend + @grand_total,
            updated_at = GETUTCDATE()
        WHERE customer_id = @customer_id;

        -- Update banquet booking count
        UPDATE banquets
        SET total_bookings = total_bookings + 1, updated_at = GETUTCDATE()
        WHERE banquet_id = @banquet_id;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

-- =============================================================================
-- SP 4: Cancel Booking
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CancelBooking
    @booking_id         BIGINT,
    @cancelled_by       INT,
    @cancellation_reason NVARCHAR(500),
    @company_id         INT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @current_status NVARCHAR(30);
        DECLARE @grand_total DECIMAL(14,2);
        DECLARE @coupon_id INT;
        DECLARE @customer_id INT;

        SELECT
            @current_status = booking_status,
            @grand_total    = grand_total,
            @coupon_id      = coupon_id,
            @customer_id    = customer_id
        FROM bookings WITH (UPDLOCK)
        WHERE booking_id = @booking_id AND company_id = @company_id;

        IF @current_status IS NULL
            THROW 50001, 'Booking not found', 1;

        IF @current_status = 'cancelled'
            THROW 50002, 'Booking is already cancelled', 1;

        IF @current_status = 'completed'
            THROW 50003, 'Completed bookings cannot be cancelled', 1;

        UPDATE bookings
        SET booking_status      = 'cancelled',
            cancelled_by        = @cancelled_by,
            cancellation_reason = @cancellation_reason,
            cancelled_at        = GETUTCDATE(),
            updated_at          = GETUTCDATE()
        WHERE booking_id = @booking_id;

        -- Revert coupon usage
        IF @coupon_id IS NOT NULL
            UPDATE coupons SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END
            WHERE coupon_id = @coupon_id;

        -- Revert customer stats
        UPDATE customers
        SET total_bookings = CASE WHEN total_bookings > 0 THEN total_bookings - 1 ELSE 0 END,
            total_spend    = CASE WHEN total_spend >= @grand_total THEN total_spend - @grand_total ELSE 0 END,
            updated_at     = GETUTCDATE()
        WHERE customer_id = @customer_id;

        COMMIT TRANSACTION;
        SELECT 1 AS success, 'Booking cancelled successfully' AS message;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

-- =============================================================================
-- SP 5: Get Available Halls for Date
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetAvailableHalls
    @company_id     INT,
    @banquet_id     INT = NULL,
    @booking_date   DATE,
    @start_time     TIME = NULL,
    @end_time       TIME = NULL,
    @capacity       INT = 0,
    @event_type_id  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        h.hall_id,
        h.hall_name,
        h.hall_code,
        h.hall_type,
        h.capacity_seated,
        h.capacity_standing,
        h.area_sqft,
        h.has_ac,
        h.has_stage,
        h.has_kitchen,
        b.banquet_name,
        b.banquet_id,
        hp.base_price,
        hp.pricing_type,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM bookings bk
                WHERE bk.hall_id = h.hall_id
                AND bk.booking_date = @booking_date
                AND bk.booking_status NOT IN ('cancelled','draft')
                AND (@start_time IS NULL OR (bk.start_time < @end_time AND bk.end_time > @start_time))
            ) THEN 0
            WHEN EXISTS (
                SELECT 1 FROM hall_blocked_dates hbd
                WHERE hbd.hall_id = h.hall_id
                AND hbd.blocked_date = @booking_date
                AND (hbd.start_time IS NULL OR (@start_time IS NULL OR (hbd.start_time < @end_time AND hbd.end_time > @start_time)))
            ) THEN 0
            ELSE 1
        END AS is_available
    FROM halls h
    INNER JOIN banquets b ON b.banquet_id = h.banquet_id
    LEFT JOIN hall_pricing hp ON hp.hall_id = h.hall_id AND hp.is_active = 1
    WHERE h.company_id = @company_id
    AND h.is_active = 1
    AND h.is_under_maintenance = 0
    AND (@banquet_id IS NULL OR h.banquet_id = @banquet_id)
    AND (@capacity = 0 OR h.capacity_seated >= @capacity)
    ORDER BY is_available DESC, h.capacity_seated ASC;
END;
GO

-- =============================================================================
-- SP 6: Get Dashboard KPIs
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetDashboardKPIs
    @company_id     INT,
    @branch_id      INT = NULL,
    @from_date      DATE = NULL,
    @to_date        DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @from_date IS NULL SET @from_date = CAST(GETDATE() AS DATE);
    IF @to_date IS NULL SET @to_date = CAST(GETDATE() AS DATE);

    DECLARE @month_start DATE = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
    DECLARE @month_end DATE = EOMONTH(GETDATE());

    -- KPI 1: Today's bookings
    SELECT COUNT(*) AS today_bookings
    FROM bookings
    WHERE company_id = @company_id
    AND booking_date = CAST(GETDATE() AS DATE)
    AND booking_status NOT IN ('cancelled')
    AND (@branch_id IS NULL OR branch_id = @branch_id);

    -- KPI 2: This month revenue
    SELECT ISNULL(SUM(amount), 0) AS month_revenue
    FROM payments
    WHERE company_id = @company_id
    AND payment_date BETWEEN @month_start AND @month_end
    AND payment_status = 'completed';

    -- KPI 3: Upcoming events (next 7 days)
    SELECT COUNT(*) AS upcoming_events
    FROM bookings
    WHERE company_id = @company_id
    AND booking_date BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, 7, GETDATE())
    AND booking_status IN ('confirmed','advance_paid','fully_paid')
    AND (@branch_id IS NULL OR branch_id = @branch_id);

    -- KPI 4: Active customers
    SELECT COUNT(DISTINCT customer_id) AS active_customers
    FROM bookings
    WHERE company_id = @company_id
    AND booking_date >= DATEADD(MONTH, -3, GETDATE())
    AND booking_status NOT IN ('cancelled');

    -- KPI 5: Occupancy rate (current month)
    SELECT
        CAST(
            100.0 * SUM(CASE WHEN bk.booking_status NOT IN ('cancelled','draft') THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0)
        AS DECIMAL(5,2)) AS occupancy_rate
    FROM (
        SELECT DISTINCT h.hall_id, d.date_val
        FROM halls h
        CROSS JOIN (
            SELECT DATEADD(DAY, number, @month_start) AS date_val
            FROM master..spt_values
            WHERE type = 'P' AND number <= DATEDIFF(DAY, @month_start, @month_end)
        ) d
        WHERE h.company_id = @company_id AND h.is_active = 1
    ) slots
    LEFT JOIN bookings bk ON bk.hall_id = slots.hall_id
        AND bk.booking_date = slots.date_val
        AND bk.company_id = @company_id;

    -- KPI 6: Pending payments
    SELECT ISNULL(SUM(balance_due), 0) AS pending_payments
    FROM bookings
    WHERE company_id = @company_id
    AND booking_status IN ('confirmed','advance_paid')
    AND balance_due > 0
    AND (@branch_id IS NULL OR branch_id = @branch_id);

    -- KPI 7: Revenue trend (last 6 months)
    SELECT
        FORMAT(payment_date, 'MMM yyyy') AS month_label,
        YEAR(payment_date) AS yr,
        MONTH(payment_date) AS mo,
        SUM(amount) AS revenue
    FROM payments
    WHERE company_id = @company_id
    AND payment_status = 'completed'
    AND payment_date >= DATEADD(MONTH, -6, GETDATE())
    GROUP BY FORMAT(payment_date, 'MMM yyyy'), YEAR(payment_date), MONTH(payment_date)
    ORDER BY yr, mo;
END;
GO

PRINT 'Booking engine stored procedures created.';
GO
