-- =============================================================================
-- TRIGGERS — Audit & Business Rules
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- TRIGGER 1: Booking Status Change Audit
-- Logs every booking status change to audit_logs
-- =============================================================================
CREATE OR ALTER TRIGGER trg_bookings_audit
ON bookings
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF UPDATE(booking_status)
    BEGIN
        INSERT INTO audit_logs (
            company_id, entity_type, entity_id,
            action, old_values, new_values, created_at
        )
        SELECT
            i.company_id,
            'booking',
            CAST(i.booking_id AS NVARCHAR(50)),
            'booking.status_change',
            '{"status":"' + d.booking_status + '","balance_due":' + CAST(d.balance_due AS NVARCHAR(20)) + '}',
            '{"status":"' + i.booking_status + '","balance_due":' + CAST(i.balance_due AS NVARCHAR(20)) + '}',
            GETUTCDATE()
        FROM inserted i
        INNER JOIN deleted d ON d.booking_id = i.booking_id
        WHERE i.booking_status <> d.booking_status;
    END;
END;
GO

-- =============================================================================
-- TRIGGER 2: Auto-update banquet average rating on review insert/update
-- =============================================================================
CREATE OR ALTER TRIGGER trg_reviews_update_rating
ON reviews
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @banquet_id INT;

    -- Get banquet_id from inserted or deleted
    SELECT @banquet_id = ISNULL(
        (SELECT TOP 1 banquet_id FROM inserted),
        (SELECT TOP 1 banquet_id FROM deleted)
    );

    IF @banquet_id IS NOT NULL
    BEGIN
        UPDATE banquets
        SET
            average_rating = (
                SELECT ISNULL(AVG(CAST(rating AS DECIMAL(3,2))), 0)
                FROM reviews
                WHERE banquet_id = @banquet_id AND is_approved = 1
            ),
            total_reviews = (
                SELECT COUNT(*) FROM reviews
                WHERE banquet_id = @banquet_id AND is_approved = 1
            ),
            updated_at = GETUTCDATE()
        WHERE banquet_id = @banquet_id;
    END;
END;
GO

-- =============================================================================
-- TRIGGER 3: Prevent double-booking (safety net at DB level)
-- =============================================================================
CREATE OR ALTER TRIGGER trg_prevent_double_booking
ON bookings
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @conflict_count INT = 0;

    SELECT @conflict_count = COUNT(*)
    FROM bookings b
    INNER JOIN inserted i ON b.hall_id = i.hall_id
        AND b.booking_date = i.booking_date
        AND b.booking_status NOT IN ('cancelled', 'draft')
        AND b.start_time < i.end_time
        AND b.end_time > i.start_time;

    IF @conflict_count > 0
    BEGIN
        RAISERROR('DOUBLE_BOOKING: Hall is already booked for this time slot', 16, 1);
        RETURN;
    END;

    -- If no conflict, proceed with actual insert
    INSERT INTO bookings (
        booking_ref, company_id, branch_id, banquet_id, hall_id,
        customer_id, pricing_id, slot_id, event_type_id, event_name,
        booking_status, booking_date, start_time, end_time,
        setup_time, teardown_time, expected_guests, step_completed,
        subtotal, decoration_total, catering_total, services_total,
        discount_amount, tax_amount, grand_total, advance_paid, balance_due,
        coupon_id, coupon_code, special_requests, internal_notes,
        booked_by, confirmed_by, hold_expires_at, created_at, updated_at
    )
    SELECT
        booking_ref, company_id, branch_id, banquet_id, hall_id,
        customer_id, pricing_id, slot_id, event_type_id, event_name,
        booking_status, booking_date, start_time, end_time,
        setup_time, teardown_time, expected_guests, step_completed,
        subtotal, decoration_total, catering_total, services_total,
        discount_amount, tax_amount, grand_total, advance_paid, balance_due,
        coupon_id, coupon_code, special_requests, internal_notes,
        booked_by, confirmed_by, hold_expires_at, created_at, updated_at
    FROM inserted;
END;
GO

-- =============================================================================
-- TRIGGER 4: Auto-update hall count on banquet when hall is added/removed
-- =============================================================================
CREATE OR ALTER TRIGGER trg_halls_update_banquet_count
ON halls
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @banquet_id INT;

    SELECT @banquet_id = ISNULL(
        (SELECT TOP 1 banquet_id FROM inserted),
        (SELECT TOP 1 banquet_id FROM deleted)
    );

    IF @banquet_id IS NOT NULL
    BEGIN
        UPDATE banquets
        SET total_halls = (
                SELECT COUNT(*) FROM halls WHERE banquet_id = @banquet_id AND is_active = 1
            ),
            total_capacity = (
                SELECT ISNULL(SUM(capacity_seated), 0) FROM halls WHERE banquet_id = @banquet_id AND is_active = 1
            ),
            updated_at = GETUTCDATE()
        WHERE banquet_id = @banquet_id;
    END;
END;
GO

-- =============================================================================
-- TRIGGER 5: Auto-generate invoice number sequence
-- =============================================================================
CREATE OR ALTER TRIGGER trg_invoice_number_generate
ON invoices
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO invoices (
        invoice_number, company_id, booking_id, customer_id,
        invoice_date, due_date, invoice_type,
        subtotal, discount_amount, taxable_amount,
        cgst_rate, cgst_amount, sgst_rate, sgst_amount,
        igst_rate, igst_amount, total_tax,
        grand_total, amount_paid, balance_due,
        payment_status, notes, terms, pdf_url,
        is_cancelled, created_at, created_by
    )
    SELECT
        'INV-' + CAST(YEAR(i.invoice_date) AS NVARCHAR(4)) + '-'
            + RIGHT('000000' + CAST(
                ISNULL((SELECT MAX(invoice_id) FROM invoices WHERE company_id = i.company_id), 0) + 1
            AS NVARCHAR(6)), 6),
        company_id, booking_id, customer_id,
        invoice_date, due_date, invoice_type,
        subtotal, discount_amount, taxable_amount,
        cgst_rate, cgst_amount, sgst_rate, sgst_amount,
        igst_rate, igst_amount, total_tax,
        grand_total, amount_paid, balance_due,
        payment_status, notes, terms, pdf_url,
        is_cancelled, GETUTCDATE(), created_by
    FROM inserted i;
END;
GO

PRINT 'Triggers created successfully.';
GO
