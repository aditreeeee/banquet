/**
 * Payment Repository
 */
'use strict';

const { executeQuery, withTransaction } = require('../config/database');

const BASE_SELECT = `
    SELECT p.payment_id, p.booking_id, p.company_id,
           p.amount, p.payment_method, p.payment_type,
           p.reference_number, p.reference_number AS payment_ref,
           p.notes, p.status, p.status AS payment_status,
           p.created_at, p.created_at AS payment_date,
           p.updated_at, p.created_by,
           b.booking_ref, b.total_amount AS booking_total,
           b.event_name, b.event_date, b.event_date AS booking_date,
           c.phone AS customer_phone,
           CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
           CONCAT(u.first_name, ' ', u.last_name) AS collected_by_name
    FROM Payments p
    JOIN Bookings  b ON b.booking_id  = p.booking_id
    JOIN Customers c ON c.customer_id = b.customer_id
    LEFT JOIN Users u ON u.user_id    = p.created_by
`;

const findById = async (paymentId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE p.payment_id = @id AND p.company_id = @companyId`,
        { id: paymentId, companyId }
    );
    return rows[0] || null;
};

const findByBooking = async (bookingId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE p.booking_id = @bookingId AND p.company_id = @companyId ORDER BY p.created_at`,
        { bookingId, companyId }
    );
    return rows;
};

const findAll = async ({ companyId, branchId, status, method, bookingId, customerId, fromDate, toDate, search, offset, limit, sortBy, sortDir }) => {
    const where = [
        'p.company_id = @companyId',
        '(@branchId   IS NULL OR b.branch_id     = @branchId)',
        '(@status     IS NULL OR p.status        = @status)',
        '(@method     IS NULL OR p.payment_method = @method)',
        '(@bookingId  IS NULL OR p.booking_id    = @bookingId)',
        '(@customerId IS NULL OR b.customer_id   = @customerId)',
        '(@fromDate   IS NULL OR CAST(p.created_at AS DATE) >= @fromDate)',
        '(@toDate     IS NULL OR CAST(p.created_at AS DATE) <= @toDate)',
        `(@search IS NULL OR p.reference_number LIKE CONCAT('%', @search, '%')
            OR b.booking_ref LIKE CONCAT('%', @search, '%')
            OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const col = ['created_at', 'amount', 'status'].includes(sortBy) ? `p.${sortBy}` : 'p.created_at';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId:   branchId   || null,
        status:     status     || null,
        method:     method     || null,
        bookingId:  bookingId  || null,
        customerId: customerId || null,
        fromDate:   fromDate ? new Date(fromDate) : null,
        toDate:     toDate   ? new Date(toDate)   : null,
        search:     search    || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total FROM Payments p
             JOIN Bookings b ON b.booking_id = p.booking_id
             JOIN Customers c ON c.customer_id = b.customer_id
             WHERE ${where}`,
            params
        ),
    ]);

    return { rows, total: countRows[0].total };
};

/**
 * Record a payment and update booking's amount_paid atomically.
 *
 * The remaining-balance check is re-validated *inside* this locking
 * transaction (not just once in payment.service.js before calling in) —
 * WITH (UPDLOCK, HOLDLOCK) on the booking row serializes concurrent payment
 * attempts for the same booking, closing the TOCTOU race where two
 * near-simultaneous payments could each read the same stale amount_paid,
 * both pass validation, and together overpay the booking. Mirrors the same
 * lock pattern booking.repository.js's checkAvailabilityInTx uses for hall
 * double-booking prevention.
 */
