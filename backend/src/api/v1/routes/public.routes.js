/**
 * Public Routes — /api/v1/public
 * No authentication required — used for banquet search, availability preview
 */
'use strict';

const { Router }       = require('express');
const router           = Router();
const { executeQuery } = require('../../../config/database');
const response         = require('../../../utils/response');

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

module.exports = router;
