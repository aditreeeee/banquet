/**
 * Invoice Routes — /api/v1/invoices
 */
'use strict';

const { Router }            = require('express');
const ctrl                  = require('../controllers/invoice.controller');
const v                     = require('../validators/invoice.validator');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }       = require('../../../constants');

const router = Router();

router.get('/',     requirePermission(PERMISSIONS.INVOICES_READ),   ctrl.list);
router.get('/:id',  requirePermission(PERMISSIONS.INVOICES_READ),   ctrl.getById);
router.post('/',    requirePermission(PERMISSIONS.INVOICES_CREATE), v.validateCreate, ctrl.create);
router.delete('/:id', requirePermission(PERMISSIONS.INVOICES_CREATE), ctrl.cancel);

module.exports = router;
