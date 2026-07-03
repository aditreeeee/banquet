/**
 * Booking Controller
 */
'use strict';

const bookingService = require('../../../services/booking.service');
const response       = require('../../../utils/response');

const actor = (req) => ({
    userId:    req.user.user_id,
    companyId: req.companyId,
    branchId:  req.user.branch_id,
    roleSlug:  req.user.role_slug,
});

const checkAvailability = async (req, res) => {
    const { hall_id, event_date, start_time, end_time } = req.query;
    const result = await bookingService.checkAvailability({
        hallId:    parseInt(hall_id, 10),
        eventDate: event_date,
        startTime: start_time,
        endTime:   end_time,
        companyId: req.companyId,
    });
    return response.success(res, result);
};

// POST version — body params instead of query (used by booking wizard)
const checkAvailabilityPost = async (req, res) => {
    const { hallId, hall_id, eventDate, event_date, startTime, start_time, endTime, end_time } = req.body;
    const result = await bookingService.checkAvailability({
        hallId:    parseInt(hallId || hall_id, 10),
        eventDate: eventDate || event_date,
        startTime: startTime || start_time,
        endTime:   endTime   || end_time,
        companyId: req.companyId,
    });
    return response.success(res, result);
};

const calculatePrice = async (req, res) => {
    const { hallId, hall_id, eventDate, event_date, startTime, start_time, endTime, end_time, guestCount, guest_count } = req.body;
    const result = await bookingService.calculatePrice({
        hallId:     parseInt(hallId || hall_id, 10),
        eventDate:  eventDate  || event_date,
        startTime:  startTime  || start_time,
        endTime:    endTime    || end_time,
        guestCount: guestCount || guest_count || null,
        companyId:  req.companyId,
    });
    return response.success(res, result);
};

const getBookedDates = async (req, res) => {
    const { hall_id, from_date, to_date } = req.query;
    const dates = await bookingService.getBookedDates({
        hallId:    parseInt(hall_id, 10),
        fromDate:  from_date,
        toDate:    to_date,
        companyId: req.companyId,
    });
    return response.success(res, dates);
};

const create = async (req, res) => {
    const booking = await bookingService.create(req.body, actor(req));
    return response.created(res, booking, 'Booking created successfully');
};

const getAll = async (req, res) => {
    const { rows, meta } = await bookingService.getAll(req.query, actor(req));
    return response.success(res, { bookings: rows, meta, stats: {} });
};

const getById = async (req, res) => {
    const booking = await bookingService.getById(
        parseInt(req.params.id, 10),
        req.companyId
    );
    return response.success(res, booking);
};

const getByRef = async (req, res) => {
    const booking = await bookingService.getByRef(req.params.ref, req.companyId);
    return response.success(res, booking);
};

const update = async (req, res) => {
    const booking = await bookingService.update(
        parseInt(req.params.id, 10),
        req.body,
        actor(req)
    );
    return response.success(res, booking, 'Booking updated');
};

const reschedule = async (req, res) => {
    const booking = await bookingService.reschedule(
        parseInt(req.params.id, 10),
        req.body,
        actor(req)
    );
    return response.success(res, booking, 'Booking rescheduled');
};

const updateStatus = async (req, res) => {
    const booking = await bookingService.updateStatus(
        parseInt(req.params.id, 10),
        req.body.status,
        actor(req)
    );
    return response.success(res, booking, 'Booking status updated');
};

const cancel = async (req, res) => {
    const booking = await bookingService.cancel(
        parseInt(req.params.id, 10),
        req.body.reason,
        actor(req)
    );
    return response.success(res, booking, 'Booking cancelled');
};

module.exports = { checkAvailability, checkAvailabilityPost, calculatePrice, getBookedDates, create, getAll, getById, getByRef, update, reschedule, updateStatus, cancel };
