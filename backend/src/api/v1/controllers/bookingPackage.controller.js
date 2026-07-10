/**
 * Booking Package Controller
 */
'use strict';

const svc = require('../../../services/bookingPackage.service');
const response = require('../../../utils/response');
const { resolveCompanyScope } = require('../../../utils/branchScope');
const actor = (req) => ({ companyId: req.companyId, userId: req.user.user_id });

// A Super Admin not currently impersonating a tenant sees every tenant's
// packages here (same resolveCompanyScope used by halls/bookings/customers/
// payments/leads) instead of scopeToCompany's write-safe company_id=1
// fallback — this is what was hiding another tenant's custom packages from
// the booking wizard's package picker.
const getAll  = async (req, res) => response.success(res, await svc.list(
    resolveCompanyScope({ companyId: req.companyId, roleSlug: req.user.role_slug, isImpersonating: req.isImpersonating }),
    req.query,
));
const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const create  = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update  = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'Package updated');
const activate   = async (req, res) => response.success(res, await svc.setActive(parseInt(req.params.id, 10), true, actor(req)), 'Package activated');
const deactivate = async (req, res) => response.success(res, await svc.setActive(parseInt(req.params.id, 10), false, actor(req)), 'Package deactivated');
const remove = async (req, res) => { await svc.remove(parseInt(req.params.id, 10), actor(req)); return response.success(res, null, 'Package deleted'); };

module.exports = { getAll, getById, create, update, activate, deactivate, remove };
