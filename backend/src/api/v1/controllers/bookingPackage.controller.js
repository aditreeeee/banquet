/**
 * Booking Package Controller
 */
'use strict';

const svc = require('../../../services/bookingPackage.service');
const response = require('../../../utils/response');
const actor = (req) => ({ companyId: req.companyId, userId: req.user.user_id });

const getAll  = async (req, res) => response.success(res, await svc.list(req.companyId, req.query));
const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const create  = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update  = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'Package updated');
const activate   = async (req, res) => response.success(res, await svc.setActive(parseInt(req.params.id, 10), true, actor(req)), 'Package activated');
const deactivate = async (req, res) => response.success(res, await svc.setActive(parseInt(req.params.id, 10), false, actor(req)), 'Package deactivated');
const remove = async (req, res) => { await svc.remove(parseInt(req.params.id, 10), actor(req)); return response.success(res, null, 'Package deleted'); };

module.exports = { getAll, getById, create, update, activate, deactivate, remove };
