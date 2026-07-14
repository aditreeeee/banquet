/**
 * Booking Services Repository — Step 7 "Additional Services" line items with
 * negotiated pricing. catalog_price is frozen at selection time for
 * comparison/audit history; negotiated_price/discount_amount are the
 * editable staff-agreed terms, final_price is what's actually billed.
 */
'use strict';

const { executeQuery, withTransaction } = require('../config/database');

const getForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `SELECT bs.booking_service_id, bs.booking_id, bs.service_key, bs.service_name,
                bs.catalog_price, bs.negotiated_price, bs.discount_amount, bs.final_price, bs.created_at
         FROM BookingServices bs
         JOIN Bookings b ON b.booking_id = bs.booking_id
         WHERE bs.booking_id = @bookingId AND b.company_id = @companyId
         ORDER BY bs.booking_service_id`,
        { bookingId, companyId }
    );
};

/**
 * Replace a booking's full set of service line items inside one transaction —
 * same "delete then re-insert" pattern as resource/decoration reallocation,
 * so a re-save can never leave stale rows or double-count a service.
 */
const reallocateForBooking = async (bookingId, companyId, services) => {
    return withTransaction(async (tx) => {
        const owns = await tx.execute(
            `SELECT booking_id FROM Bookings WHERE booking_id = @bookingId AND company_id = @companyId`,
            { bookingId, companyId }
        );
        if (!owns[0]) return;

        await tx.execute(`DELETE FROM BookingServices WHERE booking_id = @bookingId`, { bookingId });

        for (const s of services) {
            const catalogPrice = s.catalogPrice != null ? s.catalogPrice : 0;
            const negotiatedPrice = s.negotiatedPrice != null ? s.negotiatedPrice : catalogPrice;
            const discountAmount = s.discountAmount || 0;
            const finalPrice = Math.max(0, negotiatedPrice - discountAmount);
            await tx.execute(
                `INSERT INTO BookingServices
                    (booking_id, service_key, service_name, catalog_price, negotiated_price, discount_amount, final_price, created_at)
                 VALUES
                    (@bookingId, @serviceKey, @serviceName, @catalogPrice, @negotiatedPrice, @discountAmount, @finalPrice, SYSUTCDATETIME())`,
                {
                    bookingId,
                    serviceKey: s.serviceKey != null ? String(s.serviceKey) : null,
                    serviceName: s.serviceName,
                    catalogPrice,
                    negotiatedPrice,
                    discountAmount,
                    finalPrice,
                }
            );
        }
    });
};

module.exports = { getForBooking, reallocateForBooking };
