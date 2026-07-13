/**
 * Decoration Routes — /api/v1/decorations
 */
'use strict';

const { Router }             = require('express');
const ctrl                   = require('../controllers/decoration.controller');
const { requirePermission }  = require('../middleware/auth');
const { csvUpload }          = require('../middleware/upload');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/categories',              requirePermission(PERMISSIONS.DECORATIONS_READ),   ctrl.listCategories);
router.post('/categories',             requirePermission(PERMISSIONS.DECORATIONS_CREATE), ctrl.createCategory);

router.get('/items',                   requirePermission(PERMISSIONS.DECORATIONS_READ),   ctrl.listItems);
router.post('/items/import',           requirePermission(PERMISSIONS.DECORATIONS_CREATE), csvUpload.single('file'), ctrl.importCsv);
router.post('/items',                  requirePermission(PERMISSIONS.DECORATIONS_CREATE), ctrl.createItem);
router.get('/items/:id',               requirePermission(PERMISSIONS.DECORATIONS_READ),   ctrl.getItemById);
router.put('/items/:id',               requirePermission(PERMISSIONS.DECORATIONS_UPDATE), ctrl.updateItem);
router.patch('/items/:id',             requirePermission(PERMISSIONS.DECORATIONS_UPDATE), ctrl.updateItem);

router.get('/packages',                requirePermission(PERMISSIONS.DECORATIONS_READ),   ctrl.listPackages);
router.post('/packages',               requirePermission(PERMISSIONS.DECORATIONS_CREATE), ctrl.createPackage);
router.get('/packages/:id',            requirePermission(PERMISSIONS.DECORATIONS_READ),   ctrl.getPackageById);
router.get('/packages/:id/pricing',    requirePermission(PERMISSIONS.DECORATIONS_READ),   ctrl.getPackagePricing);
router.put('/packages/:id',            requirePermission(PERMISSIONS.DECORATIONS_UPDATE), ctrl.updatePackage);
router.delete('/packages/:id',         requirePermission(PERMISSIONS.DECORATIONS_UPDATE), ctrl.deletePackage);
router.post('/packages/:id/items',     requirePermission(PERMISSIONS.DECORATIONS_UPDATE), ctrl.addPackageItem);
router.delete('/packages/:id/items/:itemId', requirePermission(PERMISSIONS.DECORATIONS_UPDATE), ctrl.removePackageItem);

router.get('/snapshot',                requirePermission(PERMISSIONS.DECORATIONS_READ),   ctrl.getSnapshot);

module.exports = router;
