/**
 * Booking Validators — Joi schemas
 */
'use strict';

const Joi = require('joi');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// `eventDate` payloads carry a date only (no time-of-day), so comparing them
// against the exact current instant (Joi's 'now' ref) rejects *today* itself
// for anything requested after midnight — e.g. dragging a booking onto today's
// column in the Command Center matrix, or a same-day walk-in booking, would
// fail validation with "date must be greater than or equal to now" every
// single time. Validate against the start of today instead (computed fresh on
// every request, not once at schema-build time), so today stays valid and
// only genuinely past dates are rejected.
const notBeforeToday = (value, helpers) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (new Date(value) < startOfToday) {
        return helpers.error('date.min', { limit: 'today' });
    }
    return value;
};
const futureDate = () => Joi.date().iso().custom(notBeforeToday, 'not before today');

const eventDetailFields = {
    theme:            Joi.string().max(200).optional(),
    decorationNotes:  Joi.string().max(1000).optional(),
    staffCount:       Joi.number().integer().min(0).optional(),
    eventEndDate:     Joi.date().iso().optional(),
    setupMinutes:     Joi.number().integer().min(0).max(1440).optional(),
    cleanupMinutes:   Joi.number().integer().min(0).max(1440).optional(),
    cooloffMinutes:   Joi.number().integer().min(0).max(1440).optional(),
    cleanupCharge:    Joi.number().precision(2).min(0).optional(),
    lateExitCharge:   Joi.number().precision(2).min(0).optional(),
    setupCharge:          Joi.number().precision(2).min(0).optional(),
    decorationCharge:     Joi.number().precision(2).min(0).optional(),
    cleaningCharge:       Joi.number().precision(2).min(0).optional(),
    extendedUsageCharge:  Joi.number().precision(2).min(0).optional(),
    cooloffCharge:        Joi.number().precision(2).min(0).optional(),
    cateringPackageId:     Joi.number().integer().positive().allow(null).optional(),
    cateringPricePerPlate: Joi.number().precision(2).min(0).optional(),
    cateringTaxAmount:     Joi.number().precision(2).min(0).optional(),
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
    eventDate:      futureDate().required(),
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
    packageId:      Joi.number().integer().positive().optional(),
    couponCode:     Joi.string().max(50).optional(),
    subtotal:       Joi.number().precision(2).min(0).optional(),
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
    packageId:  Joi.number().integer().positive().allow(null).optional(),
    ...eventDetailFields,
});

const rescheduleSchema = Joi.object({
    eventDate:      futureDate().required(),
    eventTimeStart: Joi.string().pattern(TIME_PATTERN).required(),
    eventTimeEnd:   Joi.string().pattern(TIME_PATTERN).required(),
    eventEndDate:   Joi.date().iso().min(Joi.ref('eventDate')).optional(), // multi-day bookings only
    hallId:         Joi.number().integer().positive().optional(), // hall move (e.g. Command Center drag-and-drop)
});

const statusSchema = Joi.object({
    status: Joi.string().valid('tentative', 'confirmed', 'advance_paid', 'fully_paid', 'completed', 'archived', 'no_show').required(),
});

const cancelSchema = Joi.object({
    reason: Joi.string().max(500).optional(),
    cancellationCharge: Joi.number().precision(2).min(0).optional(),
    refundAmount:       Joi.number().precision(2).min(0).optional(),
    paymentId:          Joi.number().integer().positive().optional(),
});

const slotSchema = Joi.object({
    hallId:         Joi.number().integer().positive().required(),
    customerId:     Joi.number().integer().positive().optional(),
    eventDate:      futureDate().required(),
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
    eventDate:      futureDate().required(),
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

const resourcesSchema = Joi.object({
    resources: Joi.array().items(
        Joi.object({
            resourceId: Joi.number().integer().positive().required(),
            quantity:   Joi.number().integer().positive().required(),
        })
    ).required(),
});

const decorationsSchema = Joi.object({
    decorations: Joi.array().items(
        Joi.object({
            decorationId:   Joi.number().integer().positive().required(),
            quantity:       Joi.number().integer().positive().required(),
            packageId:      Joi.number().integer().positive().optional(),
            installationAt: Joi.date().iso().optional(),
            removalAt:      Joi.date().iso().optional(),
            notes:          Joi.string().max(500).optional(),
        })
    ).required(),
});

const servicesSchema = Joi.object({
    services: Joi.array().items(
        Joi.object({
            serviceKey:       Joi.alternatives(Joi.string(), Joi.number()).optional(),
            serviceName:      Joi.string().max(150).required(),
            catalogPrice:     Joi.number().min(0).required(),
            negotiatedPrice:  Joi.number().min(0).optional(),
            discountAmount:   Joi.number().min(0).optional(),
        })
    ).required(),
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
    validateResources:    validate(resourcesSchema),
    validateDecorations:  validate(decorationsSchema),
    validateServices:     validate(servicesSchema),
};
