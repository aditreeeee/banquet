/**
 * Lead Service — Sales Pipeline business logic
 * Pipeline: inquiry -> lead -> quotation -> tentative -> confirmed -> completed
 * 'lost' is reachable from any non-terminal stage.
 */

'use strict';

const leadRepo = require('../repositories/lead.repository');
const bookingService = require('./booking.service');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

// ─── Lead Scoring ───────────────────────────────────────────────────────────
/**
 * Estimate booking value and bucket it High/Medium/Low. Sales staff can see
 * at a glance which inquiries are worth prioritizing. Thresholds are a
 * starting heuristic — estimated_budget takes priority over guest_count when
 * both are known (budget is a more direct value signal).
 */
const HIGH_BUDGET_THRESHOLD = 300000;
const MEDIUM_BUDGET_THRESHOLD = 100000;
const HIGH_GUEST_THRESHOLD = 400;
const MEDIUM_GUEST_THRESHOLD = 150;

const calculateScore = ({ estimatedBudget, guestCount }) => {
    if (estimatedBudget != null) {
        if (estimatedBudget >= HIGH_BUDGET_THRESHOLD) return 'high';
        if (estimatedBudget >= MEDIUM_BUDGET_THRESHOLD) return 'medium';
        return 'low';
    }
    if (guestCount != null) {
        if (guestCount >= HIGH_GUEST_THRESHOLD) return 'high';
        if (guestCount >= MEDIUM_GUEST_THRESHOLD) return 'medium';
        return 'low';
    }
    return 'low';
};

// ─── Pipeline transitions ───────────────────────────────────────────────────
const PIPELINE_ORDER = ['inquiry', 'lead', 'quotation', 'tentative', 'confirmed', 'completed'];

const canTransition = (from, to) => {
    if (to === 'lost') return !['completed', 'lost'].includes(from);
    const fromIdx = PIPELINE_ORDER.indexOf(from);
    const toIdx = PIPELINE_ORDER.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return false;
    // Allow moving forward one or more stages, or backward one stage (correcting a mistake).
    return toIdx === fromIdx + 1 || toIdx === fromIdx - 1;
};

// ─── CRUD ───────────────────────────────────────────────────────────────────

const list = (query, actor) => {
    return leadRepo.list({
        companyId: actor.companyId,
        stage: query.stage || null,
        score: query.score || null,
        assignedTo: query.assigned_to ? parseInt(query.assigned_to, 10) : null,
    });
};

const getById = async (leadId, companyId) => {
    const lead = await leadRepo.findById(leadId, companyId);
    if (!lead) throw new NotFoundError('Lead');
    return lead;
};

const create = async (data, actor) => {
    const score = calculateScore({ estimatedBudget: data.estimatedBudget, guestCount: data.guestCount });

    const lead = await leadRepo.create({
        ...data,
        companyId: actor.companyId,
        branchId: actor.branchId,
        score,
        createdBy: actor.userId,
    });

    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'lead.created',
        entityType: 'lead',
        entityId: lead.lead_id,
        description: `Lead created for ${lead.contact_name} (${score} value)`,
        newValues: { stage: lead.stage, score },
    });

    return lead;
};

const update = async (leadId, data, actor) => {
    const existing = await getById(leadId, actor.companyId);
    if (['completed', 'lost'].includes(existing.stage)) {
        throw new ValidationError(`Cannot edit a ${existing.stage} lead`);
    }

    // Re-score if budget or guest count changed.
    const score = (data.estimatedBudget != null || data.guestCount != null)
        ? calculateScore({
            estimatedBudget: data.estimatedBudget ?? existing.estimated_budget,
            guestCount: data.guestCount ?? existing.guest_count,
        })
        : undefined;

    return leadRepo.update(leadId, actor.companyId, { ...data, score });
};

const advanceStage = async (leadId, newStage, actor, lostReason) => {
    const existing = await getById(leadId, actor.companyId);

    if (!canTransition(existing.stage, newStage)) {
        throw new ValidationError(`Cannot move lead from '${existing.stage}' to '${newStage}'`);
    }
    if (newStage === 'lost' && !lostReason) {
        throw new ValidationError('lostReason is required when marking a lead as lost');
    }

    const lead = await leadRepo.updateStage(leadId, actor.companyId, newStage, lostReason);

    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'lead.stage_changed',
        entityType: 'lead',
        entityId: leadId,
        description: `Lead ${existing.contact_name} moved from ${existing.stage} to ${newStage}${lostReason ? `: ${lostReason}` : ''}`,
        oldValues: { stage: existing.stage },
        newValues: { stage: newStage },
    });

    return lead;
};

/**
 * Convert a confirmed lead into a real Booking. Requires the concrete
 * hall/date/time/amount the sales rep has now nailed down with the customer.
 */
const convertToBooking = async (leadId, bookingData, actor) => {
    const lead = await getById(leadId, actor.companyId);
    if (lead.converted_booking_id) throw new ValidationError('Lead has already been converted to a booking');
    if (['lost'].includes(lead.stage)) throw new ValidationError('Cannot convert a lost lead');

    const booking = await bookingService.create({
        ...bookingData,
        customerId: bookingData.customerId || lead.customer_id,
        eventName: bookingData.eventName || lead.contact_name,
        eventType: bookingData.eventType || lead.event_type,
        guestCount: bookingData.guestCount || lead.guest_count,
    }, actor);

    const updatedLead = await leadRepo.markConverted(leadId, actor.companyId, booking.booking_id);

    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'lead.converted',
        entityType: 'lead',
        entityId: leadId,
        description: `Lead ${lead.contact_name} converted to booking ${booking.booking_ref}`,
        newValues: { booking_id: booking.booking_id },
    });

    return { lead: updatedLead, booking };
};

module.exports = { list, getById, create, update, advanceStage, convertToBooking, calculateScore };
