/**
 * Hall Validators — Joi schemas
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

// hall.service.js's normalize() accepts both camelCase and snake_case, so
// this validates type/format without stripping either casing.
const createSchema = Joi.object({
    hallName:  Joi.string().max(150),
    hall_name: Joi.string().max(150),
    banquetId:  Joi.number().integer().positive(),
    banquet_id: Joi.number().integer().positive(),
    basePrice:  Joi.number().precision(2).min(0),
    base_price: Joi.number().precision(2).min(0),
    capacitySeated:   Joi.number().integer().min(0),
    capacity_seated:  Joi.number().integer().min(0),
    capacityStanding:  Joi.number().integer().min(0),
    capacity_standing: Joi.number().integer().min(0),
}).unknown(true).or('hallName', 'hall_name').or('banquetId', 'banquet_id');

const updateSchema = Joi.object({
    hallName:  Joi.string().max(150),
    hall_name: Joi.string().max(150),
    basePrice:  Joi.number().precision(2).min(0),
    base_price: Joi.number().precision(2).min(0),
    capacitySeated:   Joi.number().integer().min(0),
    capacity_seated:  Joi.number().integer().min(0),
    capacityStanding:  Joi.number().integer().min(0),
    capacity_standing: Joi.number().integer().min(0),
    isActive:  Joi.boolean(),
    is_active: Joi.boolean(),
}).unknown(true);

const blockSchema = Joi.object({
    blockType:  Joi.string().valid('maintenance', 'vip_hold', 'emergency_closure', 'blackout'),
    block_type: Joi.string().valid('maintenance', 'vip_hold', 'emergency_closure', 'blackout'),
    blockedDate:  Joi.date().iso().required(),
    blocked_date: Joi.date().iso().required(),
    startTime: Joi.string().allow('', null),
    endTime:   Joi.string().allow('', null),
    reason:    Joi.string().max(500).allow('', null),
}).unknown(true).or('blockedDate', 'blocked_date');

module.exports = {
    validateCreate: validate(createSchema),
    validateUpdate: validate(updateSchema),
    validateBlock:  validate(blockSchema),
};
