/**
 * Settings Routes — /api/v1/settings
 */
'use strict';

const { Router }            = require('express');
const { requirePermission } = require('../middleware/auth');
const response              = require('../../../utils/response');
const { PERMISSIONS }       = require('../../../constants');
const settingsService       = require('../../../services/settings.service');

const router = Router();

// Get company settings (grouped, merged with system defaults)
router.get('/', requirePermission(PERMISSIONS.SETTINGS_READ), async (req, res) => {
    const grouped = await settingsService.getAllWithDefaults(req.companyId);
    return response.success(res, grouped);
});

// Upsert a setting
router.patch('/:key', requirePermission(PERMISSIONS.SETTINGS_UPDATE), async (req, res) => {
    const { value, group } = req.body;
    if (value === undefined) return res.status(400).json({ success: false, message: 'value required' });

    await settingsService.update(req.companyId, req.params.key, value, group, { userId: req.user.user_id });

    return response.success(res, null, 'Setting updated');
});

module.exports = router;
