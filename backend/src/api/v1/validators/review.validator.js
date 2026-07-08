/**
 * Reviews Validators
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
    bookingId:      Joi.number().integer().positive().required(),
    rating:         Joi.number().integer().min(1).max(5).required(),
    title:          Joi.string().max(150).optional(),
    reviewText:     Joi.string().max(2000).optional(),
    venueRating:    Joi.number().integer().min(1).max(5).optional(),
    serviceRating:  Joi.number().integer().min(1).max(5).optional(),
    cateringRating: Joi.number().integer().min(1).max(5).optional(),
    valueRating:    Joi.number().integer().min(1).max(5).optional(),
});

module.exports = { validateCreate: validate(createSchema) };
