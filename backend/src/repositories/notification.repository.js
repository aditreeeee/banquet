/**
 * Notification Repository — in-app notification records (Notifications table).
 * Distinct from notification.service.js, which sends outbound email/SMS —
 * this creates the in-app bell/inbox rows that notification.routes.js reads.
 */

'use strict';

const { executeQuery } = require('../config/database');

const create = async ({ companyId, userId, type, channel = 'in_app', title, body, referenceType, referenceId }) => {
    await executeQuery(
        `INSERT INTO Notifications (company_id, user_id, notification_type, channel, title, body, reference_type, reference_id, delivery_status, created_at)
         VALUES (@companyId, @userId, @type, @channel, @title, @body, @referenceType, @referenceId, 'sent', GETUTCDATE())`,
        {
            companyId,
            userId,
            type,
            channel,
            title,
            body,
            referenceType: referenceType || null,
            referenceId:   referenceId   || null,
        }
    );
};

/**
 * Roles considered "managers" for a company — the audience for operational
 * notifications like booking created/cancelled/hold-expired.
 */
const MANAGER_ROLE_SLUGS = ['company_admin', 'business_owner', 'branch_manager', 'operations_manager'];

const findManagerUserIds = async ({ companyId, branchId }) => {
    const rows = await executeQuery(
        `SELECT u.user_id
         FROM Users u
         JOIN Roles r ON r.role_id = u.role_id
         WHERE u.company_id = @companyId
           AND u.is_active = 1
           AND r.role_slug IN ('company_admin','business_owner','branch_manager','operations_manager')
           AND (@branchId IS NULL OR u.branch_id IS NULL OR u.branch_id = @branchId)`,
        { companyId, branchId: branchId || null }
    );
    return rows.map(r => r.user_id);
};

/**
 * Notify all managers of a company (optionally scoped to a branch) about an
 * operational event — booking created/cancelled/hold expired, etc.
 */
const notifyManagers = async ({ companyId, branchId, type, title, body, referenceType, referenceId, excludeUserId }) => {
    const userIds = (await findManagerUserIds({ companyId, branchId }))
        .filter(id => id !== excludeUserId);
    if (!userIds.length) return;

    // Single multi-row INSERT instead of one round trip per manager.
    const params = { companyId, type, title, body, referenceType: referenceType || null, referenceId: referenceId || null };
    const valueRows = userIds.map((id, i) => {
        params[`u${i}`] = id;
        return `(@companyId, @u${i}, @type, 'in_app', @title, @body, @referenceType, @referenceId, 'sent', GETUTCDATE())`;
    });

    await executeQuery(
        `INSERT INTO Notifications (company_id, user_id, notification_type, channel, title, body, reference_type, reference_id, delivery_status, created_at)
         VALUES ${valueRows.join(', ')}`,
        params
    );
};

module.exports = { create, notifyManagers, findManagerUserIds };
