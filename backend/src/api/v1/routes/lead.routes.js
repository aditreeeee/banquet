/**
 * Lead Routes — /api/v1/leads (Sales Pipeline)
 */
'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/lead.controller');
const v = require('../validators/lead.validator');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../../../constants');

const router = Router();

router.get('/',              requirePermission(PERMISSIONS.LEADS_READ),   ctrl.list);
router.post('/',             requirePermission(PERMISSIONS.LEADS_CREATE), v.validateCreate, ctrl.create);
router.get('/:id',           requirePermission(PERMISSIONS.LEADS_READ),   ctrl.getById);
router.put('/:id',           requirePermission(PERMISSIONS.LEADS_UPDATE), v.validateUpdate, ctrl.update);
router.patch('/:id/stage',   requirePermission(PERMISSIONS.LEADS_UPDATE), v.validateStage, ctrl.advanceStage);
router.post('/:id/convert',  requirePermission(PERMISSIONS.LEADS_UPDATE), v.validateConvert, ctrl.convertToBooking);

module.exports = router;
