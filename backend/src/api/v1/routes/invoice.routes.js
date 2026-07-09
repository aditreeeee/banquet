/**
 * Invoice Routes — /api/v1/invoices
 */
'use strict';

const { Router }            = require('express');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }       = require('../../../constants');
const { executeQuery }      = require('../../../config/database');
const response              = require('../../../utils/response');
const auditLogRepo          = require('../../../repositories/auditLog.repository');
const invoiceService        = require('../../../services/invoice.service');

const router = Router();

// List invoices for a company (with search / status / month filtering)
router.get('/', requirePermission(PERMISSIONS.INVOICES_READ), async (req, res) => {
    const companyId = req.companyId;
    const page      = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit     = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset    = (page - 1) * limit;
    const search    = req.query.search  || null;
    const status    = req.query.status  || null;
    const month     = req.query.month   || null; // "YYYY-MM"

    // "overdue" isn't a stored payment_status — it's a pending invoice past its
    // due date — so it needs its own condition rather than an exact-match.
    const statusCondition = status === 'overdue'
        ? `i.payment_status = 'pending' AND i.due_date < CAST(GETUTCDATE() AS DATE)`
        : '(@status IS NULL OR i.payment_status = @status)';

    const conditions = [
        'i.company_id = @companyId',
        'i.is_cancelled = 0',
        statusCondition,
        '(@month  IS NULL OR FORMAT(i.invoice_date, \'yyyy-MM\') = @month)',
        `(@search IS NULL
          OR i.invoice_number LIKE CONCAT('%', @search, '%')
          OR b.booking_ref   LIKE CONCAT('%', @search, '%')
          OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const [rows, countRows, statsRows] = await Promise.all([
        executeQuery(
            `SELECT i.invoice_id,
                    i.invoice_number  AS invoice_ref,
                    i.booking_id,
                    i.invoice_date,
                    i.due_date,
                    i.grand_total,
                    i.amount_paid,
                    i.balance_due     AS balance,
                    i.payment_status  AS status,
                    b.booking_ref,
                    b.event_name,
                    CONCAT(c.first_name, ' ', c.last_name) AS customer_name
             FROM Invoices i
             JOIN Bookings  b ON b.booking_id  = i.booking_id
             JOIN Customers c ON c.customer_id = i.customer_id
             WHERE ${conditions}
             ORDER BY i.invoice_date DESC
             OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { companyId, search, status, month, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total
             FROM Invoices i
             JOIN Bookings  b ON b.booking_id  = i.booking_id
             JOIN Customers c ON c.customer_id = i.customer_id
             WHERE ${conditions}`,
            { companyId, search, status, month }
        ),
        executeQuery(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN i.payment_status = 'paid'    THEN 1 ELSE 0 END) AS paid,
                SUM(CASE WHEN i.payment_status = 'partial' THEN 1 ELSE 0 END) AS partial,
                SUM(CASE WHEN i.payment_status = 'pending'  THEN 1 ELSE 0 END) AS unpaid,
                SUM(CASE WHEN i.payment_status = 'pending' AND i.due_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) AS overdue
             FROM Invoices i
             WHERE i.company_id = @companyId AND i.is_cancelled = 0`,
            { companyId }
        ),
    ]);

    return response.success(res, {
        invoices: rows,
        meta:  { page, limit, total: countRows[0].total },
        stats: statsRows[0] || {},
    });
});

// Get single invoice
router.get('/:id', requirePermission(PERMISSIONS.INVOICES_READ), async (req, res) => {
    const rows = await executeQuery(
        `SELECT i.*,
                b.booking_ref,
                CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                c.email AS customer_email, c.phone AS customer_phone
         FROM Invoices i
         JOIN Bookings  b ON b.booking_id  = i.booking_id
         JOIN Customers c ON c.customer_id = i.customer_id
         WHERE i.invoice_id = @id AND i.company_id = @companyId`,
        {
            id:        parseInt(req.params.id, 10),
            companyId: req.companyId,
        }
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Invoice not found' });
    return response.success(res, rows[0]);
});

// Create invoice for a booking (accepts bookingId or booking_ref)
router.post('/', requirePermission(PERMISSIONS.INVOICES_CREATE), async (req, res) => {
    const { bookingId, booking_ref } = req.body;
    if (!bookingId && !booking_ref) return res.status(400).json({ success: false, message: 'bookingId or booking_ref required' });

    let resolvedBookingId = bookingId ? parseInt(bookingId, 10) : null;
    if (!resolvedBookingId && booking_ref) {
        const rows = await executeQuery(
            `SELECT booking_id FROM Bookings WHERE booking_ref = @ref AND company_id = @companyId`,
            { ref: booking_ref, companyId: req.companyId }
        );
        if (!rows[0]) return res.status(404).json({ success: false, message: 'Booking not found' });
        resolvedBookingId = rows[0].booking_id;
    }

    const actor = { companyId: req.companyId, userId: req.user.user_id };
    const invoice = await invoiceService.generateForBooking(resolvedBookingId, actor);
    return response.created(res, invoice);
});

// Cancel invoice (soft delete — sets is_cancelled = 1)
router.delete('/:id', requirePermission(PERMISSIONS.INVOICES_CREATE), async (req, res) => {
    const rows = await executeQuery(
        `SELECT invoice_id FROM Invoices
         WHERE invoice_id = @id AND company_id = @companyId AND is_cancelled = 0`,
        { id: parseInt(req.params.id, 10), companyId: req.companyId }
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Invoice not found' });

    await executeQuery(
        `UPDATE Invoices SET is_cancelled = 1, updated_at = GETUTCDATE()
         WHERE invoice_id = @id AND company_id = @companyId`,
        { id: parseInt(req.params.id, 10), companyId: req.companyId }
    );
    await auditLogRepo.log({
        companyId:  req.companyId,
        userId:     req.user.user_id,
        action:     'invoice.cancelled',
        entityType: 'invoice',
        entityId:   req.params.id,
        description: `Invoice ${req.params.id} cancelled`,
    });
    return response.success(res, null, 'Invoice cancelled');
});

module.exports = router;
