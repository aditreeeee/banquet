/**
 * Platform Service — Super Admin cross-tenant aggregation. Tenant-specific
 * drill-down deliberately reuses the EXISTING dashboard.service.js/
 * report.service.js (just called with a specific companyId) rather than
 * duplicating their logic — only genuinely cross-tenant math lives here.
 */
'use strict';

const platformRepo = require('../repositories/platform.repository');
const dashboardService = require('./dashboard.service');
const reportService = require('./report.service');
const companyService = require('./company.service');
const { NotFoundError } = require('../api/v1/middleware/errorHandler');

const defaultRange = (query) => ({
    fromDate: query.from_date || new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1).toISOString().slice(0, 10),
    toDate: query.to_date || new Date().toISOString().slice(0, 10),
});

// getPlatformTotals() (the headline KPI cards) is deliberately always
// all-time with no date filter — so the breakdown tables it's shown
// alongside (revenueByTenant/byBanquet/byHall, occupancy) must default to
// all-time too, or the totals at the top of the page silently disagree with
// the tables below them (e.g. "Platform Bookings: 60" above a "Revenue by
// Tenant" table that only sums to 18, because that table was quietly scoped
// to the trailing 6 months while the KPI card summed everything). Only
// apply a range when the caller explicitly asks for one via from_date/
// to_date — unlike defaultRange() below, this never fabricates a default
// window. getTrends() is a genuine month-over-month trend chart and keeps
// defaultRange()'s bounded default; only the overview/revenue-breakdown
// totals needed to change.
const explicitRangeOnly = (query) => ({
    fromDate: query.from_date || null,
    toDate:   query.to_date   || null,
});

const getOverview = async (query) => {
    // revenueByTenant must line up with getPlatformTotals() (always
    // all-time) — occupancy is a genuinely period-based rate (booked-days /
    // available-days over a window) and stays on the bounded default,
    // there's no "all-time occupancy %" to reconcile it against.
    const { fromDate, toDate } = explicitRangeOnly(query);
    const { fromDate: occFromDate, toDate: occToDate } = defaultRange(query);

    const [tenantCounts, totals, revenueByTenant, occupancy, paymentStatus] = await Promise.all([
        platformRepo.getTenantCounts(),
        platformRepo.getPlatformTotals(),
        platformRepo.getRevenueByTenant({ fromDate, toDate }),
        platformRepo.getPlatformOccupancy({ fromDate: occFromDate, toDate: occToDate }),
        platformRepo.getPaymentStatusBreakdown(),
    ]);

    return {
        tenants: tenantCounts,
        totals,
        occupancy,
        paymentStatus,
        revenueByTenant,
        period: { fromDate, toDate },
    };
};

const getRevenueBreakdown = async (query) => {
    // Same reasoning as getOverview — byTenant/byBanquet/byHall are shown
    // right next to (or on the same page as) the all-time platform totals,
    // so they default to all-time too unless a range is explicitly requested.
    const { fromDate, toDate } = explicitRangeOnly(query);
    const [byTenant, byBanquet, byHall] = await Promise.all([
        platformRepo.getRevenueByTenant({ fromDate, toDate }),
        platformRepo.getRevenueByBanquet({ fromDate, toDate }),
        platformRepo.getRevenueByHall({ fromDate, toDate }),
    ]);
    return { byTenant, byBanquet, byHall, period: { fromDate, toDate } };
};

const getTrends = async (query) => {
    const { fromDate, toDate } = defaultRange(query);
    const [bookingTrends, customerGrowth] = await Promise.all([
        platformRepo.getBookingTrends({ fromDate, toDate, groupBy: query.group_by || 'month' }),
        platformRepo.getCustomerGrowth({ fromDate, toDate }),
    ]);
    return { bookingTrends, customerGrowth, period: { fromDate, toDate } };
};

/** Thin wrapper — reuses the tenant's own dashboard/report services unmodified. */
const getTenantDashboard = async (companyId, query) => {
    await companyService.getById(companyId); // 404s if the tenant doesn't exist
    return dashboardService.getDashboardData({ companyId, branchId: null }, query.period || 'month');
};

const getTenantReports = async (companyId, query) => {
    await companyService.getById(companyId);
    return reportService.getOwnerAnalytics(query, { companyId, branchId: null });
};

/** Every user on the platform with their tenant attached — see which company_id each user belongs to, across all tenants, without impersonating one at a time. */
const getAllUsers = async (query) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(parseInt(query.limit, 10) || 50, 200);
    const { rows, total } = await platformRepo.getAllUsers({
        search: query.search || null,
        companyId: query.company_id ? parseInt(query.company_id, 10) : null,
        roleSlug: query.role || null,
        offset: (page - 1) * limit,
        limit,
    });
    return { rows, meta: { page, limit, total } };
};

module.exports = { getOverview, getRevenueBreakdown, getTrends, getTenantDashboard, getTenantReports, getAllUsers };
