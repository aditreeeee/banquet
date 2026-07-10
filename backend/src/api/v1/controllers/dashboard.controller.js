/**
 * Dashboard Controller
 */
'use strict';

const dashService = require('../../../services/dashboard.service');
const response    = require('../../../utils/response');
const { resolveBranchScope, resolveCompanyScope } = require('../../../utils/branchScope');

// A Super Admin not currently impersonating a tenant sees every tenant's
// numbers here (same resolveCompanyScope used by halls/bookings/customers/
// payments) instead of scopeToCompany's write-safe company_id=1 fallback.
const buildScope = (req) => ({
    companyId: resolveCompanyScope({
        companyId: req.companyId,
        roleSlug: req.user.role_slug,
        isImpersonating: req.isImpersonating,
    }),
    branchId: resolveBranchScope({ branchId: req.user.branch_id, roleSlug: req.user.role_slug }, req.query),
});

const getData = async (req, res) => {
    const { period = 'month' } = req.query;
    const data = await dashService.getDashboardData(buildScope(req), period);
    return response.success(res, data, 'Dashboard data retrieved');
};

const getBookingsByDate = async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'date query param required' });

    const bookings = await dashService.getBookingsByDate(buildScope(req), date);
    return response.success(res, bookings);
};

// Handles /dashboard/bookings — supports both ?date= (calendar) and ?period= (table)
const getBookings = async (req, res) => {
    const scope = buildScope(req);

    if (req.query.date) {
        const bookings = await dashService.getBookingsByDate(scope, req.query.date);
        return response.success(res, bookings);
    }

    // period-based: return upcoming from full dashboard data
    const period = req.query.period || 'month';
    const data   = await dashService.getDashboardData(scope, period);
    return response.success(res, data.upcoming || []);
};

module.exports = { getData, getBookingsByDate, getBookings };
