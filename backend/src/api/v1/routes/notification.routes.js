/**
 * Notification Routes — /api/v1/notifications
 */
'use strict';

const { Router }       = require('express');
const { executeQuery } = require('../../../config/database');
const response         = require('../../../utils/response');

const router = Router();

// Get user's notifications
router.get('/', async (req, res) => {
    const rows = await executeQuery(
        `SELECT TOP 50 notification_id, title, body, is_read, notification_type, created_at
         FROM Notifications
         WHERE user_id = @userId
         ORDER BY created_at DESC`,
        { userId: req.user.user_id }
    );
    return response.success(res, rows);
});

// Mark single notification as read
router.patch('/:id/read', async (req, res) => {
    await executeQuery(
        `UPDATE Notifications SET is_read = 1, read_at = GETUTCDATE()
         WHERE notification_id = @id AND user_id = @userId`,
        {
            id:     parseInt(req.params.id, 10),
            userId: req.user.user_id,
        }
    );
    return response.success(res, null, 'Notification marked as read');
});

// Mark all as read
router.patch('/mark-all-read', async (req, res) => {
    await executeQuery(
        `UPDATE Notifications SET is_read = 1, read_at = GETUTCDATE()
         WHERE user_id = @userId AND is_read = 0`,
        { userId: req.user.user_id }
    );
    return response.success(res, null, 'All notifications marked as read');
});

module.exports = router;
