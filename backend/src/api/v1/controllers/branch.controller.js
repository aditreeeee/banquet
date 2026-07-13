/**
 * Branch Controller
 */
'use strict';

const svc       = require('../../../services/branch.service');
const branchRepo = require('../../../repositories/branch.repository');
const response  = require('../../../utils/response');
const actor     = (req) => ({ userId: req.user.user_id });

const getAll = async (req, res) => {
    const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === '1';
    return response.success(res, await branchRepo.findAll(req.companyId, { activeOnly }));
};

const getById = async (req, res) => {
    const branch = await branchRepo.findById(parseInt(req.params.id, 10), req.companyId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    return response.success(res, branch);
};

const create = async (req, res) => response.created(res, { branch_id: (await svc.create(req.companyId, req.body, actor(req))).branch_id });

const update = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.companyId, req.body, actor(req)), 'Branch updated');

module.exports = { getAll, getById, create, update };
