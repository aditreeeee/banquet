/**
 * Dashboard Routes — /api/v1/dashboard
 * All routes require authentication (applied in routes/index.js)
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/dashboard.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/',         requirePermission(PERMISSIONS.DASHBOARD_READ), ctrl.getData);
router.get('/kpis',     requirePermission(PERMISSIONS.DASHBOARD_READ), ctrl.getData);
router.get('/bookings', requirePermission(PERMISSIONS.DASHBOARD_READ), ctrl.getBookings);
router.get('/calendar', requirePermission(PERMISSIONS.DASHBOARD_READ), ctrl.getBookingsByDate);
router.get('/activity', requirePermission(PERMISSIONS.DASHBOARD_READ), ctrl.getData);

module.exports = router;
