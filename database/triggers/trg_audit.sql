-- =============================================================================
-- TRIGGERS — Audit & Business Rules
-- Dialect: Microsoft SQL Server (T-SQL)
-- Converted from MySQL. Column/table references have been reconciled against
-- the authoritative schema in database/migrations/001_create_schema.sql.
-- =============================================================================
USE BanquetDB;
GO

-- =============================================================================
-- TRIGGER 1: Booking Status Change Audit
-- Logs every booking status change to AuditLogs.
-- NOTE: Original MySQL trigger referenced columns booking_status/balance_due/
-- grand_total which do not exist on the converted Bookings table. The
-- converted schema uses: status, total_amount, amount_paid. balance_due is
-- computed as (total_amount - amount_paid).
-- Set-based: fires once per statement, handles multi-row UPDATE via inserted/deleted.
-- =============================================================================
CREATE OR ALTER TRIGGER trg_Bookings_audit
ON Bookings
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF UPDATE(status)
    BEGIN
        INSERT INTO AuditLogs (
            company_id, entity_type, entity_id,
            action, old_values, new_values, created_at
        )
        SELECT
            i.company_id,
            'booking',
            CAST(i.booking_id AS NVARCHAR(50)),
            'booking.status_change',
            '{"status":"' + d.status + '","balance_due":' + CAST((d.total_amount - d.amount_paid) AS NVARCHAR(20)) + '}',
            '{"status":"' + i.status + '","balance_due":' + CAST((i.total_amount - i.amount_paid) AS NVARCHAR(20)) + '}',
            GETUTCDATE()
        FROM inserted i
        INNER JOIN deleted d ON d.booking_id = i.booking_id
        WHERE i.status <> d.status;
    END;
END;
GO

-- =============================================================================
-- TRIGGER 2: Auto-update banquet average rating on review insert/update/delete
-- =============================================================================
CREATE OR ALTER TRIGGER trg_Reviews_update_rating
ON Reviews
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
        UPDATE Banquets
        SET
            average_rating = (
                SELECT ISNULL(AVG(CAST(rating AS DECIMAL(3,2))), 0)
                FROM Reviews
                WHERE banquet_id = @banquet_id AND is_approved = 1
            ),
            total_reviews = (
                SELECT COUNT(*) FROM Reviews
                WHERE banquet_id = @banquet_id AND is_approved = 1
            ),
            updated_at = GETUTCDATE()
        WHERE banquet_id = @banquet_id;
    END;
END;
GO

-- =============================================================================
-- TRIGGER 3: Prevent double-booking (safety net at DB level)
-- Converted BEFORE INSERT (MySQL) -> INSTEAD OF INSERT (T-SQL).
-- Rationale: the original trigger both VALIDATES (checks for a conflicting
-- overlapping booking) and, on success, performs the INSERT itself. INSTEAD
-- OF INSERT is the correct T-SQL equivalent because it lets us intercept the
-- statement, run the conflict check against the `inserted` pseudo-table, and
-- only materialize the row(s) with our own INSERT if validation passes —
-- exactly mirroring the original BEFORE INSERT intent (validate-then-insert)
-- without needing a compensating ROLLBACK/THROW pattern.
-- NOTE: Column list rewritten to match the actual converted Bookings table.
-- The MySQL/legacy version referenced banquet_id, pricing_id, slot_id,
-- event_type_id, step_completed, subtotal, decoration_total, catering_total,
-- services_total, tax_amount, grand_total, balance_due, coupon_id,
-- coupon_code, booked_by, confirmed_by, hold_expires_at — none of these
-- columns exist on the converted Bookings table (see 001_create_schema.sql).
-- They have been dropped/remapped to the real columns: status, event_date,
-- event_time_start, event_time_end, guest_count, total_amount.
-- =============================================================================
CREATE OR ALTER TRIGGER trg_Bookings_prevent_double_booking
ON Bookings
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @conflict_count INT = 0;

    SELECT @conflict_count = COUNT(*)
    FROM Bookings b
    INNER JOIN inserted i ON b.hall_id = i.hall_id
        AND b.event_date = i.event_date
        AND b.status NOT IN ('cancelled', 'draft')
        AND b.event_time_start < i.event_time_end
        AND b.event_time_end > i.event_time_start
    WHERE i.booking_id IS NULL OR b.booking_id <> i.booking_id;

    IF @conflict_count > 0
    BEGIN
        RAISERROR('DOUBLE_BOOKING: Hall is already booked for this time slot', 16, 1);
        RETURN;
    END;

    -- If no conflict, proceed with actual insert
    INSERT INTO Bookings (
        booking_ref, company_id, branch_id, hall_id, customer_id,
        event_name, event_type, event_date, event_time_start, event_time_end,
        guest_count, status, total_amount, advance_paid, amount_paid,
        discount_amount, notes, special_requests, internal_notes,
        cancellation_reason, cancelled_at, cancelled_by, confirmed_at,
        created_by, updated_by, created_at, updated_at
    )
    SELECT
        booking_ref, company_id, branch_id, hall_id, customer_id,
        event_name, event_type, event_date, event_time_start, event_time_end,
        guest_count, status, total_amount, advance_paid, amount_paid,
        discount_amount, notes, special_requests, internal_notes,
        cancellation_reason, cancelled_at, cancelled_by, confirmed_at,
        created_by, updated_by, created_at, updated_at
    FROM inserted;
END;
GO

