/**
 * Customer Controller
 */
'use strict';

const svc      = require('../../../services/customer.service');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id, roleSlug: req.user.role_slug, isImpersonating: req.isImpersonating });

const getAll  = async (req, res) => { const { rows, meta, stats } = await svc.getAll(req.query, actor(req)); return response.success(res, { customers: rows, meta, stats }); };
const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const create  = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update  = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'Customer updated');
const getHistory = async (req, res) => {
    const { rows, customer } = await svc.getBookingHistory(parseInt(req.params.id, 10), req.companyId, req.query);
    return response.success(res, { customer, bookings: rows });
};
// Soft-delete — customers referenced by existing Bookings/Invoices/Reviews can't
// be hard-deleted without breaking that history, so this deactivates instead.
const deactivate = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), { isActive: false }, actor(req)), 'Customer deleted');

module.exports = { getAll, getById, create, update, getHistory, deactivate };
