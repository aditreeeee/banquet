/**
 * Report Controller
 */
'use strict';

const svc      = require('../../../services/report.service');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id });

const getRevenue   = async (req, res) => response.success(res, await svc.getRevenueReport(req.query,   actor(req)));
const getBookings  = async (req, res) => { const { rows, meta } = await svc.getBookingReport(req.query,  actor(req)); return response.paginated(res, rows, meta); };
const getOccupancy = async (req, res) => response.success(res, await svc.getOccupancyReport(req.query, actor(req)));
const getPayments  = async (req, res) => response.success(res, await svc.getPaymentReport(req.query,   actor(req)));

module.exports = { getRevenue, getBookings, getOccupancy, getPayments };
