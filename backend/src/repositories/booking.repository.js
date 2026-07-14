/**
 * Booking Repository — All DB operations for the booking engine
 * Uses transactions + locking hints to prevent double-booking race conditions
 */

'use strict';

const { executeQuery, withTransaction } = require('../config/database');
const resourceRepo = require('./resource.repository');
const hallRepo = require('./hall.repository');
const { balanceDueExpr } = require('./sqlExpressions');

// ─── Availability Check ───────────────────────────────────────────────────────

/**
 * Constraint engine — availability is a range-overlap check between two
 * "effective occupancy windows", each extended by that booking's own
 * setup/cleanup/cool-off buffers and (for multi-day events) spanning from
 * event_date through event_end_date. This single formula handles both plain
 * single-day bookings (buffers default to 0, event_end_date defaults to
 * event_date — identical to a simple time-overlap check) and multi-day /
 * buffered bookings without special-casing.
 */
const OVERLAP_CONDITION = `
    DATEADD(MINUTE, -b.setup_minutes, CAST(b.event_date AS DATETIME) + CAST(CAST(b.event_time_start AS DATETIME) AS FLOAT))
    <
    DATEADD(MINUTE, @cleanupMinutes + @cooloffMinutes, CAST(@eventEndDate AS DATETIME) + CAST(CAST(@endTime AS DATETIME) AS FLOAT))
    AND
    DATEADD(MINUTE, b.cleanup_minutes + b.cooloff_minutes, CAST(ISNULL(b.event_end_date, b.event_date) AS DATETIME) + CAST(CAST(b.event_time_end AS DATETIME) AS FLOAT))
    >
    DATEADD(MINUTE, -@setupMinutes, CAST(@eventDate AS DATETIME) + CAST(CAST(@startTime AS DATETIME) AS FLOAT))
`;

const overlapParams = ({ eventDate, eventEndDate, startTime, endTime, setupMinutes, cleanupMinutes, cooloffMinutes }) => ({
    eventDate:      new Date(eventDate),
    eventEndDate:   new Date(eventEndDate || eventDate),
    startTime,
    endTime,
    setupMinutes:    setupMinutes    || 0,
    cleanupMinutes:  cleanupMinutes  || 0,
    cooloffMinutes:  cooloffMinutes  || 0,
});

/**
 * Check if a hall is available for a given date/time window.
 * Must be called inside a transaction — the UPDLOCK/HOLDLOCK table hint
 * serializes concurrent checks against the same hall/date.
 */
const checkAvailabilityInTx = async (tx, opts) => {
    const { hallId, excludeBookingId } = opts;
    const rows = await tx.execute(
        `SELECT COUNT(*) AS conflict_count
         FROM Bookings b WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
         WHERE b.hall_id = @hallId
           AND b.status NOT IN ('cancelled', 'draft', 'completed', 'archived')
           AND (@excludeId IS NULL OR b.booking_id <> @excludeId)
           AND (${OVERLAP_CONDITION})`,
        { hallId, excludeId: excludeBookingId || null, ...overlapParams(opts) }
    );
    return rows[0].conflict_count === 0;
};

/**
 * Public availability check (no lock — for UI queries only)
 */
