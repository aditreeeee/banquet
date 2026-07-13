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

// Field -> [min, max] validation range, mirroring settings.service.js's own
// clampedInt bounds so a bad value 422s here instead of silently clamping.
const POLICY_FIELD_RANGES = {
    accessTokenMinutes:         [1, 1440],
    idleTimeoutMinutes:         [1, 1440],
    absoluteSessionHours:       [1, 168],
    warningBeforeLogoutMinutes: [1, 60],
    keepSignedInDays:           [1, 365],
    maxConcurrentSessions:      [0, 100],
};

const updateSessionTimeout = async (req, res) => {
    const policy = {};
    for (const [field, [min, max]] of Object.entries(POLICY_FIELD_RANGES)) {
        if (req.body[field] === undefined) continue;
        const n = parseInt(req.body[field], 10);
        if (!Number.isFinite(n) || n < min || n > max) {
            return res.status(422).json({ success: false, message: `${field} must be between ${min} and ${max}` });
        }
        policy[field] = n;
    }
    if (!Object.keys(policy).length) {
        return res.status(422).json({ success: false, message: 'No valid session policy fields provided' });
    }
    const updated = await settingsService.updateSessionPolicy(policy, { userId: req.user.user_id });
    return response.success(res, updated, 'Session policy updated');
};

module.exports = {
    getOverview, getRevenueBreakdown, getTrends, getTenantDashboard, getTenantReports, getAllUsers,
    getSessionTimeout, updateSessionTimeout,
};
