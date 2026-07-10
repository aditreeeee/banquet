/**
 * Platform Repository — the one place cross-tenant SQL is allowed to live.
 * Every query here deliberately has NO `WHERE company_id = @companyId` filter
 * (or explicitly GROUPs BY company_id for per-tenant breakdowns) — only
 * platform.routes.js (Super Admin only) may call this. Column/naming
 * conventions mirror dashboard.repository.js / report.repository.js so the
 * platform dashboard and a tenant's own dashboard read consistently.
 */
'use strict';

const { executeQuery } = require('../config/database');

const getTenantCounts = async () => {
    const rows = await executeQuery(
        `SELECT
            COUNT(*) AS total_tenants,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_tenants,
            SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_tenants
         FROM Companies WHERE deleted_at IS NULL`
    );
    return rows[0];
};

const getPlatformTotals = async () => {
    const rows = await executeQuery(
        `SELECT
            (SELECT COUNT(*) FROM Banquets WHERE deleted_at IS NULL) AS total_banquets,
            (SELECT COUNT(*) FROM Halls WHERE deleted_at IS NULL) AS total_halls,
            (SELECT COUNT(*) FROM Bookings WHERE status NOT IN ('draft')) AS total_bookings,
            (SELECT COUNT(*) FROM Customers) AS total_customers,
            (SELECT COUNT(*) FROM Users WHERE deleted_at IS NULL) AS total_staff,
            (SELECT ISNULL(SUM(total_amount), 0) FROM Bookings WHERE status NOT IN ('draft','cancelled')) AS platform_revenue,
            (SELECT ISNULL(SUM(amount_paid), 0) FROM Bookings WHERE status NOT IN ('draft','cancelled')) AS platform_collected,
            (SELECT ISNULL(SUM(total_amount - ISNULL(amount_paid,0)), 0) FROM Bookings WHERE status NOT IN ('draft','cancelled')) AS platform_pending`
    );
    return rows[0];
};

// bookings_count includes cancelled bookings (excludes only draft) and
// revenue/collected exclude cancelled via CASE WHEN — same convention as
// report.repository.js's getSummaryStats (the per-tenant dashboard), so a
// tenant's own KPI cards and this platform-wide breakdown agree on what
// "N bookings" means. Filtering cancelled out of the JOIN entirely (the
// previous version) zeroed the count AND the revenue together for any
// tenant/banquet/hall whose only non-draft activity was a cancellation,
// which also made this table's totals silently disagree with
// getPlatformTotals() above it on the same page.
const getRevenueByTenant = async ({ fromDate, toDate }) => {
    return executeQuery(
        `SELECT c.company_id, c.company_name, c.is_active,
                COUNT(b.booking_id) AS bookings_count,
                ISNULL(SUM(CASE WHEN b.status <> 'cancelled' THEN b.total_amount ELSE 0 END), 0) AS revenue,
                ISNULL(SUM(CASE WHEN b.status <> 'cancelled' THEN b.amount_paid ELSE 0 END), 0) AS collected
         FROM Companies c
         LEFT JOIN Bookings b ON b.company_id = c.company_id
             AND b.status NOT IN ('draft')
             AND (@fromDate IS NULL OR b.event_date BETWEEN @fromDate AND @toDate)
         WHERE c.deleted_at IS NULL
         GROUP BY c.company_id, c.company_name, c.is_active
         ORDER BY revenue DESC`,
        { fromDate: fromDate ? new Date(fromDate) : null, toDate: toDate ? new Date(toDate) : null }
    );
};

const getRevenueByBanquet = async ({ fromDate, toDate, limit = 20 }) => {
    return executeQuery(
        `SELECT TOP (@limit) bq.banquet_id, bq.banquet_name, c.company_id, c.company_name,
                COUNT(b.booking_id) AS bookings_count,
                ISNULL(SUM(CASE WHEN b.status <> 'cancelled' THEN b.total_amount ELSE 0 END), 0) AS revenue
         FROM Banquets bq
         JOIN Companies c ON c.company_id = bq.company_id
         LEFT JOIN Halls h ON h.banquet_id = bq.banquet_id
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.status NOT IN ('draft')
             AND (@fromDate IS NULL OR b.event_date BETWEEN @fromDate AND @toDate)
         WHERE bq.deleted_at IS NULL
         GROUP BY bq.banquet_id, bq.banquet_name, c.company_id, c.company_name
         ORDER BY revenue DESC`,
        { limit, fromDate: fromDate ? new Date(fromDate) : null, toDate: toDate ? new Date(toDate) : null }
    );
};

