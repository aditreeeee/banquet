/**
 * Booking Validators — Joi schemas
 */
'use strict';

const Joi = require('joi');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    hallId:         Joi.number().integer().positive().required(),
    customerId:     Joi.number().integer().positive().required(),
    eventDate:      Joi.date().iso().min('now').required(),
    eventTimeStart: Joi.string().pattern(TIME_PATTERN).required(),
    eventTimeEnd:   Joi.string().pattern(TIME_PATTERN).required(),
    eventName:      Joi.string().max(200).optional(),
    eventType:      Joi.string().max(50).optional(),
    guestCount:     Joi.number().integer().min(1).optional(),
    totalAmount:    Joi.number().precision(2).min(0).required(),
    advancePaid:    Joi.number().precision(2).min(0).default(0),
    notes:          Joi.string().max(2000).optional(),
});

const updateSchema = Joi.object({
    eventName:  Joi.string().max(200).optional(),
    eventType:  Joi.string().max(50).optional(),
    guestCount: Joi.number().integer().min(1).optional(),
    notes:      Joi.string().max(2000).optional(),
});

const rescheduleSchema = Joi.object({
    eventDate:      Joi.date().iso().min('now').required(),
    eventTimeStart: Joi.string().pattern(TIME_PATTERN).required(),
    eventTimeEnd:   Joi.string().pattern(TIME_PATTERN).required(),
});

const statusSchema = Joi.object({
    status: Joi.string().valid('confirmed', 'advance_paid', 'fully_paid', 'completed', 'no_show').required(),
});

const cancelSchema = Joi.object({
    reason: Joi.string().max(500).optional(),
});

const availabilitySchema = Joi.object({
    hallId:    Joi.number().integer().positive().required(),
    eventDate: Joi.date().iso().required(),
    startTime: Joi.string().pattern(TIME_PATTERN).required(),
    endTime:   Joi.string().pattern(TIME_PATTERN).required(),
});

module.exports = {
    validateCreate:       validate(createSchema),
    validateUpdate:       validate(updateSchema),
    validateReschedule:   validate(rescheduleSchema),
    validateStatus:       validate(statusSchema),
    validateCancel:       validate(cancelSchema),
    validateAvailability: validate(availabilitySchema),
};
