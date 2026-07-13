/**
 * Coupon Routes — /api/v1/coupons
 */
'use strict';

const { Router }             = require('express');
const ctrl                   = require('../controllers/coupon.controller');
const { requirePermission }  = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.post('/validate',   requirePermission(PERMISSIONS.BOOKINGS_READ),     ctrl.validate);

router.get('/',            requirePermission(PERMISSIONS.COUPONS_READ),      ctrl.list);
router.post('/',           requirePermission(PERMISSIONS.COUPONS_CREATE),    ctrl.create);
router.get('/:id',         requirePermission(PERMISSIONS.COUPONS_READ),      ctrl.getById);
router.put('/:id',         requirePermission(PERMISSIONS.COUPONS_UPDATE),    ctrl.update);

module.exports = router;
