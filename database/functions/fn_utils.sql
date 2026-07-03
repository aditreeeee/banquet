-- =============================================================================
-- DATABASE FUNCTIONS — Utility & Pricing
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- FN 1: Generate Booking Reference
-- Format: BNQ-YYYY-XXXXXX (e.g. BNQ-2026-001234)
-- =============================================================================
CREATE OR ALTER FUNCTION fn_GenerateBookingRef(@booking_id BIGINT)
RETURNS NVARCHAR(20)
AS
BEGIN
    RETURN 'BNQ-' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + '-'
        + RIGHT('000000' + CAST(@booking_id AS NVARCHAR(6)), 6);
END;
GO

-- =============================================================================
-- FN 2: Generate Invoice Number
-- Format: INV-YYYY-XXXXXX
-- =============================================================================
CREATE OR ALTER FUNCTION fn_GenerateInvoiceNumber(@invoice_id BIGINT, @year INT = NULL)
RETURNS NVARCHAR(30)
AS
BEGIN
    DECLARE @yr NVARCHAR(4) = CAST(ISNULL(@year, YEAR(GETDATE())) AS NVARCHAR(4));
    RETURN 'INV-' + @yr + '-' + RIGHT('000000' + CAST(@invoice_id AS NVARCHAR(6)), 6);
END;
GO

-- =============================================================================
-- FN 3: Generate Payment Reference
-- Format: PAY-YYYY-XXXXXX
-- =============================================================================
CREATE OR ALTER FUNCTION fn_GeneratePaymentRef(@payment_id BIGINT)
RETURNS NVARCHAR(30)
AS
BEGIN
    RETURN 'PAY-' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + '-'
        + RIGHT('000000' + CAST(@payment_id AS NVARCHAR(6)), 6);
END;
GO

-- =============================================================================
-- FN 4: Calculate Hall Price for a Given Date
-- Considers weekend multiplier and special/festival pricing
-- =============================================================================
CREATE OR ALTER FUNCTION fn_GetHallPriceForDate(@hall_id INT, @booking_date DATE)
RETURNS DECIMAL(14,2)
AS
BEGIN
    DECLARE @base_price     DECIMAL(14,2) = 0;
    DECLARE @weekend_mult   DECIMAL(5,2)  = 1.00;
    DECLARE @special_mult   DECIMAL(5,2)  = 1.00;
    DECLARE @flat_price     DECIMAL(14,2) = 0;
    DECLARE @day_of_week    TINYINT       = DATEPART(WEEKDAY, @booking_date);
    DECLARE @company_id     INT;

    -- Get active pricing
    SELECT TOP 1
        @base_price   = base_price,
        @weekend_mult = weekend_multiplier
    FROM hall_pricing
    WHERE hall_id = @hall_id AND is_active = 1
      AND (valid_from IS NULL OR valid_from <= @booking_date)
      AND (valid_to   IS NULL OR valid_to   >= @booking_date)
    ORDER BY valid_from DESC;

    IF @base_price = 0 RETURN 0;

    -- Apply weekend multiplier (Sunday=1, Saturday=7)
    IF @day_of_week IN (1, 7)
        SET @base_price = @base_price * @weekend_mult;

    -- Get company_id for special pricing lookup
    SELECT @company_id = company_id FROM halls WHERE hall_id = @hall_id;

    -- Check special pricing
    SELECT TOP 1
        @special_mult = multiplier,
        @flat_price   = ISNULL(flat_price, 0)
    FROM special_pricing
    WHERE (hall_id = @hall_id OR hall_id IS NULL)
      AND company_id = @company_id
      AND special_date = @booking_date
      AND is_active = 1
    ORDER BY hall_id DESC;

    IF @flat_price > 0 RETURN @flat_price;
    IF @special_mult > 1 RETURN @base_price * @special_mult;

    RETURN @base_price;
END;
GO

-- =============================================================================
-- FN 5: Calculate GST Amount
-- Returns GST amount given taxable value and rate
-- =============================================================================
CREATE OR ALTER FUNCTION fn_CalculateGST(
    @taxable_amount DECIMAL(14,2),
    @gst_rate       DECIMAL(5,2)
)
RETURNS DECIMAL(14,2)
AS
BEGIN
    RETURN ROUND(@taxable_amount * @gst_rate / 100, 2);
