/**
 * Booking Service — Business logic for the booking engine
 * Enforces rules: availability, capacity, status transitions
 */

'use strict';

const bookingRepo  = require('../repositories/booking.repository');
const hallRepo     = require('../repositories/hall.repository');
const customerRepo = require('../repositories/customer.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const resourceRepo = require('../repositories/resource.repository');
const decorationRepo = require('../repositories/decoration.repository');
const bookingContactRepo = require('../repositories/bookingContact.repository');
const bookingStaffRepo = require('../repositories/bookingStaff.repository');
const bookingCateringRepo = require('../repositories/bookingCatering.repository');
const bookingPackageRepo = require('../repositories/bookingPackage.repository');
const notificationRepo = require('../repositories/notification.repository');
const operationalChargeService = require('./operationalCharge.service');
const paymentService = require('./payment.service');
const settingsService = require('./settings.service');
const dashService  = require('./dashboard.service');
const notif        = require('./notification.service');
const logger       = require('../utils/logger');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { resolveCompanyScope } = require('../utils/branchScope');
const {
    NotFoundError,
    ConflictError,
    ValidationError,
    ForbiddenError,
} = require('../api/v1/middleware/errorHandler');
const { BOOKING_STATUS } = require('../constants');

// ─── Valid status transitions ─────────────────────────────────────────────────
const ALLOWED_TRANSITIONS = {
    draft:        ['tentative', 'confirmed', 'cancelled'],
    tentative:    ['confirmed', 'cancelled'],
    confirmed:    ['advance_paid', 'fully_paid', 'cancelled'],
    advance_paid: ['fully_paid', 'cancelled', 'completed'],
    fully_paid:   ['completed', 'cancelled'],
    completed:    ['archived'],
    archived:     [],   // terminal
    cancelled:    [],   // terminal
    no_show:      [],
};

const canTransition = (from, to) =>
    (ALLOWED_TRANSITIONS[from] || []).includes(to);

// ─── Priority booking surcharge ────────────────────────────────────────────────
const PRIORITY_SURCHARGE_PCT = 20;

const calculatePrioritySurcharge = (baseAmount, isPriority) =>
    isPriority ? Math.round((parseFloat(baseAmount) || 0) * (PRIORITY_SURCHARGE_PCT / 100)) : 0;

// ─── Package pricing/timing (factors in the specific hall's own rate) ─────────
const STANDARD_DAY_HOURS = 8;

/**
 * A duration package's price is derived from the hall actually being booked,
 * not a flat company-wide figure — a "Full Day" at a ₹150,000 hall must cost
 * more than the same package at a ₹45,000 hall. Only 'fixed_session'
 * packages (Breakfast Event, High Tea, Wedding Ceremony, etc.) keep their own
 * flat admin-set price, since those are catering-style events, not a
 * fraction of the hall's own day rate. The result is computed once here (at
 * booking create/edit time) and stored as the snapshot package_base_price —
 * recalculateBookingTotal() just reads that stored figure unchanged, so this
 * is the only place the hall-rate logic needs to live.
 */
const computePackagePrice = (pkg, hall) => {
    const hallRate = parseFloat(hall.base_price) || 0;
    switch (pkg.calc_type) {
        case 'full_day': return Math.round(hallRate);
        case 'half_day': return Math.round(hallRate * 0.5);
        case 'hourly':    return Math.round((hallRate / STANDARD_DAY_HOURS) * (pkg.included_hours || 1));
        default:          return Math.round(parseFloat(pkg.base_price) || 0); // fixed_session
    }
};

/**
 * Duration packages (hourly/half_day/full_day) price a specific span of
 * time — the booking's actual timings must match what was priced, so the
 * event end time is derived from the package rather than left to drift out
 * of sync with it. Fixed-session packages have no included_hours and are
 * left alone (their own start/end times are the whole point).
 */
const addHours = (timeStr, hours) => {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMin = h * 60 + m + Math.round(hours * 60);
    const wrapped = ((totalMin % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

const applyPackageTiming = (data, pkg) => {
    if (!pkg || pkg.included_hours == null || !data.eventTimeStart) return data;
    return { ...data, eventTimeEnd: addHours(data.eventTimeStart, pkg.included_hours) };
};

// ─── Advance payment auto-calculation ──────────────────────────────────────────
/**
 * Required deposit percentage — configurable per company via Settings
 * (booking.advance_pct, Billing & Tax tab), not hardcoded, so changing it
 * takes effect for every new booking without a code change.
 */
const calculateAdvanceAmount = (totalAmount, advancePct) => ({
    percentage: advancePct,
    amount: Math.round((parseFloat(totalAmount) || 0) * (advancePct / 100)),
});

// ─── Check Availability (public — no lock) ────────────────────────────────────

const checkAvailability = async ({ hallId, eventDate, startTime, endTime, companyId }) => {
    // Validate hall exists and belongs to company
    const hall = await hallRepo.findById(hallId, companyId);
    if (!hall) throw new NotFoundError('Hall');

    const available = await bookingRepo.checkAvailability({
        hallId, eventDate, startTime, endTime,
    });

    return { available, hall };
};

/**
 * Blocked/booked dates for a hall (for calendar)
 */
const getBookedDates = async ({ hallId, fromDate, toDate, companyId }) => {
    const hall = await hallRepo.findById(hallId, companyId);
    if (!hall) throw new NotFoundError('Hall');
    return bookingRepo.getBookedDates({ hallId, fromDate, toDate, companyId });
};

// ─── Create ───────────────────────────────────────────────────────────────────

const create = async (data, actor) => {
    const { companyId, userId } = actor;

    // Validate hall
    const hall = await hallRepo.findById(data.hallId, companyId);
    if (!hall) throw new NotFoundError('Hall');
    if (!hall.is_active) throw new ValidationError('Hall is not accepting bookings');
    if (hall.is_under_maintenance) throw new ValidationError(`Hall is under maintenance${hall.maintenance_note ? `: ${hall.maintenance_note}` : ''}`);

    // Validate capacity
    if (data.guestCount && data.guestCount > hall.capacity) {
        throw new ValidationError(`Hall capacity is ${hall.capacity}. Guest count exceeds limit.`);
    }

    // Validate customer
    const customer = await customerRepo.findById(data.customerId, companyId);
    if (!customer) throw new NotFoundError('Customer');

    // actor.branchId is null for super-admins and company-admins (no branch assigned).
    // Fall back to the hall's resolved branch (always non-null via COALESCE with banquet).
    const branchId = actor.branchId || hall.branch_id;
    if (!branchId) throw new ValidationError('Cannot determine branch for this booking. Please assign the hall to a branch first.');

    const bookingDefaults = await settingsService.getBookingDefaults(companyId);

    // A selected rental package snapshots its own setup/cleanup/cooloff
    // defaults and overtime rate/allowance onto the booking (not a live FK
    // read later) — a later edit to the package's rate never retroactively
    // changes an already-created booking, same principle as every other
    // snapshot-pricing decision in this codebase (operational charges,
    // catering line items).
    let bookingPackage = null;
    if (data.packageId) {
        bookingPackage = await bookingPackageRepo.findPackageById(data.packageId, companyId);
        if (!bookingPackage) throw new NotFoundError('Booking package');
        if (!bookingPackage.is_active) throw new ValidationError('This booking package is no longer available');
        data = applyPackageTiming(data, bookingPackage);
    }

    const prioritySurcharge = calculatePrioritySurcharge(data.totalAmount, data.isPriority);
    // Owner can override the auto-calculated deposit by passing advancePaid explicitly.
    const advancePaid = data.advancePaid != null
        ? data.advancePaid
        : calculateAdvanceAmount(data.totalAmount, bookingDefaults.advancePct).amount;

    // Fall back to the selected package's durations, then the company's
    // configured setup/cleanup/cool-off durations, when the client omits
    // them — a missing cool-off buffer would otherwise let back-to-back
    // bookings overlap with no turnaround time.
    const booking = await bookingRepo.create({
        ...data,
        setupMinutes:   data.setupMinutes   != null ? data.setupMinutes   : (bookingPackage?.default_setup_minutes   ?? bookingDefaults.setupMinutes),
        cleanupMinutes: data.cleanupMinutes != null ? data.cleanupMinutes : (bookingPackage?.default_cleanup_minutes ?? bookingDefaults.cleanupMinutes),
        cooloffMinutes: data.cooloffMinutes != null ? data.cooloffMinutes : (bookingPackage?.default_cooloff_minutes ?? bookingDefaults.cooloffMinutes),
        packageId:                 bookingPackage?.package_id || null,
        packageOvertimeRate:       bookingPackage?.overtime_rate_per_hour ?? null,
        packageMaxExtensionHours:  bookingPackage?.max_extension_hours ?? null,
        packageBasePrice:          bookingPackage ? computePackagePrice(bookingPackage, hall) : null,
        companyId,
        branchId,
        createdBy: userId,
        advancePaid,
        priority_surcharge: prioritySurcharge,
    });

    // Invalidate dashboard cache
    dashService.invalidateDashboardCache(companyId);

    await auditLogRepo.log({
        companyId,
        userId: userId,
        action: 'booking.created',
        entityType: 'booking',
        entityId: booking.booking_id,
        description: `Booking ${booking.booking_ref} created for ${booking.event_name || 'event'}`,
        newValues: { status: booking.status, event_date: booking.event_date, hall_id: booking.hall_id },
    });

    // Send confirmation email (non-blocking)
    notif.sendBookingConfirmationEmail({
        to:        customer.email,
        firstName: customer.first_name,
        booking,
    }).catch(err => logger.warn('Confirmation email failed', { error: err.message }));

    notificationRepo.notifyManagers({
        companyId, branchId,
        type: 'booking_created',
        title: 'New booking created',
        body: `${booking.booking_ref} — ${booking.event_name || 'Event'} on ${new Date(booking.event_date).toLocaleDateString('en-IN')}`,
        referenceType: 'booking',
        referenceId: booking.booking_id,
        excludeUserId: userId,
    }).catch(err => logger.warn('Notification dispatch failed', { error: err.message }));

    logger.info('Booking created', { bookingId: booking.booking_id, companyId, userId });
    return booking;
};

// ─── Clone ────────────────────────────────────────────────────────────────────

/**
 * Clone a booking for a repeat event — carries over hall, event details,
 * resources, and alternative contacts. Customer is reused unless overridden.
 * Requires a new date/time slot since the original is already occupied.
 */
const cloneBooking = async (bookingId, overrides, actor) => {
    const source = await bookingRepo.findById(bookingId, actor.companyId);
    if (!source) throw new NotFoundError('Booking');

    const [resourceAllocations, contacts] = await Promise.all([
        resourceRepo.getAllocationsForBooking(bookingId, actor.companyId),
        bookingContactRepo.listForBooking(bookingId, actor.companyId),
    ]);

    const cloned = await create({
        hallId:         source.hall_id,
        customerId:     overrides.customerId || source.customer_id,
        eventDate:      overrides.eventDate,
        eventTimeStart: overrides.eventTimeStart,
        eventTimeEnd:   overrides.eventTimeEnd,
        eventName:      source.event_name,
        eventType:      source.event_type,
        guestCount:     source.guest_count,
        totalAmount:    source.total_amount,
        notes:          source.notes,
        isPriority:     source.is_priority,
        asTentative:    true,
        resources: resourceAllocations.map(r => ({ resourceId: r.resource_id, quantity: r.quantity_allocated })),
    }, actor);

    await bookingContactRepo.createMany(cloned.booking_id, actor.companyId, contacts.map(contact => ({
        contactName:  contact.contact_name,
        mobile:       contact.mobile,
        email:        contact.email,
        relationship: contact.relationship,
        notes:        contact.notes,
    })));

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'booking.cloned',
        entityType: 'booking',
        entityId:   cloned.booking_id,
        description: `Booking ${cloned.booking_ref} cloned from ${source.booking_ref}`,
        oldValues:  { source_booking_id: bookingId },
        newValues:  { booking_id: cloned.booking_id },
    });

    return cloned;
};

// ─── Master Booking / Child Occupancy Slots ────────────────────────────────────
/**
 * Add a child occupancy slot under a master booking — e.g. a multi-hall or
 * multi-day wedding: Hall A (Day 1), Hall B (Day 2), Outdoor (Day 3). Each
 * slot is its own Bookings row (keeps reporting/availability simple) linked
 * via parent_booking_id. Customer/event name default to the master's.
 */
const addOccupancySlot = async (masterBookingId, slotData, actor) => {
    const master = await bookingRepo.findById(masterBookingId, actor.companyId);
    if (!master) throw new NotFoundError('Master booking');

    return create({
        ...slotData,
        customerId: slotData.customerId || master.customer_id,
        eventName:  slotData.eventName  || master.event_name,
        eventType:  slotData.eventType  || master.event_type,
        parentBookingId: masterBookingId,
    }, actor);
};

const getOccupancySlots = async (masterBookingId, companyId) => {
    const master = await bookingRepo.findById(masterBookingId, companyId);
    if (!master) throw new NotFoundError('Master booking');
    return bookingRepo.findChildren(masterBookingId, companyId);
};

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Derives the full hall-occupancy timeline from a booking's already-stored
 * fields (event_date/time, setup/cleanup/cooloff minutes) — no new schema,
 * this is purely making numbers the availability check and Resource Matrix
 * already use (see booking.repository.js's OVERLAP_CONDITION) legible as
 * named checkpoints for Booking Details:
 *   Setup Start → Guest Entry → Event Start → Event End → Guest Exit →
 *   Cleaning End → Cool-Off End (= Hall Released)
 */
const getOccupancyTimeline = (booking) => {
    // event_time_start/end come back from the mssql driver as native JS Date
    // objects on a 1970-01-01 epoch. String(dateObject) formats in the
    // *server's local timezone*, not UTC (unlike an already-JSON-serialized
    // HTTP response, where res.json() always renders Dates as UTC ISO) — on
    // a server whose local timezone isn't UTC, that silently shifted every
    // timeline timestamp below by the server's UTC offset. Always go through
    // toISOString() for a real Date first.
    const parseClock = (t) => {
        if (!t) return { h: 0, m: 0 };
        const iso = t instanceof Date ? t.toISOString() : String(t);
        const m = iso.match(/(\d{2}):(\d{2})/);
        return m ? { h: parseInt(m[1], 10), m: parseInt(m[2], 10) } : { h: 0, m: 0 };
    };
    const eventDateOnly = new Date(booking.event_date).toISOString().slice(0, 10);
    const startClock = parseClock(booking.event_time_start);
    const endClock = parseClock(booking.event_time_end);

    const eventStart = new Date(`${eventDateOnly}T00:00:00.000Z`);
    eventStart.setUTCHours(startClock.h, startClock.m, 0, 0);
    const eventEnd = new Date(`${eventDateOnly}T00:00:00.000Z`);
    eventEnd.setUTCHours(endClock.h, endClock.m, 0, 0);
    if (eventEnd <= eventStart) eventEnd.setUTCDate(eventEnd.getUTCDate() + 1); // overnight event

    const setupMinutes = booking.setup_minutes || 0;
    const cleanupMinutes = booking.cleanup_minutes || 0;
    const cooloffMinutes = booking.cooloff_minutes || 0;

    const setupStart = new Date(eventStart.getTime() - setupMinutes * 60000);
    const cleaningEnd = new Date(eventEnd.getTime() + cleanupMinutes * 60000);
    const hallReleaseTime = new Date(cleaningEnd.getTime() + cooloffMinutes * 60000);

    return {
        setupStart: setupStart.toISOString(),
        guestEntry: eventStart.toISOString(),
        eventStart: eventStart.toISOString(),
        eventEnd: eventEnd.toISOString(),
        guestExit: eventEnd.toISOString(),
        cleaningEnd: cleaningEnd.toISOString(),
        hallReleaseTime: hallReleaseTime.toISOString(),
        setupMinutes, cleanupMinutes, cooloffMinutes,
    };
};

const getById = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return { ...booking, occupancy_timeline: getOccupancyTimeline(booking) };
};

const getByRef = async (bookingRef, companyId) => {
    const booking = await bookingRepo.findByRef(bookingRef, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return booking;
};

const getAll = async (query, actor) => {
    // Default to newest-created-first when the caller doesn't specify a sort.
    // Sorting by event_date ASC by default buried freshly-created bookings for
    // future dates many pages deep, making them effectively invisible right
    // after creation even though they saved correctly.
    const queryWithDefaultSort = query.sort_by
        ? query
        : { ...query, sort_by: 'created_at', sort_dir: query.sort_dir || 'desc' };
    const pagination = parsePagination(queryWithDefaultSort, ['event_date', 'created_at', 'total_amount', 'status']);
    const { branchId, roleSlug } = actor;

    // Branch managers only see their branch
    const effectiveBranchId = roleSlug === 'branch_manager' ? branchId : (query.branch_id || null);

    // A Super Admin not currently impersonating a tenant sees bookings
    // across every tenant (same resolveCompanyScope used by halls/banquets)
    // rather than silently falling back to company_id=1 — that fallback
    // exists only to keep writes from ever hitting a null company FK.
    const { rows, total, statusCounts } = await bookingRepo.findAll({
        companyId: resolveCompanyScope(actor),
        branchId:   effectiveBranchId,
        status:     query.status     || null,
        hallId:     query.hall_id    ? parseInt(query.hall_id, 10)    : null,
        customerId: query.customer_id ? parseInt(query.customer_id, 10) : null,
        fromDate:   query.from_date  || null,
        toDate:     query.to_date    || null,
        search:     query.search     || null,
        isPriority: query.is_priority != null ? (query.is_priority === 'true' || query.is_priority === true) : null,
        ...pagination,
    });

    const stats = {
        total: Object.values(statusCounts).reduce((s, n) => s + n, 0),
        confirmed:    statusCounts.confirmed    || 0,
        fully_paid:   statusCounts.fully_paid   || 0,
        advance_paid: statusCounts.advance_paid || 0,
        cancelled:    statusCounts.cancelled    || 0,
        tentative:    statusCounts.tentative    || 0,
        completed:    statusCounts.completed    || 0,
        archived:     statusCounts.archived     || 0,
    };

    return { rows, meta: buildMeta(total, pagination), stats };
};

// ─── Update ───────────────────────────────────────────────────────────────────

const update = async (bookingId, data, actor) => {
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (['cancelled', 'completed', 'archived'].includes(existing.status)) {
        throw new ValidationError(`Cannot edit a ${existing.status} booking`);
    }

    // Changing the package re-snapshots its overtime rate/allowance onto the
    // booking (same snapshot principle as create()) — the new package's rate
    // takes effect immediately, but never retroactively if it's edited again later.
    let packageFields = {};
    const packageIdProvided = Object.prototype.hasOwnProperty.call(data, 'packageId');
    if (packageIdProvided) {
        if (data.packageId != null) {
            const pkg = await bookingPackageRepo.findPackageById(data.packageId, actor.companyId);
            if (!pkg) throw new NotFoundError('Booking package');
            if (!pkg.is_active) throw new ValidationError('This booking package is no longer available');
            // update() never carries eventTimeStart/eventTimeEnd (only reschedule() does),
            // so timing enforcement only applies at creation time; an edit that swaps to a
            // different duration package here just re-prices against the existing schedule.
            const hall = await hallRepo.findById(existing.hall_id, actor.companyId);
            packageFields = { packageOvertimeRate: pkg.overtime_rate_per_hour, packageMaxExtensionHours: pkg.max_extension_hours, packageBasePrice: computePackagePrice(pkg, hall) };
        } else {
            // Explicit null clears the package — removes the flat package rate
            // so recalculateBookingTotal() falls back to hall-price-with-surcharge below.
            packageFields = { packageOvertimeRate: null, packageMaxExtensionHours: null, packageBasePrice: null };
        }
    }

    await bookingRepo.update(bookingId, actor.companyId, { ...data, ...packageFields, packageIdProvided });
    // Guest count, catering selection, package, and per-booking charge fields
    // (all editable via this endpoint) all feed the stored total — keep it in
    // sync rather than letting it go stale until some unrelated edit touches it.
    await recalculateBookingTotal(bookingId, actor.companyId);
    const booking = await bookingRepo.findById(bookingId, actor.companyId);
    dashService.invalidateDashboardCache(actor.companyId);

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'booking.updated',
        entityType: 'booking',
        entityId:   bookingId,
        description: `Booking ${existing.booking_ref} details edited`,
        oldValues:  { event_name: existing.event_name, event_type: existing.event_type, guest_count: existing.guest_count, notes: existing.notes },
        newValues:  data,
    });

    return booking;
};

// ─── Reschedule ───────────────────────────────────────────────────────────────

const reschedule = async (bookingId, scheduleData, actor) => {
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (['cancelled', 'completed', 'archived'].includes(existing.status)) {
        throw new ValidationError(`Cannot reschedule a ${existing.status} booking`);
    }

    await bookingRepo.reschedule(bookingId, actor.companyId, scheduleData);
    // A hall move or date change can shift the weekend surcharge (different
    // hall's base price, or moving on/off a weekend) — keep total_amount in
    // sync rather than leaving it priced for the booking's old slot.
    await recalculateBookingTotal(bookingId, actor.companyId);
    const booking = await bookingRepo.findById(bookingId, actor.companyId);
    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Booking rescheduled', { bookingId, companyId: actor.companyId });

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'booking.rescheduled',
        entityType: 'booking',
        entityId:   bookingId,
        description: `Booking ${existing.booking_ref} rescheduled`,
        oldValues:  { event_date: existing.event_date, event_time_start: existing.event_time_start, event_time_end: existing.event_time_end },
        newValues:  scheduleData,
    });

    return booking;
};

