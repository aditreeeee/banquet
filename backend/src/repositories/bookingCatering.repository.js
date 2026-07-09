/**
 * Booking Catering Repository — per-booking multi-session catering plans.
 * Distinct from catering.repository.js (company-wide Master Menu packages) —
 * this stores what a specific booking actually ordered, session by session.
 */
'use strict';

const { executeQuery } = require('../config/database');

const SESSION_SELECT = `
    SELECT session_id, booking_id, company_id, session_type, serving_time, guest_count, notes, created_at, updated_at
    FROM BookingCateringSessions
`;

const listSessionsForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `${SESSION_SELECT} WHERE booking_id = @bookingId AND company_id = @companyId ORDER BY serving_time, session_id`,
        { bookingId, companyId }
    );
};

const findSessionById = async (sessionId, companyId) => {
    const rows = await executeQuery(
        `${SESSION_SELECT} WHERE session_id = @sessionId AND company_id = @companyId`,
        { sessionId, companyId }
    );
    return rows[0] || null;
};

const createSession = async (bookingId, companyId, { sessionType, servingTime, guestCount, notes }) => {
    const result = await executeQuery(
        `INSERT INTO BookingCateringSessions (booking_id, company_id, session_type, serving_time, guest_count, notes, created_at, updated_at)
         OUTPUT INSERTED.session_id AS id
         VALUES (@bookingId, @companyId, @sessionType, @servingTime, @guestCount, @notes, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        {
            bookingId, companyId,
            sessionType: sessionType,
            servingTime: servingTime || null,
            guestCount:  guestCount != null ? guestCount : null,
            notes:       notes || null,
        }
    );
    return findSessionById(result[0].id, companyId);
};

const updateSession = async (sessionId, companyId, { sessionType, servingTime, guestCount, notes }) => {
    await executeQuery(
        `UPDATE BookingCateringSessions
         SET session_type = ISNULL(@sessionType, session_type),
             serving_time  = ISNULL(@servingTime, serving_time),
             guest_count   = ISNULL(@guestCount,  guest_count),
             notes         = ISNULL(@notes,       notes),
             updated_at    = SYSUTCDATETIME()
         WHERE session_id = @sessionId AND company_id = @companyId`,
        {
            sessionId, companyId,
            sessionType: sessionType || null,
            servingTime: servingTime || null,
            guestCount:  guestCount != null ? guestCount : null,
            notes:       notes != null ? notes : null,
        }
    );
    return findSessionById(sessionId, companyId);
};

const removeSession = async (sessionId, companyId) => {
    await executeQuery(`DELETE FROM BookingCateringItems WHERE session_id = @sessionId`, { sessionId });
    await executeQuery(
        `DELETE FROM BookingCateringSessions WHERE session_id = @sessionId AND company_id = @companyId`,
        { sessionId, companyId }
    );
};

const listItemsForSession = async (sessionId) => {
    return executeQuery(
        `SELECT item_row_id, session_id, item_id, item_name, quantity, unit_price, tax_percent,
                CAST(quantity * unit_price AS DECIMAL(12,2)) AS line_subtotal,
                CAST(quantity * unit_price * tax_percent / 100 AS DECIMAL(12,2)) AS line_tax,
                CAST(quantity * unit_price * (1 + tax_percent / 100) AS DECIMAL(12,2)) AS line_total
         FROM BookingCateringItems
         WHERE session_id = @sessionId
         ORDER BY item_row_id`,
        { sessionId }
    );
};

/** All items across every session for a booking — used for total recalculation. */
const listItemsForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `SELECT bci.item_row_id, bci.session_id, bci.item_id, bci.item_name, bci.quantity, bci.unit_price, bci.tax_percent
         FROM BookingCateringItems bci
         JOIN BookingCateringSessions bcs ON bcs.session_id = bci.session_id
         WHERE bcs.booking_id = @bookingId AND bcs.company_id = @companyId`,
        { bookingId, companyId }
    );
};

const addItem = async (sessionId, { itemId, itemName, quantity, unitPrice, taxPercent }) => {
    const result = await executeQuery(
        `INSERT INTO BookingCateringItems (session_id, item_id, item_name, quantity, unit_price, tax_percent, created_at)
         OUTPUT INSERTED.item_row_id AS id
         VALUES (@sessionId, @itemId, @itemName, @quantity, @unitPrice, @taxPercent, SYSUTCDATETIME())`,
        {
            sessionId,
            itemId:     itemId || null,
            itemName,
            quantity:   quantity   || 1,
            unitPrice:  unitPrice  || 0,
            taxPercent: taxPercent || 0,
        }
    );
    return result[0].id;
};

const updateItemQuantity = async (itemRowId, sessionId, quantity) => {
    await executeQuery(
        `UPDATE BookingCateringItems SET quantity = @quantity WHERE item_row_id = @itemRowId AND session_id = @sessionId`,
        { itemRowId, sessionId, quantity }
    );
};

const removeItem = async (itemRowId, sessionId) => {
    await executeQuery(
        `DELETE FROM BookingCateringItems WHERE item_row_id = @itemRowId AND session_id = @sessionId`,
        { itemRowId, sessionId }
    );
};

module.exports = {
    listSessionsForBooking, findSessionById, createSession, updateSession, removeSession,
    listItemsForSession, listItemsForBooking, addItem, updateItemQuantity, removeItem,
};
