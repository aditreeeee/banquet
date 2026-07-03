/**
 * Booking Routes — /api/v1/bookings
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/booking.controller');
const v                    = require('../validators/booking.validator');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS }      = require('../../../constants');

const router = Router();

// Availability (GET for calendar, POST for booking wizard)
router.get('/availability',          requirePermission(PERMISSIONS.AVAILABILITY_READ), ctrl.checkAvailability);
router.post('/check-availability',   requirePermission(PERMISSIONS.AVAILABILITY_READ), ctrl.checkAvailabilityPost);
router.get('/booked-dates',          requirePermission(PERMISSIONS.AVAILABILITY_READ), ctrl.getBookedDates);
router.post('/calculate-price',      requirePermission(PERMISSIONS.BOOKINGS_READ),     ctrl.calculatePrice);

// CRUD
router.get('/',              requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getAll);
router.post('/',             requirePermission(PERMISSIONS.BOOKINGS_CREATE), v.validateCreate, ctrl.create);
router.get('/ref/:ref',      requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getByRef);
router.get('/:id',           requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getById);
router.patch('/:id',         requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateUpdate, ctrl.update);
router.put('/:id',           requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateUpdate, ctrl.update);
router.patch('/:id/reschedule', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateReschedule, ctrl.reschedule);
router.patch('/:id/status',  requirePermission(PERMISSIONS.BOOKINGS_CONFIRM), v.validateStatus, ctrl.updateStatus);
router.post('/:id/cancel',   requirePermission(PERMISSIONS.BOOKINGS_CANCEL), v.validateCancel, ctrl.cancel);

module.exports = router;
