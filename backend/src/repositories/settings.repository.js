/**
 * Settings Repository — CompanySettings key/value store (tenant-scoped)
 */
'use strict';

const { executeQuery } = require('../config/database');

const findAll = async (companyId) => {
    return executeQuery(
        `SELECT setting_key, setting_value, setting_group
         FROM CompanySettings WHERE company_id = @companyId ORDER BY setting_group, setting_key`,
        { companyId }
    );
};

/** Flat { key: value } map for a company — used by other services that need
    to read a handful of settings (e.g. booking defaults, tax rates). */
const findAsMap = async (companyId) => {
    const rows = await findAll(companyId);
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    return map;
};

const findOne = async (companyId, key) => {
    const rows = await executeQuery(
        `SELECT setting_value FROM CompanySettings WHERE company_id = @companyId AND setting_key = @key`,
        { companyId, key }
    );
    return rows[0]?.setting_value ?? null;
};

const upsert = async (companyId, key, value, group) => {
    await executeQuery(
        `MERGE INTO CompanySettings AS target
         USING (SELECT @companyId AS company_id, @key AS setting_key) AS src
             ON target.company_id = src.company_id AND target.setting_key = src.setting_key
         WHEN MATCHED THEN
             UPDATE SET setting_value = @value
         WHEN NOT MATCHED THEN
             INSERT (company_id, setting_key, setting_value, setting_group)
             VALUES (@companyId, @key, @value, @group);`,
        { companyId, key, value: String(value), group: group || 'general' }
    );
};

module.exports = { findAll, findAsMap, findOne, upsert };
