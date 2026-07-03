-- =============================================================================
-- STORED PROCEDURES: PAYMENT MODULE
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- SP 1: Record Payment (Advance / Partial / Full)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_RecordPayment
    @company_id         INT,
    @booking_id         BIGINT,
    @invoice_id         BIGINT = NULL,
    @customer_id        INT,
    @payment_type       NVARCHAR(30),   -- 'advance','partial','full','installment'
    @payment_method     NVARCHAR(30),   -- 'cash','card','upi','bank_transfer','cheque','online'
    @amount             DECIMAL(14,2),
    @currency           CHAR(3) = 'INR',
    @transaction_id     NVARCHAR(200) = NULL,
    @gateway_name       NVARCHAR(50)  = NULL,
    @gateway_response   NVARCHAR(MAX) = NULL,
    @payment_note       NVARCHAR(500) = NULL,
    @cheque_number      NVARCHAR(50)  = NULL,
    @cheque_date        DATE          = NULL,
    @bank_name          NVARCHAR(100) = NULL,
    @collected_by       INT,
    @payment_id         BIGINT OUTPUT,
    @payment_ref        NVARCHAR(30)  OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Validate booking exists and belongs to company
        DECLARE @booking_total  DECIMAL(14,2);
        DECLARE @advance_paid   DECIMAL(14,2);
        DECLARE @balance_due    DECIMAL(14,2);
        DECLARE @booking_status NVARCHAR(30);

        SELECT
            @booking_total  = grand_total,
            @advance_paid   = advance_paid,
            @balance_due    = balance_due,
            @booking_status = booking_status
        FROM bookings WITH (UPDLOCK)
        WHERE booking_id = @booking_id AND company_id = @company_id;

        IF @booking_total IS NULL
            THROW 50010, 'Booking not found', 1;

        IF @booking_status = 'cancelled'
            THROW 50011, 'Cannot record payment for cancelled booking', 1;

        IF @amount > @balance_due + 0.01  -- allow 1 paisa tolerance
            THROW 50012, 'Payment amount exceeds balance due', 1;

        -- Generate payment reference
        DECLARE @seq INT;
        SELECT @seq = ISNULL(MAX(payment_id), 0) + 1 FROM payments WITH (TABLOCKX);
        SET @payment_ref = 'PAY-' + FORMAT(GETDATE(), 'yyyy') + '-' + RIGHT('000000' + CAST(@seq AS NVARCHAR(6)), 6);

        -- Insert payment record
        INSERT INTO payments (
            payment_ref, company_id, booking_id, invoice_id, customer_id,
            payment_type, payment_method, amount, currency,
            transaction_id, gateway_name, gateway_response,
            payment_status, payment_date, payment_note,
            cheque_number, cheque_date, bank_name,
            collected_by, created_at, updated_at
        )
        VALUES (
            @payment_ref, @company_id, @booking_id, @invoice_id, @customer_id,
            @payment_type, @payment_method, @amount, @currency,
            @transaction_id, @gateway_name, @gateway_response,
            'completed', CAST(GETDATE() AS DATE), @payment_note,
            @cheque_number, @cheque_date, @bank_name,
            @collected_by, GETUTCDATE(), GETUTCDATE()
        );

        SET @payment_id = SCOPE_IDENTITY();

        -- Update booking payment status
        DECLARE @new_advance    DECIMAL(14,2) = @advance_paid + @amount;
        DECLARE @new_balance    DECIMAL(14,2) = @balance_due - @amount;
        DECLARE @new_status     NVARCHAR(30);

        IF @new_balance <= 0.01
            SET @new_status = 'fully_paid';
        ELSE IF @new_advance >= (@booking_total * 0.25)
            SET @new_status = 'advance_paid';
        ELSE
            SET @new_status = @booking_status;

        UPDATE bookings
        SET advance_paid    = @new_advance,
            balance_due     = CASE WHEN @new_balance < 0 THEN 0 ELSE @new_balance END,
            booking_status  = @new_status,
            updated_at      = GETUTCDATE()
        WHERE booking_id = @booking_id;

        -- Update invoice if linked
        IF @invoice_id IS NOT NULL
        BEGIN
            UPDATE invoices
            SET amount_paid     = amount_paid + @amount,
                balance_due     = CASE WHEN balance_due - @amount < 0 THEN 0 ELSE balance_due - @amount END,
                payment_status  = CASE
                    WHEN balance_due - @amount <= 0.01 THEN 'paid'
                    WHEN amount_paid + @amount > 0 THEN 'partial'
                    ELSE 'pending' END,
                updated_at = GETUTCDATE()
            WHERE invoice_id = @invoice_id;
        END;

        -- Update customer total spend
        UPDATE customers
        SET total_spend = total_spend + @amount,
            updated_at  = GETUTCDATE()
        WHERE customer_id = @customer_id;

        -- Audit log
        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id,
            new_values, created_at)
        VALUES (@company_id, @collected_by, 'payment.create', 'payment',
            CAST(@payment_id AS NVARCHAR),
            '{"amount":' + CAST(@amount AS NVARCHAR) + ',"method":"' + @payment_method + '","booking_id":' + CAST(@booking_id AS NVARCHAR) + '}',
            GETUTCDATE());

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO

-- =============================================================================
-- SP 2: Process Refund
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ProcessRefund
    @payment_id         BIGINT,
    @booking_id         BIGINT,
    @company_id         INT,
    @refund_amount      DECIMAL(14,2),
    @refund_reason      NVARCHAR(500),
    @refund_method      NVARCHAR(30),
    @requested_by       INT,
    @refund_id          BIGINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        -- Validate original payment
        DECLARE @paid_amount    DECIMAL(14,2);
        DECLARE @pay_status     NVARCHAR(20);

        SELECT @paid_amount = amount, @pay_status = payment_status
        FROM payments
        WHERE payment_id = @payment_id AND company_id = @company_id;

        IF @paid_amount IS NULL
            THROW 50020, 'Payment not found', 1;

        IF @pay_status = 'refunded'
            THROW 50021, 'Payment already refunded', 1;

        IF @refund_amount > @paid_amount
            THROW 50022, 'Refund amount exceeds original payment', 1;

        -- Create refund record
        INSERT INTO refunds (
            payment_id, booking_id, company_id,
            refund_amount, refund_reason, refund_method,
            refund_status, requested_by, created_at
        )
        VALUES (
            @payment_id, @booking_id, @company_id,
            @refund_amount, @refund_reason, @refund_method,
            'pending', @requested_by, GETUTCDATE()
        );

        SET @refund_id = SCOPE_IDENTITY();

        -- Mark original payment as refund-pending
        UPDATE payments
        SET payment_status = 'refunded', updated_at = GETUTCDATE()
        WHERE payment_id = @payment_id AND @refund_amount >= @paid_amount;

        -- Update booking balance
        UPDATE bookings
        SET advance_paid = CASE WHEN advance_paid - @refund_amount < 0 THEN 0 ELSE advance_paid - @refund_amount END,
            balance_due  = balance_due + @refund_amount,
            updated_at   = GETUTCDATE()
        WHERE booking_id = @booking_id;

        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id,
            new_values, created_at)
        VALUES (@company_id, @requested_by, 'payment.refund_requested', 'refund',
            CAST(@refund_id AS NVARCHAR),
            '{"refund_amount":' + CAST(@refund_amount AS NVARCHAR) + ',"reason":"' + @refund_reason + '"}',
            GETUTCDATE());

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO

-- =============================================================================
-- SP 3: Approve Refund
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_ApproveRefund
    @refund_id          BIGINT,
    @company_id         INT,
    @approved_by        INT,
    @transaction_id     NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @refund_amount  DECIMAL(14,2);
        DECLARE @customer_id    INT;

        SELECT @refund_amount = r.refund_amount, @customer_id = b.customer_id
        FROM refunds r
        INNER JOIN bookings b ON b.booking_id = r.booking_id
        WHERE r.refund_id = @refund_id AND r.company_id = @company_id
          AND r.refund_status = 'pending';

        IF @refund_amount IS NULL
            THROW 50023, 'Refund not found or already processed', 1;

        UPDATE refunds
        SET refund_status   = 'processed',
            transaction_id  = @transaction_id,
            approved_by     = @approved_by,
            processed_at    = GETUTCDATE()
        WHERE refund_id = @refund_id;

        -- Reduce customer total spend
        UPDATE customers
        SET total_spend = CASE WHEN total_spend - @refund_amount < 0 THEN 0 ELSE total_spend - @refund_amount END,
            updated_at  = GETUTCDATE()
        WHERE customer_id = @customer_id;

        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, created_at)
        VALUES (@company_id, @approved_by, 'payment.refund_approved', 'refund',
            CAST(@refund_id AS NVARCHAR), GETUTCDATE());

        COMMIT TRANSACTION;
        SELECT 1 AS success;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO

-- =============================================================================
-- SP 4: Get Payment History for Booking
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetPaymentHistory
    @booking_id     BIGINT,
    @company_id     INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Booking summary
    SELECT
        b.booking_ref,
        b.booking_date,
        b.grand_total,
        b.advance_paid,
        b.balance_due,
        b.booking_status,
        u.first_name + ' ' + u.last_name AS customer_name,
        u.phone AS customer_phone
    FROM bookings b
    INNER JOIN customers c ON c.customer_id = b.customer_id
    INNER JOIN users u ON u.user_id = c.user_id
    WHERE b.booking_id = @booking_id AND b.company_id = @company_id;

    -- Payments
    SELECT
        p.payment_id,
        p.payment_ref,
        p.payment_date,
        p.amount,
        p.payment_type,
        p.payment_method,
        p.payment_status,
        p.transaction_id,
        p.gateway_name,
        p.cheque_number,
        p.bank_name,
        p.payment_note,
        uc.first_name + ' ' + uc.last_name AS collected_by_name
    FROM payments p
    LEFT JOIN users uc ON uc.user_id = p.collected_by
    WHERE p.booking_id = @booking_id AND p.company_id = @company_id
    ORDER BY p.payment_date DESC, p.created_at DESC;

    -- Refunds
    SELECT
        r.refund_id,
        r.refund_amount,
        r.refund_reason,
        r.refund_method,
        r.refund_status,
        r.transaction_id,
        r.processed_at,
        ur.first_name + ' ' + ur.last_name AS requested_by_name,
        ua.first_name + ' ' + ua.last_name AS approved_by_name
    FROM refunds r
    LEFT JOIN users ur ON ur.user_id = r.requested_by
    LEFT JOIN users ua ON ua.user_id = r.approved_by
    WHERE r.booking_id = @booking_id AND r.company_id = @company_id
    ORDER BY r.created_at DESC;
END;
GO

-- =============================================================================
-- SP 5: Get Pending Collections (dues within N days)
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetPendingCollections
    @company_id     INT,
    @branch_id      INT = NULL,
    @days_ahead     INT = 7,
    @page           INT = 1,
    @limit          INT = 20
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @offset INT = (@page - 1) * @limit;

    SELECT COUNT(*) AS total_count
    FROM bookings b
    WHERE b.company_id = @company_id
      AND b.balance_due > 0
      AND b.booking_status IN ('confirmed','advance_paid')
      AND b.booking_date BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, @days_ahead, GETDATE())
      AND (@branch_id IS NULL OR b.branch_id = @branch_id);

    SELECT
        b.booking_id, b.booking_ref, b.booking_date, b.start_time,
        b.grand_total, b.advance_paid, b.balance_due, b.booking_status,
        u.first_name + ' ' + u.last_name AS customer_name,
        u.phone AS customer_phone, u.email AS customer_email,
        et.type_name AS event_type, h.hall_name, bq.banquet_name,
        DATEDIFF(DAY, GETDATE(), b.booking_date) AS days_until_event
    FROM bookings b
    INNER JOIN customers c ON c.customer_id = b.customer_id
    INNER JOIN users u ON u.user_id = c.user_id
    INNER JOIN event_types et ON et.event_type_id = b.event_type_id
    INNER JOIN halls h ON h.hall_id = b.hall_id
    INNER JOIN banquets bq ON bq.banquet_id = b.banquet_id
    WHERE b.company_id = @company_id
      AND b.balance_due > 0
      AND b.booking_status IN ('confirmed','advance_paid')
      AND b.booking_date BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, @days_ahead, GETDATE())
      AND (@branch_id IS NULL OR b.branch_id = @branch_id)
    ORDER BY b.booking_date ASC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
END;
GO

-- =============================================================================
-- SP 6: Daily Revenue Summary
-- =============================================================================
CREATE OR ALTER PROCEDURE sp_GetDailyRevenue
    @company_id     INT,
    @branch_id      INT  = NULL,
    @target_date    DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @target_date IS NULL SET @target_date = CAST(GETDATE() AS DATE);

    SELECT
        COUNT(*) AS total_transactions,
        SUM(p.amount) AS total_collected,
        SUM(CASE WHEN p.payment_method = 'cash'          THEN p.amount ELSE 0 END) AS cash_total,
        SUM(CASE WHEN p.payment_method = 'card'          THEN p.amount ELSE 0 END) AS card_total,
        SUM(CASE WHEN p.payment_method = 'upi'           THEN p.amount ELSE 0 END) AS upi_total,
        SUM(CASE WHEN p.payment_method = 'bank_transfer' THEN p.amount ELSE 0 END) AS bank_total,
        SUM(CASE WHEN p.payment_method = 'cheque'        THEN p.amount ELSE 0 END) AS cheque_total,
        SUM(CASE WHEN p.payment_method = 'online'        THEN p.amount ELSE 0 END) AS online_total,
        COUNT(DISTINCT p.booking_id) AS bookings_with_payment
    FROM payments p
    INNER JOIN bookings b ON b.booking_id = p.booking_id
    WHERE p.company_id = @company_id
      AND p.payment_date = @target_date
      AND p.payment_status = 'completed'
      AND (@branch_id IS NULL OR b.branch_id = @branch_id);
END;
GO

PRINT 'Payment stored procedures created successfully.';
GO
