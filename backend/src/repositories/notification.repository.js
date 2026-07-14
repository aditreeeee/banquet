/**
 * Notification Repository — in-app notification records (Notifications
 * table) plus per-user/per-category channel preferences
 * (NotificationPreferences). Distinct from notification.service.js, which
 * sends outbound email — this creates/reads the in-app bell/inbox rows and
 * decides who is eligible to receive a given category of event (RBAC).
 */

'use strict';

const { executeQuery } = require('../config/database');

/**
 * Roles eligible for each notification category — write-time RBAC
 * enforcement (each recipient gets their own row, so there's no read-time
 * filtering to get wrong later). Org-unit scoping (company/branch/property)
 * is applied on top of this in resolveRecipients, not here.
 *
 * super_admin is deliberately never listed — resolveRecipients always
 * includes every super_admin regardless of category ("Super Admin: All
 * notifications").
 */
const CATEGORY_ROLES = {
    booking:          ['company_admin', 'business_owner', 'branch_manager', 'operations_manager', 'sales_manager', 'booking_executive', 'receptionist', 'staff'],
    lead:             ['company_admin', 'business_owner', 'branch_manager', 'sales_manager', 'booking_executive', 'receptionist'],
    quotation:        ['company_admin', 'business_owner', 'branch_manager', 'sales_manager', 'booking_executive', 'receptionist'],
    payment:          ['company_admin', 'business_owner', 'branch_manager', 'finance_manager'],
    invoice:          ['company_admin', 'business_owner', 'branch_manager', 'finance_manager'],
    refund:           ['company_admin', 'business_owner', 'branch_manager', 'finance_manager'],
    cancellation:     ['company_admin', 'business_owner', 'branch_manager', 'operations_manager', 'sales_manager', 'booking_executive', 'receptionist', 'staff'],
    staff_assignment: ['company_admin', 'business_owner', 'branch_manager', 'operations_manager', 'staff'],
    inventory:        ['company_admin', 'business_owner', 'branch_manager', 'operations_manager', 'staff'],
    approval:         ['company_admin', 'business_owner'],
    user_management:  ['company_admin', 'business_owner'],
};

const CATEGORIES = Object.keys(CATEGORY_ROLES);

/**
 * Resolve which users should receive a notification for a given category +
 * org scope. RBAC rules enforced here:
 *   - Super Admin always included (sees everything, every tenant).
 *   - Everyone else must belong to the same company, hold a role listed for
 *     this category, AND — if they have a branch/property assignment — that
 *     assignment must match the event's branch/property (a company-wide
 *     manager with no branch_id/property_id set still sees it; a
 *     Branch/Property Manager scoped to a different unit does not).
 */
const resolveRecipients = async ({ companyId, branchId, propertyId, category, excludeUserId }) => {
    const roles = CATEGORY_ROLES[category] || [];
    if (!companyId || !roles.length) return [];
    const rows = await executeQuery(
        `SELECT u.user_id, u.email, u.first_name, u.last_name
         FROM Users u
         JOIN Roles r ON r.role_id = u.role_id
         WHERE u.is_active = 1 AND u.deleted_at IS NULL
           AND (@excludeUserId IS NULL OR u.user_id <> @excludeUserId)
           AND (
                r.role_slug = 'super_admin'
                OR (
                    u.company_id = @companyId
                    AND r.role_slug IN (${roles.map((_, i) => `@r${i}`).join(',')})
                    AND (u.branch_id IS NULL OR @branchId IS NULL OR u.branch_id = @branchId)
                    AND (u.property_id IS NULL OR @propertyId IS NULL OR u.property_id = @propertyId)
                )
           )`,
        {
            companyId, branchId: branchId || null, propertyId: propertyId || null,
            excludeUserId: excludeUserId || null,
            ...roles.reduce((p, slug, i) => ({ ...p, [`r${i}`]: slug }), {}),
        }
    );
    return rows;
};

/**
 * Per-(user, category) channel preferences for the given user list — used
 * by notify.service.js to decide, per recipient, whether to write the
 * in-app row and/or send an email. No row for (user, category) means
 * "both enabled" (the default).
 */
const getPreferencesForUsers = async (userIds, category) => {
    if (!userIds.length) return new Map();
    const rows = await executeQuery(
        `SELECT user_id, in_app_enabled, email_enabled
         FROM NotificationPreferences
         WHERE category = @category AND user_id IN (${userIds.map((_, i) => `@u${i}`).join(',')})`,
        { category, ...userIds.reduce((p, id, i) => ({ ...p, [`u${i}`]: id }), {}) }
    );
    return new Map(rows.map(r => [r.user_id, r]));
};

