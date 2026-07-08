/**
 * Marketing Automation Routes — /api/v1/marketing
 */
'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/marketing.controller');
const v = require('../validators/marketing.validator');
const { requirePermission } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { PERMISSIONS } = require('../../../constants');

const router = Router();

router.get('/history',  requirePermission(PERMISSIONS.MARKETING_READ), ctrl.getHistory);
router.post('/upload',  requirePermission(PERMISSIONS.MARKETING_SEND), upload.single('file'), ctrl.uploadAttachment);
router.post('/send',    requirePermission(PERMISSIONS.MARKETING_SEND), v.validateSend, ctrl.send);

module.exports = router;
