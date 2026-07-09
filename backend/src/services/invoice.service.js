/**
 * Invoice Service — extracted from invoice.routes.js's inline POST handler so
 * other flows (Quotations converting to a booking) can generate an invoice
 * through the exact same tax/total math instead of duplicating it.
 */
'use strict';

const { executeQuery } = require('../config/database');
const auditLogRepo = require('../repositories/auditLog.repository');
const settingsService = require('./settings.service');
const { NotFoundError } = require('../api/v1/middleware/errorHandler');

/**
 * Generate an invoice for a booking — the booking's current total_amount is
 * the taxable base (already fully priced by booking.service.js's
 * recalculateBookingTotal), so this never re-derives revenue independently.
 */
const generateForBooking = async (bookingId, actor) => {
    const bookingRows = await executeQuery(
        `SELECT b.booking_id, b.total_amount, b.booking_ref, b.customer_id
         FROM Bookings b WHERE b.booking_id = @bookingId AND b.company_id = @companyId`,
        { bookingId, companyId: actor.companyId }
    );
    const b = bookingRows[0];
    if (!b) throw new NotFoundError('Booking');

    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${Date.now().toString().slice(-6)}`;

    const { cgstRate, sgstRate } = await settingsService.getTaxRates(actor.companyId);
    const taxableAmount = parseFloat(b.total_amount);
    const cgstAmount = Math.round(taxableAmount * (cgstRate / 100) * 100) / 100;
    const sgstAmount = Math.round(taxableAmount * (sgstRate / 100) * 100) / 100;
    const grandTotal = taxableAmount + cgstAmount + sgstAmount;

    const result = await executeQuery(
        `INSERT INTO Invoices
            (invoice_number, company_id, booking_id, customer_id,
             invoice_date, due_date,
             subtotal, discount_amount, taxable_amount,
             cgst_rate, cgst_amount, sgst_rate, sgst_amount,
             grand_total, amount_paid, balance_due,
             payment_status, created_by, created_at)
         OUTPUT INSERTED.invoice_id AS insertId
         VALUES
            (@invoiceNumber, @companyId, @bookingId, @customerId,
             CAST(GETUTCDATE() AS DATE), DATEADD(day, 7, CAST(GETUTCDATE() AS DATE)),
             @taxableAmount, 0, @taxableAmount,
             @cgstRate, @cgstAmount, @sgstRate, @sgstAmount,
             @grandTotal, 0, @grandTotal,
             'pending', @createdBy, GETUTCDATE())`,
        {
            invoiceNumber,
            companyId: actor.companyId,
            bookingId: b.booking_id,
            customerId: b.customer_id,
            taxableAmount, cgstRate, cgstAmount, sgstRate, sgstAmount, grandTotal,
            createdBy: actor.userId,
        }
    );

    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'invoice.generated',
        entityType: 'invoice',
        entityId: result[0].insertId,
        description: `Invoice ${invoiceNumber} generated for booking ${b.booking_ref}`,
        newValues: { invoiceNumber, bookingId: b.booking_id, taxableAmount, cgstAmount, sgstAmount, grandTotal },
    });

    return { invoice_id: result[0].insertId, invoice_number: invoiceNumber };
};

module.exports = { generateForBooking };
