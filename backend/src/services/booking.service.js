/**
 * Booking Service — Business logic for the booking engine
 * Enforces rules: availability, capacity, status transitions
 */

'use strict';

const bookingRepo  = require('../repositories/booking.repository');
const hallRepo     = require('../repositories/hall.repository');
const customerRepo = require('../repositories/customer.repository');
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
    draft:        ['confirmed', 'cancelled'],
    confirmed:    ['advance_paid', 'fully_paid', 'cancelled'],
    advance_paid: ['fully_paid', 'cancelled', 'completed'],
    fully_paid:   ['completed', 'cancelled'],
    completed:    [],   // terminal
    cancelled:    [],   // terminal
    no_show:      [],
};

const canTransition = (from, to) =>
    (ALLOWED_TRANSITIONS[from] || []).includes(to);

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

    const booking = await bookingRepo.create({
        ...data,
        companyId,
        branchId,
        createdBy: userId,
    });

    // Invalidate dashboard cache
    dashService.invalidateDashboardCache(companyId);

    // Send confirmation email (non-blocking)
    notif.sendBookingConfirmationEmail({
        to:        customer.email,
        firstName: customer.first_name,
        booking,
    }).catch(err => logger.warn('Confirmation email failed', { error: err.message }));

    logger.info('Booking created', { bookingId: booking.booking_id, companyId, userId });
    return booking;
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
    const pagination = parsePagination(query, ['event_date', 'created_at', 'total_amount', 'status']);
    const { companyId, branchId, roleSlug } = actor;

    // Branch managers only see their branch
    const effectiveBranchId = roleSlug === 'branch_manager' ? branchId : (query.branch_id || null);

    const { rows, total } = await bookingRepo.findAll({
        companyId,
        branchId:   effectiveBranchId,
        status:     query.status     || null,
        hallId:     query.hall_id    ? parseInt(query.hall_id, 10)    : null,
        customerId: query.customer_id ? parseInt(query.customer_id, 10) : null,
        fromDate:   query.from_date  || null,
        toDate:     query.to_date    || null,
        search:     query.search     || null,
        ...pagination,
    });

    return { rows, meta: buildMeta(total, pagination) };
};

// ─── Update ───────────────────────────────────────────────────────────────────

const update = async (bookingId, data, actor) => {
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (['cancelled', 'completed'].includes(existing.status)) {
        throw new ValidationError(`Cannot edit a ${existing.status} booking`);
    }

    const booking = await bookingRepo.update(bookingId, actor.companyId, data);
    dashService.invalidateDashboardCache(actor.companyId);
    return booking;
};

// ─── Reschedule ───────────────────────────────────────────────────────────────

const reschedule = async (bookingId, scheduleData, actor) => {
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (['cancelled', 'completed'].includes(existing.status)) {
        throw new ValidationError(`Cannot reschedule a ${existing.status} booking`);
    }

    const booking = await bookingRepo.reschedule(bookingId, actor.companyId, scheduleData);
    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Booking rescheduled', { bookingId, companyId: actor.companyId });
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
    return booking;
};

// ─── Cancel ───────────────────────────────────────────────────────────────────

const cancel = async (bookingId, reason, actor) => {
    const existing = await bookingRepo.findById(bookingId, actor.companyId);
    if (!existing) throw new NotFoundError('Booking');

    if (existing.status === 'cancelled') {
        throw new ConflictError('Booking is already cancelled');
    }
    if (existing.status === 'completed') {
        throw new ValidationError('Completed bookings cannot be cancelled');
    }

    const booking = await bookingRepo.cancel(bookingId, actor.companyId, reason, actor.userId);
    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Booking cancelled', { bookingId, companyId: actor.companyId, reason });
    return booking;
};

/**
 * Calculate price for a hall booking (for wizard preview)
 */
const calculatePrice = async ({ hallId, eventDate, startTime, endTime, guestCount, companyId }) => {
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

    return {
        hall_id:     hall.hall_id,
        hall_name:   hall.hall_name,
        base_price:  parseFloat(hall.base_price),
        is_weekend:  isWeekend,
        surcharge_pct: surcharge,
        total_price: Math.round(basePrice),
        capacity:    hall.capacity,
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
};
