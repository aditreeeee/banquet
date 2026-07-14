/**
 * Quotation Service — Finance/CRM. Create from a lead (or standalone), price
 * with line items, revise, get accepted by the customer, then convert into a
 * real Booking + Invoice using the exact same creation logic every other
 * booking/invoice goes through (bookingService.create, invoiceService.
 * generateForBooking) — so Reports/Dashboard/Payments need no separate
 * awareness of quotations at all; they only ever see the resulting Booking.
 */
'use strict';

const crypto = require('crypto');
const quotationRepo = require('../repositories/quotation.repository');
const leadRepo = require('../repositories/lead.repository');
const bookingService = require('./booking.service');
const invoiceService = require('./invoice.service');
const auditLogRepo = require('../repositories/auditLog.repository');
const notifyService = require('./notify.service');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');

// draft -> sent -> accepted -> converted
// draft/sent -> rejected/expired (terminal, except a revision can restart the chain)
const ALLOWED_TRANSITIONS = {
    draft:     ['sent', 'rejected', 'expired'],
    sent:      ['accepted', 'rejected', 'expired'],
    accepted:  ['converted'],
    rejected:  [],
    expired:   [],
    converted: [],
};

const list = async (query, actor) => {
    const p = parsePagination(query, ['created_at']);
    const { rows, total } = await quotationRepo.findAll({
        companyId: actor.companyId,
        status: query.status || null,
        leadId: query.lead_id ? parseInt(query.lead_id, 10) : null,
        customerId: query.customer_id ? parseInt(query.customer_id, 10) : null,
        search: query.search || null,
        ...p,
    });
    return { rows, meta: buildMeta(total, p) };
};

const getById = async (id, companyId) => {
    const q = await quotationRepo.findById(id, companyId);
    if (!q) throw new NotFoundError('Quotation');
    const items = await quotationRepo.getItems(id);
    const revisions = await quotationRepo.getRevisions(id, companyId);
    return { ...q, items, revisions };
};

/**
 * Create a quotation, optionally from a lead (prefills contact/event/guest
 * data — see lead.service.js's own convertToBooking for the same pattern).
 */
const create = async (data, actor) => {
    let lead = null;
    if (data.leadId) {
        lead = await leadRepo.findById(data.leadId, actor.companyId);
        if (!lead) throw new NotFoundError('Lead');
    }

    const quotation = await quotationRepo.create({
        companyId: actor.companyId,
        branchId: actor.branchId,
        leadId: data.leadId || null,
        customerId: data.customerId || lead?.customer_id || null,
        eventName: data.eventName || lead?.contact_name || null,
        eventType: data.eventType || lead?.event_type || null,
        eventDate: data.eventDate || lead?.preferred_date || null,
        guestCount: data.guestCount || lead?.guest_count || null,
        hallId: data.hallId || null,
        discountAmount: data.discountAmount || 0,
        notes: data.notes || null,
        expiryDate: data.expiryDate || null,
        createdBy: actor.userId,
    });

    for (const item of (data.items || [])) {
        await quotationRepo.addItem(quotation.quotation_id, {
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? item.unit_price,
            taxPercent: item.taxPercent ?? item.tax_percent,
        });
    }
    const priced = await quotationRepo.recalculateTotals(quotation.quotation_id, actor.companyId);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'quotation.created', entityType: 'quotation', entityId: quotation.quotation_id,
        description: `Quotation ${quotation.quotation_number} created${lead ? ` from lead ${lead.contact_name}` : ''}`,
        newValues: { grand_total: priced.grand_total },
    });

    notifyService.notify({
        companyId: actor.companyId, branchId: actor.branchId,
        category: 'quotation', type: 'quotation.created',
        title: 'New quotation',
        body: `${quotation.quotation_number} — ${quotation.event_name || 'Event'} (₹${priced.grand_total})`,
        referenceType: 'quotation', referenceId: quotation.quotation_id,
        excludeUserId: actor.userId,
    }).catch(err => logger.warn('Notification dispatch failed', { error: err.message }));

    if (lead) {
        // Advance the lead's pipeline stage to reflect a quotation now exists
        // — reuses lead.service.js's own transition validation, so this can
        // never leave the pipeline in an inconsistent state. Non-critical:
        // if the lead has already moved past 'quotation', leave it alone.
        try {
            const leadService = require('./lead.service');
            await leadService.advanceStage(lead.lead_id, 'quotation', actor);
        } catch { /* lead already past this stage, or transition not applicable */ }
    }

    return getById(quotation.quotation_id, actor.companyId);
};

