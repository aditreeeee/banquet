/**
 * Reviews Controller
 */
'use strict';

const reviewService = require('../../../services/review.service');
const response = require('../../../utils/response');

const actor = (req) => ({ companyId: req.companyId, userId: req.user.user_id });

const getForBanquet = async (req, res) => {
    const result = await reviewService.getForBanquet(parseInt(req.params.banquetId, 10), actor(req), req.query);
    return response.success(res, result);
};

const create = async (req, res) => {
    const result = await reviewService.create(req.body, actor(req));
    return response.created(res, result, 'Review recorded');
};

module.exports = { getForBanquet, create };
