/**
 * Platform Routes — /api/v1/platform
 * Super Admin only, cross-tenant. Tenant drill-down endpoints reuse the
 * existing dashboard/report services unmodified (see platform.service.js).
 */
'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/platform.controller');
const { requireRole } = require('../middleware/auth');
const { USER_ROLES } = require('../../../constants');

const router = Router();

router.use(requireRole(USER_ROLES.SUPER_ADMIN));

router.get('/overview',                    ctrl.getOverview);
router.get('/revenue',                     ctrl.getRevenueBreakdown);
router.get('/trends',                      ctrl.getTrends);
router.get('/tenants/:companyId/dashboard', ctrl.getTenantDashboard);
router.get('/tenants/:companyId/reports',   ctrl.getTenantReports);
router.get('/users',                        ctrl.getAllUsers);

module.exports = router;
