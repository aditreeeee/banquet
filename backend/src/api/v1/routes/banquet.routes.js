/**
 * Banquet Routes — /api/v1/banquets
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/banquet.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/',                  requirePermission(PERMISSIONS.BANQUETS_READ),   ctrl.getAll);
router.post('/',                 requirePermission(PERMISSIONS.BANQUETS_CREATE), ctrl.create);
router.get('/:id',               requirePermission(PERMISSIONS.BANQUETS_READ),   ctrl.getById);
router.patch('/:id',             requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.update);
router.put('/:id',               requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.update);
router.patch('/:id/activate',    requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.activate);
router.patch('/:id/deactivate',  requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.deactivate);

module.exports = router;
