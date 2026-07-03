/**
 * Hall Routes — /api/v1/halls
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/hall.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/',                      requirePermission(PERMISSIONS.HALLS_READ),         ctrl.getAll);
router.post('/',                     requirePermission(PERMISSIONS.HALLS_CREATE),       ctrl.create);
router.get('/:id',                   requirePermission(PERMISSIONS.HALLS_READ),         ctrl.getById);
router.patch('/:id',                 requirePermission(PERMISSIONS.HALLS_UPDATE),       ctrl.update);
router.put('/:id',                   requirePermission(PERMISSIONS.HALLS_UPDATE),       ctrl.update);
router.patch('/:id/activate',        requirePermission(PERMISSIONS.HALLS_UPDATE),       ctrl.activate);
router.patch('/:id/deactivate',      requirePermission(PERMISSIONS.HALLS_UPDATE),       ctrl.deactivate);
router.get('/:id/availability',      requirePermission(PERMISSIONS.AVAILABILITY_READ),  ctrl.getAvailability);
router.post('/:id/block',            requirePermission(PERMISSIONS.AVAILABILITY_MANAGE),ctrl.block);
router.delete('/:id/block/:blockId', requirePermission(PERMISSIONS.AVAILABILITY_MANAGE),ctrl.unblock);

module.exports = router;
