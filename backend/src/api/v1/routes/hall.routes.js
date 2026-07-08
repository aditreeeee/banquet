/**
 * Hall Routes — /api/v1/halls
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/hall.controller');
const hallRepo             = require('../../../repositories/hall.repository');
const { requirePermission, requireScope } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

// Resolves the branch/hall a :id route param refers to, for RolePermissionScopes
// checks. Only meaningful once a role is given branch/hall-scoped grants — see
// requireScope in middleware/auth.js.
const resolveHallScope = async (req) => {
    const hall = await hallRepo.findById(parseInt(req.params.id, 10));
    return { branchId: hall?.branch_id ?? null, hallId: hall?.hall_id ?? null };
};

router.get('/',                      requirePermission(PERMISSIONS.HALLS_READ),         ctrl.getAll);
router.post('/',                     requirePermission(PERMISSIONS.HALLS_CREATE),       ctrl.create);
router.get('/:id',                   requirePermission(PERMISSIONS.HALLS_READ),         ctrl.getById);
router.patch('/:id',                 requirePermission(PERMISSIONS.HALLS_UPDATE), requireScope(PERMISSIONS.HALLS_UPDATE, resolveHallScope), ctrl.update);
router.put('/:id',                   requirePermission(PERMISSIONS.HALLS_UPDATE), requireScope(PERMISSIONS.HALLS_UPDATE, resolveHallScope), ctrl.update);
router.patch('/:id/activate',        requirePermission(PERMISSIONS.HALLS_UPDATE), requireScope(PERMISSIONS.HALLS_UPDATE, resolveHallScope), ctrl.activate);
router.patch('/:id/deactivate',      requirePermission(PERMISSIONS.HALLS_UPDATE), requireScope(PERMISSIONS.HALLS_UPDATE, resolveHallScope), ctrl.deactivate);
router.get('/:id/availability',      requirePermission(PERMISSIONS.AVAILABILITY_READ),  ctrl.getAvailability);
router.post('/:id/block',            requirePermission(PERMISSIONS.AVAILABILITY_MANAGE),ctrl.block);
router.delete('/:id/block/:blockId', requirePermission(PERMISSIONS.AVAILABILITY_MANAGE),ctrl.unblock);

module.exports = router;
