-- =============================================================================
-- STORED PROCEDURES: INVOICE MODULE
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- SP 1: Generate GST Invoice
-- Creates invoice with line items from booking details
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GenerateInvoice
    @company_id     INT,
    @booking_id     BIGINT,
    @invoice_type   NVARCHAR(20) = 'tax_invoice',  -- 'proforma','tax_invoice','receipt'
    @due_days       INT = 0,
    @notes          NVARCHAR(MAX) = NULL,
    @terms          NVARCHAR(MAX) = NULL,
    @created_by     INT,
    @invoice_id     BIGINT OUTPUT,
    @invoice_number NVARCHAR(30) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Get booking details
        DECLARE @customer_id        INT;
        DECLARE @hall_price         DECIMAL(14,2) = 0;
        DECLARE @catering_total     DECIMAL(14,2) = 0;
        DECLARE @decoration_total   DECIMAL(14,2) = 0;
        DECLARE @services_total     DECIMAL(14,2) = 0;
        DECLARE @discount_amount    DECIMAL(14,2) = 0;
        DECLARE @grand_total        DECIMAL(14,2) = 0;
        DECLARE @advance_paid       DECIMAL(14,2) = 0;
        DECLARE @booking_status     NVARCHAR(30);
        DECLARE @hall_id            INT;
        DECLARE @event_type_id      INT;
        DECLARE @booking_date       DATE;
        DECLARE @pricing_id         INT;

        SELECT
            @customer_id        = customer_id,
            @catering_total     = catering_total,
            @decoration_total   = decoration_total,
            @services_total     = services_total,
            @discount_amount    = discount_amount,
            @grand_total        = grand_total,
            @advance_paid       = advance_paid,
            @booking_status     = booking_status,
            @hall_id            = hall_id,
            @event_type_id      = event_type_id,
            @booking_date       = booking_date,
            @pricing_id         = pricing_id
        FROM bookings
        WHERE booking_id = @booking_id AND company_id = @company_id;

        IF @customer_id IS NULL
            THROW 50030, 'Booking not found', 1;

        -- Get hall base price
        SELECT @hall_price = base_price FROM hall_pricing WHERE pricing_id = @pricing_id;
        SET @hall_price = ISNULL(@hall_price, 0);

        -- Check if invoice already exists for this booking
        IF EXISTS (SELECT 1 FROM invoices WHERE booking_id = @booking_id AND company_id = @company_id AND is_cancelled = 0 AND invoice_type = @invoice_type)
        BEGIN
            ROLLBACK;
            SELECT TOP 1 invoice_id, invoice_number FROM invoices
            WHERE booking_id = @booking_id AND company_id = @company_id AND is_cancelled = 0 AND invoice_type = @invoice_type;
            RETURN;
        END;

        -- Get GST rates for company
        DECLARE @cgst_rate DECIMAL(5,2) = 0;
        DECLARE @sgst_rate DECIMAL(5,2) = 0;
        DECLARE @igst_rate DECIMAL(5,2) = 0;

        SELECT
            @cgst_rate = ISNULL(SUM(CASE WHEN tax_name = 'CGST' THEN rate ELSE 0 END), 0),
            @sgst_rate = ISNULL(SUM(CASE WHEN tax_name = 'SGST' THEN rate ELSE 0 END), 0),
            @igst_rate = ISNULL(SUM(CASE WHEN tax_name = 'IGST' THEN rate ELSE 0 END), 0)
        FROM tax_config
        WHERE company_id = @company_id AND is_active = 1
          AND effective_from <= GETDATE()
          AND (effective_to IS NULL OR effective_to >= GETDATE());

        -- Calculate subtotal (before tax)
        DECLARE @subtotal       DECIMAL(14,2) = @hall_price + @catering_total + @decoration_total + @services_total;
        DECLARE @taxable_amount DECIMAL(14,2) = @subtotal - @discount_amount;
        DECLARE @cgst_amount    DECIMAL(14,2) = ROUND(@taxable_amount * @cgst_rate / 100, 2);
        DECLARE @sgst_amount    DECIMAL(14,2) = ROUND(@taxable_amount * @sgst_rate / 100, 2);
        DECLARE @igst_amount    DECIMAL(14,2) = ROUND(@taxable_amount * @igst_rate / 100, 2);
        DECLARE @total_tax      DECIMAL(14,2) = @cgst_amount + @sgst_amount + @igst_amount;
        DECLARE @balance_due    DECIMAL(14,2) = @grand_total - @advance_paid;

        -- Generate invoice number (trigger handles the final formatting, but we compute here for OUTPUT)
        DECLARE @next_seq INT;
        SELECT @next_seq = ISNULL(MAX(invoice_id), 0) + 1 FROM invoices WITH (TABLOCKX);
        SET @invoice_number = 'INV-' + CAST(YEAR(@booking_date) AS NVARCHAR(4)) + '-' + RIGHT('000000' + CAST(@next_seq AS NVARCHAR(6)), 6);

        -- Insert invoice (trigger will run, may re-format invoice_number)
        INSERT INTO invoices (
            invoice_number, company_id, booking_id, customer_id,
            invoice_date, due_date, invoice_type,
            subtotal, discount_amount, taxable_amount,
            cgst_rate, cgst_amount, sgst_rate, sgst_amount,
            igst_rate, igst_amount, total_tax,
            grand_total, amount_paid, balance_due,
            payment_status, notes, terms,
            is_cancelled, created_at, created_by
        )
        VALUES (
            @invoice_number, @company_id, @booking_id, @customer_id,
            CAST(GETDATE() AS DATE), DATEADD(DAY, @due_days, GETDATE()), @invoice_type,
            @subtotal, @discount_amount, @taxable_amount,
            @cgst_rate, @cgst_amount, @sgst_rate, @sgst_amount,
            @igst_rate, @igst_amount, @total_tax,
            @grand_total, @advance_paid, @balance_due,
            CASE WHEN @balance_due <= 0 THEN 'paid' WHEN @advance_paid > 0 THEN 'partial' ELSE 'pending' END,
            @notes, @terms, 0, GETUTCDATE(), @created_by
        );

        SET @invoice_id = SCOPE_IDENTITY();

        -- Insert line items
        -- Line 1: Hall Rental
        IF @hall_price > 0
        INSERT INTO invoice_items (invoice_id, description, hsn_sac_code, quantity, unit, unit_price, line_total, sort_order)
        VALUES (@invoice_id, 'Hall Rental — ' + (SELECT hall_name FROM halls WHERE hall_id = @hall_id),
                '997212', 1, 'nos', @hall_price, @hall_price, 1);

        -- Line 2: Catering
        IF @catering_total > 0
        INSERT INTO invoice_items (invoice_id, description, hsn_sac_code, quantity, unit, unit_price, line_total, sort_order)
        VALUES (@invoice_id, 'Catering Services', '996334', 1, 'lot', @catering_total, @catering_total, 2);

        -- Line 3: Decoration
        IF @decoration_total > 0
        INSERT INTO invoice_items (invoice_id, description, hsn_sac_code, quantity, unit, unit_price, line_total, sort_order)
        VALUES (@invoice_id, 'Decoration & Setup', '998813', 1, 'lot', @decoration_total, @decoration_total, 3);

        -- Line 4: Additional Services
        IF @services_total > 0
        INSERT INTO invoice_items (invoice_id, description, hsn_sac_code, quantity, unit, unit_price, line_total, sort_order)
        VALUES (@invoice_id, 'Additional Services (AV/Photography/DJ)', '998392', 1, 'lot', @services_total, @services_total, 4);

        -- Line 5: Discount (negative)
        IF @discount_amount > 0
        INSERT INTO invoice_items (invoice_id, description, quantity, unit, unit_price, line_total, sort_order)
        VALUES (@invoice_id, 'Discount Applied', 1, 'nos', -@discount_amount, -@discount_amount, 5);

        -- Audit log
        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, created_at)
        VALUES (@company_id, @created_by, 'invoice.generate', 'invoice', CAST(@invoice_id AS NVARCHAR), GETUTCDATE());

        COMMIT TRANSACTION;

        SELECT @invoice_id AS invoice_id, @invoice_number AS invoice_number;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO

