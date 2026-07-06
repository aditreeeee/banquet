/**
 * Operational Charge Config Repository — per-company configurable charges
 * (Setup / Decoration / Cleanup / Cleaning / Late Exit / Extended Hall Usage / Cool-Off),
 * each configurable as fixed / hourly / percentage / complimentary.
 */

'use strict';

const { executeQuery } = require('../config/database');

const CHARGE_TYPES = ['setup', 'decoration', 'cleanup', 'cleaning', 'late_exit', 'extended_usage', 'cooloff'];

const list = async (companyId) => {
    return executeQuery(
        `SELECT config_id, charge_type, calc_method, rate_value, is_active
         FROM OperationalChargeConfig WHERE company_id = @companyId ORDER BY charge_type`,
        { companyId }
    );
};

/** Every charge type the company hasn't configured defaults to complimentary (0). */
const getEffectiveConfig = async (companyId) => {
    const rows = await list(companyId);
    const byType = {};
    rows.forEach(r => { byType[r.charge_type] = r; });
    return CHARGE_TYPES.reduce((acc, type) => {
        acc[type] = byType[type] || { charge_type: type, calc_method: 'complimentary', rate_value: 0, is_active: true };
        return acc;
    }, {});
};

const upsert = async (companyId, chargeType, { calcMethod, rateValue, isActive }) => {
    await executeQuery(
        `MERGE OperationalChargeConfig AS target
         USING (SELECT @companyId AS company_id, @chargeType AS charge_type) AS src
         ON target.company_id = src.company_id AND target.charge_type = src.charge_type
         WHEN MATCHED THEN UPDATE SET calc_method = @calcMethod, rate_value = @rateValue,
             is_active = @isActive, updated_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (company_id, charge_type, calc_method, rate_value, is_active, updated_at)
             VALUES (@companyId, @chargeType, @calcMethod, @rateValue, @isActive, SYSUTCDATETIME());`,
        {
            companyId, chargeType,
            calcMethod: calcMethod || 'complimentary',
            rateValue: rateValue || 0,
            isActive: isActive != null ? isActive : true,
        }
    );
    const rows = await executeQuery(
        `SELECT config_id, charge_type, calc_method, rate_value, is_active
         FROM OperationalChargeConfig WHERE company_id = @companyId AND charge_type = @chargeType`,
        { companyId, chargeType }
    );
    return rows[0];
};

module.exports = { CHARGE_TYPES, list, getEffectiveConfig, upsert };
