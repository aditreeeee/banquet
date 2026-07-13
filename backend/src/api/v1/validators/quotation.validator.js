/**
 * Quotation Validators — Joi schemas
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
    leadId:     Joi.number().integer().positive().allow(null),
    customerId: Joi.number().integer().positive().allow(null),
    eventName:  Joi.string().max(200).allow('', null),
    eventType:  Joi.string().max(50).allow('', null),
    eventDate:  Joi.date().iso().allow(null),
    guestCount: Joi.number().integer().min(1).allow(null),
    hallId:     Joi.number().integer().positive().allow(null),
    discountAmount: Joi.number().precision(2).min(0),
    notes:      Joi.string().max(2000).allow('', null),
    expiryDate: Joi.date().iso().allow(null),
    items: Joi.array().items(
        Joi.object({
            description: Joi.string().max(500).required(),
            quantity:    Joi.number().positive().required(),
            unitPrice:   Joi.number().precision(2).min(0),
            unit_price:  Joi.number().precision(2).min(0),
            taxPercent:  Joi.number().min(0).max(100),
            tax_percent: Joi.number().min(0).max(100),
        }).unknown(true)
    ),
}).unknown(true);

const updateSchema = Joi.object({
    eventName:  Joi.string().max(200).allow('', null),
    eventType:  Joi.string().max(50).allow('', null),
    eventDate:  Joi.date().iso().allow(null),
    guestCount: Joi.number().integer().min(1).allow(null),
    hallId:     Joi.number().integer().positive().allow(null),
    discountAmount: Joi.number().precision(2).min(0),
    notes:      Joi.string().max(2000).allow('', null),
    expiryDate: Joi.date().iso().allow(null),
}).unknown(true);

const addItemSchema = Joi.object({
    description: Joi.string().max(500).required(),
    quantity:    Joi.number().positive().required(),
    unitPrice:   Joi.number().precision(2).min(0),
    unit_price:  Joi.number().precision(2).min(0),
    taxPercent:  Joi.number().min(0).max(100),
    tax_percent: Joi.number().min(0).max(100),
}).unknown(true);

const convertSchema = Joi.object({
    hallId:     Joi.number().integer().positive(),
    customerId: Joi.number().integer().positive(),
    eventDate:  Joi.date().iso(),
    eventTimeStart: Joi.string(),
    eventTimeEnd:   Joi.string(),
}).unknown(true);

module.exports = {
    validateCreate:  validate(createSchema),
    validateUpdate:  validate(updateSchema),
    validateAddItem: validate(addItemSchema),
    validateConvert: validate(convertSchema),
};
