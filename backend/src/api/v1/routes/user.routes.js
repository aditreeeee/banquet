/**
 * User Routes — /api/v1/users
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/user.controller');
const { requirePermission, requireRole } = require('../middleware/auth');
const { PERMISSIONS, USER_ROLES } = require('../../../constants');
const { validateCreate, validateUpdate } = require('../validators/user.validator');

const router = Router();

router.get('/roles',              ctrl.getRoles);
router.get('/pending',            requirePermission(PERMISSIONS.USERS_READ),   ctrl.getPending);
router.get('/',                   requirePermission(PERMISSIONS.USERS_READ),   ctrl.getAll);
router.post('/',                  requirePermission(PERMISSIONS.USERS_CREATE), validateCreate, ctrl.create);
router.get('/:id',                requirePermission(PERMISSIONS.USERS_READ),   ctrl.getById);
router.get('/:id/schedule',       requirePermission(PERMISSIONS.USERS_READ),   ctrl.getSchedule);
router.get('/:id/audit-log',      requirePermission(PERMISSIONS.USERS_READ),   ctrl.getAuditLog);
router.patch('/:id',              requirePermission(PERMISSIONS.USERS_UPDATE), validateUpdate, ctrl.update);
router.put('/:id',                requirePermission(PERMISSIONS.USERS_UPDATE), validateUpdate, ctrl.update);
router.patch('/:id/toggle-status',requirePermission(PERMISSIONS.USERS_UPDATE), ctrl.toggleStatus);
// Moving a user to a different company is a cross-tenant operation — Super
// Admin only, on top of the usual users:update permission check.
router.patch('/:id/company',      requirePermission(PERMISSIONS.USERS_UPDATE), requireRole(USER_ROLES.SUPER_ADMIN), ctrl.reassignCompany);
router.delete('/:id',             requirePermission(PERMISSIONS.USERS_DELETE), ctrl.remove);
router.patch('/:id/approve',      requirePermission(PERMISSIONS.USERS_UPDATE), ctrl.approve);
router.patch('/:id/reject',       requirePermission(PERMISSIONS.USERS_UPDATE), ctrl.reject);

module.exports = router;
