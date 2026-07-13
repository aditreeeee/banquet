/**
 * Menu Item Routes — /api/v1/menu-items
 */
'use strict';

const { Router }            = require('express');
const ctrl                  = require('../controllers/menuItem.controller');
const v                     = require('../validators/menuItem.validator');
const { requirePermission } = require('../middleware/auth');
const { csvUpload }         = require('../middleware/upload');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/',     requirePermission(PERMISSIONS.CATERING_READ),   ctrl.list);
router.get('/categories', requirePermission(PERMISSIONS.CATERING_READ), ctrl.listCategories);
router.post('/import', requirePermission(PERMISSIONS.CATERING_CREATE), csvUpload.single('file'), ctrl.importCsv);
router.post('/',    requirePermission(PERMISSIONS.CATERING_CREATE), v.validateCreate, ctrl.create);
router.get('/:id',  requirePermission(PERMISSIONS.CATERING_READ),   ctrl.getById);
router.put('/:id',  requirePermission(PERMISSIONS.CATERING_UPDATE), v.validateUpdate, ctrl.update);
router.patch('/:id',requirePermission(PERMISSIONS.CATERING_UPDATE), v.validateUpdate, ctrl.update);

module.exports = router;
