/**
 * Resource Routes — /api/v1/resources
 * (Shared inventory — chairs, projectors, etc. — bookable alongside halls)
 */
'use strict';

const { Router }             = require('express');
const ctrl                   = require('../controllers/resource.controller');
const v                      = require('../validators/resource.validator');
const { requirePermission }  = require('../middleware/auth');
const { csvUpload }          = require('../middleware/upload');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/',                requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.list);
router.post('/import',         requirePermission(PERMISSIONS.RESOURCES_CREATE), csvUpload.single('file'), ctrl.importCsv);
router.post('/',               requirePermission(PERMISSIONS.RESOURCES_CREATE), v.validateCreate, ctrl.create);
router.get('/snapshot',         requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.getSnapshot);
router.get('/recommendations',  requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.getRecommendations);
router.get('/:id',              requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.getById);
router.get('/:id/availability', requirePermission(PERMISSIONS.RESOURCES_READ),   ctrl.getAvailability);
router.put('/:id',              requirePermission(PERMISSIONS.RESOURCES_UPDATE), v.validateUpdate, ctrl.update);
router.patch('/:id',            requirePermission(PERMISSIONS.RESOURCES_UPDATE), v.validateUpdate, ctrl.update);

module.exports = router;