// ─── Status ───────────────────────────────────────────────────────────────────

const updateStatus = async (bookingId, newStatus, actor) => {
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (!canTransition(existing.status, newStatus)) {
        throw new ValidationError(
            `Cannot transition booking from '${existing.status}' to '${newStatus}'`
        );
    }

    // 'completed' means the event happened AND the customer settled up —
    // the state machine allows the transition from 'advance_paid' as well
    // as 'fully_paid' (status labels drift from the real payment total
    // whenever staff forget to flip it after a payment lands), so check the
    // actual balance here rather than trusting the status label alone.
    if (newStatus === 'completed') {
        const balanceDue = (existing.total_amount || 0) - (existing.amount_paid || 0);
        if (balanceDue > 0.01) {
            throw new ValidationError(
                `Cannot mark this booking completed — ₹${balanceDue.toFixed(2)} is still outstanding. Record the remaining payment first.`
            );
        }
    }

    const booking = await bookingRepo.updateStatus(bookingId, actor.companyId, newStatus, actor.userId);
    dashService.invalidateDashboardCache(actor.companyId);

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'booking.status_changed',
        entityType: 'booking',
        entityId:   bookingId,
        description: `Booking ${existing.booking_ref} status changed from ${existing.status} to ${newStatus}`,
        oldValues:  { status: existing.status },
        newValues:  { status: newStatus },
    });

    if (newStatus === 'confirmed') {
        notificationRepo.notifyManagers({
            companyId: actor.companyId, branchId: actor.branchId,
            type: 'booking_confirmed',
            title: 'Booking confirmed',
            body: `${existing.booking_ref} — ${existing.event_name || 'Event'} is now confirmed`,
            referenceType: 'booking',
            referenceId: bookingId,
            excludeUserId: actor.userId,
        }).catch(err => logger.warn('Notification dispatch failed', { error: err.message }));
    }

    return booking;
};