const create = async (data) => {
    let paymentId;

    await withTransaction(async (tx) => {
        const bookingRows = await tx.execute(
            `SELECT total_amount, ISNULL(amount_paid, 0) AS amount_paid
             FROM Bookings WITH (UPDLOCK, HOLDLOCK)
             WHERE booking_id = @bookingId AND company_id = @companyId`,
            { bookingId: data.bookingId, companyId: data.companyId }
        );
        if (!bookingRows.length) throw new Error('Booking not found');

        const remainingBalance = bookingRows[0].total_amount - bookingRows[0].amount_paid;
        if (data.amount > remainingBalance + 0.01) {
            const err = new Error(`Payment amount (${data.amount}) exceeds remaining balance (${remainingBalance.toFixed(2)})`);
            err.isValidation = true;
            throw err;
        }

        const result = await tx.execute(
            `INSERT INTO Payments (booking_id, company_id, amount, payment_method, payment_type,
                reference_number, notes, status, created_by, created_at)
             OUTPUT INSERTED.payment_id AS id
             VALUES (@bookingId, @companyId, @amount, @method, @type,
                @reference, @notes, 'completed', @createdBy, GETUTCDATE())`,
            {
                bookingId:  data.bookingId,
                companyId:  data.companyId,
                amount:     data.amount,
                method:     data.paymentMethod,
                type:       data.paymentType,
                reference:  data.referenceNumber || null,
                notes:      data.notes           || null,
                createdBy:  data.createdBy,
            }
        );
        paymentId = result[0].id;

        await tx.execute(
            `UPDATE Bookings
             SET amount_paid = ISNULL(amount_paid, 0) + @amount,
                 updated_at  = GETUTCDATE()
             WHERE booking_id = @bookingId`,
            { bookingId: data.bookingId, amount: data.amount }
        );
    });

    return findById(paymentId, data.companyId);
};

/**
 * Process a refund — writes a real Refunds row (linked to the original
 * payment) and reduces the booking's amount_paid, inside a locking
 * transaction so concurrent refund requests against the same payment
 * serialize instead of racing. The "amount already refunded" check is
 * re-validated inside the lock against the authoritative sum of prior
 * Refunds rows for this payment, not just the original payment's status flag
 * (which only ever supported one refund cleanly).
 */
const refund = async ({ paymentId, companyId, refundAmount, reason, method, createdBy }) => {
    let refundId;

    await withTransaction(async (tx) => {
        const paymentRows = await tx.execute(
            `SELECT payment_id, booking_id, amount, payment_method, status
             FROM Payments WITH (UPDLOCK, HOLDLOCK)
             WHERE payment_id = @id AND company_id = @companyId`,
            { id: paymentId, companyId }
        );
        if (!paymentRows.length) throw new Error('Payment not found');
        const original = paymentRows[0];

        const refundedRows = await tx.execute(
            `SELECT ISNULL(SUM(refund_amount), 0) AS total
             FROM Refunds WHERE payment_id = @id AND refund_status != 'failed'`,
            { id: paymentId }
        );
        const alreadyRefunded = refundedRows[0].total;
        const refundable = original.amount - alreadyRefunded;

        if (refundable <= 0) {
            const err = new Error('Payment has already been fully refunded');
            err.isValidation = true;
            throw err;
        }
        if (refundAmount > refundable + 0.01) {
            const err = new Error(`Refund amount (${refundAmount}) exceeds the refundable balance (${refundable.toFixed(2)})`);
            err.isValidation = true;
            throw err;
        }

        const newStatus = (alreadyRefunded + refundAmount) >= original.amount - 0.01 ? 'refunded' : 'partially_refunded';
        await tx.execute(
            `UPDATE Payments SET status = @status, updated_at = GETUTCDATE() WHERE payment_id = @id`,
            { id: paymentId, status: newStatus }
        );

        const result = await tx.execute(
            `INSERT INTO Refunds (payment_id, booking_id, company_id, refund_amount, refund_reason,
                refund_method, refund_status, requested_by, approved_by, processed_at, created_at)
             OUTPUT INSERTED.refund_id AS id
             VALUES (@paymentId, @bookingId, @companyId, @refundAmount, @reason,
                @method, 'completed', @createdBy, @createdBy, GETUTCDATE(), GETUTCDATE())`,
            {
                paymentId, bookingId: original.booking_id, companyId,
                refundAmount, reason: reason || null,
                method: method || original.payment_method, createdBy,
            }
        );
        refundId = result[0].id;

        await tx.execute(
            `UPDATE Bookings
             SET amount_paid = ISNULL(amount_paid, 0) - @amount,
                 updated_at  = GETUTCDATE()
             WHERE booking_id = @bookingId`,
            { bookingId: original.booking_id, amount: refundAmount }
        );
    });

    return findRefundById(refundId, companyId);
};

