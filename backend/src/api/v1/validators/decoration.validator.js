/**
 * Decoration Validators — Joi schemas
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

const itemCreateSchema = Joi.object({
    decorationName: Joi.string().max(200).required(),
    categoryId:     Joi.number().integer().positive().allow(null),
    theme:          Joi.string().max(100).allow('', null),
    colorScheme:    Joi.string().max(100).allow('', null),
    vendor:         Joi.string().max(150).allow('', null),
    unit:           Joi.string().max(30).allow('', null),
    quantityAvailable: Joi.number().integer().min(0),
    unitCost:          Joi.number().precision(2).min(0),
    rentalPrice:       Joi.number().precision(2).min(0),
    installationCost:  Joi.number().precision(2).min(0),
    removalCost:       Joi.number().precision(2).min(0),
    taxPercent:        Joi.number().min(0).max(100),
    discountPercent:   Joi.number().min(0).max(100),
}).unknown(true);

const itemUpdateSchema = Joi.object({
    decorationName: Joi.string().max(200),
    quantityAvailable: Joi.number().integer().min(0),
    unitCost:          Joi.number().precision(2).min(0),
    rentalPrice:       Joi.number().precision(2).min(0),
    installationCost:  Joi.number().precision(2).min(0),
    removalCost:       Joi.number().precision(2).min(0),
    taxPercent:        Joi.number().min(0).max(100),
    discountPercent:   Joi.number().min(0).max(100),
    isActive:          Joi.boolean(),
}).unknown(true);

const packageCreateSchema = Joi.object({
    packageName: Joi.string().max(150).required(),
    theme:       Joi.string().max(100).allow('', null),
    flatPrice:   Joi.number().precision(2).min(0).allow(null),
}).unknown(true);

const packageUpdateSchema = Joi.object({
    packageName: Joi.string().max(150),
    theme:       Joi.string().max(100).allow('', null),
    flatPrice:   Joi.number().precision(2).min(0).allow(null),
    isActive:    Joi.boolean(),
}).unknown(true);

const packageItemSchema = Joi.object({
    decorationId: Joi.number().integer().positive().required(),
    quantity:     Joi.number().integer().positive(),
}).unknown(true);

module.exports = {
    validateCreateItem:    validate(itemCreateSchema),
    validateUpdateItem:    validate(itemUpdateSchema),
    validateCreatePackage: validate(packageCreateSchema),
    validateUpdatePackage: validate(packageUpdateSchema),
    validatePackageItem:   validate(packageItemSchema),
};
