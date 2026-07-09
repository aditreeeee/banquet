/**
 * Quotation Repository — Finance module. Structurally mirrors invoices
 * (tax via settingsService.getTaxRates, soft-cancel/status flags) but with
 * proper line items, revisions, and a full status lifecycle, since a
 * quotation is negotiated back and forth before becoming a Booking, unlike
 * an invoice (generated once, after the fact, from an already-priced booking).
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT q.quotation_id, q.company_id, q.branch_id, q.lead_id, q.customer_id,
           q.quotation_number, q.status, q.revision, q.parent_quotation_id,
           q.event_name, q.event_type, q.event_date, q.guest_count, q.hall_id,
           q.subtotal, q.discount_amount, q.tax_amount, q.grand_total,
           q.notes, q.expiry_date, q.accepted_at, q.accept_token, q.converted_booking_id,
           q.created_by, q.created_at, q.updated_at,
           h.hall_name,
           CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
           CASE WHEN q.customer_id IS NOT NULL THEN CONCAT(c.first_name, ' ', c.last_name) ELSE l.contact_name END AS contact_name,
           CASE WHEN q.customer_id IS NOT NULL THEN c.email ELSE l.contact_email END AS contact_email,
           CASE WHEN q.customer_id IS NOT NULL THEN c.phone ELSE l.contact_phone END AS contact_phone
    FROM Quotations q
    LEFT JOIN Halls h      ON h.hall_id = q.hall_id
    LEFT JOIN Users u      ON u.user_id = q.created_by
    LEFT JOIN Customers c  ON c.customer_id = q.customer_id
    LEFT JOIN Leads l      ON l.lead_id = q.lead_id
`;

const generateNumber = () => `QUO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

const findAll = async ({ companyId, status, leadId, customerId, search, offset, limit }) => {
    const where = [
        'q.company_id = @companyId',
        '(@status IS NULL OR q.status = @status)',
        '(@leadId IS NULL OR q.lead_id = @leadId)',
        '(@customerId IS NULL OR q.customer_id = @customerId)',
        `(@search IS NULL OR q.quotation_number LIKE CONCAT('%', @search, '%') OR q.event_name LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');
    const params = { companyId, status: status || null, leadId: leadId || null, customerId: customerId || null, search: search || null };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY q.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, offset, limit }
        ),
        executeQuery(`SELECT COUNT(*) AS total FROM Quotations q WHERE ${where}`, params),
    ]);
    return { rows, total: countRows[0].total };
};

const findById = async (quotationId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE q.quotation_id = @id AND q.company_id = @companyId`,
        { id: quotationId, companyId }
    );
    return rows[0] || null;
};

const getItems = async (quotationId) => {
    return executeQuery(
        `SELECT item_row_id, quotation_id, description, quantity, unit_price, tax_percent,
                CAST(quantity * unit_price AS DECIMAL(12,2)) AS line_subtotal,
                CAST(quantity * unit_price * tax_percent / 100 AS DECIMAL(12,2)) AS line_tax,
                CAST(quantity * unit_price * (1 + tax_percent / 100) AS DECIMAL(12,2)) AS line_total
         FROM QuotationItems WHERE quotation_id = @quotationId ORDER BY item_row_id`,
        { quotationId }
    );
};

/**
 * Full revision history for a quotation — each revision gets its own unique
 * quotation_number (quotation_number has a UNIQUE constraint, so revisions
 * can't share one), linked purely via parent_quotation_id. Walks up to the
 * root ancestor, then a recursive CTE walks back down the whole chain.
 */
const getRevisions = async (quotationId, companyId) => {
    let rootId = quotationId;
    for (;;) {
        const rows = await executeQuery(
            `SELECT parent_quotation_id FROM Quotations WHERE quotation_id = @id AND company_id = @companyId`,
            { id: rootId, companyId }
        );
        if (!rows[0] || !rows[0].parent_quotation_id) break;
        rootId = rows[0].parent_quotation_id;
    }
    return executeQuery(
        `;WITH chain AS (
            SELECT quotation_id, quotation_number, revision, status, grand_total, created_at, parent_quotation_id
            FROM Quotations WHERE quotation_id = @rootId AND company_id = @companyId
            UNION ALL
            SELECT q.quotation_id, q.quotation_number, q.revision, q.status, q.grand_total, q.created_at, q.parent_quotation_id
            FROM Quotations q JOIN chain c ON q.parent_quotation_id = c.quotation_id
         )
         SELECT quotation_id, quotation_number, revision, status, grand_total, created_at FROM chain ORDER BY revision ASC`,
        { rootId, companyId }
    );
};

