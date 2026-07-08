/**
 * API Router — v1
 * All routes registered here with their middleware
 */
'use strict';

const router = require('express').Router();
const { authenticate, scopeToCompany } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');

// ─── Public Routes (no auth) ─────────────────────────────────────────────────
router.use('/auth',         rateLimiter.auth, require('./auth.routes'));
router.use('/public',                         require('./public.routes'));  // banquet search, availability

// ─── Protected Routes (auth required) ────────────────────────────────────────
router.use(authenticate, scopeToCompany);

router.use('/dashboard',    require('./dashboard.routes'));
router.use('/companies',    require('./company.routes'));
router.use('/branches',     require('./branch.routes'));
router.use('/banquets',     require('./banquet.routes'));
router.use('/halls',        require('./hall.routes'));
router.use('/bookings',     require('./booking.routes'));
router.use('/customers',    require('./customer.routes'));
router.use('/payments',     require('./payment.routes'));
router.use('/invoices',     require('./invoice.routes'));
router.use('/reports',      require('./report.routes'));
router.use('/resources',    require('./resource.routes'));
router.use('/catering',     require('./catering.routes'));
router.use('/menu-items',   require('./menuItem.routes'));
router.use('/leads',       require('./lead.routes'));
router.use('/marketing',   require('./marketing.routes'));
router.use('/reviews',     require('./review.routes'));
router.use('/users',        require('./user.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/settings',     require('./settings.routes'));
router.use('/operational-charges', require('./operationalCharge.routes'));
router.use('/audit-logs',   require('./auditLog.routes'));

module.exports = router;
