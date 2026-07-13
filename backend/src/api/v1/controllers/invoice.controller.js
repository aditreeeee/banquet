/**
 * Invoice Controller
 */
'use strict';

const svc      = require('../../../services/invoice.service');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, userId: req.user.user_id });

const list = async (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const { rows, total, stats } = await svc.list(req.companyId, {
        search: req.query.search, status: req.query.status, month: req.query.month,
        page, limit,
    });
    return response.success(res, { invoices: rows, meta: { page, limit, total }, stats });
};

const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));

const create = async (req, res) => {
    const invoice = await svc.createForBookingRef(req.body, actor(req));
    return response.created(res, invoice);
};

const cancel = async (req, res) => {
    await svc.cancel(parseInt(req.params.id, 10), actor(req));
    return response.success(res, null, 'Invoice cancelled');
};

module.exports = { list, getById, create, cancel };
