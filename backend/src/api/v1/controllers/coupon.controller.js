/**
 * Coupon Controller
 */
'use strict';

const svc      = require('../../../services/coupon.service');
const response = require('../../../utils/response');

const list = async (req, res) => {
    const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === '1';
    return response.success(res, await svc.list(req.companyId, { activeOnly }));
};

const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));

const create = async (req, res) => response.created(res, await svc.create(req.companyId, req.body, req.user.user_id), 'Coupon created');

const update = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.companyId, req.body), 'Coupon updated');

const validate = async (req, res) => {
    const { coupon_code, couponCode, subtotal } = req.body;
    const result = await svc.validate(req.companyId, couponCode || coupon_code, subtotal);
    return response.success(res, result);
};

module.exports = { list, getById, create, update, validate };