// ─── Cancel ───────────────────────────────────────────────────────────────────

/**
 * Cancels a booking, optionally applying a cancellation charge and/or
 * processing a refund against a specific prior payment.
 *
 * Hall occupancy and resource/inventory availability do NOT need an explicit
 * "release" step here — every availability/occupancy query in this codebase
 * (bookingRepo.checkAvailability, resourceRepo.allocateInTx/getAvailability,
 * dashboard/report occupancy queries) already excludes status='cancelled'
 * bookings from its sums, so the hall and its allocated resources become
 * available to other bookings the instant the status flips, with no
 * separate release/restore logic required.
 */
const cancel = async (bookingId, reason, actor, options = {}) => {
    const { cancellationCharge, refundAmount, paymentId } = options;
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (existing.status === 'cancelled') {
        throw new ConflictError('Booking is already cancelled');
    }
    if (existing.status === 'completed' || existing.status === 'archived') {
        throw new ValidationError(`${existing.status === 'completed' ? 'Completed' : 'Archived'} bookings cannot be cancelled`);
    }
    if (refundAmount > 0 && !paymentId) {
        throw new ValidationError('paymentId is required to process a refund');
    }

    const booking = await bookingRepo.cancel(bookingId, actor.companyId, reason, actor.userId, cancellationCharge);
    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Booking cancelled', { bookingId, companyId: actor.companyId, reason });

    let refund = null;
    if (refundAmount > 0 && paymentId) {
        refund = await paymentService.refund(paymentId, { refundAmount, reason: reason || 'Booking cancellation refund' }, actor);
    }

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'booking.cancelled',
        entityType: 'booking',
        entityId:   bookingId,
        description: `Booking ${existing.booking_ref} cancelled${reason ? `: ${reason}` : ''}`
            + (cancellationCharge ? ` — charge ${cancellationCharge}` : '')
            + (refund ? ` — refunded ${refundAmount}` : ''),
        oldValues:  { status: existing.status },
        newValues:  { status: 'cancelled', reason: reason || null, cancellationCharge: cancellationCharge || 0, refundAmount: refundAmount || 0 },
    });

    notificationRepo.notifyManagers({
        companyId: actor.companyId, branchId: actor.branchId,
        type: 'booking_cancelled',
        title: 'Booking cancelled',
        body: `${existing.booking_ref} — ${existing.event_name || 'Event'} was cancelled${reason ? `: ${reason}` : ''}`,
        referenceType: 'booking',
        referenceId: bookingId,
        excludeUserId: actor.userId,
    }).catch(err => logger.warn('Notification dispatch failed', { error: err.message }));

    return { ...booking, refund };
};