const REFUND_SELECT = `
    SELECT rf.refund_id, rf.payment_id, rf.booking_id, rf.company_id,
           rf.refund_amount, rf.refund_reason, rf.refund_method,
           rf.refund_status, rf.requested_by, rf.approved_by,
           rf.processed_at, rf.created_at
    FROM Refunds rf
`;

const findRefundById = async (refundId, companyId) => {
    const rows = await executeQuery(
        `${REFUND_SELECT} WHERE rf.refund_id = @id AND rf.company_id = @companyId`,
        { id: refundId, companyId }
    );
    return rows[0] || null;
};

const getRefundsForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `${REFUND_SELECT} WHERE rf.booking_id = @bookingId AND rf.company_id = @companyId ORDER BY rf.created_at DESC`,
        { bookingId, companyId }
    );
};

const getRefundsForPayment = async (paymentId, companyId) => {
    return executeQuery(
        `${REFUND_SELECT} WHERE rf.payment_id = @paymentId AND rf.company_id = @companyId ORDER BY rf.created_at DESC`,
        { paymentId, companyId }
    );
};

const findPending = async (companyId, daysAhead = 30) => {
    const rows = await executeQuery(
        `SELECT b.booking_id, b.booking_ref, b.event_date AS booking_date,
                b.event_name, b.status,
                CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                ISNULL(b.total_amount - b.amount_paid, 0) AS balance_due,
                DATEDIFF(DAY, CAST(GETDATE() AS DATE), b.event_date) AS days_until_event
         FROM Bookings b
         JOIN Customers c ON c.customer_id = b.customer_id
         WHERE b.company_id = @companyId
           AND b.status NOT IN ('cancelled', 'completed', 'draft')
           AND b.total_amount > ISNULL(b.amount_paid, 0)
           AND b.event_date BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, @daysAhead, CAST(GETDATE() AS DATE))
         ORDER BY b.event_date ASC`,
        { companyId, daysAhead }
    );
    return rows;
};

/**
 * Aggregate KPI stats for the payments dashboard cards
 */
const getStats = async (companyId) => {
    const rows = await executeQuery(
        `SELECT
            (SELECT ISNULL(SUM(amount), 0) FROM Payments
              WHERE company_id = @companyId AND status = 'completed'
                AND CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)) AS today,
            (SELECT ISNULL(SUM(amount), 0) FROM Payments
              WHERE company_id = @companyId AND status = 'completed'
                AND YEAR(created_at) = YEAR(GETDATE()) AND MONTH(created_at) = MONTH(GETDATE())) AS month,
            (SELECT COUNT(*) FROM Payments WHERE company_id = @companyId) AS totalTransactions,
            (SELECT ISNULL(SUM(b.total_amount - ISNULL(b.amount_paid, 0)), 0)
               FROM Bookings b
              WHERE b.company_id = @companyId
                AND b.status NOT IN ('cancelled', 'completed', 'draft')
                AND b.total_amount > ISNULL(b.amount_paid, 0)) AS pending
        `,
        { companyId }
    );
    return rows[0];
};

/** Company-wide refund list for the Payments page's "Refunds" tab. */
const findAllRefunds = async (companyId) => {
    return executeQuery(
        `SELECT rf.refund_id, rf.payment_id, rf.booking_id, rf.company_id,
                rf.refund_amount, rf.refund_reason, rf.refund_method,
                rf.refund_status, rf.processed_at, rf.created_at,
                b.booking_ref, b.event_name,
                CONCAT(c.first_name, ' ', c.last_name) AS customer_name
         FROM Refunds rf
         JOIN Bookings b  ON b.booking_id  = rf.booking_id
         JOIN Customers c ON c.customer_id = b.customer_id
         WHERE rf.company_id = @companyId
         ORDER BY rf.created_at DESC`,
        { companyId }
    );
};

module.exports = { findById, findByBooking, findAll, findPending, create, refund, getStats, getRefundsForBooking, getRefundsForPayment, findAllRefunds };
