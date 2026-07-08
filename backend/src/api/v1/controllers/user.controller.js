/**
 * User Controller
 */
'use strict';

const svc      = require('../../../services/user.service');
const bookingStaffRepo = require('../../../repositories/bookingStaff.repository');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id, roleSlug: req.user.role_slug });

const getAll       = async (req, res) => { const { rows, meta, stats } = await svc.getAll(req.query, actor(req)); return response.success(res, { users: rows, meta, stats }); };
const getById      = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const create       = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update       = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'User updated');
const toggleStatus = async (req, res) => response.success(res, await svc.toggleStatus(parseInt(req.params.id, 10), actor(req)), 'User status updated');
const getRoles     = async (req, res) => response.success(res, await svc.getRoles());
const getSchedule  = async (req, res) => response.success(res, await bookingStaffRepo.listForUser(parseInt(req.params.id, 10), req.companyId));
const getPending   = async (req, res) => response.success(res, await svc.getPending(actor(req)));
const approve      = async (req, res) => response.success(res, await svc.approve(parseInt(req.params.id, 10), actor(req)), 'Registration approved');
const reject       = async (req, res) => response.success(res, await svc.reject(parseInt(req.params.id, 10), actor(req)), 'Registration rejected');

module.exports = { getAll, getById, create, update, toggleStatus, getRoles, getSchedule, getPending, approve, reject };