const addItem = async (quotationId, data, actor) => {
    const q = await quotationRepo.findById(quotationId, actor.companyId);
    if (!q) throw new NotFoundError('Quotation');
    if (q.status !== 'draft') throw new ValidationError(`Cannot edit a ${q.status} quotation — create a revision instead`);
    await quotationRepo.addItem(quotationId, {
        description: data.description, quantity: data.quantity,
        unitPrice: data.unitPrice ?? data.unit_price, taxPercent: data.taxPercent ?? data.tax_percent,
    });
    return quotationRepo.recalculateTotals(quotationId, actor.companyId);
};

const removeItem = async (quotationId, itemRowId, actor) => {
    const q = await quotationRepo.findById(quotationId, actor.companyId);
    if (!q) throw new NotFoundError('Quotation');
    if (q.status !== 'draft') throw new ValidationError(`Cannot edit a ${q.status} quotation — create a revision instead`);
    await quotationRepo.removeItem(quotationId, itemRowId);
    return quotationRepo.recalculateTotals(quotationId, actor.companyId);
};

const update = async (quotationId, data, actor) => {
    const q = await quotationRepo.findById(quotationId, actor.companyId);
    if (!q) throw new NotFoundError('Quotation');
    if (q.status !== 'draft') throw new ValidationError(`Cannot edit a ${q.status} quotation — create a revision instead`);
    const updated = await quotationRepo.update(quotationId, actor.companyId, data);
    return quotationRepo.recalculateTotals(quotationId, actor.companyId) || updated;
};

/** Create a new revision — copies the current line items forward, links parent_quotation_id. */
const revise = async (quotationId, actor) => {
    const q = await quotationRepo.findById(quotationId, actor.companyId);
    if (!q) throw new NotFoundError('Quotation');
    const items = await quotationRepo.getItems(quotationId);

    const newQuotation = await quotationRepo.create({
        companyId: actor.companyId,
        branchId: q.branch_id,
        leadId: q.lead_id,
        customerId: q.customer_id,
        // Each revision gets its own unique quotation_number (the column has
        // a UNIQUE constraint) — parent_quotation_id is what links the chain,
        // not a shared number. See getRevisions.
        revision: q.revision + 1,
        parentQuotationId: q.quotation_id,
        eventName: q.event_name, eventType: q.event_type, eventDate: q.event_date,
        guestCount: q.guest_count, hallId: q.hall_id,
        discountAmount: q.discount_amount, notes: q.notes, expiryDate: q.expiry_date,
        createdBy: actor.userId,
    });
    for (const item of items) {
        await quotationRepo.addItem(newQuotation.quotation_id, {
            description: item.description, quantity: item.quantity, unitPrice: item.unit_price, taxPercent: item.tax_percent,
        });
    }
    await quotationRepo.recalculateTotals(newQuotation.quotation_id, actor.companyId);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'quotation.revised', entityType: 'quotation', entityId: newQuotation.quotation_id,
        description: `Quotation ${q.quotation_number} revised (rev ${q.revision} -> ${q.revision + 1})`,
        oldValues: { parent_quotation_id: q.quotation_id },
    });

    return getById(newQuotation.quotation_id, actor.companyId);
};