// ─── Activity Timeline ─────────────────────────────────────────────────────────

const getActivityTimeline = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return auditLogRepo.findForEntity({ companyId, entityType: 'booking', entityId: bookingId });
};

const getResourceAllocations = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return resourceRepo.getAllocationsForBooking(bookingId, companyId);
};

/**
 * Reallocate a booking's inventory to a new set of quantities — used when
 * guest count/hall/catering changes after creation and the recommended
 * allocation needs to be recalculated (dynamic sync, not just at creation).
 */
const updateResourceAllocations = async (bookingId, companyId, resources, actor) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    if (['cancelled', 'completed', 'archived'].includes(booking.status)) {
        throw new ValidationError(`Cannot reallocate inventory for a ${booking.status} booking`);
    }

    await resourceRepo.reallocateForBooking(bookingId, companyId, resources, booking.event_date);
    // Billable resources contribute to total_amount — a reallocation can add,
    // remove, or resize billable items, so the stored total must follow.
    await recalculateBookingTotal(bookingId, companyId);
    dashService.invalidateDashboardCache(companyId);

    await auditLogRepo.log({
        companyId,
        userId:     actor.userId,
        action:     'booking.resources_updated',
        entityType: 'booking',
        entityId:   bookingId,
        description: `Inventory allocation updated for booking ${booking.booking_ref}`,
        newValues:  { resources },
    });

    return resourceRepo.getAllocationsForBooking(bookingId, companyId);
};

