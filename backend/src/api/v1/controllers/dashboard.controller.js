/**
 * Dashboard Controller
 */
'use strict';

const dashService = require('../../../services/dashboard.service');
const response    = require('../../../utils/response');

const getData = async (req, res) => {
    const { period = 'month' } = req.query;
    const scope = {
        companyId: req.companyId,
        branchId:  req.user.branch_id || null,
    };
    const data = await dashService.getDashboardData(scope, period);
    return response.success(res, data, 'Dashboard data retrieved');
};

const getBookingsByDate = async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'date query param required' });

    const scope = {
        companyId: req.companyId,
        branchId:  req.user.branch_id || null,
    };
    const bookings = await dashService.getBookingsByDate(scope, date);
    return response.success(res, bookings);
};

// Handles /dashboard/bookings — supports both ?date= (calendar) and ?period= (table)
const getBookings = async (req, res) => {
    const scope = {
        companyId: req.companyId,
        branchId:  req.user.branch_id || null,
    };

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
