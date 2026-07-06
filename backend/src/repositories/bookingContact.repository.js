/**
 * Booking Contact Repository — Alternative Contacts attached to a booking
 */

'use strict';

const { executeQuery } = require('../config/database');

const listForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `SELECT bc.contact_id, bc.contact_name, bc.mobile, bc.email, bc.relationship, bc.notes, bc.created_at
         FROM BookingContacts bc
         JOIN Bookings b ON b.booking_id = bc.booking_id
         WHERE bc.booking_id = @bookingId AND b.company_id = @companyId
         ORDER BY bc.created_at ASC`,
        { bookingId, companyId }
    );
};

const create = async (bookingId, companyId, { contactName, mobile, email, relationship, notes }) => {
    const result = await executeQuery(
        `INSERT INTO BookingContacts (booking_id, contact_name, mobile, email, relationship, notes, created_at)
         OUTPUT INSERTED.contact_id AS id
         SELECT @bookingId, @contactName, @mobile, @email, @relationship, @notes, SYSUTCDATETIME()
         FROM Bookings WHERE booking_id = @bookingId AND company_id = @companyId`,
        {
            bookingId,
            companyId,
            contactName: contactName,
            mobile:       mobile       || null,
            email:        email        || null,
            relationship: relationship || null,
            notes:        notes        || null,
        }
    );
    return result[0] || null;
};

/** Batch-clone a set of contacts onto a new booking in one round trip (used by cloneBooking). */
const createMany = async (bookingId, companyId, contacts) => {
    if (!contacts.length) return;
    const params = { bookingId, companyId };
    const valueRows = contacts.map((c, i) => {
        params[`name${i}`] = c.contactName;
        params[`mobile${i}`] = c.mobile || null;
        params[`email${i}`] = c.email || null;
        params[`rel${i}`] = c.relationship || null;
        params[`notes${i}`] = c.notes || null;
        return `(@bookingId, @name${i}, @mobile${i}, @email${i}, @rel${i}, @notes${i}, SYSUTCDATETIME())`;
    });
    await executeQuery(
        `INSERT INTO BookingContacts (booking_id, contact_name, mobile, email, relationship, notes, created_at)
         SELECT v.* FROM (VALUES ${valueRows.join(', ')}) AS v(booking_id, contact_name, mobile, email, relationship, notes, created_at)
         WHERE EXISTS (SELECT 1 FROM Bookings WHERE booking_id = @bookingId AND company_id = @companyId)`,
        params
    );
};

const remove = async (contactId, bookingId, companyId) => {
    await executeQuery(
        `DELETE bc FROM BookingContacts bc
         JOIN Bookings b ON b.booking_id = bc.booking_id
         WHERE bc.contact_id = @contactId AND bc.booking_id = @bookingId AND b.company_id = @companyId`,
        { contactId, bookingId, companyId }
    );
};

module.exports = { listForBooking, create, createMany, remove };