-- =============================================================================
-- SP 2: Get Invoice Detail (for display / PDF generation)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetInvoiceDetail
    @invoice_id     BIGINT,
    @company_id     INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Invoice header
    SELECT
        i.invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.invoice_type,
        i.subtotal,
        i.discount_amount,
        i.taxable_amount,
        i.cgst_rate, i.cgst_amount,
        i.sgst_rate, i.sgst_amount,
        i.igst_rate, i.igst_amount,
        i.total_tax,
        i.grand_total,
        i.amount_paid,
        i.balance_due,
        i.payment_status,
        i.notes,
        i.terms,
        i.pdf_url,
        -- Company details (biller)
        c.company_name,
        c.legal_name,
        c.gst_number   AS company_gst,
        c.address_line1 AS company_address,
        c.phone        AS company_phone,
        c.email        AS company_email,
        -- Customer details
        u.first_name + ' ' + u.last_name AS customer_name,
        u.email        AS customer_email,
        u.phone        AS customer_phone,
        u.address_line1 AS customer_address,
        -- Booking details
        b.booking_ref,
        b.booking_date AS event_date,
        b.start_time,
        b.end_time,
        et.type_name   AS event_type,
        b.event_name,
        h.hall_name,
        bq.banquet_name,
        bq.address_line1 AS venue_address
    FROM invoices i
    INNER JOIN companies c ON c.company_id = i.company_id
    INNER JOIN customers cust ON cust.customer_id = i.customer_id
    INNER JOIN users u ON u.user_id = cust.user_id
    INNER JOIN bookings b ON b.booking_id = i.booking_id
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    INNER JOIN halls h ON h.hall_id = b.hall_id
    INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
    WHERE i.invoice_id = @invoice_id AND i.company_id = @company_id;

    -- Line items
    SELECT
        item_id, description, hsn_sac_code,
        quantity, unit, unit_price, discount_pct, line_total, sort_order
    FROM invoice_items
    WHERE invoice_id = @invoice_id
    ORDER BY sort_order;

    -- Payment history for this invoice
    DECLARE @booking_id_ref BIGINT;
    SELECT @booking_id_ref = booking_id FROM invoices WHERE invoice_id = @invoice_id AND company_id = @company_id;

    SELECT
        p.payment_ref,
        p.payment_date,
        p.amount,
        p.payment_method,
        p.payment_status,
        p.transaction_id,
        uc.first_name + ' ' + uc.last_name AS collected_by
    FROM payments p
    LEFT JOIN users uc ON uc.user_id = p.collected_by
    WHERE (p.invoice_id = @invoice_id OR p.booking_id = @booking_id_ref)
      AND p.company_id = @company_id
      AND p.payment_status = 'completed'
    ORDER BY p.payment_date DESC;
