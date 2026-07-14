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
 * HSN/SAC-grouped tax breakdown for Revenue Reports — catering items are the
 * only booking line items with a per-line HSN/SAC snapshot today
 * (BookingCateringItems.tax_percent, joined here to MenuItems for its
 * hsn_sac_code); hall rental, decoration, resources and operational charges
 * have no per-line tax snapshot yet, so they fall into a single "Other
 * Charges" bucket taxed at the invoice's flat CGST+SGST rate. Returns a JSON
 * string ready for Invoices.hsn_sac_breakdown, or null when there's nothing
 * to break down (taxableAmount <= 0).
 */
const buildHsnSacBreakdown = async (tx, bookingId, companyId, taxableAmount, flatTaxPct) => {
    if (!(taxableAmount > 0)) return null;

    const cateringRows = await tx.execute(
        `SELECT ISNULL(mi.hsn_sac_code, 'UNCLASSIFIED') AS hsn_sac_code, ISNULL(mi.tax_type, 'hsn') AS tax_type,
                bci.tax_percent,
                SUM(bci.quantity * bci.unit_price) AS taxable_value
         FROM BookingCateringItems bci
         JOIN BookingCateringSessions bcs ON bcs.session_id = bci.session_id
         LEFT JOIN MenuItems mi ON mi.item_id = bci.item_id
         WHERE bcs.booking_id = @bookingId AND bcs.company_id = @companyId
         GROUP BY ISNULL(mi.hsn_sac_code, 'UNCLASSIFIED'), ISNULL(mi.tax_type, 'hsn'), bci.tax_percent`,
        { bookingId, companyId }
    );

    const breakdown = cateringRows.map(r => ({
        hsn_sac_code: r.hsn_sac_code,
        tax_type: r.tax_type,
        tax_percent: r.tax_percent,
        taxable_value: Math.round(r.taxable_value * 100) / 100,
        tax_amount: Math.round(r.taxable_value * (r.tax_percent / 100) * 100) / 100,
    }));

    const cateringTotal = breakdown.reduce((s, r) => s + r.taxable_value, 0);
    const otherValue = Math.round((taxableAmount - cateringTotal) * 100) / 100;
    if (otherValue > 0) {
        breakdown.push({
            hsn_sac_code: 'OTHER',
            tax_type: 'sac',
            tax_percent: flatTaxPct,
            taxable_value: otherValue,
            tax_amount: Math.round(otherValue * (flatTaxPct / 100) * 100) / 100,
            label: 'Hall Rental, Decoration & Other Services',
        });
    }

    return breakdown.length ? JSON.stringify(breakdown) : null;
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

        const hsnSacBreakdown = await buildHsnSacBreakdown(tx, b.booking_id, actor.companyId, taxableAmount, cgstRate + sgstRate);

        const invoiceId = await invoiceRepo.create(tx, {
            invoiceNumber,
            companyId: actor.companyId,
            bookingId: b.booking_id,
            customerId: b.customer_id,
            taxableAmount, cgstRate, cgstAmount, sgstRate, sgstAmount, grandTotal,
            hsnSacBreakdown,
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
