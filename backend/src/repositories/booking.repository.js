/**
 * Booking Repository — All DB operations for the booking engine
 * Uses transactions + locking hints to prevent double-booking race conditions
 */

'use strict';

const { executeQuery, withTransaction } = require('../config/database');

// ─── Availability Check ───────────────────────────────────────────────────────

/**
 * Check if a hall is available for a given date/time window.
 * Must be called inside a transaction — the UPDLOCK/HOLDLOCK table hint
 * serializes concurrent checks against the same hall/date.
 */
const checkAvailabilityInTx = async (tx, { hallId, eventDate, startTime, endTime, excludeBookingId }) => {
    const rows = await tx.execute(
        `SELECT COUNT(*) AS conflict_count
         FROM Bookings WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
         WHERE hall_id    = @hallId
           AND event_date = @eventDate
           AND status NOT IN ('cancelled', 'draft')
           AND (@excludeId IS NULL OR booking_id <> @excludeId)
           AND (event_time_start < @endTime AND event_time_end > @startTime)`,
        {
            hallId,
            eventDate: new Date(eventDate),
            startTime,
            endTime,
            excludeId: excludeBookingId || null,
        }
    );
    return rows[0].conflict_count === 0;
};

/**
 * Public availability check (no lock — for UI queries only)
 */
const checkAvailability = async ({ hallId, eventDate, startTime, endTime, excludeBookingId }) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS conflict_count
         FROM Bookings
         WHERE hall_id    = @hallId
           AND event_date = @eventDate
           AND status NOT IN ('cancelled', 'draft')
           AND (@excludeId IS NULL OR booking_id <> @excludeId)
           AND (event_time_start < @endTime AND event_time_end > @startTime)`,
        {
            hallId,
            eventDate: new Date(eventDate),
            startTime,
            endTime,
            excludeId: excludeBookingId || null,
        }
    );
    return rows[0].conflict_count === 0;
};

/**
 * Get booked dates for a hall within a date range (for calendar UI)
 */
const getBookedDates = async ({ hallId, fromDate, toDate, companyId }) => {
    const rows = await executeQuery(
        `SELECT DISTINCT CAST(event_date AS DATE) AS booked_date
         FROM Bookings
         WHERE hall_id    = @hallId
           AND company_id = @companyId
           AND event_date BETWEEN @fromDate AND @toDate
           AND status NOT IN ('cancelled', 'draft')
         ORDER BY booked_date`,
        {
            hallId,
            companyId,
            fromDate: new Date(fromDate),
            toDate:   new Date(toDate),
        }
    );
    return rows.map(r => r.booked_date);
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Create a booking atomically — checks availability inside same transaction
 */
const create = async (data) => {
    let createdBookingId = null;

    await withTransaction(async (tx) => {
        const isAvailable = await checkAvailabilityInTx(tx, {
            hallId:    data.hallId,
            eventDate: data.eventDate,
            startTime: data.eventTimeStart,
            endTime:   data.eventTimeEnd,
        });

        if (!isAvailable) {
            const { ConflictError } = require('../api/v1/middleware/errorHandler');
            throw new ConflictError('Hall is not available for the selected date and time');
        }

        const dateStr   = new Date(data.eventDate).toISOString().slice(0, 10).replace(/-/g, '');
        const bookingRef = `BKG-${dateStr}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

        const result = await tx.execute(
            `INSERT INTO Bookings (
                company_id, branch_id, hall_id, customer_id, booking_ref,
                event_date, event_time_start, event_time_end,
                event_name, event_type, guest_count,
                total_amount, advance_paid, amount_paid,
                notes, status, created_by, created_at, updated_at
            )
            OUTPUT INSERTED.booking_id AS id
            VALUES (
                @companyId, @branchId, @hallId, @customerId, @bookingRef,
                @eventDate, @eventTimeStart, @eventTimeEnd,
                @eventName, @eventType, @guestCount,
                @totalAmount, @advancePaid, @amountPaid,
                @notes, 'confirmed', @createdBy, GETUTCDATE(), GETUTCDATE()
            )`,
            {
                companyId:      data.companyId,
                branchId:       data.branchId,
                hallId:         data.hallId,
                customerId:     data.customerId,
                bookingRef,
                eventDate:      new Date(data.eventDate),
                eventTimeStart: data.eventTimeStart,
                eventTimeEnd:   data.eventTimeEnd,
                eventName:      data.eventName      || null,
                eventType:      data.eventType      || null,
                guestCount:     data.guestCount     || null,
                totalAmount:    data.totalAmount,
                advancePaid:    data.advancePaid    || 0,
                amountPaid:     data.amountPaid     || 0,
                notes:          data.notes          || null,
                createdBy:      data.createdBy,
            }
        );
        createdBookingId = result[0].id;
    });

    return findById(createdBookingId);
};

