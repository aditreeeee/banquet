/**
 * Lead Repository — Sales Pipeline (Inquiry -> Lead -> Quotation -> Tentative -> Confirmed -> Completed)
 */

'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT l.lead_id, l.company_id, l.branch_id, l.customer_id,
           l.contact_name, l.contact_phone, l.contact_email,
           l.event_type, l.preferred_date, l.guest_count, l.estimated_budget,
           l.score, l.source, l.stage, l.assigned_to, l.notes, l.lost_reason,
           l.converted_booking_id, l.created_by, l.created_at, l.updated_at,
           CASE WHEN l.assigned_to IS NULL THEN NULL ELSE CONCAT(u.first_name, ' ', u.last_name) END AS assigned_to_name
    FROM Leads l
    LEFT JOIN Users u ON u.user_id = l.assigned_to
`;

const list = async ({ companyId, stage, score, assignedTo }) => {
    return executeQuery(
        `${BASE_SELECT}
         WHERE (@companyId IS NULL OR l.company_id = @companyId)
           AND (@stage IS NULL OR l.stage = @stage)
           AND (@score IS NULL OR l.score = @score)
           AND (@assignedTo IS NULL OR l.assigned_to = @assignedTo)
         ORDER BY
            CASE l.score WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
            ISNULL(l.estimated_budget, 0) DESC,
            l.created_at DESC`,
        { companyId: companyId || null, stage: stage || null, score: score || null, assignedTo: assignedTo || null }
    );
};

const findById = async (leadId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE l.lead_id = @leadId AND l.company_id = @companyId`,
        { leadId, companyId }
    );
    return rows[0] || null;
};

const create = async (data) => {
    const result = await executeQuery(
        `INSERT INTO Leads (
            company_id, branch_id, customer_id, contact_name, contact_phone, contact_email,
            event_type, preferred_date, guest_count, estimated_budget, score, source, stage,
            assigned_to, notes, created_by, created_at, updated_at
        )
        OUTPUT INSERTED.lead_id AS id
        VALUES (
            @companyId, @branchId, @customerId, @contactName, @contactPhone, @contactEmail,
            @eventType, @preferredDate, @guestCount, @estimatedBudget, @score, @source, @stage,
            @assignedTo, @notes, @createdBy, SYSUTCDATETIME(), SYSUTCDATETIME()
        )`,
        {
            companyId:      data.companyId,
            branchId:       data.branchId       || null,
            customerId:     data.customerId     || null,
            contactName:    data.contactName,
            contactPhone:   data.contactPhone    || null,
            contactEmail:   data.contactEmail    || null,
            eventType:      data.eventType       || null,
            preferredDate:  data.preferredDate ? new Date(data.preferredDate) : null,
            guestCount:     data.guestCount      || null,
            estimatedBudget:data.estimatedBudget || null,
            score:          data.score,
            source:         data.source          || null,
            stage:          data.stage           || 'inquiry',
            assignedTo:     data.assignedTo      || null,
            notes:          data.notes           || null,
            createdBy:      data.createdBy       || null,
        }
    );
    return findById(result[0].id, data.companyId);
};

const update = async (leadId, companyId, data) => {
    await executeQuery(
        `UPDATE Leads
         SET contact_name     = ISNULL(@contactName,    contact_name),
             contact_phone    = ISNULL(@contactPhone,   contact_phone),
             contact_email    = ISNULL(@contactEmail,   contact_email),
             event_type       = ISNULL(@eventType,      event_type),
             preferred_date   = ISNULL(@preferredDate,  preferred_date),
             guest_count      = ISNULL(@guestCount,     guest_count),
             estimated_budget = ISNULL(@estimatedBudget,estimated_budget),
             score            = ISNULL(@score,          score),
             source           = ISNULL(@source,         source),
             assigned_to      = ISNULL(@assignedTo,     assigned_to),
             notes            = ISNULL(@notes,          notes),
             updated_at       = SYSUTCDATETIME()
         WHERE lead_id = @leadId AND company_id = @companyId`,
        {
            leadId, companyId,
            contactName:     data.contactName     || null,
            contactPhone:    data.contactPhone    || null,
            contactEmail:    data.contactEmail    || null,
            eventType:       data.eventType       || null,
            preferredDate:   data.preferredDate ? new Date(data.preferredDate) : null,
            guestCount:      data.guestCount      || null,
            estimatedBudget: data.estimatedBudget || null,
            score:           data.score           || null,
            source:          data.source          || null,
            assignedTo:      data.assignedTo      || null,
            notes:           data.notes           || null,
        }
    );
    return findById(leadId, companyId);
};

