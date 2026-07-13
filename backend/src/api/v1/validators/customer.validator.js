/**
 * Customer Validators — Joi schemas
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

// customer.service.js's normalize() accepts both camelCase and snake_case for
// every field, so schemas here validate type/format when a field is present
// rather than stripping unknown keys (which would break either casing).
const createSchema = Joi.object({
    firstName:  Joi.string().max(100),
    first_name: Joi.string().max(100),
    lastName:   Joi.string().max(100).allow('', null),
    last_name:  Joi.string().max(100).allow('', null),
    email:      Joi.string().email().max(150).allow('', null),
    phone:      Joi.string().max(20).required(),
    alternatePhone:  Joi.string().max(20).allow('', null),
    alternate_phone: Joi.string().max(20).allow('', null),
    address: Joi.string().max(500).allow('', null),
    city:    Joi.string().max(100).allow('', null),
    state:   Joi.string().max(100).allow('', null),
    notes:   Joi.string().max(2000).allow('', null),
    source:  Joi.string().valid('direct', 'referral', 'walk_in', 'website', 'phone', 'social_media').allow(null),
    branchId:  Joi.number().integer().positive().allow(null),
    branch_id: Joi.number().integer().positive().allow(null),
}).unknown(true).or('firstName', 'first_name');

const updateSchema = Joi.object({
    firstName:  Joi.string().max(100),
    first_name: Joi.string().max(100),
    lastName:   Joi.string().max(100).allow('', null),
    last_name:  Joi.string().max(100).allow('', null),
    email:      Joi.string().email().max(150).allow('', null),
    phone:      Joi.string().max(20),
    alternatePhone:  Joi.string().max(20).allow('', null),
    alternate_phone: Joi.string().max(20).allow('', null),
    address: Joi.string().max(500).allow('', null),
    city:    Joi.string().max(100).allow('', null),
    state:   Joi.string().max(100).allow('', null),
    notes:   Joi.string().max(2000).allow('', null),
    source:  Joi.string().valid('direct', 'referral', 'walk_in', 'website', 'phone', 'social_media').allow(null),
    isActive:  Joi.boolean(),
    is_active: Joi.boolean(),
}).unknown(true);

module.exports = {
    validateCreate: validate(createSchema),
    validateUpdate: validate(updateSchema),
};
