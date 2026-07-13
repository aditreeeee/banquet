/**
 * Invoice Validators — Joi schemas
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
    bookingId:   Joi.number().integer().positive(),
    booking_ref: Joi.string().max(30),
}).unknown(true).or('bookingId', 'booking_ref');

module.exports = {
    validateCreate: validate(createSchema),
};
