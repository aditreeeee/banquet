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
const bookingContactRepo = require('../repositories/bookingContact.repository');
const bookingStaffRepo = require('../repositories/bookingStaff.repository');
const notificationRepo = require('../repositories/notification.repository');
const operationalChargeService = require('./operationalCharge.service');
const dashService  = require('./dashboard.service');
const notif        = require('./notification.service');
const logger       = require('../utils/logger');
const { parsePagination, buildMeta } = require('../utils/pagination');
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

// ─── Advance payment auto-calculation ──────────────────────────────────────────
/**
 * Bookings made less than a month out require a larger deposit since there's
 * less time to recover the slot if the customer defaults; otherwise a lighter
 * 20% deposit applies.
 */
const calculateAdvanceAmount = (eventDate, totalAmount) => {
    const daysUntilEvent = Math.ceil((new Date(eventDate) - new Date()) / (1000 * 60 * 60 * 24));
    const percentage = daysUntilEvent < 30 ? 50 : 20;
    return {
        percentage,
        amount: Math.round((parseFloat(totalAmount) || 0) * (percentage / 100)),
    };
};

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

    const prioritySurcharge = calculatePrioritySurcharge(data.totalAmount, data.isPriority);
    // Owner can override the auto-calculated deposit by passing advancePaid explicitly.
    const advancePaid = data.advancePaid != null
        ? data.advancePaid
        : calculateAdvanceAmount(data.eventDate, data.totalAmount).amount;

    const booking = await bookingRepo.create({
        ...data,
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

const getById = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return booking;
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
    const { companyId, branchId, roleSlug } = actor;

    // Branch managers only see their branch
    const effectiveBranchId = roleSlug === 'branch_manager' ? branchId : (query.branch_id || null);

    const { rows, total, statusCounts } = await bookingRepo.findAll({
        companyId,
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

    const booking = await bookingRepo.update(bookingId, actor.companyId, data);
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

    const booking = await bookingRepo.reschedule(bookingId, actor.companyId, scheduleData);
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

const cancel = async (bookingId, reason, actor) => {
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (existing.status === 'cancelled') {
        throw new ConflictError('Booking is already cancelled');
    }
    if (existing.status === 'completed' || existing.status === 'archived') {
        throw new ValidationError(`${existing.status === 'completed' ? 'Completed' : 'Archived'} bookings cannot be cancelled`);
    }

    const booking = await bookingRepo.cancel(bookingId, actor.companyId, reason, actor.userId);
    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Booking cancelled', { bookingId, companyId: actor.companyId, reason });

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'booking.cancelled',
        entityType: 'booking',
        entityId:   bookingId,
        description: `Booking ${existing.booking_ref} cancelled${reason ? `: ${reason}` : ''}`,
        oldValues:  { status: existing.status },
        newValues:  { status: 'cancelled', reason: reason || null },
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

    return booking;
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
    const advance = calculateAdvanceAmount(eventDate, totalPrice);

    // Configurable operational charges (Setup/Decoration/Cleanup/Cleaning/
    // Late Exit/Extended Usage/Cool-Off) — same calculation the quotation,
    // invoice, and payment breakdown all read from, so they never drift.
    const operationalCharges = await operationalChargeService.calculateBookingCharges(companyId, {
        setupMinutes, cleanupMinutes, cooloffMinutes, lateExitHours, extendedUsageHours,
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
    getActivityTimeline,
    getResourceAllocations,
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
