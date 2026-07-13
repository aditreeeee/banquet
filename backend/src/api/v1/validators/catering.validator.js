/**
 * Catering Validators — Joi schemas
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

const createPackageSchema = Joi.object({
    packageName:   Joi.string().max(150).required(),
    packageType:   Joi.string().valid('veg', 'non_veg', 'jain', 'mixed').required(),
    description:   Joi.string().max(1000).allow('', null),
    pricePerPlate: Joi.number().precision(2).min(0),
    minPlates:     Joi.number().integer().min(0),
}).unknown(true);

const addItemSchema = Joi.object({
    itemId:           Joi.number().integer().positive().required(),
    quantityPerPlate: Joi.number().positive().required(),
}).unknown(true);

module.exports = {
    validateCreatePackage: validate(createPackageSchema),
    validateAddItem:       validate(addItemSchema),
};
