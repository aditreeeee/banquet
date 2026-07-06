/**
 * Marketing Automation Controller
 */
'use strict';

const marketingService = require('../../../services/marketing.service');
const response = require('../../../utils/response');

const actor = (req) => ({ userId: req.user.user_id, companyId: req.companyId });

const send = async (req, res) => {
    const result = await marketingService.send(req.body, actor(req));
    return response.created(res, result, 'Campaign sent');
};

const getHistory = async (req, res) => {
    const { lead_id, customer_id } = req.query;
    const history = await marketingService.getHistory(
        { leadId: lead_id ? parseInt(lead_id, 10) : null, customerId: customer_id ? parseInt(customer_id, 10) : null },
        actor(req)
    );
    return response.success(res, history);
};

module.exports = { send, getHistory };
