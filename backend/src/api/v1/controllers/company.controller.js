/**
 * Company (Tenant) Controller — platform-level, Super Admin only.
 */
'use strict';

const svc = require('../../../services/company.service');
const response = require('../../../utils/response');
const actor = (req) => ({ userId: req.user.user_id });

const getAll  = async (req, res) => response.success(res, { companies: await svc.getAll(req.query) });
const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10)));
const create  = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update  = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'Company updated');
const activate   = async (req, res) => { await svc.setActive(parseInt(req.params.id, 10), true, actor(req)); return response.success(res, null, 'Tenant activated'); };
const suspend    = async (req, res) => { await svc.setActive(parseInt(req.params.id, 10), false, actor(req)); return response.success(res, null, 'Tenant suspended'); };
const remove     = async (req, res) => { await svc.remove(parseInt(req.params.id, 10), actor(req)); return response.success(res, null, 'Tenant deleted'); };

module.exports = { getAll, getById, create, update, activate, suspend, remove };