const getPreferences = async (userId) => {
    const rows = await executeQuery(
        `SELECT category, in_app_enabled, email_enabled FROM NotificationPreferences WHERE user_id = @userId`,
        { userId }
    );
    const byCategory = new Map(rows.map(r => [r.category, r]));
    // Every category is always represented, defaulting to both-enabled, so
    // the settings UI never has to guess what an absent row means.
    return CATEGORIES.map(category => byCategory.get(category) || { category, in_app_enabled: true, email_enabled: true });
};

const upsertPreference = async (userId, category, { inAppEnabled, emailEnabled }) => {
    if (!CATEGORIES.includes(category)) return;
    await executeQuery(
        `MERGE NotificationPreferences AS target
         USING (SELECT @userId AS user_id, @category AS category) AS src
         ON target.user_id = src.user_id AND target.category = src.category
         WHEN MATCHED THEN
             UPDATE SET in_app_enabled = @inAppEnabled, email_enabled = @emailEnabled, updated_at = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN
             INSERT (user_id, category, in_app_enabled, email_enabled, updated_at)
             VALUES (@userId, @category, @inAppEnabled, @emailEnabled, SYSUTCDATETIME());`,
        { userId, category, inAppEnabled: inAppEnabled !== false, emailEnabled: emailEnabled !== false }
    );
};

/**
 * Create one in-app notification row. dedupeKey (when given) makes this
 * idempotent per-user via UQ_notif_user_dedupe — a retried event silently
 * no-ops instead of creating a duplicate row.
 */
const create = async ({ companyId, branchId, propertyId, userId, category, type, channel = 'in_app', title, body, referenceType, referenceId, dedupeKey }) => {
    if (dedupeKey) {
        const exists = await executeQuery(
            `SELECT 1 AS x FROM Notifications WHERE user_id = @userId AND dedupe_key = @dedupeKey`,
            { userId, dedupeKey }
        );
        if (exists.length) return null;
    }
    const result = await executeQuery(
        `INSERT INTO Notifications
            (company_id, branch_id, property_id, user_id, category, notification_type, channel, title, body, reference_type, reference_id, dedupe_key, delivery_status, created_at)
         OUTPUT INSERTED.notification_id AS id
         VALUES
            (@companyId, @branchId, @propertyId, @userId, @category, @type, @channel, @title, @body, @referenceType, @referenceId, @dedupeKey, 'sent', GETUTCDATE())`,
        {
            companyId, branchId: branchId || null, propertyId: propertyId || null,
            userId, category: category || null, type, channel, title, body,
            referenceType: referenceType || null, referenceId: referenceId || null,
            dedupeKey: dedupeKey || null,
        }
    );
    return result[0].id;
};

const markEmailSent = async (notificationId) => {
    await executeQuery(
        `UPDATE Notifications SET email_sent = 1, email_sent_at = SYSUTCDATETIME() WHERE notification_id = @id`,
        { id: notificationId }
    );
};

const list = async (userId, { unreadOnly, limit } = {}) => {
    return executeQuery(
        `SELECT TOP (@limit) notification_id, category, notification_type, title, body,
                reference_type, reference_id, is_read, read_at, created_at
         FROM Notifications
         WHERE user_id = @userId ${unreadOnly ? 'AND is_read = 0' : ''}
         ORDER BY created_at DESC`,
        { userId, limit: limit || 50 }
    );
};

const unreadCount = async (userId) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS cnt FROM Notifications WHERE user_id = @userId AND is_read = 0`,
        { userId }
    );
    return rows[0].cnt;
};

const markRead = async (notificationId, userId) => {
    await executeQuery(
        `UPDATE Notifications SET is_read = 1, read_at = GETUTCDATE()
         WHERE notification_id = @id AND user_id = @userId`,
        { id: notificationId, userId }
    );
};

const markAllRead = async (userId) => {
    await executeQuery(
        `UPDATE Notifications SET is_read = 1, read_at = GETUTCDATE()
         WHERE user_id = @userId AND is_read = 0`,
        { userId }
    );
};

module.exports = {
    CATEGORIES,
    resolveRecipients,
    getPreferencesForUsers,
    getPreferences,
    upsertPreference,
    create,
    markEmailSent,
    list,
    unreadCount,
    markRead,
    markAllRead,
};
