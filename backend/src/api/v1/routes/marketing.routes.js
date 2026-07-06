/**
 * Marketing Automation Routes — /api/v1/marketing
 */
'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/marketing.controller');
const v = require('../validators/marketing.validator');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../../../constants');

const router = Router();

router.get('/history',  requirePermission(PERMISSIONS.MARKETING_READ), ctrl.getHistory);
router.post('/send',    requirePermission(PERMISSIONS.MARKETING_SEND), v.validateSend, ctrl.send);

module.exports = router;