-- =============================================================================
-- TRIGGER 4: Auto-update hall count on banquet when hall is added/removed
-- =============================================================================
CREATE OR ALTER TRIGGER trg_Halls_update_banquet_count
ON Halls
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
        UPDATE Banquets
        SET total_halls = (
                SELECT COUNT(*) FROM Halls WHERE banquet_id = @banquet_id AND is_active = 1
            ),
            total_capacity = (
                SELECT ISNULL(SUM(capacity_seated), 0) FROM Halls WHERE banquet_id = @banquet_id AND is_active = 1
            ),
            updated_at = GETUTCDATE()
        WHERE banquet_id = @banquet_id;
    END;
END;
GO

-- =============================================================================
-- TRIGGER 5: Auto-generate invoice number sequence
-- Converted BEFORE INSERT (MySQL) -> INSTEAD OF INSERT (T-SQL).
-- Rationale: same as TRIGGER 3 — the original mutates/derives a value
-- (invoice_number) before the row is stored, then inserts. INSTEAD OF INSERT
-- lets us compute the generated invoice_number per row from `inserted` and
-- perform the real INSERT ourselves, preserving the "mutate-then-insert"
-- intent of the MySQL BEFORE trigger exactly.
-- =============================================================================
CREATE OR ALTER TRIGGER trg_Invoices_number_generate
ON Invoices
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO Invoices (
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
                ISNULL((SELECT MAX(invoice_id) FROM Invoices WHERE company_id = i.company_id), 0) + 1
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

-- =============================================================================
-- SECTION: updated_at MAINTENANCE TRIGGERS
--
-- The MySQL schema used `updated_at DATETIME ... ON UPDATE CURRENT_TIMESTAMP`
-- to auto-refresh a row's timestamp on every UPDATE. T-SQL has no equivalent
-- column-level clause, so the converted schema (001_create_schema.sql) drops
-- that clause and the following AFTER UPDATE triggers restore the behavior.
--
-- Each trigger is guarded with `IF TRIGGER_NESTLEVEL() > 1 RETURN;` as the
-- first statement in the body. This is a defense-in-depth guard: the trigger
-- itself performs an UPDATE on the same table it fires on, which would cause
-- infinite recursion if RECURSIVE_TRIGGERS were ever turned ON for the
-- database. SQL Server's default is RECURSIVE_TRIGGERS OFF (so direct
-- self-recursion is already prevented at the engine level), but the
-- TRIGGER_NESTLEVEL() guard protects against a future/accidental
-- `ALTER DATABASE ... SET RECURSIVE_TRIGGERS ON`, and also protects against
-- indirect recursion (trigger A updates table B whose trigger updates back
-- into table A) without relying on that database-level setting remaining
-- correctly configured forever.
-- =============================================================================

GO
CREATE OR ALTER TRIGGER trg_Roles_UpdateTimestamp
ON Roles
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE r
    SET r.updated_at = GETDATE()
    FROM Roles r
    INNER JOIN inserted i ON r.role_id = i.role_id;
END;
GO

CREATE OR ALTER TRIGGER trg_Companies_UpdateTimestamp
ON Companies
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE c
    SET c.updated_at = GETDATE()
    FROM Companies c
    INNER JOIN inserted i ON c.company_id = i.company_id;
END;
GO

CREATE OR ALTER TRIGGER trg_Branches_UpdateTimestamp
ON Branches
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE br
    SET br.updated_at = GETDATE()
    FROM Branches br
    INNER JOIN inserted i ON br.branch_id = i.branch_id;
END;
GO

CREATE OR ALTER TRIGGER trg_Users_UpdateTimestamp
ON Users
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE u
    SET u.updated_at = GETDATE()
    FROM Users u
    INNER JOIN inserted i ON u.user_id = i.user_id;
END;
GO

CREATE OR ALTER TRIGGER trg_Halls_UpdateTimestamp
ON Halls
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE h
    SET h.updated_at = GETDATE()
    FROM Halls h
    INNER JOIN inserted i ON h.hall_id = i.hall_id;
END;
GO

CREATE OR ALTER TRIGGER trg_Customers_UpdateTimestamp
ON Customers
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE c
    SET c.updated_at = GETDATE()
    FROM Customers c
    INNER JOIN inserted i ON c.customer_id = i.customer_id;
END;
GO

CREATE OR ALTER TRIGGER trg_Bookings_UpdateTimestamp
ON Bookings
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE b
    SET b.updated_at = GETDATE()
    FROM Bookings b
    INNER JOIN inserted i ON b.booking_id = i.booking_id;
END;
GO

CREATE OR ALTER TRIGGER trg_Payments_UpdateTimestamp
ON Payments
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE p
    SET p.updated_at = GETDATE()
    FROM Payments p
    INNER JOIN inserted i ON p.payment_id = i.payment_id;
END;
GO

CREATE OR ALTER TRIGGER trg_CompanySettings_UpdateTimestamp
ON CompanySettings
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE cs
    SET cs.updated_at = GETDATE()
    FROM CompanySettings cs
    INNER JOIN inserted i ON cs.setting_id = i.setting_id;
END;
GO

CREATE OR ALTER TRIGGER trg_EmailTemplates_UpdateTimestamp
ON EmailTemplates
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    UPDATE et
    SET et.updated_at = GETDATE()
    FROM EmailTemplates et
    INNER JOIN inserted i ON et.template_id = i.template_id;
END;
GO

PRINT 'Triggers created successfully.';
GO
