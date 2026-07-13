/**
 * Branch Routes — /api/v1/branches
 */
'use strict';

const { Router }             = require('express');
const ctrl                   = require('../controllers/branch.controller');
const { requirePermission }  = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

// activeOnly=true is used by the user-assignment cascading dropdown
// (Company/Property -> Branch) — it must only ever offer branches that
// are still active. The branch-management page itself omits this filter
// so inactive branches remain visible/reactivatable there.
router.get('/',     requirePermission(PERMISSIONS.BRANCHES_READ),   ctrl.getAll);
router.get('/:id',  requirePermission(PERMISSIONS.BRANCHES_READ),   ctrl.getById);
router.post('/',    requirePermission(PERMISSIONS.BRANCHES_CREATE), ctrl.create);
router.patch('/:id', requirePermission(PERMISSIONS.BRANCHES_UPDATE), ctrl.update);

module.exports = router;