/**
 * Full booking detail by ID (with hall, customer, payments)
 */
const findById = async (bookingId, companyId = null) => {
    const rows = await executeQuery(
        `SELECT
            b.*,
            h.hall_name, h.capacity, h.floor_number,
            bq.banquet_name,
            CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
            c.email AS customer_email, c.phone AS customer_phone,
            CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
            ISNULL((SELECT SUM(amount) FROM Payments WHERE booking_id = b.booking_id AND status = 'completed'), 0) AS total_paid
         FROM Bookings b
         JOIN Halls     h  ON h.hall_id     = b.hall_id
         JOIN Banquets  bq ON bq.banquet_id = h.banquet_id
         JOIN Customers c  ON c.customer_id = b.customer_id
         LEFT JOIN Users u ON u.user_id     = b.created_by
         WHERE b.booking_id = @bookingId
           AND (@companyId IS NULL OR b.company_id = @companyId)`,
        { bookingId, companyId: companyId || null }
    );
    return rows[0] || null;
};

/**
 * Paginated list with filters
 */
const findAll = async ({ companyId, branchId, status, hallId, customerId, fromDate, toDate, search, offset, limit, sortBy, sortDir }) => {
    const where = [
        'b.company_id = @companyId',
        '(@branchId IS NULL OR b.branch_id = @branchId)',
        '(@status IS NULL OR b.status = @status)',
        '(@hallId IS NULL OR b.hall_id = @hallId)',
        '(@customerId IS NULL OR b.customer_id = @customerId)',
        '(@fromDate IS NULL OR b.event_date >= @fromDate)',
        '(@toDate IS NULL OR b.event_date <= @toDate)',
        `(@search IS NULL OR b.booking_ref LIKE CONCAT('%', @search, '%')
          OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const orderCol = ['event_date', 'created_at', 'total_amount', 'status'].includes(sortBy)
        ? `b.${sortBy}` : 'b.event_date';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId:   branchId   || null,
        status:     status     || null,
        hallId:     hallId     || null,
        customerId: customerId || null,
        fromDate:   fromDate ? new Date(fromDate) : null,
        toDate:     toDate   ? new Date(toDate)   : null,
        search:     search   || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `SELECT
                b.booking_id, b.booking_ref, b.event_date, b.event_time_start, b.event_time_end,
                b.event_name, b.event_type, b.guest_count, b.status,
                b.total_amount, b.advance_paid, b.amount_paid,
                b.created_at,
                h.hall_name,
                CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                c.phone AS customer_phone
             FROM Bookings b
             JOIN Halls h     ON h.hall_id     = b.hall_id
             JOIN Customers c ON c.customer_id = b.customer_id
             WHERE ${where}
             ORDER BY ${orderCol} ${dir}
             OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total
             FROM Bookings b
             JOIN Customers c ON c.customer_id = b.customer_id
             WHERE ${where}`,
            params
        ),
    ]);

    return { rows, total: countRows[0].total };
};

/**
 * Update booking fields (non-date fields only)
 */
const update = async (bookingId, companyId, data) => {
    await executeQuery(
        `UPDATE Bookings
         SET event_name  = ISNULL(@eventName,  event_name),
             event_type  = ISNULL(@eventType,  event_type),
             guest_count = ISNULL(@guestCount, guest_count),
             notes       = ISNULL(@notes,      notes),
             updated_at  = GETUTCDATE()
         WHERE booking_id = @bookingId AND company_id = @companyId`,
        {
            bookingId,
            companyId,
            eventName:  data.eventName  || null,
            eventType:  data.eventType  || null,
            guestCount: data.guestCount || null,
            notes:      data.notes      || null,
        }
    );
    return findById(bookingId, companyId);
};

/**
 * Reschedule — checks availability in transaction then updates date/time
 */
const reschedule = async (bookingId, companyId, { eventDate, eventTimeStart, eventTimeEnd }) => {
    await withTransaction(async (tx) => {
        const booking  = await findById(bookingId, companyId);
        const isAvail  = await checkAvailabilityInTx(tx, {
            hallId: booking?.hall_id,
            eventDate,
            startTime: eventTimeStart,
            endTime:   eventTimeEnd,
            excludeBookingId: bookingId,
        });

        if (!isAvail) {
            const { ConflictError } = require('../api/v1/middleware/errorHandler');
            throw new ConflictError('Hall is not available for the new date/time');
        }

        await tx.execute(
            `UPDATE Bookings
             SET event_date       = @eventDate,
                 event_time_start = @eventTimeStart,
                 event_time_end   = @eventTimeEnd,
                 updated_at       = GETUTCDATE()
             WHERE booking_id = @bookingId AND company_id = @companyId`,
            { bookingId, companyId, eventDate: new Date(eventDate), eventTimeStart, eventTimeEnd }
        );
    });

    return findById(bookingId, companyId);
};

/**
 * Update booking status
 */
const updateStatus = async (bookingId, companyId, status, updatedBy) => {
    await executeQuery(
        `UPDATE Bookings
         SET status     = @status,
             updated_at = GETUTCDATE(),
             updated_by = @updatedBy
         WHERE booking_id = @bookingId AND company_id = @companyId`,
        { bookingId, companyId, status, updatedBy }
    );
    return findById(bookingId, companyId);
};

/**
 * Cancel a booking (soft — sets status to 'cancelled')
 */
const cancel = async (bookingId, companyId, reason, cancelledBy) => {
    await executeQuery(
        `UPDATE Bookings
         SET status              = 'cancelled',
             cancellation_reason = @reason,
             cancelled_at        = GETUTCDATE(),
             cancelled_by        = @cancelledBy,
             updated_at          = GETUTCDATE()
         WHERE booking_id = @bookingId AND company_id = @companyId
           AND status NOT IN ('cancelled', 'completed')`,
        { bookingId, companyId, reason: reason || null, cancelledBy }
    );
    return findById(bookingId, companyId);
};

/**
 * Find booking by booking_ref (used by payment lookup, invoice lookup)
 */
const findByRef = async (bookingRef, companyId) => {
    const rows = await executeQuery(
        `SELECT
            b.*,
            h.hall_name,
            CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
            c.email AS customer_email, c.phone AS customer_phone,
            ISNULL(b.total_amount - b.amount_paid, 0) AS balance_due
         FROM Bookings b
         JOIN Halls     h ON h.hall_id     = b.hall_id
         JOIN Customers c ON c.customer_id = b.customer_id
         WHERE b.booking_ref = @bookingRef
           AND (@companyId IS NULL OR b.company_id = @companyId)`,
        { bookingRef, companyId: companyId || null }
    );
    return rows[0] || null;
};

module.exports = {
    checkAvailability,
    getBookedDates,
    create,
    findById,
    findByRef,
    findAll,
    update,
    reschedule,
    updateStatus,
    cancel,
};
