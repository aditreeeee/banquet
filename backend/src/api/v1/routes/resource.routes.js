/**
 * Resource Routes — /api/v1/resources
 * (Shared inventory — chairs, projectors, etc. — bookable alongside halls)
 */
'use strict';

const { Router }             = require('express');
const ctrl                   = require('../controllers/resource.controller');
const { requirePermission }  = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/',                requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.list);
router.post('/',               requirePermission(PERMISSIONS.RESOURCES_CREATE), ctrl.create);
router.get('/snapshot',         requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.getSnapshot);
router.get('/:id',              requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.getById);
router.get('/:id/availability', requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.getAvailability);
router.put('/:id',              requirePermission(PERMISSIONS.RESOURCES_UPDATE), ctrl.update);
router.patch('/:id',            requirePermission(PERMISSIONS.RESOURCES_UPDATE), ctrl.update);

module.exports = router;
