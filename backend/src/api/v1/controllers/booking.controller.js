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
    isImpersonating: req.isImpersonating,
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
    const {
        hallId, hall_id, eventDate, event_date, startTime, start_time, endTime, end_time,
        guestCount, guest_count, isPriority, is_priority,
        setupMinutes, setup_minutes, cleanupMinutes, cleanup_minutes, cooloffMinutes, cooloff_minutes,
        lateExitHours, late_exit_hours, extendedUsageHours, extended_usage_hours,
    } = req.body;
    const result = await bookingService.calculatePrice({
        hallId:     parseInt(hallId || hall_id, 10),
        eventDate:  eventDate  || event_date,
        startTime:  startTime  || start_time,
        endTime:    endTime    || end_time,
        guestCount: guestCount || guest_count || null,
        isPriority: !!(isPriority || is_priority),
        setupMinutes:        parseInt(setupMinutes || setup_minutes, 10)               || 0,
        cleanupMinutes:      parseInt(cleanupMinutes || cleanup_minutes, 10)            || 0,
        cooloffMinutes:      parseInt(cooloffMinutes || cooloff_minutes, 10)            || 0,
        lateExitHours:       parseFloat(lateExitHours || late_exit_hours)               || 0,
        extendedUsageHours:  parseFloat(extendedUsageHours || extended_usage_hours)     || 0,
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
    const { rows, meta, stats } = await bookingService.getAll(req.query, actor(req));
    return response.success(res, { bookings: rows, meta, stats });
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
        actor(req),
        {
            cancellationCharge: req.body.cancellationCharge,
            refundAmount:       req.body.refundAmount,
            paymentId:          req.body.paymentId,
        }
    );
    return response.success(res, booking, 'Booking cancelled');
};

const getActivities = async (req, res) => {
    const activities = await bookingService.getActivityTimeline(
        parseInt(req.params.id, 10),
        req.companyId
    );
    return response.success(res, activities);
};

const getResources = async (req, res) => {
    const allocations = await bookingService.getResourceAllocations(
        parseInt(req.params.id, 10),
        req.companyId
    );
    return response.success(res, allocations);
};

const updateResources = async (req, res) => {
    const allocations = await bookingService.updateResourceAllocations(
        parseInt(req.params.id, 10),
        req.companyId,
        req.body.resources || [],
        { userId: req.user.user_id }
    );
    return response.success(res, allocations, 'Inventory allocation updated');
};

const getDecorations = async (req, res) => {
    const allocations = await bookingService.getDecorationAllocations(
        parseInt(req.params.id, 10),
        req.companyId
    );
    return response.success(res, allocations);
};

const updateDecorations = async (req, res) => {
    const allocations = await bookingService.updateDecorationAllocations(
        parseInt(req.params.id, 10),
        req.companyId,
        req.body.decorations || [],
        { userId: req.user.user_id }
    );
    return response.success(res, allocations, 'Decoration allocation updated');
};

const getServices = async (req, res) => {
    const services = await bookingService.getServiceAllocations(
        parseInt(req.params.id, 10),
        req.companyId
    );
    return response.success(res, services);
};

const updateServices = async (req, res) => {
    const services = await bookingService.updateServiceAllocations(
        parseInt(req.params.id, 10),
        req.companyId,
        req.body.services || [],
        { userId: req.user.user_id }
    );
    return response.success(res, services, 'Additional services updated');
};

const addSlot = async (req, res) => {
    const slot = await bookingService.addOccupancySlot(
        parseInt(req.params.id, 10),
        req.body,
        actor(req)
    );
    return response.created(res, slot, 'Occupancy slot added');
};

const getSlots = async (req, res) => {
    const slots = await bookingService.getOccupancySlots(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, slots);
};

const clone = async (req, res) => {
    const { eventDate, eventTimeStart, eventTimeEnd, customerId } = req.body;
    const cloned = await bookingService.cloneBooking(
        parseInt(req.params.id, 10),
        { eventDate, eventTimeStart, eventTimeEnd, customerId },
        actor(req)
    );
    return response.created(res, cloned, 'Booking cloned');
};

const getContacts = async (req, res) => {
    const contacts = await bookingService.getContacts(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, contacts);
};

const addContact = async (req, res) => {
    const contact = await bookingService.addContact(parseInt(req.params.id, 10), req.companyId, req.body);
    return response.created(res, contact, 'Contact added');
};

const removeContact = async (req, res) => {
    await bookingService.removeContact(
        parseInt(req.params.id, 10),
        parseInt(req.params.contactId, 10),
        req.companyId
    );
    return response.success(res, null, 'Contact removed');
};

const getStaff = async (req, res) => {
    const staff = await bookingService.getStaffAssignments(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, staff);
};

const assignStaff = async (req, res) => {
    const { userId, roleNote } = req.body;
    const assignment = await bookingService.assignStaff(
        parseInt(req.params.id, 10), req.companyId, req.user.user_id,
        { userId: parseInt(userId, 10), roleNote }
    );
    return response.created(res, assignment, 'Staff assigned');
};

const removeStaff = async (req, res) => {
    await bookingService.removeStaffAssignment(
        parseInt(req.params.id, 10), parseInt(req.params.assignmentId, 10), req.companyId, req.user.user_id
    );
    return response.success(res, null, 'Staff assignment removed');
};

module.exports = {
    checkAvailability, checkAvailabilityPost, calculatePrice, getBookedDates, create, getAll, getById, getByRef,
    update, reschedule, updateStatus, cancel, getActivities, getResources, updateResources,
    getDecorations, updateDecorations, getServices, updateServices, getContacts, addContact, removeContact,
    getStaff, assignStaff, removeStaff, clone, addSlot, getSlots,
};
