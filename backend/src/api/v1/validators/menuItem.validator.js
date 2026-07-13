/**
 * Menu Item Validators — Joi schemas
 */
'use strict';

const Joi = require('joi');
const { ValidationError } = require('../middleware/errorHandler');

const FOOD_TYPES = ['veg', 'non_veg', 'jain', 'vegan', 'mixed'];

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
    categoryId:  Joi.number().integer().positive().required(),
    itemName:    Joi.string().max(150).required(),
    description: Joi.string().max(1000).allow('', null),
    foodType:    Joi.string().valid(...FOOD_TYPES).required(),
    unit:        Joi.string().max(30).allow('', null),
    basePrice:   Joi.number().precision(2).min(0).required(),
    taxPercent:  Joi.number().min(0).max(100),
    unitCost:    Joi.number().precision(2).min(0),
}).unknown(true);

const updateSchema = Joi.object({
    itemName:    Joi.string().max(150),
    description: Joi.string().max(1000).allow('', null),
    basePrice:   Joi.number().precision(2).min(0),
    taxPercent:  Joi.number().min(0).max(100),
    unitCost:    Joi.number().precision(2).min(0),
    isActive:    Joi.boolean(),
}).unknown(true);

module.exports = {
    validateCreate: validate(createSchema),
    validateUpdate: validate(updateSchema),
};
