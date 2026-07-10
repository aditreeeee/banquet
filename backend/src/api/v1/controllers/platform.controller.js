/**
 * Platform Controller — Super Admin cross-tenant views.
 */
'use strict';

const svc = require('../../../services/platform.service');
const response = require('../../../utils/response');
const settingsService = require('../../../services/settings.service');

const getOverview = async (req, res) => response.success(res, await svc.getOverview(req.query));
const getRevenueBreakdown = async (req, res) => response.success(res, await svc.getRevenueBreakdown(req.query));
const getTrends = async (req, res) => response.success(res, await svc.getTrends(req.query));
const getTenantDashboard = async (req, res) => response.success(res, await svc.getTenantDashboard(parseInt(req.params.companyId, 10), req.query));
const getTenantReports = async (req, res) => response.success(res, await svc.getTenantReports(parseInt(req.params.companyId, 10), req.query));
const getAllUsers = async (req, res) => { const { rows, meta } = await svc.getAllUsers(req.query); return response.success(res, { users: rows, meta }); };

// Platform-wide session/token policy — deliberately not part of the regular
// per-tenant /settings endpoint (that always writes to whichever company
// the caller happens to be scoped/impersonating as). This always reads and
// writes the one global value every tenant's logins share.
const getSessionTimeout = async (req, res) => response.success(res, await settingsService.getSessionPolicy());
const updateSessionTimeout = async (req, res) => {
    const minutes = parseInt(req.body.accessTokenMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
        return res.status(422).json({ success: false, message: 'accessTokenMinutes must be between 1 and 1440' });
    }
    await settingsService.updateSessionPolicy(minutes, { userId: req.user.user_id });
    return response.success(res, await settingsService.getSessionPolicy(), 'Session timeout updated');
};

module.exports = {
    getOverview, getRevenueBreakdown, getTrends, getTenantDashboard, getTenantReports, getAllUsers,
    getSessionTimeout, updateSessionTimeout,
};
