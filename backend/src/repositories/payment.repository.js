/**
 * Payment Repository
 */
'use strict';

const { executeQuery, withTransaction } = require('../config/database');

const BASE_SELECT = `
    SELECT p.payment_id, p.booking_id, p.company_id,
           p.amount, p.payment_method, p.payment_type,
           p.reference_number, p.notes, p.status,
           p.created_at, p.created_by,
           b.booking_ref, b.total_amount AS booking_total,
           CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
           CONCAT(u.first_name, ' ', u.last_name) AS collected_by_name
    FROM Payments p
    JOIN Bookings  b ON b.booking_id  = p.booking_id
    JOIN Customers c ON c.customer_id = b.customer_id
    LEFT JOIN Users u ON u.user_id    = p.created_by
`;

const findById = async (paymentId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE p.payment_id = :id AND p.company_id = :companyId`,
        { id: paymentId, companyId }
    );
    return rows[0] || null;
};

const findByBooking = async (bookingId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE p.booking_id = :bookingId AND p.company_id = :companyId ORDER BY p.created_at`,
        { bookingId, companyId }
    );
    return rows;
};

const findAll = async ({ companyId, branchId, status, method, bookingId, fromDate, toDate, offset, limit, sortBy, sortDir }) => {
    const where = [
        'p.company_id = :companyId',
        '(:branchId  IS NULL OR b.branch_id     = :branchId)',
        '(:status    IS NULL OR p.status        = :status)',
        '(:method    IS NULL OR p.payment_method = :method)',
        '(:bookingId IS NULL OR p.booking_id    = :bookingId)',
        '(:fromDate  IS NULL OR DATE(p.created_at) >= :fromDate)',
        '(:toDate    IS NULL OR DATE(p.created_at) <= :toDate)',
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
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} LIMIT :limit OFFSET :offset`,
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
             VALUES (:bookingId, :companyId, :amount, :method, :type,
                :reference, :notes, 'completed', :createdBy, UTC_TIMESTAMP())`,
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
        paymentId = result.insertId;

        await tx.execute(
            `UPDATE Bookings
             SET amount_paid = IFNULL(amount_paid, 0) + :amount,
                 updated_at  = UTC_TIMESTAMP()
             WHERE booking_id = :bookingId`,
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
            `UPDATE Payments SET status = 'refunded', updated_at = UTC_TIMESTAMP() WHERE payment_id = :id`,
            { id: paymentId }
        );

        const result = await tx.execute(
            `INSERT INTO Payments (booking_id, company_id, amount, payment_method, payment_type,
                notes, status, created_by, created_at)
             VALUES (:bookingId, :companyId, :amount, :method, 'refund',
                :notes, 'refunded', :createdBy, UTC_TIMESTAMP())`,
            {
                bookingId: original.booking_id,
                companyId,
                amount:    -Math.abs(refundAmount),
                method:    original.payment_method,
                notes:     reason || null,
                createdBy,
            }
        );
        refundPaymentId = result.insertId;

        await tx.execute(
            `UPDATE Bookings
             SET amount_paid = IFNULL(amount_paid, 0) - :amount,
                 updated_at  = UTC_TIMESTAMP()
             WHERE booking_id = :bookingId`,
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
                IFNULL(b.total_amount - b.amount_paid, 0) AS balance_due,
                DATEDIFF(b.event_date, CURDATE()) AS days_until_event
         FROM Bookings b
         JOIN Customers c ON c.customer_id = b.customer_id
         WHERE b.company_id = :companyId
           AND b.status NOT IN ('cancelled', 'completed', 'draft')
           AND b.total_amount > IFNULL(b.amount_paid, 0)
           AND b.event_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL :daysAhead DAY)
         ORDER BY b.event_date ASC`,
        { companyId, daysAhead }
    );
    return rows;
};

module.exports = { findById, findByBooking, findAll, findPending, create, refund };