const getRevenueByHall = async ({ fromDate, toDate, limit = 20 }) => {
    return executeQuery(
        `SELECT TOP (@limit) h.hall_id, h.hall_name, c.company_id, c.company_name,
                COUNT(b.booking_id) AS bookings_count,
                ISNULL(SUM(CASE WHEN b.status <> 'cancelled' THEN b.total_amount ELSE 0 END), 0) AS revenue
         FROM Halls h
         JOIN Companies c ON c.company_id = h.company_id
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.status NOT IN ('draft')
             AND (@fromDate IS NULL OR b.event_date BETWEEN @fromDate AND @toDate)
         WHERE h.deleted_at IS NULL
         GROUP BY h.hall_id, h.hall_name, c.company_id, c.company_name
         ORDER BY revenue DESC`,
        { limit, fromDate: fromDate ? new Date(fromDate) : null, toDate: toDate ? new Date(toDate) : null }
    );
};

/** Cross-tenant occupancy — booked hall-days vs. available hall-days per hall, aggregated to a platform average. */
const getPlatformOccupancy = async ({ fromDate, toDate }) => {
    const rows = await executeQuery(
        `SELECT h.hall_id,
                COUNT(DISTINCT b.event_date) AS booked_days
         FROM Halls h
         LEFT JOIN Bookings b ON b.hall_id = h.hall_id
             AND b.status NOT IN ('draft','cancelled')
             AND b.event_date BETWEEN @fromDate AND @toDate
         WHERE h.deleted_at IS NULL AND h.is_active = 1
         GROUP BY h.hall_id`,
        { fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
    const totalDays = Math.max(1, Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1);
    const avgOccupancyPct = rows.length
        ? Math.round(rows.reduce((s, r) => s + (r.booked_days / totalDays) * 100, 0) / rows.length)
        : 0;
    return { avgOccupancyPct, hallCount: rows.length, totalDays };
};

const getBookingTrends = async ({ fromDate, toDate, groupBy = 'month' }) => {
    // Week grouping uses YEAR/DATEPART(iso_week,...) directly rather than
    // FORMAT()'s .NET picture-format strings, which have no week-number token.
    const periodExpr = groupBy === 'day'
        ? `FORMAT(event_date, 'yyyy-MM-dd')`
        : groupBy === 'week'
            ? `CONCAT(DATEPART(iso_week, event_date), '-', DATEPART(year, event_date))`
            : `FORMAT(event_date, 'yyyy-MM')`;
    return executeQuery(
        `SELECT ${periodExpr} AS period_label,
                MIN(event_date) AS period_start,
                COUNT(*) AS bookings_count,
                ISNULL(SUM(total_amount), 0) AS revenue
         FROM Bookings
         WHERE status NOT IN ('draft')
           AND event_date BETWEEN @fromDate AND @toDate
         GROUP BY ${periodExpr}
         ORDER BY MIN(event_date)`,
        { fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
};

const getCustomerGrowth = async ({ fromDate, toDate }) => {
    return executeQuery(
        `SELECT FORMAT(created_at, 'yyyy-MM') AS period_label, COUNT(*) AS new_customers
         FROM Customers
         WHERE created_at BETWEEN @fromDate AND @toDate
         GROUP BY FORMAT(created_at, 'yyyy-MM')
         ORDER BY period_label`,
        { fromDate: new Date(fromDate), toDate: new Date(toDate) }
    );
};

const getPaymentStatusBreakdown = async () => {
    return executeQuery(
        `SELECT status, COUNT(*) AS count, ISNULL(SUM(total_amount), 0) AS total_value
         FROM Bookings
         WHERE status NOT IN ('draft')
         GROUP BY status`
    );
};

/**
 * Every user on the platform with their tenant (company) attached — the
 * Super Admin equivalent of user.repository.js's findAll, which is always
 * scoped to one company_id. Lets Super Admin see/search which company_id
 * each user belongs to without impersonating tenants one at a time.
 */
const getAllUsers = async ({ search, companyId, roleSlug, offset = 0, limit = 50 }) => {
    const where = [
        'u.deleted_at IS NULL',
        '(@companyId IS NULL OR u.company_id = @companyId)',
        '(@roleSlug IS NULL OR r.role_slug = @roleSlug)',
        `(@search IS NULL OR u.email LIKE CONCAT('%', @search, '%')
            OR CONCAT(u.first_name, ' ', u.last_name) LIKE CONCAT('%', @search, '%')
            OR c.company_name LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');
    const params = { search: search || null, companyId: companyId || null, roleSlug: roleSlug || null };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
                    u.company_id, c.company_name, c.is_active AS company_is_active,
                    r.role_slug, r.role_name, u.is_active, u.created_at
             FROM Users u
             JOIN Roles r ON r.role_id = u.role_id
             LEFT JOIN Companies c ON c.company_id = u.company_id
             WHERE ${where}
             ORDER BY c.company_name, u.first_name
             OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, offset, limit }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total
             FROM Users u
             JOIN Roles r ON r.role_id = u.role_id
             LEFT JOIN Companies c ON c.company_id = u.company_id
             WHERE ${where}`,
            params
        ),
    ]);
    return { rows, total: countRows[0].total };
};

module.exports = {
    getTenantCounts, getPlatformTotals, getRevenueByTenant, getRevenueByBanquet, getRevenueByHall,
    getPlatformOccupancy, getBookingTrends, getCustomerGrowth, getPaymentStatusBreakdown, getAllUsers,
};
