/**
 * Payment Service
 */
'use strict';

const payRepo     = require('../repositories/payment.repository');
const bookingRepo = require('../repositories/booking.repository');
const dashService = require('./dashboard.service');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const logger = require('../utils/logger');

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['created_at', 'amount', 'status']);
    const { rows, total } = await payRepo.findAll({
        companyId: actor.companyId,
        branchId:  actor.branchId || query.branch_id || null,
        status:    query.status   || null,
        method:    query.method   || null,
        bookingId: query.booking_id ? parseInt(query.booking_id, 10) : null,
        fromDate:  query.from_date  || null,
        toDate:    query.to_date    || null,
        ...p,
    });
    return { rows, meta: buildMeta(total, p) };
};

const getById = async (id, companyId) => {
    const p = await payRepo.findById(id, companyId);
    if (!p) throw new NotFoundError('Payment');
    return p;
};

const getByBooking = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    const payments = await payRepo.findByBooking(bookingId, companyId);
    return { booking, payments };
};

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

    const remainingBalance = booking.total_amount - (booking.amount_paid || 0);
    if (data.amount > remainingBalance + 0.01) {
        throw new ValidationError(
            `Payment amount (${data.amount}) exceeds remaining balance (${remainingBalance.toFixed(2)})`
        );
    }

    const payment = await payRepo.create({
        bookingId,
        companyId:     actor.companyId,
        amount:        data.amount,
        paymentMethod,
        paymentType,
        referenceNumber,
        notes,
        createdBy:     actor.userId,
    });

    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Payment recorded', { paymentId: payment.payment_id, bookingId, amount: data.amount });
    return payment;
};

const getPending = async (query, actor) => {
    const daysAhead = parseInt(query.days_ahead, 10) || 30;
    return payRepo.findPending(actor.companyId, daysAhead);
};

const refund = async (paymentId, { refundAmount, reason }, actor) => {
    const payment = await payRepo.findById(paymentId, actor.companyId);
    if (!payment) throw new NotFoundError('Payment');

    if (payment.status === 'refunded') {
        throw new ValidationError('Payment has already been refunded');
    }

    if (refundAmount > payment.amount) {
        throw new ValidationError('Refund amount cannot exceed the original payment amount');
    }

    const result = await payRepo.refund({
        paymentId,
        companyId:    actor.companyId,
        refundAmount,
        reason,
        createdBy:    actor.userId,
    });

    dashService.invalidateDashboardCache(actor.companyId);
    logger.info('Payment refunded', { paymentId, refundAmount });
    return result;
};

module.exports = { getAll, getById, getByBooking, create, refund, getPending };
