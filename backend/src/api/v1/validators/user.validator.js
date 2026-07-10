/**
 * User Validators — Joi schemas
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

// user.service.js reads every field as `data.camelCase ?? data.snake_case`
// (the Users page submits snake_case) — both spellings have to stay
// accepted here, or stripUnknown would drop whichever one a given caller
// used before the service gets a chance to fall back to the other.
const nameAndRoleFields = {
    firstName: Joi.string().max(100),
    first_name: Joi.string().max(100),
    lastName:  Joi.string().max(100),
    last_name:  Joi.string().max(100),
    phone:      Joi.string().max(20).allow('', null),
    roleId:     Joi.number().integer().positive().allow(null),
    role_id:    Joi.number().integer().positive().allow(null),
    roleIds:    Joi.array().items(Joi.number().integer().positive()),
    role_ids:   Joi.array().items(Joi.number().integer().positive()),
    branchId:   Joi.number().integer().positive().allow(null),
    branch_id:  Joi.number().integer().positive().allow(null),
};

const createSchema = Joi.object({
    email:    Joi.string().email().max(150).required(),
    password: Joi.string().min(8).max(100).optional(),
    ...nameAndRoleFields,
})
    .or('firstName', 'first_name')
    .or('lastName', 'last_name');

const updateSchema = Joi.object({
    ...nameAndRoleFields,
    isActive: Joi.boolean(),
    status:   Joi.string().valid('active', 'inactive'),
});

module.exports = {
    validateCreate: validate(createSchema),
    validateUpdate: validate(updateSchema),
};
