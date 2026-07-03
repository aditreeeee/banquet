/**
 * Auth Validators — Joi schemas for all auth endpoints
 */

'use strict';

const Joi = require('joi');

const password = Joi.string()
    .min(8).max(72)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .messages({
        'string.pattern.base': 'Password must contain uppercase, lowercase, and a number',
        'string.min':          'Password must be at least 8 characters',
    });

const schemas = {
    login: Joi.object({
        email:      Joi.string().email().lowercase().trim().required(),
        password:   Joi.string().required(),
        remember_me: Joi.boolean().default(false),
    }),

    forgotPassword: Joi.object({
        email: Joi.string().email().lowercase().trim().required(),
    }),

    resetPassword: Joi.object({
        token:            Joi.string().hex().length(64).required(),
        password:         password.required(),
        confirm_password: Joi.any().valid(Joi.ref('password')).required()
            .messages({ 'any.only': 'Passwords do not match' }),
    }),

    changePassword: Joi.object({
        current_password: Joi.string().required(),
        new_password:     password.required(),
        confirm_password: Joi.any().valid(Joi.ref('new_password')).required()
            .messages({ 'any.only': 'Passwords do not match' }),
    }),

    refreshToken: Joi.object({
        refresh_token: Joi.string().required(),
    }),
};

/**
 * Validate middleware factory
 * Validates req.body against a named schema; calls next(err) on failure
 */
const validate = (schemaName) => (req, res, next) => {
    const { error, value } = schemas[schemaName].validate(req.body, {
        abortEarly:  false,
        stripUnknown: true,
    });

    if (error) {
        const { ValidationError } = require('../middleware/errorHandler');
        const errors = error.details.map(d => ({
            field:   d.context?.key || d.path.join('.'),
            message: d.message,
        }));
        return next(new ValidationError('Validation failed', errors));
    }

    req.body = value; // sanitized values
    next();
};

module.exports = { schemas, validate };