const updateStage = async (leadId, companyId, stage, lostReason) => {
    await executeQuery(
        `UPDATE Leads
         SET stage = @stage, lost_reason = ISNULL(@lostReason, lost_reason), updated_at = SYSUTCDATETIME()
         WHERE lead_id = @leadId AND company_id = @companyId`,
        { leadId, companyId, stage, lostReason: lostReason || null }
    );
    return findById(leadId, companyId);
};

const markConverted = async (leadId, companyId, bookingId) => {
    await executeQuery(
        `UPDATE Leads
         SET stage = 'completed', converted_booking_id = @bookingId, updated_at = SYSUTCDATETIME()
         WHERE lead_id = @leadId AND company_id = @companyId`,
        { leadId, companyId, bookingId }
    );
    return findById(leadId, companyId);
};

/**
 * Find an existing, still-open lead for this company matching either the
 * phone or the email of a new inquiry — used so a repeat public submission
 * (e.g. someone filling the form twice, or scanning the QR again after an
 * earlier visit) appends to the same lead instead of fragmenting the pipeline
 * across duplicates. Deliberately excludes 'completed'/'lost' leads: those
 * are closed pipeline history, not something a new inquiry should reopen.
 */
const findDuplicate = async (companyId, phone, email) => {
    if (!phone && !email) return null;
    const rows = await executeQuery(
        `${BASE_SELECT}
         WHERE l.company_id = @companyId
           AND l.stage NOT IN ('completed', 'lost')
           AND ((@phone IS NOT NULL AND l.contact_phone = @phone)
             OR (@email IS NOT NULL AND l.contact_email = @email))
         ORDER BY l.created_at DESC`,
        { companyId, phone: phone || null, email: email || null }
    );
    return rows[0] || null;
};

/**
 * Prepends a timestamped entry to notes rather than overwriting it — the
 * closest this schema has to a real interaction-history table without
 * introducing a new one. Also re-scores/refreshes the fields a repeat
 * inquiry commonly updates (event type, date, guest count, budget) when the
 * new submission provided them, without clobbering existing values with
 * blanks.
 */
const appendInteraction = async (leadId, companyId, { entry, eventType, preferredDate, guestCount, estimatedBudget, score }) => {
    await executeQuery(
        `UPDATE Leads
         SET notes            = LEFT(CONCAT(@entry, CHAR(10), CHAR(10), ISNULL(notes, '')), 2000),
             event_type       = ISNULL(@eventType,       event_type),
             preferred_date   = ISNULL(@preferredDate,   preferred_date),
             guest_count      = ISNULL(@guestCount,      guest_count),
             estimated_budget = ISNULL(@estimatedBudget, estimated_budget),
             score            = ISNULL(@score,           score),
             updated_at       = SYSUTCDATETIME()
         WHERE lead_id = @leadId AND company_id = @companyId`,
        {
            leadId, companyId, entry,
            eventType:       eventType       || null,
            preferredDate:   preferredDate ? new Date(preferredDate) : null,
            guestCount:      guestCount      || null,
            estimatedBudget: estimatedBudget || null,
            score:           score           || null,
        }
    );
    return findById(leadId, companyId);
};

module.exports = { list, findById, create, update, updateStage, markConverted, findDuplicate, appendInteraction };
