/**
 * Reviews Repository — customer feedback on completed bookings, surfaced as
 * average rating / review count / recent reviews on the banquet's info.
 */
'use strict';

const { executeQuery } = require('../config/database');

const SELECT_FIELDS = `
    r.review_id, r.banquet_id, r.customer_id, r.booking_id, r.rating, r.title, r.review_text,
    r.venue_rating, r.service_rating, r.catering_rating, r.value_rating,
    r.is_approved, r.is_featured, r.admin_response, r.photo_urls, r.created_at,
    CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
    b.booking_ref, b.event_name
`;

const parseRow = (row) => {
    if (row && typeof row.photo_urls === 'string') {
        try { row.photo_urls = JSON.parse(row.photo_urls); } catch { row.photo_urls = []; }
    }
    return row;
};

const findForBanquet = async (banquetId, companyId, { limit = 20, offset = 0, approvedOnly = false } = {}) => {
    const rows = await executeQuery(
        `SELECT ${SELECT_FIELDS}
         FROM Reviews r
         JOIN Customers c ON c.customer_id = r.customer_id
         JOIN Bookings  b ON b.booking_id  = r.booking_id
         WHERE r.banquet_id = @banquetId AND b.company_id = @companyId
           AND (@approvedOnly = 0 OR r.is_approved = 1)
         ORDER BY r.created_at DESC
         OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
        { banquetId, companyId, limit, offset, approvedOnly: approvedOnly ? 1 : 0 }
    );
    return rows.map(parseRow);
};

const getStats = async (banquetId, companyId) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS total_reviews, AVG(CAST(r.rating AS DECIMAL(3,2))) AS avg_rating
         FROM Reviews r
         JOIN Bookings b ON b.booking_id = r.booking_id
         WHERE r.banquet_id = @banquetId AND b.company_id = @companyId AND r.is_approved = 1`,
        { banquetId, companyId }
    );
    return rows[0] || { total_reviews: 0, avg_rating: null };
};

/** Reviews a given customer has left, most recent first — used by the
    Customer Detail page's Reviews tab (customers/detail.html:renderReviews,
    which expects r.rating/r.created_at/r.event_name/r.comment). companyId
    === null means "every tenant" (Super Admin, not impersonating) — matches
    customer.repository.js:findById's own scoping. */
const findByCustomer = async (customerId, companyId) => {
    const rows = await executeQuery(
        `SELECT r.review_id, r.banquet_id, r.customer_id, r.booking_id, r.rating,
                r.title, r.review_text AS comment, r.created_at,
                b.booking_ref, b.event_name
         FROM Reviews r
         JOIN Bookings b ON b.booking_id = r.booking_id
         WHERE r.customer_id = @customerId AND (@companyId IS NULL OR b.company_id = @companyId)
         ORDER BY r.created_at DESC`,
        { customerId, companyId: companyId || null }
    );
    return rows;
};

const findByBooking = async (bookingId, companyId) => {
    const rows = await executeQuery(
        `SELECT ${SELECT_FIELDS}
         FROM Reviews r
         JOIN Customers c ON c.customer_id = r.customer_id
         JOIN Bookings  b ON b.booking_id  = r.booking_id
         WHERE r.booking_id = @bookingId AND b.company_id = @companyId`,
        { bookingId, companyId }
    );
    return rows.map(parseRow)[0] || null;
};

const create = async ({ banquetId, customerId, bookingId, rating, title, reviewText, venueRating, serviceRating, cateringRating, valueRating, photoUrls }) => {
    const result = await executeQuery(
        `INSERT INTO Reviews (
            banquet_id, customer_id, booking_id, rating, title, review_text,
            venue_rating, service_rating, catering_rating, value_rating,
            is_approved, is_featured, photo_urls, created_at
        )
        OUTPUT INSERTED.review_id AS id
        VALUES (
            @banquetId, @customerId, @bookingId, @rating, @title, @reviewText,
            @venueRating, @serviceRating, @cateringRating, @valueRating,
            1, 0, @photoUrls, SYSUTCDATETIME()
        )`,
        {
            banquetId, customerId, bookingId, rating,
            title: title || null,
            reviewText: reviewText || null,
            venueRating: venueRating || null,
            serviceRating: serviceRating || null,
            cateringRating: cateringRating || null,
            valueRating: valueRating || null,
            photoUrls: Array.isArray(photoUrls) && photoUrls.length ? JSON.stringify(photoUrls) : null,
        }
    );
    return result[0].id;
};

/** Recomputes and persists the banquet's stored average_rating/total_reviews
    (Banquets.average_rating / total_reviews are plain columns, not computed —
    this keeps them in sync after every approved review). */
const syncBanquetRatingStats = async (banquetId) => {
    await executeQuery(
        `UPDATE Banquets
         SET average_rating = ISNULL((SELECT AVG(CAST(rating AS DECIMAL(3,2))) FROM Reviews WHERE banquet_id = @banquetId AND is_approved = 1), 0),
             total_reviews  = (SELECT COUNT(*) FROM Reviews WHERE banquet_id = @banquetId AND is_approved = 1)
         WHERE banquet_id = @banquetId`,
        { banquetId }
    );
};

module.exports = { findForBanquet, getStats, findByBooking, findByCustomer, create, syncBanquetRatingStats };
