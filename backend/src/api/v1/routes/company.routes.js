/**
 * Company (Tenant) Routes — /api/v1/companies
 * Tenant management is a platform-level (Super Admin) capability. The one
 * exception: a tenant's own admin may read (not modify) their own company
 * profile — mirrors the old stub's self-view behavior, now on real columns.
 */
'use strict';

const { Router }       = require('express');
const ctrl             = require('../controllers/company.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }  = require('../../../constants');

const router = Router();

router.get('/',        requirePermission(PERMISSIONS.COMPANIES_READ), ctrl.getAll);
router.post('/',       requirePermission(PERMISSIONS.COMPANIES_CREATE), ctrl.create);

router.get('/:id', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!req.user.isSuperAdmin && id !== req.companyId) {
        return res.status(404).json({ success: false, message: 'Company not found' });
    }
    return ctrl.getById(req, res, next);
});

router.put('/:id',              requirePermission(PERMISSIONS.COMPANIES_UPDATE), ctrl.update);
router.patch('/:id/activate',   requirePermission(PERMISSIONS.COMPANIES_UPDATE), ctrl.activate);
router.patch('/:id/suspend',    requirePermission(PERMISSIONS.COMPANIES_UPDATE), ctrl.suspend);
router.delete('/:id',           requirePermission(PERMISSIONS.COMPANIES_DELETE), ctrl.remove);

module.exports = router;
