/**
 * Operational Charge Routes — /api/v1/operational-charges
 */
'use strict';

const { Router }             = require('express');
const ctrl                   = require('../controllers/operationalCharge.controller');
const { requirePermission }  = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/',                requirePermission(PERMISSIONS.SETTINGS_READ),   ctrl.list);
router.get('/calculate',       requirePermission(PERMISSIONS.SETTINGS_READ),   ctrl.calculate);
router.put('/:chargeType',     requirePermission(PERMISSIONS.SETTINGS_UPDATE), ctrl.upsert);

module.exports = router;
