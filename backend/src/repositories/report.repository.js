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
         GROUP BY ${groupExpr}, ${labelExpr}
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

// ─── Owner Analytics ────────────────────────────────────────────────────────

const getRevenuePerHall = async ({ companyId, branchId, fromDate, toDate }) => {
    return executeQuery(
        `SELECT
            h.hall_id, h.hall_name, h.area_sqft,
            COUNT(b.booking_id) AS bookings_count,
            ISNULL(SUM(b.total_amount), 0) AS revenue,
            CAST(ISNULL(SUM(b.total_amount), 0) / NULLIF(h.area_sqft, 0) AS DECIMAL(12,2)) AS revenue_per_sqft
         FROM Halls h
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.event_date BETWEEN @fromDate AND @toDate
             AND b.status NOT IN ('draft', 'cancelled')
         WHERE h.company_id = @companyId
           AND (@branchId IS NULL OR h.branch_id = @branchId)
           AND h.is_active = 1
         GROUP BY h.hall_id, h.hall_name, h.area_sqft
         ORDER BY revenue DESC`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
};

const getTopCustomers = async ({ companyId, branchId, fromDate, toDate, limit = 10 }) => {
    return executeQuery(
        `SELECT TOP (@limit)
            c.customer_id, CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
            COUNT(b.booking_id) AS total_bookings,
            ISNULL(SUM(b.total_amount), 0) AS total_spend
         FROM Customers c
         JOIN Bookings b ON b.customer_id = c.customer_id
             AND b.event_date BETWEEN @fromDate AND @toDate
             AND b.status NOT IN ('draft', 'cancelled')
         WHERE c.company_id = @companyId
           AND (@branchId IS NULL OR b.branch_id = @branchId)
         GROUP BY c.customer_id, c.first_name, c.last_name
         ORDER BY total_spend DESC`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate), limit }
    );
};

const getCancellationAndRefundRates = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT
            COUNT(*) AS total_bookings,
            COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_bookings
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status <> 'draft'`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );

    const paymentRows = await executeQuery(
        `SELECT
            ISNULL(SUM(CASE WHEN payment_type = 'refund' THEN amount ELSE 0 END), 0) AS refunded_amount,
            ISNULL(SUM(CASE WHEN payment_type <> 'refund' THEN amount ELSE 0 END), 0) AS collected_amount
         FROM Payments
         WHERE company_id = @companyId
           AND status = 'completed'
           AND CAST(created_at AS DATE) BETWEEN @fromDate AND @toDate`,
        { companyId, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );

    const b = rows[0];
    const p = paymentRows[0];
    return {
        cancellation_rate: b.total_bookings > 0 ? Number((b.cancelled_bookings / b.total_bookings * 100).toFixed(2)) : 0,
        cancelled_bookings: b.cancelled_bookings,
        total_bookings: b.total_bookings,
        refund_rate: p.collected_amount > 0 ? Number((p.refunded_amount / p.collected_amount * 100).toFixed(2)) : 0,
        refunded_amount: p.refunded_amount,
        collected_amount: p.collected_amount,
    };
};

const getInventoryCost = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT ISNULL(SUM(br.quantity_allocated * r.unit_price), 0) AS inventory_cost
         FROM BookingResources br
         JOIN Resources r ON r.resource_id = br.resource_id
         JOIN Bookings b  ON b.booking_id  = br.booking_id
         WHERE b.company_id = @companyId
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND b.event_date BETWEEN @fromDate AND @toDate
           AND b.status NOT IN ('draft', 'cancelled')`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
    return rows[0].inventory_cost;
};

const getMonthlyComparison = async ({ companyId, branchId, currentFrom, currentTo, previousFrom, previousTo }) => {
    const query = (fromDate, toDate) => executeQuery(
        `SELECT COUNT(*) AS bookings_count, ISNULL(SUM(total_amount), 0) AS revenue
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('draft', 'cancelled')`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );

    const [current, previous] = await Promise.all([
        query(currentFrom, currentTo),
        query(previousFrom, previousTo),
    ]);

    return { current: current[0], previous: previous[0] };
};

module.exports = {
    getRevenueReport,
    getBookingReport,
    getOccupancyReport,
    getPaymentReport,
    getSummaryStats,
    getRevenuePerHall,
    getTopCustomers,
    getCancellationAndRefundRates,
    getInventoryCost,
    getMonthlyComparison,
};
