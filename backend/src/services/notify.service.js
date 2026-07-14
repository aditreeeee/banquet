/**
 * Notify Service — the single entry point for raising an in-app + email
 * notification for a business event. Every category listed in the RBAC spec
 * (bookings, leads, quotations, payments, invoices, refunds, cancellations,
 * staff assignments, inventory alerts, approvals, user management) should
 * call notify() rather than writing to Notifications directly, so RBAC
 * scoping, dedupe, and preference checks are enforced exactly once.
 */
'use strict';

const notificationRepo = require('../repositories/notification.repository');
const emailService = require('./notification.service');
const { executeQuery } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Raise a notification for an event.
 *
 * @param {object} opts
 * @param {number} opts.companyId
 * @param {number|null} [opts.branchId] - scopes Branch Manager visibility
 * @param {number|null} [opts.propertyId] - scopes Property Manager visibility (Banquets.banquet_id)
 * @param {string} opts.category - one of notificationRepo.CATEGORIES
 * @param {string} opts.type - short machine-readable event type, e.g. 'booking.created'
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.referenceType] - e.g. 'booking'
 * @param {number} [opts.referenceId]
 * @param {number[]} [opts.specificUserIds] - always-included recipients (e.g. the
 *   staff member being assigned, or the user whose account was approved) —
 *   merged with the role-resolved audience, still subject to their own
 *   preferences and dedupe.
 * @param {number} [opts.excludeUserId] - the actor who caused the event, so they
 *   don't get notified about their own action (unless also in specificUserIds).
 * @param {string} [opts.emailSubject] - defaults to title
 * @param {string} [opts.emailHtml] - defaults to a plain wrapper around body
 */
const notify = async ({
    companyId, branchId, propertyId, category, type, title, body,
    referenceType, referenceId, specificUserIds = [], excludeUserId,
    emailSubject, emailHtml, dedupeKeySuffix,
}) => {
    if (!notificationRepo.CATEGORIES.includes(category)) {
        logger.warn('notify() called with unknown category', { category, type });
        return;
    }

    const roleResolved = await notificationRepo.resolveRecipients({ companyId, branchId, propertyId, category, excludeUserId });
    const byId = new Map(roleResolved.map(u => [u.user_id, u]));

    // specificUserIds are always included (subject to their own preferences),
    // even if their role wouldn't otherwise see this category — e.g. a
    // booking_executive being personally assigned to a booking as staff.
    // Their email isn't known from the role query, so look it up.
    const missingIds = specificUserIds.filter(id => id && id !== excludeUserId && !byId.has(id));
    if (missingIds.length) {
        const rows = await executeQuery(
            `SELECT user_id, email, first_name, last_name FROM Users
             WHERE user_id IN (${missingIds.map((_, i) => `@u${i}`).join(',')}) AND is_active = 1 AND deleted_at IS NULL`,
            missingIds.reduce((p, id, i) => ({ ...p, [`u${i}`]: id }), {})
        );
        rows.forEach(u => byId.set(u.user_id, u));
    }
    if (!byId.size) return;

    const recipients = [...byId.values()];
    const userIds = recipients.map(r => r.user_id);
    const prefs = await notificationRepo.getPreferencesForUsers(userIds, category);
    const dedupeKey = referenceType && referenceId
        ? `${category}:${type}:${referenceType}:${referenceId}${dedupeKeySuffix ? `:${dedupeKeySuffix}` : ''}`
        : null;

    for (const recipient of recipients) {
        const pref = prefs.get(recipient.user_id);
        const inAppEnabled = pref ? pref.in_app_enabled : true;
        const emailEnabled = pref ? pref.email_enabled : true;

        let notificationId = null;
        if (inAppEnabled) {
            try {
                notificationId = await notificationRepo.create({
                    companyId, branchId, propertyId, userId: recipient.user_id,
                    category, type, title, body, referenceType, referenceId, dedupeKey,
                });
            } catch (err) {
                logger.warn('In-app notification create failed', { userId: recipient.user_id, category, type, error: err.message });
            }
        }

        // Only known if we didn't dedupe it out above, so skipped duplicates
        // never send a duplicate email either.
        if (emailEnabled && notificationId && recipient.email) {
            emailService.sendGenericEmail({
                to: recipient.email,
                subject: emailSubject || title,
                html: emailHtml || `<p>${body}</p>`,
            }).then(() => notificationRepo.markEmailSent(notificationId))
              .catch(err => logger.warn('Notification email failed', { to: recipient.email, category, type, error: err.message }));
        }
    }
};

module.exports = { notify };
