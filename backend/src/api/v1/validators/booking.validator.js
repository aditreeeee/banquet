/**
 * Booking Validators — Joi schemas
 */
'use strict';

const Joi = require('joi');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const UTILITY_OPTIONS = [
    'microphones', 'speakers', 'stage', 'projector', 'led', 'lighting',
    'generator', 'photography', 'security', 'parking', 'power_backup', 'cleaning', 'kitchen',
];

const eventDetailFields = {
    theme:            Joi.string().max(200).optional(),
    decorationNotes:  Joi.string().max(1000).optional(),
    utilities:        Joi.array().items(Joi.string().valid(...UTILITY_OPTIONS)).optional(),
    staffCount:       Joi.number().integer().min(0).optional(),
    eventEndDate:     Joi.date().iso().optional(),
    setupMinutes:     Joi.number().integer().min(0).max(1440).optional(),
    cleanupMinutes:   Joi.number().integer().min(0).max(1440).optional(),
    cooloffMinutes:   Joi.number().integer().min(0).max(1440).optional(),
    cleanupCharge:    Joi.number().precision(2).min(0).optional(),
    lateExitCharge:   Joi.number().precision(2).min(0).optional(),
};

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
    advancePaid:    Joi.number().precision(2).min(0).optional(),
    notes:          Joi.string().max(2000).optional(),
    asTentative:    Joi.boolean().optional().default(false),
    isPriority:     Joi.boolean().optional().default(false),
    ...eventDetailFields,
    resources:      Joi.array().items(
        Joi.object({
            resourceId: Joi.number().integer().positive().required(),
            quantity:   Joi.number().integer().positive().required(),
        })
    ).optional(),
});

const updateSchema = Joi.object({
    eventName:  Joi.string().max(200).optional(),
    eventType:  Joi.string().max(50).optional(),
    guestCount: Joi.number().integer().min(1).optional(),
    notes:      Joi.string().max(2000).optional(),
    ...eventDetailFields,
});

const rescheduleSchema = Joi.object({
    eventDate:      Joi.date().iso().min('now').required(),
    eventTimeStart: Joi.string().pattern(TIME_PATTERN).required(),
    eventTimeEnd:   Joi.string().pattern(TIME_PATTERN).required(),
});

const statusSchema = Joi.object({
    status: Joi.string().valid('tentative', 'confirmed', 'advance_paid', 'fully_paid', 'completed', 'archived', 'no_show').required(),
});

const cancelSchema = Joi.object({
    reason: Joi.string().max(500).optional(),
});

const slotSchema = Joi.object({
    hallId:         Joi.number().integer().positive().required(),
    customerId:     Joi.number().integer().positive().optional(),
    eventDate:      Joi.date().iso().min('now').required(),
    eventTimeStart: Joi.string().pattern(TIME_PATTERN).required(),
    eventTimeEnd:   Joi.string().pattern(TIME_PATTERN).required(),
    eventName:      Joi.string().max(200).optional(),
    eventType:      Joi.string().max(50).optional(),
    guestCount:     Joi.number().integer().min(1).optional(),
    totalAmount:    Joi.number().precision(2).min(0).required(),
    advancePaid:    Joi.number().precision(2).min(0).optional(),
    notes:          Joi.string().max(2000).optional(),
    asTentative:    Joi.boolean().optional().default(false),
});

const cloneSchema = Joi.object({
    eventDate:      Joi.date().iso().min('now').required(),
    eventTimeStart: Joi.string().pattern(TIME_PATTERN).required(),
    eventTimeEnd:   Joi.string().pattern(TIME_PATTERN).required(),
    customerId:     Joi.number().integer().positive().optional(),
});

const contactSchema = Joi.object({
    contactName:  Joi.string().max(150).required(),
    mobile:       Joi.string().max(20).optional(),
    email:        Joi.string().email().max(150).optional(),
    relationship: Joi.string().max(100).optional(),
    notes:        Joi.string().max(500).optional(),
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
    validateContact:      validate(contactSchema),
    validateClone:        validate(cloneSchema),
    validateSlot:         validate(slotSchema),
};
