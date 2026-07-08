/**
 * Reviews Routes — /api/v1/reviews
 */
'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/review.controller');
const v = require('../validators/review.validator');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../../../constants');

const router = Router();

router.get('/banquet/:banquetId', requirePermission(PERMISSIONS.BANQUETS_READ),   ctrl.getForBanquet);
router.post('/',                  requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateCreate, ctrl.create);

module.exports = router;
