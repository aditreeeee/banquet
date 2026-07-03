/**
 * Settings Routes — /api/v1/settings
 */
'use strict';

const { Router }            = require('express');
const { requirePermission } = require('../middleware/auth');
const { executeQuery }      = require('../../../config/database');
const response              = require('../../../utils/response');
const { PERMISSIONS }       = require('../../../constants');

const router = Router();

// Get company settings
router.get('/', requirePermission(PERMISSIONS.SETTINGS_READ), async (req, res) => {
    const rows = await executeQuery(
        `SELECT setting_key, setting_value, setting_group
         FROM CompanySettings WHERE company_id = @companyId ORDER BY setting_group, setting_key`,
        { companyId: req.companyId }
    );

    // Group by setting_group for cleaner response
    const grouped = {};
    for (const row of rows) {
        if (!grouped[row.setting_group]) grouped[row.setting_group] = {};
        grouped[row.setting_group][row.setting_key] = row.setting_value;
    }

    return response.success(res, grouped);
});

// Upsert a setting (MySQL INSERT ... ON DUPLICATE KEY UPDATE)
router.patch('/:key', requirePermission(PERMISSIONS.SETTINGS_UPDATE), async (req, res) => {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ success: false, message: 'value required' });

    await executeQuery(
        `MERGE INTO CompanySettings AS target
         USING (SELECT @companyId AS company_id, @key AS setting_key) AS src
             ON target.company_id = src.company_id AND target.setting_key = src.setting_key
         WHEN MATCHED THEN
             UPDATE SET setting_value = @value
         WHEN NOT MATCHED THEN
             INSERT (company_id, setting_key, setting_value, setting_group)
             VALUES (@companyId, @key, @value, 'general');`,
        {
            companyId: req.companyId,
            key:       req.params.key,
            value:     String(value),
        }
    );

    return response.success(res, null, 'Setting updated');
});

module.exports = router;