const create = async (data) => {
    const quotationNumber = data.quotationNumber || generateNumber();
    const result = await executeQuery(
        `INSERT INTO Quotations
            (company_id, branch_id, lead_id, customer_id, quotation_number, status, revision, parent_quotation_id,
             event_name, event_type, event_date, guest_count, hall_id,
             subtotal, discount_amount, tax_amount, grand_total, notes, expiry_date,
             created_by, created_at, updated_at)
         OUTPUT INSERTED.quotation_id AS id
         VALUES
            (@companyId, @branchId, @leadId, @customerId, @quotationNumber, 'draft', @revision, @parentQuotationId,
             @eventName, @eventType, @eventDate, @guestCount, @hallId,
             0, @discountAmount, 0, 0, @notes, @expiryDate,
             @createdBy, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        {
            companyId: data.companyId,
            branchId: data.branchId || null,
            leadId: data.leadId || null,
            customerId: data.customerId || null,
            quotationNumber,
            revision: data.revision || 1,
            parentQuotationId: data.parentQuotationId || null,
            eventName: data.eventName || null,
            eventType: data.eventType || null,
            eventDate: data.eventDate ? new Date(data.eventDate) : null,
            guestCount: data.guestCount || null,
            hallId: data.hallId || null,
            discountAmount: data.discountAmount || 0,
            notes: data.notes || null,
            expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
            createdBy: data.createdBy,
        }
    );
    return findById(result[0].id, data.companyId);
};

const addItem = async (quotationId, { description, quantity, unitPrice, taxPercent }) => {
    await executeQuery(
        `INSERT INTO QuotationItems (quotation_id, description, quantity, unit_price, tax_percent, created_at)
         VALUES (@quotationId, @description, @quantity, @unitPrice, @taxPercent, SYSUTCDATETIME())`,
        { quotationId, description, quantity: quantity || 1, unitPrice: unitPrice || 0, taxPercent: taxPercent || 0 }
    );
};

const removeItem = async (quotationId, itemRowId) => {
    await executeQuery(
        `DELETE FROM QuotationItems WHERE item_row_id = @itemRowId AND quotation_id = @quotationId`,
        { itemRowId, quotationId }
    );
};

/** Recompute subtotal/tax/grand_total from the current line items + discount. */
const recalculateTotals = async (quotationId, companyId) => {
    const items = await getItems(quotationId);
    const subtotal = items.reduce((s, i) => s + (parseFloat(i.line_subtotal) || 0), 0);
    const taxAmount = items.reduce((s, i) => s + (parseFloat(i.line_tax) || 0), 0);
    const rows = await executeQuery(`SELECT discount_amount FROM Quotations WHERE quotation_id = @id`, { id: quotationId });
    const discount = parseFloat(rows[0]?.discount_amount) || 0;
    const grandTotal = Number((subtotal + taxAmount - discount).toFixed(2));

    await executeQuery(
        `UPDATE Quotations SET subtotal = @subtotal, tax_amount = @taxAmount, grand_total = @grandTotal, updated_at = SYSUTCDATETIME()
         WHERE quotation_id = @id AND company_id = @companyId`,
        { id: quotationId, companyId, subtotal: Number(subtotal.toFixed(2)), taxAmount: Number(taxAmount.toFixed(2)), grandTotal }
    );
    return findById(quotationId, companyId);
};

const update = async (quotationId, companyId, data) => {
    await executeQuery(
        `UPDATE Quotations
         SET event_name      = ISNULL(@eventName, event_name),
             event_type      = ISNULL(@eventType, event_type),
             event_date      = ISNULL(@eventDate, event_date),
             guest_count     = ISNULL(@guestCount, guest_count),
             hall_id         = ISNULL(@hallId, hall_id),
             discount_amount = ISNULL(@discountAmount, discount_amount),
             notes           = ISNULL(@notes, notes),
             expiry_date     = ISNULL(@expiryDate, expiry_date),
             updated_at      = SYSUTCDATETIME()
         WHERE quotation_id = @id AND company_id = @companyId`,
        {
            id: quotationId, companyId,
            eventName: data.eventName || null,
            eventType: data.eventType || null,
            eventDate: data.eventDate ? new Date(data.eventDate) : null,
            guestCount: data.guestCount != null ? data.guestCount : null,
            hallId: data.hallId || null,
            discountAmount: data.discountAmount != null ? data.discountAmount : null,
            notes: data.notes != null ? data.notes : null,
            expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        }
    );
    return findById(quotationId, companyId);
};

const setStatus = async (quotationId, companyId, status, extra = {}) => {
    await executeQuery(
        `UPDATE Quotations
         SET status = @status,
             accepted_at = CASE WHEN @status = 'accepted' THEN SYSUTCDATETIME() ELSE accepted_at END,
             accept_token = ISNULL(@acceptToken, accept_token),
             updated_at = SYSUTCDATETIME()
         WHERE quotation_id = @id AND company_id = @companyId`,
        { id: quotationId, companyId, status, acceptToken: extra.acceptToken || null }
    );
    return findById(quotationId, companyId);
};

const findByAcceptToken = async (token) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE q.accept_token = @token`,
        { token }
    );
    return rows[0] || null;
};

const markConverted = async (quotationId, companyId, bookingId) => {
    await executeQuery(
        `UPDATE Quotations SET status = 'converted', converted_booking_id = @bookingId, updated_at = SYSUTCDATETIME()
         WHERE quotation_id = @id AND company_id = @companyId`,
        { id: quotationId, companyId, bookingId }
    );
    return findById(quotationId, companyId);
};

module.exports = {
    findAll, findById, getItems, getRevisions, create, addItem, removeItem,
    recalculateTotals, update, setStatus, findByAcceptToken, markConverted,
};
