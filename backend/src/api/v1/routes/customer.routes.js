/**
 * Customer Routes — /api/v1/customers
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/customer.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/',                      requirePermission(PERMISSIONS.CUSTOMERS_READ),   ctrl.getAll);
router.post('/',                     requirePermission(PERMISSIONS.CUSTOMERS_CREATE), ctrl.create);
router.get('/:id',                   requirePermission(PERMISSIONS.CUSTOMERS_READ),   ctrl.getById);
router.put('/:id',                   requirePermission(PERMISSIONS.CUSTOMERS_UPDATE), ctrl.update);
router.patch('/:id',                 requirePermission(PERMISSIONS.CUSTOMERS_UPDATE), ctrl.update);
router.get('/:id/booking-history',   requirePermission(PERMISSIONS.CUSTOMERS_READ),   ctrl.getHistory);
router.delete('/:id',                requirePermission(PERMISSIONS.CUSTOMERS_DELETE), ctrl.deactivate);

module.exports = router;
