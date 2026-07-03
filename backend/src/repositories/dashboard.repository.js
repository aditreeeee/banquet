/**
 * Dashboard Repository — Aggregated stats queries
 */

'use strict';

const { executeQuery } = require('../config/database');

/**
 * Build a WHERE fragment for the event_date column based on period.
 * Returns pure SQL — no bound params (all values are MySQL date functions).
 */
const buildDateRange = (period) => {
    switch (period) {
        case 'week':
            return `event_date BETWEEN DATE_SUB(UTC_DATE(), INTERVAL 6 DAY) AND UTC_DATE()`;
        case 'month':
            return `event_date BETWEEN DATE(CONCAT(YEAR(UTC_DATE()), '-', LPAD(MONTH(UTC_DATE()), 2, '0'), '-01'))
                                   AND LAST_DAY(UTC_DATE())`;
        case 'quarter':
            return `event_date BETWEEN DATE(CONCAT(YEAR(UTC_DATE()), '-', LPAD((QUARTER(UTC_DATE())-1)*3+1, 2, '0'), '-01'))
                                   AND LAST_DAY(DATE(CONCAT(YEAR(UTC_DATE()), '-', LPAD(QUARTER(UTC_DATE())*3, 2, '0'), '-01')))`;
        case 'year':
        default:
            return `YEAR(event_date) = YEAR(UTC_DATE())`;
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
            IFNULL(SUM(total_amount), 0)                       AS total_revenue,
            IFNULL(SUM(advance_paid), 0)                       AS advance_collected,
            IFNULL(SUM(total_amount) - SUM(IFNULL(amount_paid, 0)), 0) AS pending_amount
         FROM Bookings
         WHERE company_id = :companyId
           AND (:branchId IS NULL OR branch_id = :branchId)
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
         WHERE company_id = :companyId
           AND (:branchId IS NULL OR branch_id = :branchId)
           AND ${dateFilter}`,
        { companyId, branchId: branchId || null }
    );
    return rows[0]?.new_customers || 0;
};

const getRevenueSeries = async ({ companyId, branchId, period = 'month' }) => {
    let groupBy, labelExpr;
    switch (period) {
        case 'week':
            groupBy   = `DATE(event_date)`;
            labelExpr = `DATE_FORMAT(event_date, '%a %e')`;
            break;
        case 'month':
            groupBy   = `WEEK(event_date, 1)`;
            labelExpr = `CONCAT('Wk ', WEEK(event_date, 1))`;
            break;
        case 'quarter':
        case 'year':
        default:
            groupBy   = `MONTH(event_date)`;
            labelExpr = `DATE_FORMAT(event_date, '%b')`;
    }

    const dateFilter = buildDateRange(period);

    const rows = await executeQuery(
        `SELECT
            ANY_VALUE(${labelExpr})       AS label,
            IFNULL(SUM(total_amount), 0)  AS revenue,
            0                             AS target
         FROM Bookings
         WHERE company_id = :companyId
           AND (:branchId IS NULL OR branch_id = :branchId)
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
         WHERE company_id = :companyId
           AND (:branchId IS NULL OR branch_id = :branchId)
           AND ${dateFilter}
         GROUP BY status`,
        { companyId, branchId: branchId || null }
    );
    return rows;
};

const getUpcomingBookings = async ({ companyId, branchId, limit = 10 }) => {
    const rows = await executeQuery(
        `SELECT
            b.booking_id, b.booking_ref, b.event_date, b.event_time_start,
            b.status, b.total_amount,
            h.hall_name,
            CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
            c.phone AS customer_phone
         FROM Bookings b
         JOIN Halls     h ON h.hall_id     = b.hall_id
         JOIN Customers c ON c.customer_id = b.customer_id
         WHERE b.company_id = :companyId
           AND (:branchId IS NULL OR b.branch_id = :branchId)
           AND b.event_date BETWEEN UTC_DATE() AND DATE_ADD(UTC_DATE(), INTERVAL 30 DAY)
           AND b.status NOT IN ('cancelled', 'draft')
         ORDER BY b.event_date ASC, b.event_time_start ASC
         LIMIT :limit`,
        { companyId, branchId: branchId || null, limit }
    );
    return rows;
};

const getHallOccupancy = async ({ companyId, branchId, period = 'month' }) => {
    const dateFilter = buildDateRange(period);

    const rows = await executeQuery(
        `SELECT
            h.hall_id, h.hall_name,
            h.capacity,
            COUNT(b.booking_id)  AS bookings_count,
            CAST(
                COUNT(b.booking_id) * 100.0 /
                NULLIF(DATEDIFF(UTC_DATE(),
                    CASE '${period}'
                        WHEN 'week'    THEN DATE_SUB(UTC_DATE(), INTERVAL 6 DAY)
                        WHEN 'month'   THEN DATE(CONCAT(YEAR(UTC_DATE()), '-', LPAD(MONTH(UTC_DATE()), 2, '0'), '-01'))
                        WHEN 'quarter' THEN DATE(CONCAT(YEAR(UTC_DATE()), '-', LPAD((QUARTER(UTC_DATE())-1)*3+1, 2, '0'), '-01'))
                        ELSE DATE(CONCAT(YEAR(UTC_DATE()), '-01-01'))
                    END
                ), 0)
            AS DECIMAL(5,1))  AS occupancy_pct
         FROM Halls h
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.company_id = :companyId
             AND ${dateFilter.replace(/event_date/g, 'b.event_date')}
             AND b.status NOT IN ('draft', 'cancelled')
         WHERE h.company_id = :companyId
           AND (:branchId IS NULL OR h.branch_id = :branchId)
           AND h.is_active = 1
         GROUP BY h.hall_id, h.hall_name, h.capacity
         ORDER BY occupancy_pct DESC`,
        { companyId, branchId: branchId || null }
    );
    return rows;
};

const getRecentActivity = async ({ companyId, limit = 15 }) => {
    const rows = await executeQuery(
        `SELECT
            al.log_id, al.action, al.entity_type, al.entity_id,
            al.description, al.created_at,
            CONCAT(u.first_name, ' ', u.last_name) AS user_name
         FROM AuditLogs al
         JOIN Users u ON u.user_id = al.user_id
         WHERE al.company_id = :companyId
         ORDER BY al.created_at DESC
         LIMIT :limit`,
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
         WHERE b.company_id = :companyId
           AND (:branchId IS NULL OR b.branch_id = :branchId)
           AND DATE(b.event_date) = :date
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
