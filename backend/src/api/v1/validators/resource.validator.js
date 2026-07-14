/**
 * Resource Validators — Joi schemas
 */
'use strict';

const Joi = require('joi');
const { ValidationError } = require('../middleware/errorHandler');

const CATEGORIES = ['furniture', 'decor', 'lighting', 'audio', 'visual', 'signage', 'custom'];

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
    resourceName:      Joi.string().max(150).required(),
    resourceType:      Joi.string().max(100).allow('', null),
    category:          Joi.string().valid(...CATEGORIES).allow(null),
    supplier:          Joi.string().max(150).allow('', null),
    unitPrice:         Joi.number().precision(2).min(0),
    costPrice:         Joi.number().precision(2).min(0),
    quantityAvailable: Joi.number().integer().min(0),
    isBillable:        Joi.boolean(),
    hsnSacCode:        Joi.string().max(15).allow('', null),
    taxType:           Joi.string().valid('hsn', 'sac'),
    taxPercent:        Joi.number().min(0).max(100),
}).unknown(true);

const updateSchema = Joi.object({
    resourceName:      Joi.string().max(150),
    category:          Joi.string().valid(...CATEGORIES).allow(null),
    supplier:          Joi.string().max(150).allow('', null),
    unitPrice:         Joi.number().precision(2).min(0),
    costPrice:         Joi.number().precision(2).min(0),
    quantityAvailable: Joi.number().integer().min(0),
    isActive:          Joi.boolean(),
    isBillable:        Joi.boolean(),
    hsnSacCode:        Joi.string().max(15).allow('', null),
    taxType:           Joi.string().valid('hsn', 'sac'),
    taxPercent:        Joi.number().min(0).max(100),
}).unknown(true);

module.exports = {
    validateCreate: validate(createSchema),
    validateUpdate: validate(updateSchema),
};
