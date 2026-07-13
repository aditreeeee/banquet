/**
 * Coupon Routes — /api/v1/coupons
 */
'use strict';

const { Router }             = require('express');
const ctrl                   = require('../controllers/coupon.controller');
const v                      = require('../validators/coupon.validator');
const { requirePermission }  = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.post('/validate',   requirePermission(PERMISSIONS.BOOKINGS_READ),     v.validateValidateReq, ctrl.validate);

router.get('/',            requirePermission(PERMISSIONS.COUPONS_READ),      ctrl.list);
router.post('/',           requirePermission(PERMISSIONS.COUPONS_CREATE),    v.validateCreate, ctrl.create);
router.get('/:id',         requirePermission(PERMISSIONS.COUPONS_READ),      ctrl.getById);
router.put('/:id',         requirePermission(PERMISSIONS.COUPONS_UPDATE),    v.validateUpdate, ctrl.update);

module.exports = router;
