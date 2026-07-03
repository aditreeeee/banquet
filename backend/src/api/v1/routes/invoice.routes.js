/**
 * Invoice Routes — /api/v1/invoices
 */
'use strict';

const { Router }            = require('express');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }       = require('../../../constants');
const { executeQuery }      = require('../../../config/database');
const response              = require('../../../utils/response');

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

    const conditions = [
        'i.company_id = :companyId',
        'i.is_cancelled = 0',
        '(:status IS NULL OR i.payment_status = :status)',
        '(:month  IS NULL OR DATE_FORMAT(i.invoice_date, \'%Y-%m\') = :month)',
        `(:search IS NULL
          OR i.invoice_number LIKE CONCAT('%', :search, '%')
          OR b.booking_ref   LIKE CONCAT('%', :search, '%')
          OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', :search, '%'))`,
    ].join(' AND ');

    const [rows, countRows] = await Promise.all([
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
             LIMIT :limit OFFSET :offset`,
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
    ]);

    return response.success(res, {
        invoices: rows,
        meta:  { page, limit, total: countRows[0].total },
        stats: {},
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
         WHERE i.invoice_id = :id AND i.company_id = :companyId`,
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

    const bookingRows = await executeQuery(
        `SELECT b.booking_id, b.total_amount, b.booking_ref, b.customer_id
         FROM Bookings b
         WHERE (:bookingId IS NULL OR b.booking_id = :bookingId)
           AND (:bookingRef IS NULL OR b.booking_ref = :bookingRef)
           AND b.company_id = :companyId`,
        { bookingId: bookingId ? parseInt(bookingId, 10) : null, bookingRef: booking_ref || null, companyId: req.companyId }
    );
    if (!bookingRows[0]) return res.status(404).json({ success: false, message: 'Booking not found' });

    const b             = bookingRows[0];
    const year          = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${Date.now().toString().slice(-6)}`;

    const result = await executeQuery(
        `INSERT INTO Invoices
            (invoice_number, company_id, booking_id, customer_id,
             invoice_date, due_date,
             subtotal, discount_amount, taxable_amount,
             grand_total, amount_paid, balance_due,
             payment_status, created_by, created_at)
         VALUES
            (:invoiceNumber, :companyId, :bookingId, :customerId,
             DATE(UTC_TIMESTAMP()), DATE_ADD(DATE(UTC_TIMESTAMP()), INTERVAL 7 DAY),
             :amount, 0, :amount,
             :amount, 0, :amount,
             'pending', :createdBy, UTC_TIMESTAMP())`,
        {
            invoiceNumber,
            companyId:  req.companyId,
            bookingId:  b.booking_id,
            customerId: b.customer_id,
            amount:     b.total_amount,
            createdBy:  req.user.user_id,
        }
    );

    return response.created(res, { invoice_id: result.insertId, invoice_number: invoiceNumber });
});

// Cancel invoice (soft delete — sets is_cancelled = 1)
router.delete('/:id', requirePermission(PERMISSIONS.INVOICES_CREATE), async (req, res) => {
    const rows = await executeQuery(
        `SELECT invoice_id FROM Invoices
         WHERE invoice_id = :id AND company_id = :companyId AND is_cancelled = 0`,
        { id: parseInt(req.params.id, 10), companyId: req.companyId }
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Invoice not found' });

    await executeQuery(
        `UPDATE Invoices SET is_cancelled = 1, updated_at = UTC_TIMESTAMP()
         WHERE invoice_id = :id AND company_id = :companyId`,
        { id: parseInt(req.params.id, 10), companyId: req.companyId }
    );
    return response.success(res, null, 'Invoice cancelled');
});

module.exports = router;