const getDecorationAllocations = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return decorationRepo.getAllocationsForBooking(bookingId, companyId);
};

/**
 * Reallocate a booking's decoration items to a new set of quantities — same
 * pattern as updateResourceAllocations (decorations are quantity-bound stock,
 * not a per-plate calculation). Called both right after booking creation
 * (Step 6 catalog selection) and on edit, since — unlike resources — the
 * create payload's decorations[] is never trusted at creation time; the
 * booking must exist first so the allocation rows can reference it.
 */
const updateDecorationAllocations = async (bookingId, companyId, decorations, actor) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    if (['cancelled', 'completed', 'archived'].includes(booking.status)) {
        throw new ValidationError(`Cannot reallocate decorations for a ${booking.status} booking`);
    }

    await decorationRepo.reallocateForBooking(bookingId, companyId, decorations, booking.event_date);
    // Decoration cost contributes to total_amount — see recalculateBookingTotal.
    await recalculateBookingTotal(bookingId, companyId);
    dashService.invalidateDashboardCache(companyId);

    await auditLogRepo.log({
        companyId,
        userId:     actor.userId,
        action:     'booking.decorations_updated',
        entityType: 'booking',
        entityId:   bookingId,
        description: `Decoration allocation updated for booking ${booking.booking_ref}`,
        newValues:  { decorations },
    });

    return decorationRepo.getAllocationsForBooking(bookingId, companyId);
};

