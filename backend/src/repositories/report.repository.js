/**
 * Reports Repository — Analytics and export queries
 */
'use strict';

const { executeQuery } = require('../config/database');

const getRevenueReport = async ({ companyId, branchId, fromDate, toDate, groupBy = 'month' }) => {
    const groupExpr  = groupBy === 'day'
        ? `CAST(event_date AS DATE)`
        : `DATEFROMPARTS(YEAR(event_date), MONTH(event_date), 1)`;

    const labelExpr  = groupBy === 'day'
        ? `FORMAT(event_date, 'dd MMM yyyy')`
        : `FORMAT(event_date, 'MMM yyyy')`;

    const rows = await executeQuery(
        `SELECT
            ${labelExpr}                                              AS period_label,
            ${groupExpr}                                              AS period_date,
            COUNT(*)                                                  AS booking_count,
            ISNULL(SUM(total_amount), 0)                             AS total_revenue,
            ISNULL(SUM(amount_paid), 0)                              AS amount_collected,
            ISNULL(SUM(total_amount - ISNULL(amount_paid, 0)), 0)   AS pending_amount,
            COUNT(CASE WHEN status = 'cancelled' THEN 1 END)         AS cancellations
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('draft')
         GROUP BY ${groupExpr}
         ORDER BY period_date`,
        {
            companyId,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows;
};

const BOOKING_SORT_COLUMNS = {
    event_date:    'b.event_date',
    total_amount:  'b.total_amount',
    customer_name: 'customer_name',
    status:        'b.status',
};

const getBookingReport = async ({ companyId, branchId, fromDate, toDate, status, search, sortBy, sortDir, offset, limit }) => {
    const where = [
        'b.company_id = @companyId',
        '(@branchId IS NULL OR b.branch_id = @branchId)',
        'b.event_date BETWEEN @fromDate AND @toDate',
        '(@status IS NULL OR b.status = @status)',
        `(@search IS NULL OR b.booking_ref LIKE @search OR b.event_name LIKE @search
            OR b.event_type LIKE @search OR h.hall_name LIKE @search
            OR c.first_name LIKE @search OR c.last_name LIKE @search)`,
    ].join(' AND ');

    const params = {
        companyId,
        branchId: branchId || null,
        fromDate: new Date(fromDate),
        toDate:   new Date(toDate),
        status:   status   || null,
        search:   search    ? `%${search}%` : null,
    };

    const orderCol = BOOKING_SORT_COLUMNS[sortBy] || 'b.event_date';
    const orderDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `SELECT
                b.booking_ref, b.event_date, b.event_time_start, b.event_time_end,
                b.event_name, b.event_type, b.guest_count, b.status,
                b.total_amount, b.amount_paid,
                b.total_amount - ISNULL(b.amount_paid, 0) AS balance_due,
                h.hall_name, h.capacity,
                bq.banquet_name,
                CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                c.phone AS customer_phone,
                c.email AS customer_email,
                b.created_at, b.cancellation_reason
             FROM Bookings b
             JOIN Halls     h  ON h.hall_id     = b.hall_id
             JOIN Banquets  bq ON bq.banquet_id = h.banquet_id
             JOIN Customers c  ON c.customer_id = b.customer_id
             WHERE ${where}
             ORDER BY ${orderCol} ${orderDir}
             OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total
             FROM Bookings b
             JOIN Halls     h  ON h.hall_id     = b.hall_id
             JOIN Customers c  ON c.customer_id = b.customer_id
             WHERE ${where}`,
            params
        ),
    ]);

    return { rows, total: countRows[0].total };
};

const getOccupancyReport = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT
            h.hall_id, h.hall_name, h.capacity,
            bq.banquet_name,
            COUNT(b.booking_id)               AS total_bookings,
            ISNULL(SUM(b.total_amount), 0)    AS total_revenue,
            COUNT(CASE WHEN b.status = 'cancelled' THEN 1 END) AS cancellations,
            DATEDIFF(DAY, @fromDate, @toDate) + 1  AS total_days,
            CAST(
                COUNT(b.booking_id) * 100.0 /
                NULLIF(DATEDIFF(DAY, @fromDate, @toDate) + 1, 0)
            AS DECIMAL(5,1))                  AS occupancy_pct
         FROM Halls h
         JOIN Banquets bq ON bq.banquet_id = h.banquet_id
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.event_date BETWEEN @fromDate AND @toDate
             AND b.status NOT IN ('draft', 'cancelled')
         WHERE h.company_id = @companyId
           AND (@branchId IS NULL OR h.branch_id = @branchId)
           AND h.is_active = 1
         GROUP BY h.hall_id, h.hall_name, h.capacity, bq.banquet_name
         ORDER BY occupancy_pct DESC`,
        {
            companyId,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows;
};

const getPaymentReport = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT
            payment_method,
            payment_type,
            COUNT(*)                AS transaction_count,
            ISNULL(SUM(amount), 0) AS total_amount
         FROM Payments
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR booking_id IN (
                SELECT booking_id FROM Bookings WHERE branch_id = @branchId
           ))
           AND CAST(created_at AS DATE) BETWEEN @fromDate AND @toDate
           AND status = 'completed'
         GROUP BY payment_method, payment_type
         ORDER BY total_amount DESC`,
        {
            companyId,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows;
};

const getSummaryStats = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT
            COUNT(*)                                              AS total_bookings,
            ISNULL(SUM(total_amount), 0)                         AS gross_revenue,
            ISNULL(SUM(amount_paid), 0)                          AS collected,
            ISNULL(SUM(total_amount - ISNULL(amount_paid,0)),0)  AS outstanding,
            COUNT(CASE WHEN status = 'cancelled' THEN 1 END)     AS cancellations,
            COUNT(CASE WHEN status = 'completed' THEN 1 END)     AS completed_events,
            ISNULL(AVG(CAST(guest_count AS DECIMAL(10,2))), 0)   AS avg_guest_count
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('draft')`,
        {
            companyId,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows[0];
};

module.exports = {
    getRevenueReport,
    getBookingReport,
    getOccupancyReport,
    getPaymentReport,
    getSummaryStats,
};
