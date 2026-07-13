/**
 * Operational Charge Controller
 */
'use strict';

const chargeService = require('../../../services/operationalCharge.service');
const response       = require('../../../utils/response');

const list = async (req, res) => {
    const configs = await chargeService.list(req.companyId);
    return response.success(res, configs);
};

const upsert = async (req, res) => {
    const { calcMethod, rateValue, isActive } = req.body;
    const config = await chargeService.upsert(req.companyId, req.params.chargeType, { calcMethod, rateValue, isActive }, req.user.user_id);
    return response.success(res, config, 'Operational charge config saved');
};

const calculate = async (req, res) => {
    const breakdown = await chargeService.calculateBookingCharges(req.companyId, {
        setupMinutes:       parseInt(req.query.setup_minutes, 10)       || 0,
        cleanupMinutes:      parseInt(req.query.cleanup_minutes, 10)     || 0,
        cooloffMinutes:      parseInt(req.query.cooloff_minutes, 10)     || 0,
        lateExitHours:       parseFloat(req.query.late_exit_hours)       || 0,
        extendedUsageHours:  parseFloat(req.query.extended_usage_hours)  || 0,
        totalAmount:         parseFloat(req.query.total_amount)          || 0,
    });
    return response.success(res, breakdown);
};

module.exports = { list, upsert, calculate };