// ─── Alternative Contacts ──────────────────────────────────────────────────────

const getContacts = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return bookingContactRepo.listForBooking(bookingId, companyId);
};

const addContact = async (bookingId, companyId, data) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return bookingContactRepo.create(bookingId, companyId, data);
};

const removeContact = async (bookingId, contactId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    await bookingContactRepo.remove(contactId, bookingId, companyId);
};

// ─── Staff Assignment (Command Center) ─────────────────────────────────────────

const getStaffAssignments = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return bookingStaffRepo.listForBooking(bookingId, companyId);
};

const assignStaff = async (bookingId, companyId, actorUserId, { userId, roleNote }) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    const assignment = await bookingStaffRepo.assign(bookingId, companyId, { userId, roleNote });

    await auditLogRepo.log({
        companyId, userId: actorUserId,
        action: 'booking.staff_assigned',
        entityType: 'booking', entityId: bookingId,
        description: `Staff member assigned to booking ${booking.booking_ref}${roleNote ? ` (${roleNote})` : ''}`,
        newValues: { assigned_user_id: userId, role_note: roleNote || null },
    });
    return assignment;
};

const removeStaffAssignment = async (bookingId, assignmentId, companyId, actorUserId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    await bookingStaffRepo.remove(assignmentId, bookingId, companyId);

    await auditLogRepo.log({
        companyId, userId: actorUserId,
        action: 'booking.staff_unassigned',
        entityType: 'booking', entityId: bookingId,
        description: `Staff assignment removed from booking ${booking.booking_ref}`,
    });
};

