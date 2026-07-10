/**
 * Payment Routes — /api/v1/payments
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/payment.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');
const { validateCreate, validateRefund } = require('../validators/payment.validator');

const router = Router();

router.get('/',                           requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getAll);
router.get('/pending',                    requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getPending);
router.get('/refunds',                    requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getAllRefunds);
router.get('/booking/:bookingId',         requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getByBooking);
router.post('/',                          requirePermission(PERMISSIONS.PAYMENTS_CREATE), validateCreate, ctrl.create);
router.get('/:id',                        requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getById);
router.post('/:id/refund',               requirePermission(PERMISSIONS.PAYMENTS_REFUND), validateRefund, ctrl.refund);
router.get('/:id/refunds',               requirePermission(PERMISSIONS.PAYMENTS_READ),   ctrl.getRefunds);

module.exports = router;
