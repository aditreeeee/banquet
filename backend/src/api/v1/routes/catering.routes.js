/**
 * Catering Routes — /api/v1/catering
 * Catering packages, now backed by the centralized Master Menu (MenuItems).
 */
'use strict';

const { Router }            = require('express');
const ctrl                  = require('../controllers/catering.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/packages',                    requirePermission(PERMISSIONS.CATERING_READ),   ctrl.listPackages);
router.post('/packages',                   requirePermission(PERMISSIONS.CATERING_CREATE), ctrl.createPackage);
router.get('/packages/:id',                requirePermission(PERMISSIONS.CATERING_READ),   ctrl.getPackage);
router.get('/packages/:id/pricing',        requirePermission(PERMISSIONS.CATERING_READ),   ctrl.getPricing);
router.get('/packages/:id/bill',           requirePermission(PERMISSIONS.CATERING_READ),   ctrl.calculateBill);
router.post('/packages/:id/items',         requirePermission(PERMISSIONS.CATERING_UPDATE), ctrl.addItem);
router.delete('/packages/:id/items/:itemId', requirePermission(PERMISSIONS.CATERING_UPDATE), ctrl.removeItem);
router.post('/packages/:id/sync-price',    requirePermission(PERMISSIONS.CATERING_UPDATE), ctrl.syncPrice);

module.exports = router;