/**
 * Recompute and persist total_amount from the booking's current hall,
 * guest count, priority flag, catering selection, and billable resource
 * allocations — the single source of truth every edit path below funnels
 * through so total_amount can never drift from what's actually on the
 * booking. Payments/balance/outstanding-amount all read total_amount live
 * (see payment.service.js:withAdvanceInfo, sqlExpressions.balanceDueExpr),
 * so keeping this one column correct is sufficient to keep those correct too.
 *
 * Deliberately NOT included: operational rate-config changes
 * (operationalCharge.service.js upsert) — those are company-wide settings for
 * future bookings' wizard preview, not a per-booking snapshot, so changing
 * them must never retroactively reprice bookings that already exist. All 7
 * operational-charge components (setup/decoration/cleanup/cleaning/
 * late_exit/extended_usage/cooloff) are booking-level snapshot columns (set
 * at creation or explicit edit, see eventDetailFields) and are reused as-is
 * here, not recomputed from current company rates.
 */
const recalculateBookingTotal = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');

    const hall = await hallRepo.findById(booking.hall_id, companyId);
    if (!hall) throw new NotFoundError('Hall');

    // A selected rental package has its own fixed price (snapshotted at
    // booking time — package_base_price), which replaces the hall's
    // weekend-surcharge pricing entirely rather than stacking with it;
    // packages are a different pricing model (flat per-package rate), not a
    // hall-rate modifier. Bookings with no package keep the original
    // hall-price-with-weekend-surcharge calculation, unchanged.
    let hallPrice;
    if (booking.package_id && booking.package_base_price != null) {
        hallPrice = Math.round(parseFloat(booking.package_base_price) || 0);
    } else {
        const dow = new Date(booking.event_date).getDay();
        const isWeekend = dow === 0 || dow === 6;
        let basePrice = parseFloat(hall.base_price) || 0;
        const surchargePct = parseFloat(hall.weekend_surcharge_pct) || 0;
        if (isWeekend && surchargePct > 0) basePrice *= (1 + surchargePct / 100);
        hallPrice = Math.round(basePrice);
    }

    const prioritySurcharge = calculatePrioritySurcharge(hallPrice, booking.is_priority);

    // Prefer the new per-booking, multi-session catering plan when the
    // booking has any sessions — it supersedes the older single flat
    // catering_package_id/price_per_plate fields (which stay as a fallback
    // for bookings created before per-session catering existed, so their
    // totals don't drop to zero).
    const cateringSessionItems = await bookingCateringRepo.listItemsForBooking(bookingId, companyId);
    const cateringCost = cateringSessionItems.length
        ? Number(cateringSessionItems.reduce((sum, i) =>
            sum + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0) * (1 + (parseFloat(i.tax_percent) || 0) / 100), 0
          ).toFixed(2))
        : (booking.catering_package_id
            ? Math.round((parseFloat(booking.catering_price_per_plate) || 0) * (booking.guest_count || 0)
                + (parseFloat(booking.catering_tax_amount) || 0))
            : 0);

    const allocations = await resourceRepo.getAllocationsForBooking(bookingId, companyId);
    const resourceCost = allocations.reduce((sum, r) => (
        r.is_billable ? sum + (parseFloat(r.unit_price) || 0) * (r.quantity_allocated || 0) : sum
    ), 0);

    // Same fallback principle as catering above: prefer the catalog
    // allocation (rental + install + removal, less discount, plus tax) when
    // the booking has any DecorationItems allocated via the Decorations
    // module; fall back to the legacy flat decoration_charge column for
    // bookings priced before the catalog existed. Never sum both — that
    // would double-count (see backend/scripts/setup.js's DecorationItems
    // block and Decorations module notes for why decoration_charge was
    // pulled out of storedCharges below).
    const decorationAllocations = await decorationRepo.getAllocationsForBooking(bookingId, companyId);
    const decorationCost = decorationAllocations.length
        ? Number(decorationAllocations.reduce((sum, d) => {
            const base = (parseFloat(d.rental_price) || 0) * d.quantity_allocated
                + (parseFloat(d.installation_cost) || 0) + (parseFloat(d.removal_cost) || 0);
            const discounted = base * (1 - (parseFloat(d.discount_percent) || 0) / 100);
            return sum + discounted * (1 + (parseFloat(d.tax_percent) || 0) / 100);
        }, 0).toFixed(2))
        : (parseFloat(booking.decoration_charge) || 0);

    const storedCharges = ['setup_charge', 'cleanup_charge', 'cleaning_charge',
        'late_exit_charge', 'extended_usage_charge', 'cooloff_charge']
        .reduce((sum, col) => sum + (parseFloat(booking[col]) || 0), 0);

    const newTotal = Number((
        hallPrice
        + prioritySurcharge
        + storedCharges
        + cateringCost
        + resourceCost
        + decorationCost
    ).toFixed(2));

    if (newTotal !== parseFloat(booking.total_amount)) {
        await bookingRepo.updateTotalAmount(bookingId, companyId, newTotal);
        dashService.invalidateDashboardCache(companyId);
    }

    return newTotal;
};

