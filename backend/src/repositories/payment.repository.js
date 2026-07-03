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

const findAll = async ({ companyId, branchId, status, method, bookingId, fromDate, toDate, search, offset, limit, sortBy, sortDir }) => {
    const where = [
        'p.company_id = @companyId',
        '(@branchId  IS NULL OR b.branch_id     = @branchId)',
        '(@status    IS NULL OR p.status        = @status)',
        '(@method    IS NULL OR p.payment_method = @method)',
        '(@bookingId IS NULL OR p.booking_id    = @bookingId)',
        '(@fromDate  IS NULL OR CAST(p.created_at AS DATE) >= @fromDate)',
        '(@toDate    IS NULL OR CAST(p.created_at AS DATE) <= @toDate)',
        `(@search IS NULL OR p.reference_number LIKE CONCAT('%', @search, '%')
            OR b.booking_ref LIKE CONCAT('%', @search, '%')
            OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const col = ['created_at', 'amount', 'status'].includes(sortBy) ? `p.${sortBy}` : 'p.created_at';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId:  branchId  || null,
        status:    status    || null,
        method:    method    || null,
        bookingId: bookingId || null,
        fromDate:  fromDate ? new Date(fromDate) : null,
        toDate:    toDate   ? new Date(toDate)   : null,
        search:    search    || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total FROM Payments p JOIN Bookings b ON b.booking_id = p.booking_id WHERE ${where}`,
            params
        ),
    ]);

    return { rows, total: countRows[0].total };
};

/**
 * Record a payment and update booking's amount_paid atomically
 */
const create = async (data) => {
    let paymentId;

    await withTransaction(async (tx) => {
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
 * Process a refund — inserts a negative payment and reduces amount_paid
 */
const refund = async ({ paymentId, companyId, refundAmount, reason, createdBy }) => {
    const original = await findById(paymentId, companyId);
    if (!original) throw new Error('Payment not found');

    let refundPaymentId;

    await withTransaction(async (tx) => {
        await tx.execute(
            `UPDATE Payments SET status = 'refunded', updated_at = GETUTCDATE() WHERE payment_id = @id`,
            { id: paymentId }
        );

        const result = await tx.execute(
            `INSERT INTO Payments (booking_id, company_id, amount, payment_method, payment_type,
                notes, status, created_by, created_at)
             OUTPUT INSERTED.payment_id AS id
             VALUES (@bookingId, @companyId, @amount, @method, 'refund',
                @notes, 'refunded', @createdBy, GETUTCDATE())`,
            {
                bookingId: original.booking_id,
                companyId,
                amount:    -Math.abs(refundAmount),
                method:    original.payment_method,
                notes:     reason || null,
                createdBy,
            }
        );
        refundPaymentId = result[0].id;

        await tx.execute(
            `UPDATE Bookings
             SET amount_paid = ISNULL(amount_paid, 0) - @amount,
                 updated_at  = GETUTCDATE()
             WHERE booking_id = @bookingId`,
            { bookingId: original.booking_id, amount: Math.abs(refundAmount) }
        );
    });

    return findById(refundPaymentId, companyId);
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

module.exports = { findById, findByBooking, findAll, findPending, create, refund, getStats };
