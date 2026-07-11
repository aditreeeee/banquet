/**
 * Audit Log Repository — writes to the shared, append-only AuditLogs table.
 * Used to build activity timelines (e.g. booking history) without a
 * per-entity activity table.
 */

'use strict';

const { executeQuery } = require('../config/database');

/**
 * Record an activity/audit entry.
 * @param {object} entry
 * @param {number} entry.companyId
 * @param {number} entry.userId
 * @param {string} entry.action       - e.g. 'booking.created', 'booking.cancelled'
 * @param {string} entry.entityType   - e.g. 'booking'
 * @param {string|number} entry.entityId
 * @param {string} [entry.description]
 * @param {object} [entry.oldValues]
 * @param {object} [entry.newValues]
 */
const log = async ({ companyId, userId, action, entityType, entityId, description, oldValues, newValues }) => {
    await executeQuery(
        `INSERT INTO AuditLogs (
            company_id, user_id, action, entity_type, entity_id,
            description, old_values, new_values, created_at
        )
        VALUES (
            @companyId, @userId, @action, @entityType, @entityId,
            @description, @oldValues, @newValues, GETUTCDATE()
        )`,
        {
            companyId,
            userId,
            action,
            entityType,
            entityId:    String(entityId),
            description: description || null,
            oldValues:   oldValues ? JSON.stringify(oldValues) : null,
            newValues:   newValues ? JSON.stringify(newValues) : null,
        }
    );
};

/**
 * Chronological activity timeline for a single entity (e.g. one booking).
 */
const findForEntity = async ({ companyId, entityType, entityId }) => {
    return executeQuery(
        `SELECT al.log_id, al.action, al.description, al.old_values, al.new_values, al.created_at,
                CASE WHEN al.user_id IS NULL THEN 'System' ELSE CONCAT(u.first_name, ' ', u.last_name) END AS user_name
         FROM AuditLogs al
         LEFT JOIN Users u ON u.user_id = al.user_id
         WHERE al.company_id = @companyId
           AND al.entity_type = @entityType
           AND al.entity_id = @entityId
         ORDER BY al.created_at ASC`,
        { companyId, entityType, entityId: String(entityId) }
    );
};

/**
 * A single user's full activity trail — their own login history plus every
 * administrative action taken ON their account (creation, role changes,
 * Company/Property/Branch reassignment, approval/rejection, deletion). Both
 * kinds share entity_type='user' + entity_id=<that user> (see
 * auth.service.js:login and every write in user.service.js), so one query
 * covers the "login history, role changes, assignments, and administrative
 * actions" a user's detail view needs.
 *
 * Deliberately NOT scoped by company_id — visibility (who is allowed to look
 * at this user's audit trail at all) is enforced by the caller
 * (user.service.js:getAuditLog) before this ever runs, exactly like
 * userRepo.findById(id, resolveCompanyScope(actor)).
 */
const findForUser = async (userId) => {
    return executeQuery(
        `SELECT al.log_id, al.action, al.description, al.old_values, al.new_values,
                al.ip_address, al.created_at,
                CASE WHEN al.user_id IS NULL THEN 'System' ELSE CONCAT(u.first_name, ' ', u.last_name) END AS actor_name
         FROM AuditLogs al
         LEFT JOIN Users u ON u.user_id = al.user_id
         WHERE al.entity_type = 'user' AND al.entity_id = @entityId
         ORDER BY al.created_at DESC`,
        { entityId: String(userId) }
    );
};

module.exports = { log, findForEntity, findForUser };
