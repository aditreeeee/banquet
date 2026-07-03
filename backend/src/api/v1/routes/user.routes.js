/**
 * User Routes — /api/v1/users
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/user.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/roles',              ctrl.getRoles);
router.get('/',                   requirePermission(PERMISSIONS.USERS_READ),   ctrl.getAll);
router.post('/',                  requirePermission(PERMISSIONS.USERS_CREATE), ctrl.create);
router.get('/:id',                requirePermission(PERMISSIONS.USERS_READ),   ctrl.getById);
router.patch('/:id',              requirePermission(PERMISSIONS.USERS_UPDATE), ctrl.update);
router.put('/:id',                requirePermission(PERMISSIONS.USERS_UPDATE), ctrl.update);
router.patch('/:id/toggle-status',requirePermission(PERMISSIONS.USERS_UPDATE), ctrl.toggleStatus);

module.exports = router;
