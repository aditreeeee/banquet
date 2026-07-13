/**
 * Invoice Service
 */
'use strict';

const { withTransaction } = require('../config/database');
const invoiceRepo = require('../repositories/invoice.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const settingsService = require('./settings.service');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const list = async (companyId, { search, status, month, page, limit }) => {
    const offset = (page - 1) * limit;
    const { rows, total, stats } = await invoiceRepo.findAll(companyId, { search, status, month, limit, offset });
    return { rows, total, stats };
};

const getById = async (invoiceId, companyId) => {
    const invoice = await invoiceRepo.findById(invoiceId, companyId);
    if (!invoice) throw new NotFoundError('Invoice');
    return invoice;
};

/**
 * Generate an invoice for a booking — the booking's current total_amount is
 * the taxable base (already fully priced by booking.service.js's
 * recalculateBookingTotal), so this never re-derives revenue independently.
 *
 * Runs the booking lookup, sequence-number allocation, and insert inside one
 * transaction: without this, two concurrent requests for the same booking
 * could both read "no invoice yet" and both insert one, and two concurrent
 * requests for different bookings could race on the same sequence number.
 * The UPDLOCK/HOLDLOCK in nextSequenceForYear serializes the latter; the
 * unique (company_id, invoice_number) constraint is the last-resort backstop
 * for both.
 */
const generateForBooking = async (bookingId, actor) => {
    return withTransaction(async (tx) => {
        const bookingRows = await tx.execute(
            `SELECT b.booking_id, b.total_amount, b.booking_ref, b.customer_id
             FROM Bookings b WITH (UPDLOCK, HOLDLOCK)
             WHERE b.booking_id = @bookingId AND b.company_id = @companyId`,
            { bookingId, companyId: actor.companyId }
        );
        const b = bookingRows[0];
        if (!b) throw new NotFoundError('Booking');

        const existing = await tx.execute(
            `SELECT invoice_id FROM Invoices WHERE booking_id = @bookingId AND is_cancelled = 0`,
            { bookingId }
        );
        if (existing[0]) throw new ValidationError('An active invoice already exists for this booking');

        const year = new Date().getFullYear();
        const seq = await invoiceRepo.nextSequenceForYear(tx, actor.companyId, year);
        const invoiceNumber = `INV-${year}-${String(seq).padStart(6, '0')}`;

        const { cgstRate, sgstRate } = await settingsService.getTaxRates(actor.companyId);
        const taxableAmount = parseFloat(b.total_amount);
        const cgstAmount = Math.round(taxableAmount * (cgstRate / 100) * 100) / 100;
        const sgstAmount = Math.round(taxableAmount * (sgstRate / 100) * 100) / 100;
        const grandTotal = taxableAmount + cgstAmount + sgstAmount;

        const invoiceId = await invoiceRepo.create(tx, {
            invoiceNumber,
            companyId: actor.companyId,
            bookingId: b.booking_id,
            customerId: b.customer_id,
            taxableAmount, cgstRate, cgstAmount, sgstRate, sgstAmount, grandTotal,
            createdBy: actor.userId,
        });

        await auditLogRepo.log({
            companyId: actor.companyId,
            userId: actor.userId,
            action: 'invoice.generated',
            entityType: 'invoice',
            entityId: invoiceId,
            description: `Invoice ${invoiceNumber} generated for booking ${b.booking_ref}`,
            newValues: { invoiceNumber, bookingId: b.booking_id, taxableAmount, cgstAmount, sgstAmount, grandTotal },
        });

        return { invoice_id: invoiceId, invoice_number: invoiceNumber };
    });
};

const createForBookingRef = async ({ bookingId, booking_ref: bookingRef }, actor) => {
    if (!bookingId && !bookingRef) throw new ValidationError('bookingId or booking_ref is required');
    let resolvedId = bookingId ? parseInt(bookingId, 10) : null;
    if (!resolvedId) {
        const booking = await invoiceRepo.findBookingByRef(bookingRef, actor.companyId);
        if (!booking) throw new NotFoundError('Booking');
        resolvedId = booking.booking_id;
    }
    return generateForBooking(resolvedId, actor);
};

const cancel = async (invoiceId, actor) => {
    const invoice = await invoiceRepo.findById(invoiceId, actor.companyId);
    if (!invoice) throw new NotFoundError('Invoice');
    await invoiceRepo.cancel(invoiceId, actor.companyId);
    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'invoice.cancelled',
        entityType: 'invoice',
        entityId: invoiceId,
        description: `Invoice ${invoiceId} cancelled`,
    });
};

module.exports = { list, getById, generateForBooking, createForBookingRef, cancel };
