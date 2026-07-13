/**
 * Quotation Routes — /api/v1/quotations
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/quotation.controller');
const v                    = require('../validators/quotation.validator');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

// The public customer-facing acceptance link lives at
// /api/v1/public/quotations/accept/:token (see public.routes.js) — it must
// be reachable without auth, and everything under this router sits behind
// the global authenticate/scopeToCompany middleware (see routes/index.js).

router.get('/',                    requirePermission(PERMISSIONS.QUOTATIONS_READ),   ctrl.getAll);
router.post('/',                   requirePermission(PERMISSIONS.QUOTATIONS_CREATE), v.validateCreate, ctrl.create);
router.get('/:id',                 requirePermission(PERMISSIONS.QUOTATIONS_READ),   ctrl.getById);
router.get('/:id/pdf',             requirePermission(PERMISSIONS.QUOTATIONS_READ),   ctrl.downloadPDF);
router.put('/:id',                 requirePermission(PERMISSIONS.QUOTATIONS_UPDATE), v.validateUpdate, ctrl.update);
router.post('/:id/items',          requirePermission(PERMISSIONS.QUOTATIONS_UPDATE), v.validateAddItem, ctrl.addItem);
router.delete('/:id/items/:itemRowId', requirePermission(PERMISSIONS.QUOTATIONS_UPDATE), ctrl.removeItem);
router.post('/:id/revise',         requirePermission(PERMISSIONS.QUOTATIONS_CREATE), ctrl.revise);
router.patch('/:id/send',          requirePermission(PERMISSIONS.QUOTATIONS_UPDATE), ctrl.send);
router.patch('/:id/reject',        requirePermission(PERMISSIONS.QUOTATIONS_UPDATE), ctrl.reject);
router.patch('/:id/expire',        requirePermission(PERMISSIONS.QUOTATIONS_UPDATE), ctrl.expire);
router.patch('/:id/accept',        requirePermission(PERMISSIONS.QUOTATIONS_APPROVE), ctrl.accept);
router.post('/:id/convert',        requirePermission(PERMISSIONS.QUOTATIONS_APPROVE), v.validateConvert, ctrl.convert);

module.exports = router;
