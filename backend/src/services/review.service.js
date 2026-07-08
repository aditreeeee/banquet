/**
 * Reviews Service — post-event customer feedback tied to a completed booking.
 */
'use strict';

const reviewRepo = require('../repositories/review.repository');
const bookingRepo = require('../repositories/booking.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError, ConflictError } = require('../api/v1/middleware/errorHandler');

const getForBanquet = async (banquetId, actor, query = {}) => {
    // req.query values arrive as strings — SQL Server's FETCH NEXT row-count
    // parameter requires an actual integer type, not a numeric-looking string.
    const limit  = parseInt(query.limit, 10)  || 20;
    const offset = parseInt(query.offset, 10) || 0;
    const [reviews, stats] = await Promise.all([
        reviewRepo.findForBanquet(banquetId, actor.companyId, { limit, offset }),
        reviewRepo.getStats(banquetId, actor.companyId),
    ]);
    return { reviews, stats };
};

const create = async (data, actor) => {
    const booking = await bookingRepo.findById(data.bookingId, actor.companyId);
    if (!booking) throw new NotFoundError('Booking');
    if (booking.status !== 'completed') {
        throw new ValidationError('Reviews can only be recorded for completed bookings');
    }

    const existing = await reviewRepo.findByBooking(data.bookingId, actor.companyId);
    if (existing) throw new ConflictError('A review already exists for this booking');

    // banquetId is derived from the booking's own hall, not trusted from client input.
    const banquetId = booking.banquet_id;

    const reviewId = await reviewRepo.create({
        banquetId,
        customerId:    booking.customer_id,
        bookingId:     data.bookingId,
        rating:        data.rating,
        title:         data.title,
        reviewText:    data.reviewText,
        venueRating:   data.venueRating,
        serviceRating: data.serviceRating,
        cateringRating:data.cateringRating,
        valueRating:   data.valueRating,
    });

    await reviewRepo.syncBanquetRatingStats(banquetId);

    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'review.created',
        entityType: 'review',
        entityId: reviewId,
        description: `Review recorded for booking ${booking.booking_ref} (${data.rating}/5)`,
        newValues: { rating: data.rating, bookingId: data.bookingId },
    });

    return { review_id: reviewId };
};

module.exports = { getForBanquet, create };
