/**
 * Payment Service
 */
'use strict';

const payRepo     = require('../repositories/payment.repository');
const bookingRepo = require('../repositories/booking.repository');
const dashService = require('./dashboard.service');
const auditLogRepo = require('../repositories/auditLog.repository');
const settingsService = require('./settings.service');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const logger = require('../utils/logger');

// Same formula as booking.service.js's calculateAdvanceAmount (not imported
// directly — booking.service.js already requires this module, and requiring
// it back here would create a circular dependency that breaks module
// loading order). Keep in sync if the advance-rounding rule ever changes.
const calculateAdvanceAmount = (totalAmount, advancePct) =>
    Math.round((parseFloat(totalAmount) || 0) * (advancePct / 100));

/**
 * Surfaces the "Required Advance" alongside the booking's actual paid/balance
 * figures, using the same advance-percentage formula the booking wizard uses
 * so this never drifts from what the customer was originally quoted.
 */
const withAdvanceInfo = async (booking, companyId) => {
    const defaults = await settingsService.getBookingDefaults(companyId);
    const requiredAdvance = calculateAdvanceAmount(booking.total_amount, defaults.advancePct);
    const amountPaid = booking.amount_paid || 0;
    return {
        totalAmount:     booking.total_amount,
        requiredAdvance,
        advancePaid:     Math.min(amountPaid, requiredAdvance),
        amountPaid,
        balanceDue:      Math.max(booking.total_amount - amountPaid, 0),
    };
};

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['created_at', 'amount', 'status']);
    const { rows, total } = await payRepo.findAll({
        companyId: actor.companyId,
        branchId:  actor.branchId || query.branch_id || null,
        status:    query.status   || null,
        method:    query.method   || null,
        bookingId: query.booking_id ? parseInt(query.booking_id, 10) : null,
        customerId: query.customer_id ? parseInt(query.customer_id, 10) : null,
        fromDate:  query.from_date  || null,
        toDate:    query.to_date    || null,
        search:    query.search     || null,
        ...p,
    });
    return { rows, meta: buildMeta(total, p) };
};

const getStats = async (actor) => payRepo.getStats(actor.companyId);

const getById = async (id, companyId) => {
    const p = await payRepo.findById(id, companyId);
    if (!p) throw new NotFoundError('Payment');
    return p;
};

const getByBooking = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    const [payments, refunds, advanceInfo] = await Promise.all([
        payRepo.findByBooking(bookingId, companyId),
        payRepo.getRefundsForBooking(bookingId, companyId),
        withAdvanceInfo(booking, companyId),
    ]);
    return { booking, payments, refunds, advanceInfo };
};

const getRefundsForPayment = async (paymentId, companyId) => {
    const payment = await payRepo.findById(paymentId, companyId);
    if (!payment) throw new NotFoundError('Payment');
    return payRepo.getRefundsForPayment(paymentId, companyId);
};

const getAllRefunds = async (actor) => payRepo.findAllRefunds(actor.companyId);

const create = async (data, actor) => {
    // Accept both camelCase (programmatic) and snake_case (frontend form)
    const bookingId     = parseInt(data.bookingId     || data.booking_id,    10) || null;
    const paymentMethod = data.paymentMethod || data.payment_method;
    const paymentType   = data.paymentType   || data.payment_type;
    const referenceNumber = data.referenceNumber || data.transaction_id || data.reference_number || null;
    const notes         = data.notes || data.remarks || null;

    const booking = await bookingRepo.findById(bookingId, actor.companyId);
    if (!booking) throw new NotFoundError('Booking');

    if (['cancelled', 'draft'].includes(booking.status)) {
        throw new ValidationError(`Cannot record payment for a ${booking.status} booking`);
    }

    // The authoritative balance check happens inside payRepo.create()'s locking
    // transaction (WITH (UPDLOCK, HOLDLOCK) on the booking row) — this closes
    // the TOCTOU race a plain pre-check here would leave open between two
    // concurrent requests. This is just a fast-path UX rejection so a request
    // that's obviously over the (possibly-stale) balance fails without a
    // round-trip; the real enforcement is in the repository.
    const remainingBalance = booking.total_amount - (booking.amount_paid || 0);
    if (data.amount > remainingBalance + 0.01) {
        throw new ValidationError(
            `Payment amount (${data.amount}) exceeds remaining balance (${remainingBalance.toFixed(2)})`
        );
    }

    let payment;
    try {
        payment = await payRepo.create({
            bookingId,
            companyId:     actor.companyId,
            amount:        data.amount,
            paymentMethod,
            paymentType,
            referenceNumber,
            notes,
            createdBy:     actor.userId,
        });
    } catch (err) {
        if (err.isValidation) throw new ValidationError(err.message);
        throw err;
    }

    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Payment recorded', { paymentId: payment.payment_id, bookingId, amount: data.amount });
    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'payment.created',
        entityType: 'payment',
        entityId:   payment.payment_id,
        description: `Payment of ${data.amount} recorded for booking ${bookingId}`,
        newValues:  { amount: data.amount, paymentMethod, paymentType, bookingId },
    });
    return payment;
};

const getPending = async (query, actor) => {
    const daysAhead = parseInt(query.days_ahead, 10) || 30;
    return payRepo.findPending(actor.companyId, daysAhead);
};

const refund = async (paymentId, { refundAmount, reason, method }, actor) => {
    if (!reason || !reason.trim()) {
        throw new ValidationError('A refund reason is required');
    }
    if (!(refundAmount > 0)) {
        throw new ValidationError('Refund amount must be greater than zero');
    }

    const payment = await payRepo.findById(paymentId, actor.companyId);
    if (!payment) throw new NotFoundError('Payment');

    // The authoritative "not already fully refunded" / "amount within
    // refundable balance" checks happen inside payRepo.refund()'s locking
    // transaction (against the real sum of prior Refunds rows) — this is
    // just a fast-path UX rejection using the (possibly-stale) read above.
    if (payment.status === 'refunded') {
        throw new ValidationError('Payment has already been fully refunded');
    }
    if (refundAmount > payment.amount) {
        throw new ValidationError('Refund amount cannot exceed the original payment amount');
    }

    let result;
    try {
        result = await payRepo.refund({
            paymentId,
            companyId:    actor.companyId,
            refundAmount,
            reason,
            method,
            createdBy:    actor.userId,
        });
    } catch (err) {
        if (err.isValidation) throw new ValidationError(err.message);
        throw err;
    }

    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Payment refunded', { paymentId, refundAmount });
    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'payment.refunded',
        entityType: 'payment',
        entityId:   paymentId,
        description: `Payment ${paymentId} refunded: ${refundAmount}${reason ? ` (${reason})` : ''}`,
        oldValues:  { status: payment.status, amount: payment.amount },
        newValues:  { refundAmount, reason },
    });
    return result;
};

module.exports = { getAll, getById, getByBooking, create, refund, getPending, getStats, getRefundsForPayment, getAllRefunds };
