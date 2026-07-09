/**
 * Booking Package Routes — /api/v1/booking-packages
 * Reuses the bookings:read/create/update permission surface — packages are
 * configured as part of managing the booking engine, not a separate module.
 */
'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/bookingPackage.controller');
const { requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../../../constants');

const router = Router();

router.get('/',               requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getAll);
router.post('/',              requirePermission(PERMISSIONS.BOOKINGS_CREATE), ctrl.create);
router.get('/:id',            requirePermission(PERMISSIONS.BOOKINGS_READ),   ctrl.getById);
router.put('/:id',            requirePermission(PERMISSIONS.BOOKINGS_UPDATE), ctrl.update);
router.patch('/:id/activate', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), ctrl.activate);
router.patch('/:id/deactivate', requirePermission(PERMISSIONS.BOOKINGS_UPDATE), ctrl.deactivate);
router.delete('/:id',         requirePermission(PERMISSIONS.BOOKINGS_UPDATE), ctrl.remove);

module.exports = router;
