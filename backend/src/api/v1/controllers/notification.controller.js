/**
 * Notification Controller — in-app notifications inbox + preferences
 */
'use strict';

const notificationRepo = require('../../../repositories/notification.repository');
const response = require('../../../utils/response');

const list = async (req, res) => {
    const unreadOnly = req.query.unread === 'true';
    const notifications = await notificationRepo.list(req.user.user_id, { unreadOnly, limit: 50 });
    return response.success(res, { notifications });
};

const getUnreadCount = async (req, res) => {
    const count = await notificationRepo.unreadCount(req.user.user_id);
    return response.success(res, { count });
};

const markRead = async (req, res) => {
    await notificationRepo.markRead(parseInt(req.params.id, 10), req.user.user_id);
    return response.success(res, null, 'Notification marked as read');
};

const markAllRead = async (req, res) => {
    await notificationRepo.markAllRead(req.user.user_id);
    return response.success(res, null, 'All notifications marked as read');
};

const getPreferences = async (req, res) => {
    const preferences = await notificationRepo.getPreferences(req.user.user_id);
    return response.success(res, preferences);
};

const updatePreferences = async (req, res) => {
    const items = Array.isArray(req.body.preferences) ? req.body.preferences : [];
    for (const p of items) {
        await notificationRepo.upsertPreference(req.user.user_id, p.category, {
            inAppEnabled: p.inAppEnabled,
            emailEnabled: p.emailEnabled,
        });
    }
    const preferences = await notificationRepo.getPreferences(req.user.user_id);
    return response.success(res, preferences, 'Notification preferences updated');
};

module.exports = { list, getUnreadCount, markRead, markAllRead, getPreferences, updatePreferences };
