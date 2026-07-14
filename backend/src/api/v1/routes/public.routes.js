/**
 * Public Routes — /api/v1/public
 * No authentication required — used for banquet search, availability preview
 */
'use strict';

const { Router }       = require('express');
const router           = Router();
const { executeQuery } = require('../../../config/database');
const response         = require('../../../utils/response');
const quotationService = require('../../../services/quotation.service');

/**
 * GET /api/v1/public/companies
 * Minimal (id + name only — no contact/financial fields) listing of active
 * companies/properties, for the self-registration form's required
 * Company/Property picker. Registration happens before a session exists, so
 * this can't sit behind the authenticated GET /companies endpoint — but it
 * exposes nothing beyond what a prospective customer needs to pick which
 * property they're signing up with.
 */
router.get('/companies', async (req, res) => {
    const rows = await executeQuery(
        `SELECT company_id, company_name
         FROM Companies
         WHERE is_active = 1 AND deleted_at IS NULL
         ORDER BY company_name`
    );
    return response.success(res, rows);
});

/**
 * GET /api/v1/public/banquets?city=&min_capacity=
 * Public listing for customer-facing search
 */
router.get('/banquets', async (req, res) => {
    const { city, min_capacity } = req.query;

    const rows = await executeQuery(
        `SELECT TOP 50
            b.banquet_id, b.banquet_name, b.city, b.state, b.address,
            b.phone, b.email,
            (SELECT COUNT(*) FROM Halls h WHERE h.banquet_id = b.banquet_id AND h.is_active = 1) AS hall_count,
            (SELECT MIN(base_price) FROM Halls h WHERE h.banquet_id = b.banquet_id AND h.is_active = 1) AS min_price,
            (SELECT MAX(capacity)   FROM Halls h WHERE h.banquet_id = b.banquet_id AND h.is_active = 1) AS max_capacity
         FROM Banquets b
         WHERE b.is_active = 1
           AND (@city IS NULL OR b.city LIKE CONCAT('%', @city, '%'))
           AND (@minCap IS NULL OR EXISTS (
               SELECT 1 FROM Halls h
               WHERE h.banquet_id = b.banquet_id AND h.capacity >= @minCap AND h.is_active = 1
           ))
         ORDER BY b.banquet_name`,
        {
            city:   city        || null,
            minCap: min_capacity ? parseInt(min_capacity, 10) : null,
        }
    );

    return response.success(res, rows);
});

/**
 * GET /api/v1/public/halls/:id/availability?event_date=
 */
router.get('/halls/:id/availability', async (req, res) => {
    const { event_date } = req.query;
    const hallId = parseInt(req.params.id, 10);

    if (!event_date) {
        return res.status(400).json({ success: false, message: 'event_date query param required' });
    }

    const rows = await executeQuery(
        `SELECT event_time_start, event_time_end, status
         FROM Bookings
         WHERE hall_id  = @hallId
           AND CAST(event_date AS DATE) = @date
           AND status NOT IN ('cancelled', 'draft')
         ORDER BY event_time_start`,
        { hallId, date: event_date }
    );

    return response.success(res, {
        hallId,
        date:          event_date,
        bookedSlots:   rows,
        isFullyBooked: rows.length > 0 && rows.some(s => s.event_time_start === '00:00:00'),
    });
});

/**
 * GET /api/v1/public/properties/:token
 * Resolves a Banquet by its opaque property_token — the identifier every new
 * public-facing surface (inquiry forms, QR codes, online booking links)
 * should embed in its URL instead of the raw banquet_id. Rejects unknown or
 * inactive tokens the same way (generic 404) so a deactivated property's old
 * QR codes/links don't leak whether the token itself was ever valid.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/properties/:token', async (req, res) => {
    // A malformed token isn't just "not found" — passed straight to a
    // UNIQUEIDENTIFIER comparison it throws a SQL conversion error (500),
    // leaking that the lookup reached the database at all. Reject the shape
    // before querying so every invalid input gets the same generic 404.
    if (!UUID_RE.test(req.params.token)) {
        return res.status(404).json({ success: false, statusCode: 404, code: 'NOT_FOUND', message: 'Property not found' });
    }
    const banquetRepo = require('../../../repositories/banquet.repository');
    const banquet = await banquetRepo.findByToken(req.params.token);
    if (!banquet || !banquet.is_active) {
        return res.status(404).json({ success: false, statusCode: 404, code: 'NOT_FOUND', message: 'Property not found' });
    }
    // Only what a public inquiry/booking form needs — never company_id,
    // banquet_id, financial fields, or anything else BASE_SELECT joins in.
    return response.success(res, {
        propertyToken: banquet.property_token,
        name:          banquet.banquet_name,
        description:   banquet.description,
        address:       banquet.address,
        city:          banquet.city,
        state:         banquet.state,
        phone:         banquet.phone,
        email:         banquet.email,
        imageUrl:      banquet.image_url,
        totalCapacity: banquet.total_capacity,
        avgRating:     banquet.avg_rating,
        totalReviews:  banquet.total_reviews,
    });
});

/**
 * PATCH /api/v1/public/quotations/accept/:token
 * Customer-facing acceptance link — no auth, mirrors the password-reset
 * token pattern. The token itself (random 24-byte hex, single-use per
 * quotation) is the only credential.
 */
router.patch('/quotations/accept/:token', async (req, res) => {
    const updated = await quotationService.acceptViaToken(req.params.token);
    return response.success(res, updated, 'Quotation accepted');
});

module.exports = router;
