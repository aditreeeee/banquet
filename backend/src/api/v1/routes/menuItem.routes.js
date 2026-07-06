/**
 * Menu Item Routes — /api/v1/menu-items
 */
'use strict';

const { Router }            = require('express');
const ctrl                  = require('../controllers/menuItem.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/',     requirePermission(PERMISSIONS.CATERING_READ),   ctrl.list);
router.get('/categories', requirePermission(PERMISSIONS.CATERING_READ), ctrl.listCategories);
router.post('/',    requirePermission(PERMISSIONS.CATERING_CREATE), ctrl.create);
router.get('/:id',  requirePermission(PERMISSIONS.CATERING_READ),   ctrl.getById);
router.put('/:id',  requirePermission(PERMISSIONS.CATERING_UPDATE), ctrl.update);
router.patch('/:id',requirePermission(PERMISSIONS.CATERING_UPDATE), ctrl.update);

module.exports = router;
