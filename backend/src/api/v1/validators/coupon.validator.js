/**
 * Coupon Validators — Joi schemas. Structural/type checks only — coupon.service.js
 * still owns the business rules (uniqueness, validTo > validFrom, etc.) that need
 * a DB lookup or cross-field date comparison the same way it already did.
 */
'use strict';

const Joi = require('joi');
const { ValidationError } = require('../middleware/errorHandler');

const validate = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: false });
    if (error) {
        const errors = error.details.map(d => ({ field: d.context?.key || d.path.join('.'), message: d.message }));
        return next(new ValidationError('Validation failed', errors));
    }
    req.body = value;
    next();
};

const createSchema = Joi.object({
    couponCode:   Joi.string().max(50).required(),
    couponName:   Joi.string().max(100).required(),
    description:  Joi.string().max(255).allow('', null),
    discountType:  Joi.string().valid('percentage', 'flat').required(),
    discountValue: Joi.number().precision(2).positive().required(),
    maxDiscountAmount: Joi.number().precision(2).min(0).allow(null),
    minBookingAmount:  Joi.number().precision(2).min(0),
    usageLimit:  Joi.number().integer().positive().allow(null),
    usagePerUser: Joi.number().integer().positive(),
    validFrom: Joi.date().iso().required(),
    validTo:   Joi.date().iso().required(),
    applicableHalls:      Joi.array().items(Joi.number().integer()).allow(null),
    applicableEvents:     Joi.array().items(Joi.string()).allow(null),
    applicablePackages:   Joi.array().items(Joi.number().integer()).allow(null),
    applicableBranches:   Joi.array().items(Joi.number().integer()).allow(null),
    applicableProperties: Joi.array().items(Joi.number().integer()).allow(null),
}).unknown(true);

const updateSchema = Joi.object({
    couponName:  Joi.string().max(100),
    description: Joi.string().max(255).allow('', null),
    discountType:  Joi.string().valid('percentage', 'flat'),
    discountValue: Joi.number().precision(2).positive(),
    maxDiscountAmount: Joi.number().precision(2).min(0).allow(null),
    minBookingAmount:  Joi.number().precision(2).min(0),
    usageLimit:  Joi.number().integer().positive().allow(null),
    usagePerUser: Joi.number().integer().positive(),
    validFrom: Joi.date().iso(),
    validTo:   Joi.date().iso(),
    isActive:  Joi.boolean(),
    applicableHalls:      Joi.array().items(Joi.number().integer()).allow(null),
    applicableEvents:     Joi.array().items(Joi.string()).allow(null),
    applicablePackages:   Joi.array().items(Joi.number().integer()).allow(null),
    applicableBranches:   Joi.array().items(Joi.number().integer()).allow(null),
    applicableProperties: Joi.array().items(Joi.number().integer()).allow(null),
}).unknown(true);

const validateCouponSchema = Joi.object({
    coupon_code: Joi.string().max(50),
    couponCode:  Joi.string().max(50),
    subtotal:    Joi.number().min(0).required(),
}).unknown(true).or('coupon_code', 'couponCode');

module.exports = {
    validateCreate:      validate(createSchema),
    validateUpdate:      validate(updateSchema),
    validateValidateReq: validate(validateCouponSchema),
};
