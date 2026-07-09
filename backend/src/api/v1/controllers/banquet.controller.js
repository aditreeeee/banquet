/**
 * Banquet Controller
 */
'use strict';

const svc      = require('../../../services/banquet.service');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id, roleSlug: req.user.role_slug, isImpersonating: req.isImpersonating });

const getAll  = async (req, res) => { const { rows, meta } = await svc.getAll(req.query, actor(req)); return response.success(res, { banquets: rows, meta }); };
const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const create  = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update  = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'Banquet updated');
const activate   = async (req, res) => { await svc.setActive(parseInt(req.params.id, 10), true,  actor(req)); return response.success(res, null, 'Banquet activated'); };
const deactivate = async (req, res) => { await svc.setActive(parseInt(req.params.id, 10), false, actor(req)); return response.success(res, null, 'Banquet deactivated'); };
const remove     = async (req, res) => { await svc.remove(parseInt(req.params.id, 10), actor(req)); return response.success(res, null, 'Banquet deleted'); };

module.exports = { getAll, getById, create, update, activate, deactivate, remove };