const checkAvailability = async (opts) => {
    const { hallId, excludeBookingId } = opts;
    const rows = await executeQuery(
        `SELECT COUNT(*) AS conflict_count
         FROM Bookings b
         WHERE b.hall_id = @hallId
           AND b.status NOT IN ('cancelled', 'draft', 'completed', 'archived')
           AND (@excludeId IS NULL OR b.booking_id <> @excludeId)
           AND (${OVERLAP_CONDITION})`,
        { hallId, excludeId: excludeBookingId || null, ...overlapParams(opts) }
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
           AND status NOT IN ('cancelled', 'draft', 'completed', 'archived')
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
 * Reject a hall/date-range combination that falls under a maintenance/blocked
 * window (HallBlockedDates) — shared by create() and reschedule() so a
 * drag-and-drop hall move can't bypass the same maintenance check a fresh
 * booking already enforces.
 */
const assertHallNotBlocked = async (tx, hallId, eventDate, eventEndDate) => {
    const blockRows = await tx.execute(
        `SELECT TOP 1 block_type, reason FROM HallBlockedDates
         WHERE hall_id = @hallId AND block_type <> 'vip_hold'
           AND blocked_date BETWEEN @eventDate AND @eventEndDate`,
        { hallId, eventDate: new Date(eventDate), eventEndDate: new Date(eventEndDate || eventDate) }
    );
    if (blockRows.length > 0) {
        const { ConflictError } = require('../api/v1/middleware/errorHandler');
        throw new ConflictError(`Hall is blocked (${blockRows[0].block_type}): ${blockRows[0].reason || 'no reason given'}`);
    }
};

/**
 * Create a booking atomically — checks availability inside same transaction
 */
const create = async (data) => {
    let createdBookingId = null;

    await withTransaction(async (tx) => {
        const isAvailable = await checkAvailabilityInTx(tx, {
            hallId:        data.hallId,
            eventDate:     data.eventDate,
            eventEndDate:  data.eventEndDate,
            startTime:     data.eventTimeStart,
            endTime:       data.eventTimeEnd,
            setupMinutes:   data.setupMinutes,
            cleanupMinutes: data.cleanupMinutes,
            cooloffMinutes: data.cooloffMinutes,
        });

        if (!isAvailable) {
            const { ConflictError } = require('../api/v1/middleware/errorHandler');
            throw new ConflictError('Hall is not available for the selected date and time');
        }

        await assertHallNotBlocked(tx, data.hallId, data.eventDate, data.eventEndDate);

        const dateStr   = new Date(data.eventDate).toISOString().slice(0, 10).replace(/-/g, '');
        const bookingRef = `BKG-${dateStr}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

        const result = await tx.execute(
            `INSERT INTO Bookings (
                company_id, branch_id, hall_id, customer_id, booking_ref,
                event_date, event_time_start, event_time_end,
                event_name, event_type, guest_count,
                total_amount, advance_paid, amount_paid,
                notes, status, is_priority, priority_surcharge, parent_booking_id,
                theme, decoration_notes, staff_count, event_end_date,
                setup_minutes, cleanup_minutes, cooloff_minutes, cleanup_charge, late_exit_charge,
                setup_charge, decoration_charge, cleaning_charge, extended_usage_charge, cooloff_charge,
                catering_package_id, catering_price_per_plate, catering_tax_amount,
                package_id, package_overtime_rate, package_max_extension_hours, package_base_price,
                created_by, created_at, updated_at
            )
            OUTPUT INSERTED.booking_id AS id
            VALUES (
                @companyId, @branchId, @hallId, @customerId, @bookingRef,
                @eventDate, @eventTimeStart, @eventTimeEnd,
                @eventName, @eventType, @guestCount,
                @totalAmount, @advancePaid, @amountPaid,
                @notes, @status, @isPriority, @prioritySurcharge, @parentBookingId,
                @theme, @decorationNotes, @staffCount, @eventEndDate,
                @setupMinutes, @cleanupMinutes, @cooloffMinutes, @cleanupCharge, @lateExitCharge,
                @setupCharge, @decorationCharge, @cleaningCharge, @extendedUsageCharge, @cooloffCharge,
                @cateringPackageId, @cateringPricePerPlate, @cateringTaxAmount,
                @packageId, @packageOvertimeRate, @packageMaxExtensionHours, @packageBasePrice,
                @createdBy, GETUTCDATE(), GETUTCDATE()
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
                status:         data.asTentative ? 'tentative' : 'confirmed',
                isPriority:         !!data.isPriority,
                prioritySurcharge:  data.priority_surcharge || 0,
                parentBookingId:    data.parentBookingId || null,
                theme:              data.theme || null,
                decorationNotes:    data.decorationNotes || null,
                staffCount:         data.staffCount != null ? data.staffCount : null,
                eventEndDate:       data.eventEndDate ? new Date(data.eventEndDate) : null,
                setupMinutes:       data.setupMinutes    || 0,
                cleanupMinutes:     data.cleanupMinutes  || 0,
                cooloffMinutes:     data.cooloffMinutes  || 0,
                cleanupCharge:      data.cleanupCharge   || 0,
                lateExitCharge:     data.lateExitCharge  || 0,
                setupCharge:        data.setupCharge         || 0,
                decorationCharge:   data.decorationCharge    || 0,
                cleaningCharge:     data.cleaningCharge      || 0,
                extendedUsageCharge: data.extendedUsageCharge || 0,
                cooloffCharge:      data.cooloffCharge       || 0,
                cateringPackageId:     data.cateringPackageId     || null,
                cateringPricePerPlate: data.cateringPricePerPlate || null,
                cateringTaxAmount:     data.cateringTaxAmount     || null,
                packageId:              data.packageId              || null,
                packageOvertimeRate:    data.packageOvertimeRate    || null,
                packageMaxExtensionHours: data.packageMaxExtensionHours || null,
                packageBasePrice:       data.packageBasePrice       || null,
                createdBy:      data.createdBy,
            }
        );
        createdBookingId = result[0].id;

        if (Array.isArray(data.resources) && data.resources.length > 0) {
            await resourceRepo.allocateInTx(tx, {
                bookingId: createdBookingId,
                companyId: data.companyId,
                resources: data.resources,
                eventDate: data.eventDate,
            });
        }
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
            bq.banquet_id, bq.banquet_name,
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
const findAll = async ({ companyId, branchId, status, hallId, customerId, fromDate, toDate, search, isPriority, offset, limit, sortBy, sortDir }) => {
    const where = [
        // NULL companyId means "every tenant" — only reachable via the
        // Super-Admin-only company_id=all opt-in in scopeToCompany (see
        // auth.js), used by the Dashboard/Command Center when not
        // impersonating a specific tenant.
        '(@companyId IS NULL OR b.company_id = @companyId)',
        '(@branchId IS NULL OR b.branch_id = @branchId)',
        '(@status IS NULL OR b.status = @status)',
        '(@hallId IS NULL OR b.hall_id = @hallId)',
        '(@customerId IS NULL OR b.customer_id = @customerId)',
        '(@fromDate IS NULL OR b.event_date >= @fromDate)',
        '(@toDate IS NULL OR b.event_date <= @toDate)',
        '(@isPriority IS NULL OR b.is_priority = @isPriority)',
        // Matches everything the payments/index.html Record Payment search box
        // promises ("booking ID, customer name, phone or event date") — phone
        // and event date were previously joined/selected but never actually
        // matched against @search, so searching by either silently returned
        // nothing.
        `(@search IS NULL OR b.booking_ref LIKE CONCAT('%', @search, '%')
          OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', @search, '%')
          OR c.phone LIKE CONCAT('%', @search, '%')
          OR CONVERT(VARCHAR(10), b.event_date, 120) LIKE CONCAT('%', @search, '%'))`,
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
        isPriority: isPriority != null ? isPriority : null,
    };

    const [rows, countRows, statusCountRows] = await Promise.all([
        executeQuery(
            `SELECT
                b.booking_id, b.booking_ref, b.hall_id, b.event_date, b.event_time_start, b.event_time_end,
                b.event_name, b.event_type, b.guest_count, b.status,
                b.total_amount, b.advance_paid, b.amount_paid,
                b.is_priority, b.created_at,
                b.setup_minutes, b.cleanup_minutes, b.cooloff_minutes,
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
        // Status breakdown ignores the status filter itself (so counts reflect
        // "how many of each status match the other active filters"), but respects
        // every other filter (hall/date/search/branch) — this is what powers the
        // bookings-index stat strip, which must move as filters change.
        executeQuery(
            `SELECT b.status, COUNT(*) AS cnt
             FROM Bookings b
             JOIN Customers c ON c.customer_id = b.customer_id
             WHERE ${where.replace("(@status IS NULL OR b.status = @status) AND", '')}
             GROUP BY b.status`,
            params
        ),
    ]);

    const statusCounts = {};
    statusCountRows.forEach(r => { statusCounts[r.status] = r.cnt; });

    return { rows, total: countRows[0].total, statusCounts };
};

/**
 * Update booking fields (non-date fields only)
 */
const update = async (bookingId, companyId, data) => {
    await executeQuery(
        `UPDATE Bookings
         SET event_name        = ISNULL(@eventName,  event_name),
             event_type        = ISNULL(@eventType,  event_type),
             guest_count       = ISNULL(@guestCount, guest_count),
             notes             = ISNULL(@notes,      notes),
             theme             = ISNULL(@theme,            theme),
             decoration_notes  = ISNULL(@decorationNotes,  decoration_notes),
             staff_count       = ISNULL(@staffCount,       staff_count),
             event_end_date    = ISNULL(@eventEndDate,     event_end_date),
             setup_minutes     = ISNULL(@setupMinutes,     setup_minutes),
             cleanup_minutes   = ISNULL(@cleanupMinutes,   cleanup_minutes),
             cooloff_minutes   = ISNULL(@cooloffMinutes,   cooloff_minutes),
             cleanup_charge    = ISNULL(@cleanupCharge,    cleanup_charge),
             late_exit_charge  = ISNULL(@lateExitCharge,   late_exit_charge),
             setup_charge          = ISNULL(@setupCharge,         setup_charge),
             decoration_charge     = ISNULL(@decorationCharge,    decoration_charge),
             cleaning_charge       = ISNULL(@cleaningCharge,      cleaning_charge),
             extended_usage_charge = ISNULL(@extendedUsageCharge, extended_usage_charge),
             cooloff_charge        = ISNULL(@cooloffCharge,       cooloff_charge),
             catering_package_id      = ISNULL(@cateringPackageId,     catering_package_id),
             catering_price_per_plate = ISNULL(@cateringPricePerPlate, catering_price_per_plate),
             catering_tax_amount      = ISNULL(@cateringTaxAmount,     catering_tax_amount),
             package_id                  = CASE WHEN @packageIdProvided = 1 THEN @packageId                 ELSE package_id                  END,
             package_overtime_rate       = CASE WHEN @packageIdProvided = 1 THEN @packageOvertimeRate       ELSE package_overtime_rate        END,
             package_max_extension_hours = CASE WHEN @packageIdProvided = 1 THEN @packageMaxExtensionHours  ELSE package_max_extension_hours  END,
             package_base_price          = CASE WHEN @packageIdProvided = 1 THEN @packageBasePrice          ELSE package_base_price           END,
             updated_at        = GETUTCDATE()
         WHERE booking_id = @bookingId AND company_id = @companyId`,
        {
            bookingId,
            companyId,
            eventName:  data.eventName  || null,
            eventType:  data.eventType  || null,
            guestCount: data.guestCount || null,
            notes:      data.notes      || null,
            theme:             data.theme || null,
            decorationNotes:   data.decorationNotes || null,
            staffCount:        data.staffCount != null ? data.staffCount : null,
            eventEndDate:      data.eventEndDate ? new Date(data.eventEndDate) : null,
            setupMinutes:      data.setupMinutes   != null ? data.setupMinutes   : null,
            cleanupMinutes:    data.cleanupMinutes != null ? data.cleanupMinutes : null,
            cooloffMinutes:    data.cooloffMinutes != null ? data.cooloffMinutes : null,
            cleanupCharge:     data.cleanupCharge  != null ? data.cleanupCharge  : null,
            lateExitCharge:    data.lateExitCharge != null ? data.lateExitCharge : null,
            setupCharge:         data.setupCharge         != null ? data.setupCharge         : null,
            decorationCharge:    data.decorationCharge    != null ? data.decorationCharge    : null,
            cleaningCharge:      data.cleaningCharge      != null ? data.cleaningCharge      : null,
            extendedUsageCharge: data.extendedUsageCharge != null ? data.extendedUsageCharge : null,
            cooloffCharge:       data.cooloffCharge       != null ? data.cooloffCharge        : null,
            cateringPackageId:     data.cateringPackageId     != null ? data.cateringPackageId     : null,
            cateringPricePerPlate: data.cateringPricePerPlate != null ? data.cateringPricePerPlate : null,
            cateringTaxAmount:     data.cateringTaxAmount     != null ? data.cateringTaxAmount     : null,
            packageIdProvided:         data.packageIdProvided ? 1 : 0,
            packageId:                 data.packageId                 != null ? data.packageId                 : null,
            packageOvertimeRate:       data.packageOvertimeRate       != null ? data.packageOvertimeRate       : null,
            packageMaxExtensionHours:  data.packageMaxExtensionHours  != null ? data.packageMaxExtensionHours  : null,
            packageBasePrice:          data.packageBasePrice          != null ? data.packageBasePrice          : null,
        }
    );
    return findById(bookingId, companyId);
};

/**
 * Reschedule — checks availability in transaction then updates date/time
 */
const reschedule = async (bookingId, companyId, { eventDate, eventTimeStart, eventTimeEnd, eventEndDate, hallId }) => {
    await withTransaction(async (tx) => {
        const booking  = await findById(bookingId, companyId);
        // eventEndDate defaults to the booking's current value when the caller
        // doesn't supply one (single-day bookings never send it).
        const resolvedEndDate = eventEndDate || booking?.event_end_date;
        // A hall move (e.g. drag-and-drop in the Command Center) targets a
        // different hall_id than the booking currently has — default to the
        // existing hall when no move is requested (plain date/time reschedule).
        const targetHallId = hallId || booking?.hall_id;

        // Re-validate the target hall on every reschedule (not just hall
        // moves) — the hall the booking already lives in may since have been
        // deactivated or put under maintenance, and that shouldn't be
        // reachable again just by dragging the same booking to a new date.
        const targetHall = await hallRepo.findById(targetHallId, companyId);
        if (!targetHall) {
            const { NotFoundError } = require('../api/v1/middleware/errorHandler');
            throw new NotFoundError('Hall');
        }
        if (!targetHall.is_active) {
            const { ValidationError } = require('../api/v1/middleware/errorHandler');
            throw new ValidationError('Target hall is not accepting bookings (inactive)');
        }
        if (targetHall.is_under_maintenance) {
            const { ValidationError } = require('../api/v1/middleware/errorHandler');
            throw new ValidationError(`Target hall is under maintenance${targetHall.maintenance_note ? `: ${targetHall.maintenance_note}` : ''}`);
        }
        if (booking?.guest_count > (targetHall.capacity_seated || targetHall.capacity || 0)) {
            const { ValidationError } = require('../api/v1/middleware/errorHandler');
            throw new ValidationError(
                `Target hall capacity (${targetHall.capacity_seated || targetHall.capacity}) is below the booking's guest count (${booking.guest_count})`
            );
        }

        const isAvail  = await checkAvailabilityInTx(tx, {
            hallId: targetHallId,
            eventDate,
            eventEndDate:   resolvedEndDate,
            startTime: eventTimeStart,
            endTime:   eventTimeEnd,
            setupMinutes:   booking?.setup_minutes,
            cleanupMinutes: booking?.cleanup_minutes,
            cooloffMinutes: booking?.cooloff_minutes,
            excludeBookingId: bookingId,
        });

        if (!isAvail) {
            const { ConflictError } = require('../api/v1/middleware/errorHandler');
            throw new ConflictError('Hall is not available for the new date/time');
        }

        await assertHallNotBlocked(tx, targetHallId, eventDate, resolvedEndDate);

        await tx.execute(
            `UPDATE Bookings
             SET event_date       = @eventDate,
                 event_time_start = @eventTimeStart,
                 event_time_end   = @eventTimeEnd,
                 event_end_date   = @eventEndDate,
                 hall_id          = @hallId,
                 updated_at       = GETUTCDATE()
             WHERE booking_id = @bookingId AND company_id = @companyId`,
            {
                bookingId, companyId, eventTimeStart, eventTimeEnd,
                eventDate: new Date(eventDate),
                eventEndDate: resolvedEndDate ? new Date(resolvedEndDate) : null,
                hallId: targetHallId,
            }
        );
    });

    return findById(bookingId, companyId);
};

/**
 * Persist a freshly recalculated total_amount — see
 * booking.service.js:recalculateBookingTotal for what feeds into this. Kept
 * as its own narrow statement (not folded into update()) so callers that
 * only need to sync the total after a resource/catering/reschedule change
 * don't have to pass through update()'s full ISNULL-guarded field set.
 */
const updateTotalAmount = async (bookingId, companyId, totalAmount) => {
    await executeQuery(
        `UPDATE Bookings
         SET total_amount = @totalAmount,
             updated_at   = GETUTCDATE()
         WHERE booking_id = @bookingId AND company_id = @companyId`,
        { bookingId, companyId, totalAmount }
    );
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
const cancel = async (bookingId, companyId, reason, cancelledBy, cancellationCharge) => {
    await executeQuery(
        `UPDATE Bookings
         SET status              = 'cancelled',
             cancellation_reason = @reason,
             cancellation_charge = @cancellationCharge,
             cancelled_at        = GETUTCDATE(),
             cancelled_by        = @cancelledBy,
             updated_at          = GETUTCDATE()
         WHERE booking_id = @bookingId AND company_id = @companyId
           AND status NOT IN ('cancelled', 'completed', 'archived')`,
        { bookingId, companyId, reason: reason || null, cancelledBy, cancellationCharge: cancellationCharge ?? null }
    );
    return findById(bookingId, companyId);
};

/**
 * Child occupancy slots under a master booking (e.g. Hall A Day 1, Hall B Day 2).
 */
const findChildren = async (parentBookingId, companyId) => {
    return executeQuery(
        `SELECT b.booking_id, b.booking_ref, b.hall_id, h.hall_name, b.event_date,
                b.event_time_start, b.event_time_end, b.status, b.total_amount
         FROM Bookings b
         JOIN Halls h ON h.hall_id = b.hall_id
         WHERE b.parent_booking_id = @parentBookingId AND b.company_id = @companyId
         ORDER BY b.event_date, b.event_time_start`,
        { parentBookingId, companyId }
    );
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
            ${balanceDueExpr('b')} AS balance_due
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
    findChildren,
    update,
    updateTotalAmount,
    reschedule,
    updateStatus,
    cancel,
};