END;
GO

-- =============================================================================
-- FN 6: Calculate Required Advance Amount
-- =============================================================================
CREATE OR ALTER FUNCTION fn_GetAdvanceAmount(@grand_total DECIMAL(14,2), @company_id INT)
RETURNS DECIMAL(14,2)
AS
BEGIN
    DECLARE @pct DECIMAL(5,2) = 25.00;  -- default 25%

    SELECT TOP 1 @pct = CAST(setting_value AS DECIMAL(5,2))
    FROM company_settings
    WHERE company_id = @company_id AND setting_key = 'advance_percentage';

    RETURN CEILING(@grand_total * @pct / 100);
END;
GO

-- =============================================================================
-- FN 7: Count Working Days Between Two Dates (excluding Sundays)
-- =============================================================================
CREATE OR ALTER FUNCTION fn_WorkingDays(@from_date DATE, @to_date DATE)
RETURNS INT
AS
BEGIN
    DECLARE @total_days INT = DATEDIFF(DAY, @from_date, @to_date) + 1;
    DECLARE @full_weeks INT = @total_days / 7;
    DECLARE @remaining  INT = @total_days % 7;
    DECLARE @start_dow  INT = DATEPART(WEEKDAY, @from_date);
    DECLARE @sundays    INT = @full_weeks;

    -- Check if any remaining days land on Sunday
    DECLARE @i INT = 0;
    WHILE @i < @remaining
    BEGIN
        IF ((@start_dow + @i - 1) % 7) + 1 = 1  -- WEEKDAY 1 = Sunday
            SET @sundays = @sundays + 1;
        SET @i = @i + 1;
    END;

    RETURN @total_days - @sundays;
END;
GO

-- =============================================================================
-- FN 8: Is Date a Weekend (Saturday or Sunday)
-- =============================================================================
CREATE OR ALTER FUNCTION fn_IsWeekend(@date DATE)
RETURNS BIT
AS
BEGIN
    RETURN CASE WHEN DATEPART(WEEKDAY, @date) IN (1, 7) THEN 1 ELSE 0 END;
END;
GO

-- =============================================================================
-- FN 9: Get Financial Year Range
-- India FY: April 1 to March 31
-- =============================================================================
CREATE OR ALTER FUNCTION fn_GetFinancialYear(@date DATE)
RETURNS TABLE
AS
RETURN (
    SELECT
        CASE WHEN MONTH(@date) >= 4
            THEN DATEFROMPARTS(YEAR(@date), 4, 1)
            ELSE DATEFROMPARTS(YEAR(@date) - 1, 4, 1)
        END AS fy_start,
        CASE WHEN MONTH(@date) >= 4
            THEN DATEFROMPARTS(YEAR(@date) + 1, 3, 31)
            ELSE DATEFROMPARTS(YEAR(@date), 3, 31)
        END AS fy_end,
        CASE WHEN MONTH(@date) >= 4
            THEN CAST(YEAR(@date) AS NVARCHAR(4)) + '-' + CAST(YEAR(@date) + 1 AS NVARCHAR(4))
            ELSE CAST(YEAR(@date) - 1 AS NVARCHAR(4)) + '-' + CAST(YEAR(@date) AS NVARCHAR(4))
        END AS fy_label
);
GO

-- =============================================================================
-- FN 10: Mask Phone Number (for privacy in logs)
-- +91-9876543210 → +91-9876XXXX10
-- =============================================================================
CREATE OR ALTER FUNCTION fn_MaskPhone(@phone NVARCHAR(20))
RETURNS NVARCHAR(20)
AS
BEGIN
    IF @phone IS NULL RETURN NULL;
    IF LEN(@phone) < 8 RETURN @phone;
    RETURN LEFT(@phone, LEN(@phone) - 6) + 'XXXX' + RIGHT(@phone, 2);
END;
GO