/**
 * Calculate price for a hall booking (for wizard preview)
 */
const calculatePrice = async ({ hallId, eventDate, startTime, endTime, guestCount, companyId, isPriority, setupMinutes, cleanupMinutes, cooloffMinutes, lateExitHours, extendedUsageHours }) => {
    const hall = await hallRepo.findById(hallId, companyId);
    if (!hall) throw new NotFoundError('Hall');

    const date   = new Date(eventDate);
    const dow    = date.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dow === 0 || dow === 6;

    let basePrice  = parseFloat(hall.base_price) || 0;
    const surcharge = parseFloat(hall.weekend_surcharge_pct) || 0;
    if (isWeekend && surcharge > 0) {
        basePrice = basePrice * (1 + surcharge / 100);
    }

    const priceBeforePriority = Math.round(basePrice);
    const prioritySurcharge = calculatePrioritySurcharge(priceBeforePriority, isPriority);
    const totalPrice = priceBeforePriority + prioritySurcharge;
    const bookingDefaults = await settingsService.getBookingDefaults(companyId);
    const advance = calculateAdvanceAmount(totalPrice, bookingDefaults.advancePct);

    // Configurable operational charges (Setup/Decoration/Cleanup/Cleaning/
    // Late Exit/Extended Usage/Cool-Off) — same calculation the quotation,
    // invoice, and payment breakdown all read from, so they never drift.
    const operationalCharges = await operationalChargeService.calculateBookingCharges(companyId, {
        setupMinutes:   setupMinutes   != null ? setupMinutes   : bookingDefaults.setupMinutes,
        cleanupMinutes: cleanupMinutes != null ? cleanupMinutes : bookingDefaults.cleanupMinutes,
        cooloffMinutes: cooloffMinutes != null ? cooloffMinutes : bookingDefaults.cooloffMinutes,
        lateExitHours, extendedUsageHours,
        totalAmount: totalPrice,
    });

    return {
        hall_id:     hall.hall_id,
        hall_name:   hall.hall_name,
        base_price:  parseFloat(hall.base_price),
        is_weekend:  isWeekend,
        surcharge_pct: surcharge,
        is_priority: !!isPriority,
        priority_surcharge_pct: isPriority ? PRIORITY_SURCHARGE_PCT : 0,
        priority_surcharge: prioritySurcharge,
        total_price: totalPrice,
        advance_percentage: advance.percentage,
        advance_amount: advance.amount,
        capacity:    hall.capacity,
        operational_charges: operationalCharges,
        grand_total: Number((totalPrice + operationalCharges.total).toFixed(2)),
    };
};

module.exports = {
    checkAvailability,
    getBookedDates,
    calculatePrice,
    create,
    getById,
    getByRef,
    getAll,
    update,
    reschedule,
    updateStatus,
    cancel,
    recalculateBookingTotal,
    getActivityTimeline,
    getResourceAllocations,
    updateResourceAllocations,
    getDecorationAllocations,
    updateDecorationAllocations,
    getContacts,
    addContact,
    removeContact,
    getStaffAssignments,
    assignStaff,
    removeStaffAssignment,
    cloneBooking,
    addOccupancySlot,
    getOccupancySlots,
};