const updateStatus = async (quotationId, newStatus, actor) => {
    const q = await quotationRepo.findById(quotationId, actor.companyId);
    if (!q) throw new NotFoundError('Quotation');
    if (!(ALLOWED_TRANSITIONS[q.status] || []).includes(newStatus)) {
        throw new ValidationError(`Cannot transition quotation from '${q.status}' to '${newStatus}'`);
    }

    let acceptToken = null;
    if (newStatus === 'sent' && !q.accept_token) {
        acceptToken = crypto.randomBytes(24).toString('hex');
    }

    const updated = await quotationRepo.setStatus(quotationId, actor.companyId, newStatus, { acceptToken });

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'quotation.status_changed', entityType: 'quotation', entityId: quotationId,
        description: `Quotation ${q.quotation_number} status changed from ${q.status} to ${newStatus}`,
        oldValues: { status: q.status }, newValues: { status: newStatus },
    });

    if (['accepted', 'rejected'].includes(newStatus)) {
        notifyService.notify({
            companyId: actor.companyId, branchId: actor.branchId,
            category: 'quotation', type: `quotation.${newStatus}`,
            title: `Quotation ${newStatus}`,
            body: `${q.quotation_number} — ${q.event_name || 'Event'} was ${newStatus}`,
            referenceType: 'quotation', referenceId: quotationId,
            excludeUserId: actor.userId,
        }).catch(err => logger.warn('Notification dispatch failed', { error: err.message }));
    }

    return updated;
};

/** Customer-facing acceptance via a public token link (mirrors the password-reset token pattern). */
const acceptViaToken = async (token) => {
    const q = await quotationRepo.findByAcceptToken(token);
    if (!q) throw new NotFoundError('Quotation');
    if (q.status !== 'sent') throw new ValidationError(`This quotation is ${q.status} and can no longer be accepted`);
    return quotationRepo.setStatus(q.quotation_id, q.company_id, 'accepted');
};

/**
 * Convert an accepted quotation into a real Booking (+ auto-generated
 * Invoice) — built from the quotation's own priced line items/grand_total,
 * not re-derived, so revenue can never disagree between the two.
 */
const convertToBooking = async (quotationId, bookingOverrides, actor) => {
    const q = await quotationRepo.findById(quotationId, actor.companyId);
    if (!q) throw new NotFoundError('Quotation');
    if (q.status !== 'accepted') throw new ValidationError('Only an accepted quotation can be converted to a booking');

    const customerId = bookingOverrides.customerId || q.customer_id;
    if (!customerId) throw new ValidationError('customerId is required — this quotation has no linked customer yet');
    const hallId = bookingOverrides.hallId || q.hall_id;
    if (!hallId) throw new ValidationError('hallId is required to create the booking');
    if (!bookingOverrides.eventTimeStart || !bookingOverrides.eventTimeEnd) {
        throw new ValidationError('eventTimeStart and eventTimeEnd are required to create the booking');
    }

    const booking = await bookingService.create({
        hallId, customerId,
        eventDate: bookingOverrides.eventDate || q.event_date,
        eventTimeStart: bookingOverrides.eventTimeStart,
        eventTimeEnd: bookingOverrides.eventTimeEnd,
        eventName: q.event_name,
        eventType: q.event_type,
        guestCount: q.guest_count,
        totalAmount: q.grand_total,
    }, actor);

    const updatedQuotation = await quotationRepo.markConverted(quotationId, actor.companyId, booking.booking_id);

    if (q.lead_id) {
        await leadRepo.markConverted(q.lead_id, actor.companyId, booking.booking_id);
    }

    const invoice = await invoiceService.generateForBooking(booking.booking_id, actor);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'quotation.converted', entityType: 'quotation', entityId: quotationId,
        description: `Quotation ${q.quotation_number} converted to booking ${booking.booking_ref}`,
        newValues: { booking_id: booking.booking_id, invoice_id: invoice.invoice_id },
    });

    return { quotation: updatedQuotation, booking, invoice };
};

module.exports = {
    list, getById, create, addItem, removeItem, update, revise, updateStatus, acceptViaToken, convertToBooking,
};