END;
GO

-- =============================================================================
-- SP 3: Get Invoice Detail Payment History (separate query — fix above)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetInvoicePayments
    @invoice_id BIGINT,
    @company_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @booking_id BIGINT;
    SELECT @booking_id = booking_id FROM invoices WHERE invoice_id = @invoice_id AND company_id = @company_id;

    SELECT
        p.payment_ref, p.payment_date, p.amount,
        p.payment_method, p.payment_status, p.transaction_id,
        uc.first_name + ' ' + uc.last_name AS collected_by
    FROM payments p
    LEFT JOIN users uc ON uc.user_id = p.collected_by
    WHERE (p.invoice_id = @invoice_id OR p.booking_id = @booking_id)
      AND p.company_id = @company_id
      AND p.payment_status = 'completed'
    ORDER BY p.payment_date DESC;
END;
GO

-- =============================================================================
-- SP 4: Update Invoice PDF URL (after PDF generation)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_UpdateInvoicePDF
    @invoice_id INT,
    @pdf_url    NVARCHAR(500)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE invoices SET pdf_url = @pdf_url WHERE invoice_id = @invoice_id;
END;
GO

-- =============================================================================
-- SP 5: List Invoices (paginated)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ListInvoices
    @company_id     INT,
    @branch_id      INT  = NULL,
    @payment_status NVARCHAR(20) = NULL,
    @from_date      DATE = NULL,
    @to_date        DATE = NULL,
    @search         NVARCHAR(200) = NULL,
    @page           INT = 1,
    @limit          INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @offset INT = (@page - 1) * @limit;

    SELECT COUNT(*) AS total_count
    FROM invoices i
    INNER JOIN bookings b ON b.booking_id = i.booking_id
    INNER JOIN customers c ON c.customer_id = i.customer_id
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE i.company_id = @company_id AND i.is_cancelled = 0
      AND (@branch_id      IS NULL OR b.branch_id       = @branch_id)
      AND (@payment_status IS NULL OR i.payment_status  = @payment_status)
      AND (@from_date      IS NULL OR i.invoice_date    >= @from_date)
      AND (@to_date        IS NULL OR i.invoice_date    <= @to_date)
      AND (@search         IS NULL OR i.invoice_number  LIKE '%' + @search + '%'
                                   OR b.booking_ref     LIKE '%' + @search + '%'
                                   OR u.first_name + ' ' + u.last_name LIKE '%' + @search + '%');

    SELECT
        i.invoice_id, i.invoice_number, i.invoice_date, i.invoice_type,
        i.grand_total, i.amount_paid, i.balance_due, i.payment_status,
        b.booking_ref, b.booking_date AS event_date,
        u.first_name + ' ' + u.last_name AS customer_name,
        u.phone AS customer_phone,
        i.pdf_url
    FROM invoices i
    INNER JOIN bookings b ON b.booking_id = i.booking_id
    INNER JOIN customers c ON c.customer_id = i.customer_id
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE i.company_id = @company_id AND i.is_cancelled = 0
      AND (@branch_id      IS NULL OR b.branch_id       = @branch_id)
      AND (@payment_status IS NULL OR i.payment_status  = @payment_status)
      AND (@from_date      IS NULL OR i.invoice_date    >= @from_date)
      AND (@to_date        IS NULL OR i.invoice_date    <= @to_date)
      AND (@search         IS NULL OR i.invoice_number  LIKE '%' + @search + '%'
                                   OR b.booking_ref     LIKE '%' + @search + '%'
                                   OR u.first_name + ' ' + u.last_name LIKE '%' + @search + '%')
    ORDER BY i.invoice_date DESC, i.invoice_id DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
END;
GO

-- =============================================================================
-- SP 6: Cancel Invoice
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_CancelInvoice
    @invoice_id INT,
    @company_id INT,
    @cancelled_by INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE invoices SET is_cancelled = 1 WHERE invoice_id = @invoice_id AND company_id = @company_id;
    INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, created_at)
    VALUES (@company_id, @cancelled_by, 'invoice.cancel', 'invoice', CAST(@invoice_id AS NVARCHAR), GETUTCDATE());
END;
GO

PRINT 'Invoice stored procedures created successfully.';
GO
