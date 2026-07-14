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
         WHERE (@companyId IS NULL OR company_id = @companyId)
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('draft')
         GROUP BY ${groupExpr}, ${labelExpr}
         ORDER BY period_date`,
        {
            companyId: companyId || null,
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
            WHERE (@companyId IS NULL OR b.company_id = @companyId) AND b.status NOT IN ('draft', 'cancelled')
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
         WHERE (@companyId IS NULL OR h.company_id = @companyId)
           AND (@branchId IS NULL OR h.branch_id = @branchId)
           AND h.is_active = 1
         GROUP BY h.hall_id, h.hall_name, h.capacity, bq.banquet_name,
                  range_bounds.range_start, range_bounds.range_end,
                  occ.occupied_days, blocked.blocked_days
         ORDER BY occupancy_pct DESC
         OPTION (MAXRECURSION 366)`,
        {
            companyId: companyId || null,
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
         WHERE (@companyId IS NULL OR company_id = @companyId)
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('draft')`,
        {
            companyId: companyId || null,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows[0];
};

/**
 * GST actually collected via generated invoices in the date range — distinct
 * from Bookings.total_amount (the taxable base), this sums the tax invoices
 * were raised for (invoice_date, not event_date, since that's when the tax
 * liability was actually created). Cancelled invoices are excluded, same as
 * every other revenue figure in this file.
 */
const getGstCollected = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT ISNULL(SUM(i.cgst_amount + i.sgst_amount), 0) AS gst_collected
         FROM Invoices i
         JOIN Bookings b ON b.booking_id = i.booking_id
         WHERE (@companyId IS NULL OR i.company_id = @companyId)
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND i.invoice_date BETWEEN @fromDate AND @toDate
           AND i.is_cancelled = 0`,
        {
            companyId: companyId || null,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows[0].gst_collected;
};

/**
 * Tax collected grouped by HSN/SAC code across every invoice raised in the
 * range — parses each invoice's hsn_sac_breakdown JSON (see
 * invoice.service.js buildHsnSacBreakdown) and re-aggregates in application
 * code since SQL Server has no native JSON array-unnest prior to OPENJSON,
 * which would need a per-row APPLY; simpler and clear enough at report-page
 * volumes to do the grouping here.
 */
const getHsnSacBreakdown = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT i.hsn_sac_breakdown
         FROM Invoices i
         JOIN Bookings b ON b.booking_id = i.booking_id
         WHERE (@companyId IS NULL OR i.company_id = @companyId)
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND i.invoice_date BETWEEN @fromDate AND @toDate
           AND i.is_cancelled = 0
           AND i.hsn_sac_breakdown IS NOT NULL`,
        {
            companyId: companyId || null,
            branchId: branchId || null,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );

    const grouped = new Map();
    for (const row of rows) {
        let items;
        try { items = JSON.parse(row.hsn_sac_breakdown); } catch { continue; }
        for (const item of items) {
            const key = `${item.hsn_sac_code}:${item.tax_percent}`;
            const existing = grouped.get(key) || {
                hsn_sac_code: item.hsn_sac_code, tax_type: item.tax_type,
                tax_percent: item.tax_percent, taxable_value: 0, tax_amount: 0,
            };
            existing.taxable_value += Number(item.taxable_value) || 0;
            existing.tax_amount    += Number(item.tax_amount) || 0;
            grouped.set(key, existing);
        }
    }
    return Array.from(grouped.values()).sort((a, b) => b.tax_amount - a.tax_amount);
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

/**
 * Decoration package/item performance for Owner Analytics — usage, revenue
 * (same rental+install+removal, less discount, plus tax formula as
 * booking.service.js's recalculateBookingTotal, computed here per-allocation
 * rather than duplicated onto a stored column), cost (unit_cost snapshot),
 * and utilization (allocated ÷ available stock) for the period.
 */
const getDecorationAnalytics = async ({ companyId, branchId, fromDate, toDate }) => {
    const REVENUE_EXPR = `
        (bd.quantity_allocated * di.rental_price + di.installation_cost + di.removal_cost)
        * (1 - di.discount_percent / 100) * (1 + di.tax_percent / 100)`;

    const packageBreakdown = await executeQuery(
        `SELECT dp.package_id, dp.package_name,
                COUNT(DISTINCT bd.booking_id) AS bookings_count,
                ISNULL(SUM(bd.quantity_allocated), 0) AS total_quantity,
                ISNULL(SUM(${REVENUE_EXPR}), 0) AS revenue
         FROM BookingDecorations bd
         JOIN DecorationItems di ON di.decoration_id = bd.decoration_id
         JOIN DecorationPackages dp ON dp.package_id = bd.package_id
         JOIN Bookings b ON b.booking_id = bd.booking_id
         WHERE b.company_id = @companyId
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND b.event_date BETWEEN @fromDate AND @toDate
           AND b.status NOT IN ('draft', 'cancelled')
         GROUP BY dp.package_id, dp.package_name
         ORDER BY bookings_count DESC`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );

    const totals = await executeQuery(
        `SELECT ISNULL(SUM(${REVENUE_EXPR}), 0) AS total_revenue,
                ISNULL(SUM(bd.quantity_allocated * di.unit_cost), 0) AS total_cost
         FROM BookingDecorations bd
         JOIN DecorationItems di ON di.decoration_id = bd.decoration_id
         JOIN Bookings b ON b.booking_id = bd.booking_id
         WHERE b.company_id = @companyId
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND b.event_date BETWEEN @fromDate AND @toDate
           AND b.status NOT IN ('draft', 'cancelled')`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );

    const itemUtilization = await executeQuery(
        `SELECT di.decoration_id, di.decoration_name, di.quantity_available,
                ISNULL(SUM(bd.quantity_allocated), 0) AS quantity_allocated,
                CASE WHEN di.quantity_available > 0
                     THEN CAST(ISNULL(SUM(bd.quantity_allocated), 0) * 100.0 / di.quantity_available AS DECIMAL(5,2))
                     ELSE 0 END AS utilization_pct
         FROM DecorationItems di
         LEFT JOIN BookingDecorations bd ON bd.decoration_id = di.decoration_id
             AND bd.booking_id IN (
                 SELECT booking_id FROM Bookings
                 WHERE company_id = @companyId
                   AND (@branchId IS NULL OR branch_id = @branchId)
                   AND event_date BETWEEN @fromDate AND @toDate
                   AND status NOT IN ('draft', 'cancelled')
             )
         WHERE di.company_id = @companyId AND di.is_active = 1
         GROUP BY di.decoration_id, di.decoration_name, di.quantity_available
         ORDER BY quantity_allocated DESC`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );

    return {
        packageBreakdown,
        totalRevenue: totals[0].total_revenue,
        totalCost: totals[0].total_cost,
        profitability: Number(totals[0].total_revenue) - Number(totals[0].total_cost),
        itemUtilization,
    };
};

// ─── Revenue report — event type, coupon impact, composition ───────────────

const getEventTypeBreakdown = async ({ companyId, branchId, fromDate, toDate }) => {
    return executeQuery(
        `SELECT
            ISNULL(NULLIF(event_type, ''), 'Unspecified') AS event_type,
            COUNT(*)                        AS bookings_count,
            ISNULL(SUM(total_amount), 0)    AS revenue
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('draft', 'cancelled')
         GROUP BY event_type
         ORDER BY revenue DESC`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
};

/**
 * Discount impact from redeemed coupons in the date range (by booking's
 * event_date, matching every other figure in this report). Sits alongside
 * revenue rather than replacing it — total_amount on Bookings is already
 * post-discount (see coupon.service.js apply()/booking.repository.js
 * applyCoupon), so this exists purely to show how much of the collected
 * revenue was given up to promotions, not to be subtracted again.
 */
const getCouponImpact = async ({ companyId, branchId, fromDate, toDate }) => {
    const [summary, byCoupon] = await Promise.all([
        executeQuery(
            `SELECT
                COUNT(DISTINCT b.booking_id)      AS redemptions,
                ISNULL(SUM(b.discount_amount), 0) AS total_discount
             FROM Bookings b
             WHERE b.company_id = @companyId
               AND (@branchId IS NULL OR b.branch_id = @branchId)
               AND b.event_date BETWEEN @fromDate AND @toDate
               AND b.status NOT IN ('draft', 'cancelled')
               AND b.coupon_id IS NOT NULL`,
            { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
        ),
        executeQuery(
            `SELECT
                b.coupon_code,
                COUNT(*)                          AS redemptions,
                ISNULL(SUM(b.discount_amount), 0) AS total_discount,
                ISNULL(SUM(b.total_amount), 0)    AS revenue_influenced
             FROM Bookings b
             WHERE b.company_id = @companyId
               AND (@branchId IS NULL OR b.branch_id = @branchId)
               AND b.event_date BETWEEN @fromDate AND @toDate
               AND b.status NOT IN ('draft', 'cancelled')
               AND b.coupon_id IS NOT NULL
             GROUP BY b.coupon_code
             ORDER BY total_discount DESC`,
            { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
        ),
    ]);
    return { redemptions: summary[0].redemptions, totalDiscount: summary[0].total_discount, byCoupon };
};

/**
 * How collected revenue breaks down into three buckets: Decoration (reuses
 * the same figure getDecorationAnalytics already computes correctly from
 * DecorationBookings, since decoration_charge alone is stale whenever a
 * booking uses the catalog-allocation path — see booking.service.js
 * recalculateBookingTotal), flat Operational Charges/Surcharges (these ARE
 * reliable summed columns — setup/cleanup/cleaning/late-exit/
 * extended-usage/cooloff/priority surcharge are never derived from a
 * fallback branch), and "Venue, Catering & Services" as the remainder.
 *
 * That remainder is deliberately NOT split further into hall/catering/
 * resources/services here — doing so precisely would mean re-implementing
 * recalculateBookingTotal's branching (package pricing vs weekend-surcharge
 * hall rates, per-session catering vs flat fallback, resource/service
 * allocations) a second time in raw SQL, which risks quietly drifting out of
 * sync with the real total. Deriving it as total_revenue minus the two
 * reliable buckets guarantees this composition always sums to the same
 * total_revenue figure shown elsewhere on the report, by construction.
 */
const getRevenueComposition = async ({ companyId, branchId, fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT
            ISNULL(SUM(total_amount), 0) AS total_revenue,
            ISNULL(SUM(setup_charge + cleanup_charge + cleaning_charge + late_exit_charge + extended_usage_charge + cooloff_charge + priority_surcharge), 0) AS operational_charges
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('draft', 'cancelled')`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );

    const decoration = await getDecorationAnalytics({ companyId, branchId, fromDate, toDate });

    const totalRevenue = Number(rows[0].total_revenue) || 0;
    const operationalCharges = Number(rows[0].operational_charges) || 0;
    const decorationRevenue = Number(decoration.totalRevenue) || 0;

    return {
        total_revenue: totalRevenue,
        decoration_revenue: decorationRevenue,
        operational_charges: operationalCharges,
        venue_catering_services: Math.max(totalRevenue - decorationRevenue - operationalCharges, 0),
    };
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
    getDecorationAnalytics,
    getMonthlyComparison,
    getGstCollected,
    getHsnSacBreakdown,
    getEventTypeBreakdown,
    getCouponImpact,
    getRevenueComposition,
};
