/**
 * Expire Tentative Holds — TTL sweep
 * Tentative bookings (slot holds) that outlive the company's configured
 * `hold_duration_mins` (CompanySettings, group 'booking') are auto-cancelled,
 * releasing the hall and any allocated inventory back to availability.
 */

'use strict';

const cron = require('node-cron');
const { executeQuery } = require('../config/database');
const auditLogRepo = require('../repositories/auditLog.repository');
const notificationRepo = require('../repositories/notification.repository');
const dashService = require('../services/dashboard.service');
const logger = require('../utils/logger');

const DEFAULT_HOLD_MINUTES = 15;

/**
 * Find and cancel tentative bookings past their hold window.
 * Returns the list of expired bookings for logging/cache invalidation.
 */
const expireOverdueHolds = async () => {
    const expired = await executeQuery(
        `UPDATE b
         SET status              = 'cancelled',
             cancellation_reason = 'Tentative hold expired automatically',
             cancelled_at        = GETUTCDATE(),
             updated_at          = GETUTCDATE()
         OUTPUT INSERTED.booking_id, INSERTED.company_id, INSERTED.booking_ref
         FROM Bookings b
         OUTER APPLY (
             SELECT TOP 1 TRY_CAST(setting_value AS INT) AS mins
             FROM CompanySettings
             WHERE company_id = b.company_id AND setting_key = 'hold_duration_mins'
         ) s
         WHERE b.status = 'tentative'
           AND DATEADD(MINUTE, ISNULL(s.mins, @defaultMinutes), b.created_at) < GETUTCDATE()`,
        { defaultMinutes: DEFAULT_HOLD_MINUTES }
    );

    for (const row of expired) {
        await auditLogRepo.log({
            companyId:  row.company_id,
            userId:     null,
            action:     'booking.hold_expired',
            entityType: 'booking',
            entityId:   row.booking_id,
            description: `Booking ${row.booking_ref} tentative hold expired automatically and was cancelled`,
            oldValues:  { status: 'tentative' },
            newValues:  { status: 'cancelled', reason: 'Tentative hold expired automatically' },
        });

        await notificationRepo.notifyManagers({
            companyId: row.company_id,
            type: 'booking_hold_expired',
            title: 'Booking hold expired',
            body: `${row.booking_ref} was automatically cancelled — the tentative hold expired`,
            referenceType: 'booking',
            referenceId: row.booking_id,
        }).catch(err => logger.warn('Notification dispatch failed', { error: err.message }));

        dashService.invalidateDashboardCache(row.company_id);
    }

    if (expired.length > 0) {
        logger.info('Expired tentative booking holds', { count: expired.length });
    }

    return expired;
};

/**
 * Register the cron sweep. Runs every minute — cheap query, and holds are
 * usually short (default 15 min), so minute-level granularity matters.
 */
const start = () => {
    cron.schedule('* * * * *', () => {
        expireOverdueHolds().catch(err => {
            logger.error('Tentative hold expiry sweep failed', { error: err.message });
        });
    });
    logger.info('Tentative hold expiry job scheduled (every minute)');
};

module.exports = { start, expireOverdueHolds };
