/**
 * Invoice Repository — pulled out of invoice.routes.js's inline SQL to match
 * the Routes→Controllers→Services→Repositories pattern used by every other
 * module (bookings, payments, customers, etc.).
 */
'use strict';

const { executeQuery } = require('../config/database');

const findAll = async (companyId, { search, status, month, limit, offset }) => {
    // "overdue" isn't a stored payment_status — it's a pending invoice past its
    // due date — so it needs its own condition rather than an exact-match.
    const statusCondition = status === 'overdue'
        ? `i.payment_status = 'pending' AND i.due_date < CAST(GETUTCDATE() AS DATE)`
        : '(@status IS NULL OR i.payment_status = @status)';

    const conditions = [
        'i.company_id = @companyId',
        'i.is_cancelled = 0',
        statusCondition,
        '(@month  IS NULL OR FORMAT(i.invoice_date, \'yyyy-MM\') = @month)',
        `(@search IS NULL
          OR i.invoice_number LIKE CONCAT('%', @search, '%')
          OR b.booking_ref   LIKE CONCAT('%', @search, '%')
          OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const params = { companyId, search: search || null, status: status || null, month: month || null };

    const [rows, countRows, statsRows] = await Promise.all([
        executeQuery(
            `SELECT i.invoice_id,
                    i.invoice_number  AS invoice_ref,
                    i.booking_id,
                    i.invoice_date,
                    i.due_date,
                    i.grand_total,
                    i.amount_paid,
                    i.balance_due     AS balance,
                    i.payment_status  AS status,
                    b.booking_ref,
                    b.event_name,
                    CONCAT(c.first_name, ' ', c.last_name) AS customer_name
             FROM Invoices i
             JOIN Bookings  b ON b.booking_id  = i.booking_id
             JOIN Customers c ON c.customer_id = i.customer_id
             WHERE ${conditions}
             ORDER BY i.invoice_date DESC
             OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total
             FROM Invoices i
             JOIN Bookings  b ON b.booking_id  = i.booking_id
             JOIN Customers c ON c.customer_id = i.customer_id
             WHERE ${conditions}`,
            params
        ),
        executeQuery(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN i.payment_status = 'paid'    THEN 1 ELSE 0 END) AS paid,
                SUM(CASE WHEN i.payment_status = 'partial' THEN 1 ELSE 0 END) AS partial,
                SUM(CASE WHEN i.payment_status = 'pending'  THEN 1 ELSE 0 END) AS unpaid,
                SUM(CASE WHEN i.payment_status = 'pending' AND i.due_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) AS overdue
             FROM Invoices i
             WHERE i.company_id = @companyId AND i.is_cancelled = 0`,
            { companyId }
        ),
    ]);

    return { rows, total: countRows[0].total, stats: statsRows[0] || {} };
};

// Includes the issuing Company/Property's own name/address/phone/email/GST —
// this is a document sent to the customer, so it must show the real tenant's
// details, never generic platform branding.
const findById = async (invoiceId, companyId) => {
    const rows = await executeQuery(
        `SELECT i.*,
                b.booking_ref,
                CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                c.email AS customer_email, c.phone AS customer_phone,
                co.company_name, co.address_line1 AS company_address_line1,
                co.address_line2 AS company_address_line2, co.phone AS company_phone,
                co.email AS company_email, co.gst_number AS company_gst_number
         FROM Invoices i
         JOIN Bookings  b ON b.booking_id  = i.booking_id
         JOIN Customers c ON c.customer_id = i.customer_id
         LEFT JOIN Companies co ON co.company_id = i.company_id
         WHERE i.invoice_id = @id AND i.company_id = @companyId`,
        { id: invoiceId, companyId }
    );
    return rows[0] || null;
};

const findBookingByRef = async (bookingRef, companyId) => {
    const rows = await executeQuery(
        `SELECT booking_id FROM Bookings WHERE booking_ref = @ref AND company_id = @companyId`,
        { ref: bookingRef, companyId }
    );
    return rows[0] || null;
};

/**
 * Runs inside a transaction (tx from withTransaction) — locks the current
 * year's invoice rows for this company so the sequence number handed out is
 * never reused by a concurrent request, then inserts the invoice itself.
 * Both steps share the same transaction as the caller's booking-total read,
 * so "read booking total" → "compute sequence" → "insert" is fully atomic.
 */
const nextSequenceForYear = async (tx, companyId, year) => {
    const rows = await tx.execute(
        `SELECT COUNT(*) AS cnt FROM Invoices WITH (UPDLOCK, HOLDLOCK)
         WHERE company_id = @companyId AND YEAR(invoice_date) = @year`,
        { companyId, year }
    );
    return (rows[0]?.cnt || 0) + 1;
};

const create = async (tx, data) => {
    const result = await tx.execute(
        `INSERT INTO Invoices
            (invoice_number, company_id, booking_id, customer_id,
             invoice_date, due_date,
             subtotal, discount_amount, taxable_amount,
             cgst_rate, cgst_amount, sgst_rate, sgst_amount,
             grand_total, amount_paid, balance_due,
             hsn_sac_breakdown,
             payment_status, created_by, created_at)
         OUTPUT INSERTED.invoice_id AS insertId
         VALUES
            (@invoiceNumber, @companyId, @bookingId, @customerId,
             CAST(GETUTCDATE() AS DATE), DATEADD(day, 7, CAST(GETUTCDATE() AS DATE)),
             @taxableAmount, 0, @taxableAmount,
             @cgstRate, @cgstAmount, @sgstRate, @sgstAmount,
             @grandTotal, 0, @grandTotal,
             @hsnSacBreakdown,
             'pending', @createdBy, GETUTCDATE())`,
        { ...data, hsnSacBreakdown: data.hsnSacBreakdown || null }
    );
    return result[0].insertId;
};

// Invoices has no updated_at column (unlike most other tables) — the
// original inline route query referenced one anyway, which would have
// thrown "Invalid column name" on every cancel attempt.
const cancel = async (invoiceId, companyId) => {
    await executeQuery(
        `UPDATE Invoices SET is_cancelled = 1
         WHERE invoice_id = @id AND company_id = @companyId`,
        { id: invoiceId, companyId }
    );
};

module.exports = { findAll, findById, findBookingByRef, nextSequenceForYear, create, cancel };
