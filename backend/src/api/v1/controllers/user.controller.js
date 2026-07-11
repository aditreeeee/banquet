/**
 * User Controller
 */
'use strict';

const svc      = require('../../../services/user.service');
const bookingStaffRepo = require('../../../repositories/bookingStaff.repository');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id, roleSlug: req.user.role_slug, isImpersonating: !!req.isImpersonating });

const getAll       = async (req, res) => { const { rows, meta, stats } = await svc.getAll(req.query, actor(req)); return response.success(res, { users: rows, meta, stats }); };
const getById      = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), actor(req)));
const create       = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update       = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'User updated');
const toggleStatus = async (req, res) => response.success(res, await svc.toggleStatus(parseInt(req.params.id, 10), actor(req)), 'User status updated');
const reassignCompany = async (req, res) => {
    const branchId = req.body.branchId ?? req.body.branch_id;
    return response.success(
        res,
        await svc.reassignCompany(
            parseInt(req.params.id, 10),
            parseInt(req.body.companyId, 10),
            branchId != null && branchId !== '' ? parseInt(branchId, 10) : null,
            actor(req)
        ),
        'User moved to the new property'
    );
};
const remove        = async (req, res) => { await svc.remove(parseInt(req.params.id, 10), actor(req)); return response.success(res, null, 'User deleted'); };
const getRoles     = async (req, res) => response.success(res, await svc.getRoles());
const getSchedule  = async (req, res) => response.success(res, await bookingStaffRepo.listForUser(parseInt(req.params.id, 10), req.companyId));
const getPending   = async (req, res) => response.success(res, await svc.getPending(actor(req)));
const approve      = async (req, res) => response.success(res, await svc.approve(parseInt(req.params.id, 10), actor(req)), 'Registration approved');
const reject       = async (req, res) => response.success(res, await svc.reject(parseInt(req.params.id, 10), actor(req)), 'Registration rejected');
const getAuditLog  = async (req, res) => response.success(res, await svc.getAuditLog(parseInt(req.params.id, 10), actor(req)));

module.exports = { getAll, getById, create, update, reassignCompany, toggleStatus, remove, getRoles, getSchedule, getPending, approve, reject, getAuditLog };
