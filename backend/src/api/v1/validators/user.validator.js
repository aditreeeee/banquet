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
    // Only a Super Admin's request may actually change these (enforced in
    // user.service.js:resolveOrgAssignment) — accepted here for everyone so
    // Joi's stripUnknown doesn't drop the field before the service gets a
    // chance to validate + reject it for non-super-admin callers.
    companyId:  Joi.number().integer().positive().allow(null),
    company_id: Joi.number().integer().positive().allow(null),
    // Staff profile fields (see database/migrations/017_staff_profile.sql) —
    // Users ARE staff when given an operational role, no separate Staff table.
    employeeCode:  Joi.string().max(20).allow('', null),
    department:    Joi.string().max(50).allow('', null),
    designation:   Joi.string().max(100).allow('', null),
    propertyId:    Joi.number().integer().positive().allow(null),
    availabilityStatus: Joi.string().valid('available', 'on_duty', 'on_leave', 'off_duty'),
    employmentStatus:   Joi.string().valid('active', 'on_leave', 'resigned', 'terminated'),
    joiningDate:   Joi.date().allow('', null),
    skills:        Joi.string().max(500).allow('', null),
    certifications: Joi.string().max(500).allow('', null),
    emergencyContactName:  Joi.string().max(150).allow('', null),
    emergencyContactPhone: Joi.string().max(20).allow('', null),
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
