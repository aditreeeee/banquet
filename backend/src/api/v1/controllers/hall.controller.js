/**
 * Hall Controller
 */
'use strict';

const svc      = require('../../../services/hall.service');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id });

const getAll         = async (req, res) => { const { rows, meta } = await svc.getAll(req.query, actor(req)); return response.success(res, { halls: rows, meta }); };
const getById        = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const create         = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update         = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'Hall updated');
const activate       = async (req, res) => { await svc.setActive(parseInt(req.params.id, 10), true,  actor(req)); return response.success(res, null, 'Hall activated'); };
const deactivate     = async (req, res) => { await svc.setActive(parseInt(req.params.id, 10), false, actor(req)); return response.success(res, null, 'Hall deactivated'); };
const getAvailability= async (req, res) => response.success(res, await svc.getAvailability(parseInt(req.params.id, 10), req.query, actor(req)));
const block          = async (req, res) => response.created(res, await svc.block(parseInt(req.params.id, 10), req.body, actor(req)), 'Date blocked');
const unblock        = async (req, res) => { await svc.unblock(parseInt(req.params.id, 10), parseInt(req.params.blockId, 10), actor(req)); return response.success(res, null, 'Block removed'); };

module.exports = { getAll, getById, create, update, activate, deactivate, getAvailability, block, unblock };