-- =============================================================================
-- FN 11: Mask Email Address (for logs/display)
-- user@example.com → u***@example.com
-- =============================================================================
CREATE OR ALTER FUNCTION fn_MaskEmail(@email NVARCHAR(150))
RETURNS NVARCHAR(150)
AS
BEGIN
    IF @email IS NULL RETURN NULL;
    DECLARE @at_pos INT = CHARINDEX('@', @email);
    IF @at_pos <= 1 RETURN @email;
    RETURN LEFT(@email, 1) + REPLICATE('*', @at_pos - 2) + SUBSTRING(@email, @at_pos, LEN(@email));
END;
GO

-- =============================================================================
-- FN 12: Table-valued: Get Date Range as Rows
-- Useful for calendar generation and gap analysis
-- =============================================================================
CREATE OR ALTER FUNCTION fn_DateRange(@start_date DATE, @end_date DATE)
RETURNS TABLE
AS
RETURN (
    SELECT TOP (DATEDIFF(DAY, @start_date, @end_date) + 1)
        DATEADD(DAY, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1, @start_date) AS calendar_date
    FROM sys.all_columns a
    CROSS JOIN sys.all_columns b
);
GO

-- =============================================================================
-- FN 13: Check if booking slot conflicts (returns 1 if conflict exists)
-- =============================================================================
CREATE OR ALTER FUNCTION fn_HasBookingConflict(
    @hall_id        INT,
    @booking_date   DATE,
    @start_time     TIME,
    @end_time       TIME,
    @exclude_booking_id BIGINT = NULL
)
RETURNS BIT
AS
BEGIN
    DECLARE @conflict BIT = 0;

    IF EXISTS (
        SELECT 1 FROM bookings
        WHERE hall_id = @hall_id
          AND booking_date = @booking_date
          AND booking_status NOT IN ('cancelled','draft')
          AND (booking_id <> ISNULL(@exclude_booking_id, -1))
          AND @start_time < end_time
          AND @end_time   > start_time
    )
        SET @conflict = 1;

    IF EXISTS (
        SELECT 1 FROM hall_blocked_dates
        WHERE hall_id = @hall_id
          AND blocked_date = @booking_date
          AND (start_time IS NULL OR (@start_time < end_time AND @end_time > start_time))
    )
        SET @conflict = 1;

    RETURN @conflict;
END;
GO

-- =============================================================================
-- FN 14: Get Coupon Discount Amount
-- =============================================================================
CREATE OR ALTER FUNCTION fn_ApplyCoupon(
    @coupon_code    NVARCHAR(50),
    @company_id     INT,
    @subtotal       DECIMAL(14,2)
)
RETURNS DECIMAL(14,2)
AS
BEGIN
    DECLARE @discount    DECIMAL(14,2) = 0;
    DECLARE @dtype       NVARCHAR(20);
    DECLARE @dvalue      DECIMAL(10,2);
    DECLARE @max_disc    DECIMAL(10,2);
    DECLARE @min_amount  DECIMAL(10,2);
    DECLARE @usage_limit INT;
    DECLARE @used_count  INT;

    SELECT
        @dtype       = discount_type,
        @dvalue      = discount_value,
        @max_disc    = max_discount_amount,
        @min_amount  = min_booking_amount,
        @usage_limit = usage_limit,
        @used_count  = used_count
    FROM coupons
    WHERE UPPER(coupon_code) = UPPER(@coupon_code)
      AND company_id = @company_id
      AND is_active  = 1
      AND valid_from <= GETUTCDATE()
      AND valid_to   >= GETUTCDATE();

    IF @dtype IS NULL RETURN 0;
    IF @subtotal < @min_amount RETURN 0;
    IF @usage_limit IS NOT NULL AND @used_count >= @usage_limit RETURN 0;

    IF @dtype = 'percentage'
        SET @discount = @subtotal * @dvalue / 100;
    ELSE
        SET @discount = @dvalue;

    IF @max_disc IS NOT NULL AND @discount > @max_disc
        SET @discount = @max_disc;

    RETURN @discount;
END;
GO

PRINT 'Database functions created successfully.';
GO
