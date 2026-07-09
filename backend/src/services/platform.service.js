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

const getOverview = async (query) => {
    const { fromDate, toDate } = defaultRange(query);

    const [tenantCounts, totals, revenueByTenant, occupancy, paymentStatus] = await Promise.all([
        platformRepo.getTenantCounts(),
        platformRepo.getPlatformTotals(),
        platformRepo.getRevenueByTenant({ fromDate, toDate }),
        platformRepo.getPlatformOccupancy({ fromDate, toDate }),
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
    const { fromDate, toDate } = defaultRange(query);
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
