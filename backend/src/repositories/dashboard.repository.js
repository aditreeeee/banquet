/**
 * Dashboard Repository — Aggregated stats queries.
 *
 * KPI/revenue/occupancy figures delegate to report.repository.js (the
 * canonical source for these — see getSummaryStats/getRevenueReport/
 * getOccupancyReport there) via periodToDateRange() below, converting the
 * dashboard's rolling "period" (week/month/quarter/year) into an explicit
 * date range. This ensures the dashboard and the reports/owner-analytics
 * module can never disagree on what counts as revenue, pending, cancelled,
 * or occupied — they run the exact same SQL.
 */

'use strict';

const { executeQuery } = require('../config/database');
const reportRepo = require('./report.repository');

/**
 * Converts a rolling period name into an explicit [from, to] date range
 * anchored on "now", matching the semantics the dashboard has always used
 * (current week/month/quarter/year), so report.repository.js's date-range
 * queries can be reused here without changing their signature.
 */
const periodToDateRange = (period) => {
    const now = new Date();
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const toISO = d => d.toISOString().slice(0, 10);

    switch (period) {
        case 'week': {
            const start = new Date(now); start.setUTCDate(start.getUTCDate() - 6);
            return { fromDate: toISO(start), toDate: toISO(now) };
        }
        case 'quarter': {
            const qStartMonth = Math.floor(m / 3) * 3;
            const start = new Date(Date.UTC(y, qStartMonth, 1));
            const end   = new Date(Date.UTC(y, qStartMonth + 3, 0));
            return { fromDate: toISO(start), toDate: toISO(end) };
        }
        case 'year':
            return { fromDate: `${y}-01-01`, toDate: `${y}-12-31` };
        case 'month':
        default: {
            const start = new Date(Date.UTC(y, m, 1));
            const end   = new Date(Date.UTC(y, m + 1, 0));
            return { fromDate: toISO(start), toDate: toISO(end) };
        }
    }
};

const getKpiStats = async ({ companyId, branchId, period = 'month' }) => {
    const { fromDate, toDate } = periodToDateRange(period);
    return reportRepo.getSummaryStats({ companyId, branchId, fromDate, toDate });
};

const getNewCustomers = async ({ companyId, branchId, period = 'month' }) => {
    const { fromDate, toDate } = periodToDateRange(period);
    const rows = await executeQuery(
        `SELECT COUNT(*) AS new_customers
         FROM Customers
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND CAST(created_at AS DATE) BETWEEN @fromDate AND @toDate`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
    return rows[0]?.new_customers || 0;
};

const getRevenueSeries = async ({ companyId, branchId, period = 'month' }) => {
    const groupBy = period === 'week' ? 'day' : period === 'month' ? 'week' : 'month';
    const { fromDate, toDate } = periodToDateRange(period);
    const rows = await reportRepo.getRevenueReport({ companyId, branchId, fromDate, toDate, groupBy });
    // Dashboard chart expects {label, revenue}; report series has {period_label, total_revenue, ...}.
    return rows.map(r => ({ label: r.period_label, revenue: r.total_revenue }));
};

const getStatusDistribution = async ({ companyId, branchId, period = 'month' }) => {
    const { fromDate, toDate } = periodToDateRange(period);
    const rows = await executeQuery(
        `SELECT status, COUNT(*) AS count
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND event_date BETWEEN @fromDate AND @toDate
         GROUP BY status`,
        { companyId, branchId: branchId || null, fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
    return rows;
};

const getUpcomingBookings = async ({ companyId, branchId, limit = 10 }) => {
    const rows = await executeQuery(
        `SELECT TOP (@limit)
            b.booking_id, b.booking_ref, b.event_date, b.event_time_start, b.event_time_end,
            b.event_name, b.status, b.total_amount, b.amount_paid, b.guest_count, b.is_priority,
            h.hall_name,
            CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
            c.phone AS customer_phone
         FROM Bookings b
         JOIN Halls     h ON h.hall_id     = b.hall_id
         JOIN Customers c ON c.customer_id = b.customer_id
         WHERE b.company_id = @companyId
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND b.event_date BETWEEN CAST(GETUTCDATE() AS DATE) AND DATEADD(DAY, 30, CAST(GETUTCDATE() AS DATE))
           AND b.status NOT IN ('cancelled', 'draft')
         ORDER BY b.event_date ASC, b.event_time_start ASC`,
        { companyId, branchId: branchId || null, limit }
    );
    return rows;
};

/** Per-hall occupancy for the period — see reportRepo.getOccupancyReport for the canonical query. */
const getHallOccupancy = async ({ companyId, branchId, period = 'month' }) => {
    const { fromDate, toDate } = periodToDateRange(period);
    return reportRepo.getOccupancyReport({ companyId, branchId, fromDate, toDate });
};

const getRecentActivity = async ({ companyId, limit = 15 }) => {
    const rows = await executeQuery(
        `SELECT TOP (@limit)
            al.log_id, al.action, al.entity_type, al.entity_id,
            al.description, al.created_at,
            CASE WHEN al.user_id IS NULL THEN 'System' ELSE CONCAT(u.first_name, ' ', u.last_name) END AS user_name,
            b.booking_ref, b.event_name,
            CASE WHEN b.customer_id IS NOT NULL THEN CONCAT(c.first_name, ' ', c.last_name) ELSE NULL END AS customer_name,
            h.hall_name
         FROM AuditLogs al
         LEFT JOIN Users u ON u.user_id = al.user_id
         LEFT JOIN Bookings b  ON al.entity_type = 'booking' AND b.booking_id = TRY_CAST(al.entity_id AS INT)
         LEFT JOIN Customers c ON c.customer_id = b.customer_id
         LEFT JOIN Halls h     ON h.hall_id = b.hall_id
         WHERE al.company_id = @companyId
         ORDER BY al.created_at DESC`,
        { companyId, limit }
    );
    return rows;
};

const getBookingsByDate = async ({ companyId, branchId, date }) => {
    const rows = await executeQuery(
        `SELECT
            b.booking_id, b.booking_ref, b.event_date, b.event_time_start, b.event_time_end,
            b.event_name, b.status, b.total_amount, b.amount_paid, b.guest_count, b.is_priority,
            h.hall_name,
            CONCAT(c.first_name, ' ', c.last_name) AS customer_name
         FROM Bookings b
         JOIN Halls     h ON h.hall_id     = b.hall_id
         JOIN Customers c ON c.customer_id = b.customer_id
         WHERE b.company_id = @companyId
           AND (@branchId IS NULL OR b.branch_id = @branchId)
           AND CAST(b.event_date AS DATE) = @date
           AND b.status NOT IN ('draft')
         ORDER BY b.event_time_start`,
        { companyId, branchId: branchId || null, date: new Date(date) }
    );
    return rows;
};

module.exports = {
    getKpiStats,
    getNewCustomers,
    getRevenueSeries,
    getStatusDistribution,
    getUpcomingBookings,
    getHallOccupancy,
    getRecentActivity,
    getBookingsByDate,
};
