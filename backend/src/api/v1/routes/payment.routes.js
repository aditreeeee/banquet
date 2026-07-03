/**
 * Payment Routes — /api/v1/payments
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/payment.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/',                           requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getAll);
router.get('/pending',                    requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getPending);
router.get('/booking/:bookingId',         requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getByBooking);
router.post('/',                          requirePermission(PERMISSIONS.PAYMENTS_CREATE), ctrl.create);
router.get('/:id',                        requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getById);
router.post('/:id/refund',               requirePermission(PERMISSIONS.PAYMENTS_REFUND), ctrl.refund);

module.exports = router;
