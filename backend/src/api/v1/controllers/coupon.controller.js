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

const getUsage = async (req, res) => response.success(res, await svc.getUsageHistory(parseInt(req.params.id, 10), req.companyId));

const create = async (req, res) => response.created(res, await svc.create(req.companyId, req.body, req.user.user_id), 'Coupon created');

const update = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.companyId, req.body, req.user.user_id), 'Coupon updated');

const activate = async (req, res) => response.success(res, await svc.setActive(parseInt(req.params.id, 10), req.companyId, true, req.user.user_id), 'Coupon activated');

const deactivate = async (req, res) => response.success(res, await svc.setActive(parseInt(req.params.id, 10), req.companyId, false, req.user.user_id), 'Coupon deactivated');

const remove = async (req, res) => {
    await svc.remove(parseInt(req.params.id, 10), req.companyId, req.user.user_id);
    return response.success(res, null, 'Coupon deleted');
};

const clone = async (req, res) => {
    const newCode = req.body.newCouponCode || req.body.new_coupon_code;
    return response.created(res, await svc.clone(parseInt(req.params.id, 10), req.companyId, newCode, req.user.user_id), 'Coupon cloned');
};

const validate = async (req, res) => {
    const b = req.body;
    const result = await svc.validate(req.companyId, b.couponCode || b.coupon_code, {
        subtotal:   b.subtotal,
        eventType:  b.eventType   ?? b.event_type,
        hallId:     b.hallId      ?? b.hall_id,
        packageId:  b.packageId   ?? b.package_id,
        branchId:   b.branchId    ?? b.branch_id,
        propertyId: b.propertyId  ?? b.property_id,
        customerId: b.customerId  ?? b.customer_id,
    });
    return response.success(res, result);
};

module.exports = { list, getById, getUsage, create, update, activate, deactivate, remove, clone, validate };
