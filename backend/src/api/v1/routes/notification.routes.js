/**
 * Notification Routes — /api/v1/notifications
 */
'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/notification.controller');

const router = Router();

router.get('/',                  ctrl.list);
router.get('/unread-count',      ctrl.getUnreadCount);
router.patch('/:id/read',        ctrl.markRead);
router.patch('/mark-all-read',   ctrl.markAllRead);
router.get('/preferences',       ctrl.getPreferences);
router.put('/preferences',       ctrl.updatePreferences);

module.exports = router;
