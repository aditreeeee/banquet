/**
 * Payment Validators — Joi schemas
 */
'use strict';

const Joi = require('joi');
const { ValidationError } = require('../middleware/errorHandler');

const validate = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
        const errors = error.details.map(d => ({ field: d.context?.key || d.path.join('.'), message: d.message }));
        return next(new ValidationError('Validation failed', errors));
    }
    req.body = value;
    next();
};

// payment.service.js accepts both camelCase (programmatic callers) and
// snake_case (the Payments page's plain <form>) for the same fields — the
// schema below has to allow either spelling of each field rather than
// picking one, or a legitimate request in the "wrong" casing would get its
// field stripped by stripUnknown before it ever reaches the service.
// payment_method/payment_type have no DB-level CHECK constraint (NVARCHAR(30)
// free text) and the Payments page's CSV importer forwards whatever a
// spreadsheet column contains — so these stay as bounded free text rather
// than a fixed enum, to avoid rejecting legitimate-but-unlisted values that
// worked before this validator existed. The point here is basic shape/type
// safety (a booking ID that's actually a number, an amount that's actually
// positive), not new business rules.
const createSchema = Joi.object({
    bookingId:        Joi.number().integer().positive(),
    booking_id:        Joi.number().integer().positive(),
    amount:            Joi.number().precision(2).positive().required(),
    paymentMethod:     Joi.string().max(30),
    payment_method:    Joi.string().max(30),
    paymentType:       Joi.string().max(30),
    payment_type:      Joi.string().max(30),
    referenceNumber:   Joi.string().max(100).allow('', null),
    transaction_id:    Joi.string().max(100).allow('', null),
    reference_number:  Joi.string().max(100).allow('', null),
    payment_date:      Joi.string().max(30).allow('', null), // accepted, currently ignored by the service (payment_date is derived from created_at on read)
    notes:             Joi.string().max(1000).allow('', null),
    remarks:           Joi.string().max(1000).allow('', null),
})
    .or('bookingId', 'booking_id')
    .or('paymentMethod', 'payment_method')
    .or('paymentType', 'payment_type');

const refundSchema = Joi.object({
    refundAmount: Joi.number().precision(2).positive().required(),
    reason:       Joi.string().min(1).max(500).required(),
    method:       Joi.string().max(30).optional(),
});

module.exports = {
    validateCreate: validate(createSchema),
    validateRefund: validate(refundSchema),
};
