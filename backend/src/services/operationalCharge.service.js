/**
 * Operational Charge Service — config CRUD plus the shared calculation used
 * by booking pricing (quotation/invoice/booking summary/payment breakdown
 * all read from this single function so charges never drift out of sync).
 */

'use strict';

const chargeRepo = require('../repositories/operationalCharge.repository');
const { ValidationError } = require('../api/v1/middleware/errorHandler');

const CALC_METHODS = ['fixed', 'hourly', 'percentage', 'complimentary'];

const list = (companyId) => chargeRepo.list(companyId);

const upsert = async (companyId, chargeType, data) => {
    if (!chargeRepo.CHARGE_TYPES.includes(chargeType)) {
        throw new ValidationError(`charge_type must be one of: ${chargeRepo.CHARGE_TYPES.join(', ')}`);
    }
    if (data.calcMethod && !CALC_METHODS.includes(data.calcMethod)) {
        throw new ValidationError(`calc_method must be one of: ${CALC_METHODS.join(', ')}`);
    }
    return chargeRepo.upsert(companyId, chargeType, data);
};

/**
 * Compute one charge given its config and the relevant duration/base amount.
 * - fixed:         rate_value as a flat amount
 * - hourly:        rate_value * hours (hours derived from booking's buffer minutes)
 * - percentage:    rate_value% of the booking's total_amount
 * - complimentary: always 0
 */
const computeCharge = (config, { hours = 0, baseAmount = 0 }) => {
    if (!config || !config.is_active) return 0;
    switch (config.calc_method) {
        case 'fixed':      return Number(config.rate_value);
        case 'hourly':     return Number((config.rate_value * hours).toFixed(2));
        case 'percentage': return Number((baseAmount * config.rate_value / 100).toFixed(2));
        case 'complimentary':
        default:           return 0;
    }
};

/**
 * Full operational-charge breakdown for a booking — used by the wizard's
 * live price preview, the quotation, the invoice, and the payment breakdown,
 * so all four always agree.
 */
const calculateBookingCharges = async (companyId, { setupMinutes, cleanupMinutes, cooloffMinutes, lateExitHours, extendedUsageHours, totalAmount }) => {
    const config = await chargeRepo.getEffectiveConfig(companyId);
    const breakdown = {
        setup:           computeCharge(config.setup,           { hours: (setupMinutes || 0) / 60,   baseAmount: totalAmount }),
        decoration:      computeCharge(config.decoration,      { hours: 0,                          baseAmount: totalAmount }),
        cleanup:         computeCharge(config.cleanup,         { hours: (cleanupMinutes || 0) / 60,  baseAmount: totalAmount }),
        cleaning:        computeCharge(config.cleaning,        { hours: (cleanupMinutes || 0) / 60,  baseAmount: totalAmount }),
        late_exit:       computeCharge(config.late_exit,       { hours: lateExitHours || 0,          baseAmount: totalAmount }),
        extended_usage:  computeCharge(config.extended_usage,  { hours: extendedUsageHours || 0,     baseAmount: totalAmount }),
        cooloff:         computeCharge(config.cooloff,         { hours: (cooloffMinutes || 0) / 60,  baseAmount: totalAmount }),
    };
    breakdown.total = Number(Object.values(breakdown).reduce((s, v) => s + v, 0).toFixed(2));
    return breakdown;
};

module.exports = { list, upsert, computeCharge, calculateBookingCharges, CALC_METHODS, CHARGE_TYPES: chargeRepo.CHARGE_TYPES };
