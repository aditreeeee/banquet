/**
 * Marketing Automation Validators
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

const sendSchema = Joi.object({
    leadId:       Joi.number().integer().positive().optional(),
    customerId:   Joi.number().integer().positive().optional(),
    campaignType: Joi.string().valid(
        'flyer', 'discount', 'festival_offer', 'wedding_package', 'anniversary_package', 'birthday_package'
    ).required(),
    subject: Joi.string().max(200).optional(),
    message: Joi.string().max(4000).required(),
    attachmentUrl:  Joi.string().uri({ relativeOnly: true }).max(500).optional(),
    attachmentName: Joi.string().max(255).optional(),
    websiteUrl:     Joi.string().uri().max(500).optional(),
    socialLinks:    Joi.array().items(Joi.string().uri().max(300)).max(10).optional(),
}).or('leadId', 'customerId');

module.exports = { validateSend: validate(sendSchema) };
