/**
 * Lead Controller — Sales Pipeline
 */
'use strict';

const leadService = require('../../../services/lead.service');
const response = require('../../../utils/response');

const actor = (req) => ({
    userId: req.user.user_id,
    companyId: req.companyId,
    branchId: req.user.branch_id,
});

const list = async (req, res) => {
    const leads = await leadService.list(req.query, actor(req));
    return response.success(res, leads);
};

const getById = async (req, res) => {
    const lead = await leadService.getById(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, lead);
};

const create = async (req, res) => {
    const lead = await leadService.create(req.body, actor(req));
    return response.created(res, lead, 'Lead created');
};

const update = async (req, res) => {
    const lead = await leadService.update(parseInt(req.params.id, 10), req.body, actor(req));
    return response.success(res, lead, 'Lead updated');
};

const advanceStage = async (req, res) => {
    const lead = await leadService.advanceStage(
        parseInt(req.params.id, 10),
        req.body.stage,
        actor(req),
        req.body.lostReason
    );
    return response.success(res, lead, 'Lead stage updated');
};

const convertToBooking = async (req, res) => {
    const result = await leadService.convertToBooking(parseInt(req.params.id, 10), req.body, actor(req));
    return response.created(res, result, 'Lead converted to booking');
};

module.exports = { list, getById, create, update, advanceStage, convertToBooking };
