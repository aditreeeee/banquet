/**
 * Platform Controller — Super Admin cross-tenant views.
 */
'use strict';

const svc = require('../../../services/platform.service');
const response = require('../../../utils/response');

const getOverview = async (req, res) => response.success(res, await svc.getOverview(req.query));
const getRevenueBreakdown = async (req, res) => response.success(res, await svc.getRevenueBreakdown(req.query));
const getTrends = async (req, res) => response.success(res, await svc.getTrends(req.query));
const getTenantDashboard = async (req, res) => response.success(res, await svc.getTenantDashboard(parseInt(req.params.companyId, 10), req.query));
const getTenantReports = async (req, res) => response.success(res, await svc.getTenantReports(parseInt(req.params.companyId, 10), req.query));
const getAllUsers = async (req, res) => { const { rows, meta } = await svc.getAllUsers(req.query); return response.success(res, { users: rows, meta }); };

module.exports = { getOverview, getRevenueBreakdown, getTrends, getTenantDashboard, getTenantReports, getAllUsers };
