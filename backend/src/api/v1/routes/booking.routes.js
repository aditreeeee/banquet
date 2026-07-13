/**
 * Booking Routes — /api/v1/bookings
 */
'use strict';

const { Router }           = require('express');
const ctrl                 = require('../controllers/booking.controller');
const cateringCtrl         = require('../controllers/bookingCatering.controller');
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
router.get('/:id/activities', requirePermission(PERMISSIONS.BOOKINGS_READ),  ctrl.getActivities);
router.get('/:id/resources',  requirePermission(PERMISSIONS.BOOKINGS_READ),  ctrl.getResources);
router.put('/:id/resources',  requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateResources, ctrl.updateResources);
router.get('/:id/decorations',  requirePermission(PERMISSIONS.BOOKINGS_READ),  ctrl.getDecorations);
router.put('/:id/decorations',  requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateDecorations, ctrl.updateDecorations);
router.get('/:id/contacts',   requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getContacts);
router.post('/:id/contacts',  requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateContact, ctrl.addContact);
router.delete('/:id/contacts/:contactId', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), ctrl.removeContact);
router.get('/:id/staff',      requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getStaff);
router.post('/:id/staff',     requirePermission(PERMISSIONS.BOOKINGS_UPDATE), ctrl.assignStaff);
router.delete('/:id/staff/:assignmentId', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), ctrl.removeStaff);

// Per-booking multi-session catering plan (distinct from the company-wide
// Master Menu / CateringPackages under /catering — see bookingCatering.service.js)
router.get('/:bookingId/catering/sessions',            requirePermission(PERMISSIONS.BOOKINGS_READ),   cateringCtrl.listSessions);
router.post('/:bookingId/catering/sessions',           requirePermission(PERMISSIONS.BOOKINGS_UPDATE), cateringCtrl.addSession);
router.put('/:bookingId/catering/sessions/:sessionId', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), cateringCtrl.updateSession);
router.delete('/:bookingId/catering/sessions/:sessionId', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), cateringCtrl.removeSession);
router.post('/:bookingId/catering/sessions/:sessionId/items', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), cateringCtrl.addItem);
router.delete('/:bookingId/catering/sessions/:sessionId/items/:itemRowId', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), cateringCtrl.removeItem);
router.post('/:bookingId/catering/sessions/:sessionId/apply-package', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), cateringCtrl.applyPackage);
router.patch('/:id',         requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateUpdate, ctrl.update);
router.put('/:id',           requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateUpdate, ctrl.update);
router.patch('/:id/reschedule', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), v.validateReschedule, ctrl.reschedule);
router.patch('/:id/status',  requirePermission(PERMISSIONS.BOOKINGS_CONFIRM), v.validateStatus, ctrl.updateStatus);
router.post('/:id/cancel',   requirePermission(PERMISSIONS.BOOKINGS_CANCEL), v.validateCancel, ctrl.cancel);
router.post('/:id/clone',    requirePermission(PERMISSIONS.BOOKINGS_CREATE), v.validateClone, ctrl.clone);
router.post('/:id/slots',    requirePermission(PERMISSIONS.BOOKINGS_CREATE), v.validateSlot,  ctrl.addSlot);
router.get('/:id/slots',     requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getSlots);

module.exports = router;
