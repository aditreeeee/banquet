/**
 * Lead Validators — Joi schemas for the sales pipeline
 */
'use strict';

const Joi = require('joi');

const validate = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
        const { ValidationError } = require('../middleware/errorHandler');
        const errors = error.details.map(d => ({ field: d.context?.key || d.path.join('.'), message: d.message }));
        return next(new ValidationError('Validation failed', errors));
    }
    req.body = value;
    next();
};

const createSchema = Joi.object({
    customerId:      Joi.number().integer().positive().optional(),
    contactName:     Joi.string().max(150).required(),
    contactPhone:    Joi.string().max(20).optional(),
    contactEmail:    Joi.string().email().max(150).optional(),
    eventType:       Joi.string().max(50).optional(),
    preferredDate:   Joi.date().iso().optional(),
    guestCount:      Joi.number().integer().min(1).optional(),
    estimatedBudget: Joi.number().precision(2).min(0).optional(),
    source:          Joi.string().max(50).optional(),
    assignedTo:      Joi.number().integer().positive().optional(),
    notes:           Joi.string().max(2000).optional(),
});

const updateSchema = Joi.object({
    contactName:     Joi.string().max(150).optional(),
    contactPhone:    Joi.string().max(20).optional(),
    contactEmail:    Joi.string().email().max(150).optional(),
    eventType:       Joi.string().max(50).optional(),
    preferredDate:   Joi.date().iso().optional(),
    guestCount:      Joi.number().integer().min(1).optional(),
    estimatedBudget: Joi.number().precision(2).min(0).optional(),
    source:          Joi.string().max(50).optional(),
    assignedTo:      Joi.number().integer().positive().optional(),
    notes:           Joi.string().max(2000).optional(),
});

const stageSchema = Joi.object({
    stage:      Joi.string().valid('inquiry', 'lead', 'quotation', 'tentative', 'confirmed', 'completed', 'lost').required(),
    lostReason: Joi.string().max(500).optional(),
});

const convertSchema = Joi.object({
    hallId:         Joi.number().integer().positive().required(),
    customerId:     Joi.number().integer().positive().optional(),
    eventDate:      Joi.date().iso().min('now').required(),
    eventTimeStart: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
    eventTimeEnd:   Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
    eventName:      Joi.string().max(200).optional(),
    eventType:      Joi.string().max(50).optional(),
    guestCount:     Joi.number().integer().min(1).optional(),
    totalAmount:    Joi.number().precision(2).min(0).required(),
    advancePaid:    Joi.number().precision(2).min(0).optional(),
    isPriority:     Joi.boolean().optional(),
});

module.exports = {
    validateCreate:  validate(createSchema),
    validateUpdate:  validate(updateSchema),
    validateStage:   validate(stageSchema),
    validateConvert: validate(convertSchema),
};
