/**
 * Reports Repository — Analytics and export queries
 */
'use strict';

const { executeQuery } = require('../config/database');
const { balanceDueExpr } = require('./sqlExpressions');

const getRevenueReport = async ({ companyId, branchId, fromDate, toDate, groupBy = 'month' }) => {
    const groupExpr = groupBy === 'day'  ? `CAST(event_date AS DATE)`
                     : groupBy === 'week' ? `DATEPART(ISO_WEEK, event_date)`
                     : `DATEFROMPARTS(YEAR(event_date), MONTH(event_date), 1)`;

    const labelExpr = groupBy === 'day'  ? `FORMAT(event_date, 'dd MMM yyyy')`
                     : groupBy === 'week' ? `CONCAT('Wk ', DATEPART(ISO_WEEK, event_date))`
                     : `FORMAT(event_date, 'MMM yyyy')`;

    const rows = await executeQuery(
        `SELECT
            ${labelExpr}                                              AS period_label,
            ${groupExpr}                                              AS period_date,
            COUNT(*)                                                  AS booking_count,
            ISNULL(SUM(CASE WHEN status <> 'cancelled' THEN total_amount ELSE 0 END), 0)  AS total_revenue,
            ISNULL(SUM(CASE WHEN status <> 'cancelled' THEN amount_paid ELSE 0 END), 0)   AS amount_collected,
            ISNULL(SUM(CASE WHEN status <> 'cancelled' THEN total_amount - ISNULL(amount_paid, 0) ELSE 0 END), 0) AS pending_amount,
            COUNT(CASE WHEN status = 'cancelled' THEN 1 END)         AS cancellations,
            ISNULL(SUM(CASE WHEN status = 'cancelled' THEN total_amount ELSE 0 END), 0)   AS cancelled_amount
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

/** Total refunded amount actually processed (by refund creation date) within a range — a
    separate concept from a booking's cancelled total_amount, since refunds can be partial
    and are dated independently of the original event date. */
const getRefundedAmount = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT ISNULL(SUM(-p.amount), 0) AS refunded_amount
         FROM Payments p
         JOIN Bookings b ON b.booking_id = p.booking_id
         WHERE p.company_id = @companyId
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND p.payment_type = 'refund'
           AND CAST(p.created_at AS DATE) BETWEEN @fromDate AND @toDate`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
    return rows[0].refunded_amount;
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
                ${balanceDueExpr('b')} AS balance_due,
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

/**
 * Canonical per-hall occupancy for a date range — occupied hall-days (multi-day
 * bookings expanded across event_date..event_end_date, not counted as a single
 * row) divided by hall-days actually available (range length minus any
 * HallBlockedDates/maintenance days), alongside revenue/cancellations/banquet
 * context. This is the single occupancy source for both the dashboard and the
 * reports/owner-analytics module (via dashboard.repository.js's thin
 * period->date-range wrapper) — a plain COUNT(booking_id)/total_days ratio
 * undercounts multi-day bookings and ignores maintenance blocks.
 */
const getOccupancyReport = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `WITH range_bounds AS (
            SELECT CAST(@fromDate AS DATE) AS range_start, CAST(@toDate AS DATE) AS range_end
         ),
         dates AS (
            SELECT range_start AS d FROM range_bounds
            UNION ALL
            SELECT DATEADD(DAY, 1, d) FROM dates, range_bounds WHERE DATEADD(DAY, 1, d) <= range_end
         ),
         occ AS (
            SELECT b.hall_id, COUNT(DISTINCT dt.d) AS occupied_days
            FROM Bookings b
            CROSS APPLY (
                SELECT d FROM dates
                WHERE d BETWEEN b.event_date AND ISNULL(b.event_end_date, b.event_date)
            ) dt
            WHERE b.company_id = @companyId AND b.status NOT IN ('draft', 'cancelled')
            GROUP BY b.hall_id
         ),
         blocked AS (
            SELECT hbd.hall_id, COUNT(DISTINCT hbd.blocked_date) AS blocked_days
            FROM HallBlockedDates hbd, range_bounds
            WHERE hbd.blocked_date BETWEEN range_bounds.range_start AND range_bounds.range_end
            GROUP BY hbd.hall_id
         )
         SELECT
            h.hall_id, h.hall_name, h.capacity,
            bq.banquet_name,
            COUNT(b.booking_id)               AS total_bookings,
            ISNULL(SUM(CASE WHEN b.status <> 'cancelled' THEN b.total_amount ELSE 0 END), 0) AS total_revenue,
            COUNT(CASE WHEN b.status = 'cancelled' THEN 1 END) AS cancellations,
            (DATEDIFF(DAY, range_bounds.range_start, range_bounds.range_end) + 1) - ISNULL(blocked.blocked_days, 0) AS total_days,
            ISNULL(occ.occupied_days, 0) AS occupied_days,
            CAST(
                ISNULL(occ.occupied_days, 0) * 100.0 /
                NULLIF((DATEDIFF(DAY, range_bounds.range_start, range_bounds.range_end) + 1) - ISNULL(blocked.blocked_days, 0), 0)
            AS DECIMAL(5,1))                  AS occupancy_pct
         FROM Halls h
         CROSS JOIN range_bounds
         JOIN Banquets bq ON bq.banquet_id = h.banquet_id
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.event_date BETWEEN range_bounds.range_start AND range_bounds.range_end
             AND b.status NOT IN ('draft', 'cancelled')
         LEFT JOIN occ     ON occ.hall_id     = h.hall_id
         LEFT JOIN blocked ON blocked.hall_id = h.hall_id
         WHERE h.company_id = @companyId
           AND (@branchId IS NULL OR h.branch_id = @branchId)
           AND h.is_active = 1
         GROUP BY h.hall_id, h.hall_name, h.capacity, bq.banquet_name,
                  range_bounds.range_start, range_bounds.range_end,
                  occ.occupied_days, blocked.blocked_days
         ORDER BY occupancy_pct DESC
         OPTION (MAXRECURSION 366)`,
        {
            companyId,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows;
};

/**
 * Per-day occupancy across all halls for a date range — feeds the occupancy
 * report's calendar heatmap. Same occupied/available-day methodology as
 * getOccupancyReport (multi-day bookings expanded, maintenance blocks
 * subtracted) but grouped by calendar date instead of by hall.
 */
const getDailyOccupancy = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `WITH range_bounds AS (
            SELECT CAST(@fromDate AS DATE) AS range_start, CAST(@toDate AS DATE) AS range_end
         ),
         dates AS (
            SELECT range_start AS d FROM range_bounds
            UNION ALL
            SELECT DATEADD(DAY, 1, d) FROM dates, range_bounds WHERE DATEADD(DAY, 1, d) <= range_end
         ),
         active_halls AS (
            SELECT hall_id FROM Halls
            WHERE company_id = @companyId AND (@branchId IS NULL OR branch_id = @branchId) AND is_active = 1
         ),
         booked AS (
            SELECT dt.d, COUNT(DISTINCT b.hall_id) AS booked_halls
            FROM Bookings b
            CROSS APPLY (
                SELECT d FROM dates
                WHERE d BETWEEN b.event_date AND ISNULL(b.event_end_date, b.event_date)
            ) dt
            WHERE b.company_id = @companyId AND b.status NOT IN ('draft', 'cancelled')
              AND b.hall_id IN (SELECT hall_id FROM active_halls)
            GROUP BY dt.d
         ),
         blocked AS (
            SELECT hbd.blocked_date AS d, COUNT(DISTINCT hbd.hall_id) AS blocked_halls
            FROM HallBlockedDates hbd
            WHERE hbd.hall_id IN (SELECT hall_id FROM active_halls)
            GROUP BY hbd.blocked_date
         )
         SELECT
            dates.d                                                            AS occ_date,
            (SELECT COUNT(*) FROM active_halls)                                AS total_halls,
            ISNULL(blocked.blocked_halls, 0)                                   AS blocked_halls,
            ISNULL(booked.booked_halls, 0)                                     AS booked_halls,
            CAST(
                ISNULL(booked.booked_halls, 0) * 100.0 /
                NULLIF((SELECT COUNT(*) FROM active_halls) - ISNULL(blocked.blocked_halls, 0), 0)
            AS DECIMAL(5,1))                                                   AS occupancy_pct
         FROM dates
         LEFT JOIN booked  ON booked.d  = dates.d
         LEFT JOIN blocked ON blocked.d = dates.d
         ORDER BY dates.d
         OPTION (MAXRECURSION 366)`,
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

/**
 * Canonical booking/revenue summary for a date range — the single source of
 * truth for these figures. Both the dashboard and the reports module call
 * this (via dashboard.repository.js's thin period->date-range wrapper) so
 * they can never disagree on what counts as revenue/pending/cancelled.
 * Revenue/collected/pending all EXCLUDE cancelled bookings; cancellation
 * count/rate are reported separately.
 */
const getSummaryStats = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT
            COUNT(*)                                                AS total_bookings,
            COUNT(CASE WHEN status = 'confirmed'  THEN 1 END)      AS confirmed_bookings,
            COUNT(CASE WHEN status = 'cancelled'  THEN 1 END)      AS cancelled_bookings,
            COUNT(CASE WHEN status = 'completed'  THEN 1 END)      AS completed_bookings,
            ISNULL(SUM(CASE WHEN status <> 'cancelled' THEN total_amount ELSE 0 END), 0)   AS total_revenue,
            ISNULL(SUM(CASE WHEN status <> 'cancelled' THEN advance_paid ELSE 0 END), 0)   AS advance_collected,
            ISNULL(SUM(CASE WHEN status <> 'cancelled' THEN amount_paid ELSE 0 END), 0)    AS collected,
            ISNULL(SUM(CASE WHEN status <> 'cancelled' THEN total_amount - ISNULL(amount_paid,0) ELSE 0 END), 0) AS pending_amount,
            ISNULL(AVG(CAST(guest_count AS DECIMAL(10,2))), 0)     AS avg_guest_count
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
    getRefundedAmount,
    getBookingReport,
    getOccupancyReport,
    getDailyOccupancy,
    getPaymentReport,
    getSummaryStats,
    getRevenuePerHall,
    getTopCustomers,
    getCancellationAndRefundRates,
    getInventoryCost,
    getMonthlyComparison,
};
