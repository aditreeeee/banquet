/**
 * Dashboard Repository — Aggregated stats queries
 */

'use strict';

const { executeQuery } = require('../config/database');

/**
 * Build a WHERE fragment for the event_date column based on period.
 * Returns pure SQL — no bound params (all values are MSSQL date functions).
 */
const buildDateRange = (period) => {
    switch (period) {
        case 'week':
            return `event_date BETWEEN DATEADD(DAY, -6, CAST(GETUTCDATE() AS DATE)) AND CAST(GETUTCDATE() AS DATE)`;
        case 'month':
            return `event_date BETWEEN DATEFROMPARTS(YEAR(GETUTCDATE()), MONTH(GETUTCDATE()), 1)
                                   AND EOMONTH(GETUTCDATE())`;
        case 'quarter':
            return `event_date BETWEEN DATEFROMPARTS(YEAR(GETUTCDATE()), ((DATEPART(QUARTER, GETUTCDATE()) - 1) * 3) + 1, 1)
                                   AND EOMONTH(DATEFROMPARTS(YEAR(GETUTCDATE()), DATEPART(QUARTER, GETUTCDATE()) * 3, 1))`;
        case 'year':
        default:
            return `YEAR(event_date) = YEAR(GETUTCDATE())`;
    }
};

/**
 * SQL expression for the start-of-period date, used by occupancy % calculations.
 */
const buildPeriodStartExpr = (period) => {
    switch (period) {
        case 'week':
            return `DATEADD(DAY, -6, CAST(GETUTCDATE() AS DATE))`;
        case 'month':
            return `DATEFROMPARTS(YEAR(GETUTCDATE()), MONTH(GETUTCDATE()), 1)`;
        case 'quarter':
            return `DATEFROMPARTS(YEAR(GETUTCDATE()), ((DATEPART(QUARTER, GETUTCDATE()) - 1) * 3) + 1, 1)`;
        case 'year':
        default:
            return `DATEFROMPARTS(YEAR(GETUTCDATE()), 1, 1)`;
    }
};

const getKpiStats = async ({ companyId, branchId, period = 'month' }) => {
    const dateFilter = buildDateRange(period);

    const rows = await executeQuery(
        `SELECT
            COUNT(*)                                            AS total_bookings,
            COUNT(CASE WHEN status = 'confirmed'  THEN 1 END)  AS confirmed_bookings,
            COUNT(CASE WHEN status = 'cancelled'  THEN 1 END)  AS cancelled_bookings,
            COUNT(CASE WHEN status = 'completed'  THEN 1 END)  AS completed_bookings,
            ISNULL(SUM(total_amount), 0)                       AS total_revenue,
            ISNULL(SUM(advance_paid), 0)                       AS advance_collected,
            ISNULL(SUM(total_amount) - SUM(ISNULL(amount_paid, 0)), 0) AS pending_amount
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND ${dateFilter}
           AND status NOT IN ('draft')`,
        { companyId, branchId: branchId || null }
    );
    return rows[0];
};

const getNewCustomers = async ({ companyId, branchId, period = 'month' }) => {
    const dateFilter = buildDateRange(period).replace(/event_date/g, 'created_at');

    const rows = await executeQuery(
        `SELECT COUNT(*) AS new_customers
         FROM Customers
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND ${dateFilter}`,
        { companyId, branchId: branchId || null }
    );
    return rows[0]?.new_customers || 0;
};

const getRevenueSeries = async ({ companyId, branchId, period = 'month' }) => {
    let groupBy, labelExpr;
    switch (period) {
        case 'week':
            groupBy   = `CAST(event_date AS DATE)`;
            labelExpr = `FORMAT(event_date, 'ddd d')`;
            break;
        case 'month':
            groupBy   = `DATEPART(ISO_WEEK, event_date)`;
            labelExpr = `CONCAT('Wk ', DATEPART(ISO_WEEK, event_date))`;
            break;
        case 'quarter':
        case 'year':
        default:
            groupBy   = `MONTH(event_date)`;
            labelExpr = `FORMAT(event_date, 'MMM')`;
    }

    const dateFilter = buildDateRange(period);

    const rows = await executeQuery(
        `SELECT
            MAX(${labelExpr})              AS label,
            ISNULL(SUM(total_amount), 0)  AS revenue,
            0                             AS target
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND ${dateFilter}
           AND status NOT IN ('draft', 'cancelled')
         GROUP BY ${groupBy}
         ORDER BY ${groupBy}`,
        { companyId, branchId: branchId || null }
    );
    return rows;
};

const getStatusDistribution = async ({ companyId, branchId, period = 'month' }) => {
    const dateFilter = buildDateRange(period);

    const rows = await executeQuery(
        `SELECT status, COUNT(*) AS count
         FROM Bookings
         WHERE company_id = @companyId
           AND (@branchId IS NULL OR branch_id = @branchId)
           AND ${dateFilter}
         GROUP BY status`,
        { companyId, branchId: branchId || null }
    );
    return rows;
};

const getUpcomingBookings = async ({ companyId, branchId, limit = 10 }) => {
    const rows = await executeQuery(
        `SELECT TOP (@limit)
            b.booking_id, b.booking_ref, b.event_date, b.event_time_start,
            b.status, b.total_amount,
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

const getHallOccupancy = async ({ companyId, branchId, period = 'month' }) => {
    const dateFilter = buildDateRange(period);
    const periodStartExpr = buildPeriodStartExpr(period);

    const rows = await executeQuery(
        `SELECT
            h.hall_id, h.hall_name,
            h.capacity,
            COUNT(b.booking_id)  AS bookings_count,
            CAST(
                COUNT(b.booking_id) * 100.0 /
                NULLIF(DATEDIFF(DAY, ${periodStartExpr}, CAST(GETUTCDATE() AS DATE)), 0)
            AS DECIMAL(5,1))  AS occupancy_pct
         FROM Halls h
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.company_id = @companyId
             AND ${dateFilter.replace(/event_date/g, 'b.event_date')}
             AND b.status NOT IN ('draft', 'cancelled')
         WHERE h.company_id = @companyId
           AND (@branchId IS NULL OR h.branch_id = @branchId)
           AND h.is_active = 1
         GROUP BY h.hall_id, h.hall_name, h.capacity
         ORDER BY occupancy_pct DESC`,
        { companyId, branchId: branchId || null }
    );
    return rows;
};

const getRecentActivity = async ({ companyId, limit = 15 }) => {
    const rows = await executeQuery(
        `SELECT TOP (@limit)
            al.log_id, al.action, al.entity_type, al.entity_id,
            al.description, al.created_at,
            CASE WHEN al.user_id IS NULL THEN 'System' ELSE CONCAT(u.first_name, ' ', u.last_name) END AS user_name
         FROM AuditLogs al
         LEFT JOIN Users u ON u.user_id = al.user_id
         WHERE al.company_id = @companyId
         ORDER BY al.created_at DESC`,
        { companyId, limit }
    );
    return rows;
};

const getBookingsByDate = async ({ companyId, branchId, date }) => {
    const rows = await executeQuery(
        `SELECT
            b.booking_id, b.booking_ref, b.event_date, b.event_time_start,
            b.status, b.total_amount,
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
