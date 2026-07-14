/**
 * Banquet Routes — /api/v1/banquets
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/banquet.controller');
const { requirePermission, requireRole } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

router.get('/',                  requirePermission(PERMISSIONS.BANQUETS_READ),   ctrl.getAll);
router.post('/',                 requirePermission(PERMISSIONS.BANQUETS_CREATE), ctrl.create);
router.get('/:id',               requirePermission(PERMISSIONS.BANQUETS_READ),   ctrl.getById);
router.patch('/:id',             requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.update);
router.put('/:id',               requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.update);
router.patch('/:id/activate',    requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.activate);
router.patch('/:id/deactivate',  requirePermission(PERMISSIONS.BANQUETS_UPDATE), ctrl.deactivate);
// Genuine soft delete (deleted_at), distinct from deactivate (is_active) —
// blocked while any hall still exists under the banquet. See
// banquet.service.js:remove.
router.delete('/:id',            requirePermission(PERMISSIONS.BANQUETS_DELETE), ctrl.remove);

// Property Token — view/regenerate restricted to Super Admin only (not just
// banquets:update), since regenerating invalidates every public URL/QR code
// already printed/distributed for this property; a routine branch-manager
// edit permission shouldn't carry that blast radius.
router.get('/:id/token',            requireRole('super_admin'), ctrl.getToken);
router.get('/:id/token/qrcode',     requireRole('super_admin'), ctrl.getTokenQrCode);
router.post('/:id/token/regenerate', requireRole('super_admin'), ctrl.regenerateToken);

module.exports = router;
