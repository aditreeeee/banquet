/**
 * Report Routes — /api/v1/reports
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/report.controller');
const { requirePermission } = require('../middleware/auth');
const { reportExport: exportLimiter } = require('../middleware/rateLimiter');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/revenue',   requirePermission(PERMISSIONS.REPORTS_READ), ctrl.getRevenue);
router.get('/bookings',  requirePermission(PERMISSIONS.REPORTS_READ), ctrl.getBookings);
router.get('/occupancy', requirePermission(PERMISSIONS.REPORTS_READ), ctrl.getOccupancy);
router.get('/payments',  requirePermission(PERMISSIONS.REPORTS_READ), ctrl.getPayments);
router.get('/owner-analytics', requirePermission(PERMISSIONS.REPORTS_READ), ctrl.getOwnerAnalytics);

module.exports = router;
