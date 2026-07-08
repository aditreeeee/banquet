/**
 * Booking Staff Assignment Repository — staff assigned to work a booking,
 * surfaced in the Command Center Quick Drawer's "Staff" section.
 */

'use strict';

const { executeQuery } = require('../config/database');

const listForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `SELECT bsa.assignment_id, bsa.user_id, bsa.role_note, bsa.status, bsa.created_at,
                CONCAT(u.first_name, ' ', u.last_name) AS staff_name, u.role_id, r.role_name
         FROM BookingStaffAssignments bsa
         JOIN Bookings b ON b.booking_id = bsa.booking_id
         JOIN Users u    ON u.user_id    = bsa.user_id
         LEFT JOIN Roles r ON r.role_id  = u.role_id
         WHERE bsa.booking_id = @bookingId AND b.company_id = @companyId
         ORDER BY bsa.created_at ASC`,
        { bookingId, companyId }
    );
};

const assign = async (bookingId, companyId, { userId, roleNote }) => {
    const result = await executeQuery(
        `INSERT INTO BookingStaffAssignments (booking_id, user_id, role_note, status, created_at)
         OUTPUT INSERTED.assignment_id AS id
         SELECT @bookingId, @userId, @roleNote, 'assigned', SYSUTCDATETIME()
         FROM Bookings WHERE booking_id = @bookingId AND company_id = @companyId`,
        { bookingId, companyId, userId, roleNote: roleNote || null }
    );
    return result[0] || null;
};

const updateStatus = async (assignmentId, bookingId, companyId, status) => {
    await executeQuery(
        `UPDATE bsa SET bsa.status = @status
         FROM BookingStaffAssignments bsa
         JOIN Bookings b ON b.booking_id = bsa.booking_id
         WHERE bsa.assignment_id = @assignmentId AND bsa.booking_id = @bookingId AND b.company_id = @companyId`,
        { assignmentId, bookingId, companyId, status }
    );
};

const remove = async (assignmentId, bookingId, companyId) => {
    await executeQuery(
        `DELETE bsa FROM BookingStaffAssignments bsa
         JOIN Bookings b ON b.booking_id = bsa.booking_id
         WHERE bsa.assignment_id = @assignmentId AND bsa.booking_id = @bookingId AND b.company_id = @companyId`,
        { assignmentId, bookingId, companyId }
    );
};

/** All assignments for a staff member across every booking — their schedule/assigned events. */
const listForUser = async (userId, companyId) => {
    return executeQuery(
        `SELECT bsa.assignment_id, bsa.booking_id, bsa.role_note, bsa.status, bsa.created_at,
                b.booking_ref, b.event_name, b.event_date, b.event_time_start, b.event_time_end, b.status AS booking_status,
                h.hall_name
         FROM BookingStaffAssignments bsa
         JOIN Bookings b ON b.booking_id = bsa.booking_id
         JOIN Halls h    ON h.hall_id    = b.hall_id
         WHERE bsa.user_id = @userId AND b.company_id = @companyId
         ORDER BY b.event_date DESC`,
        { userId, companyId }
    );
};

module.exports = { listForBooking, assign, updateStatus, remove, listForUser };
