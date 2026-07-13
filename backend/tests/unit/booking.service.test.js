'use strict';

jest.mock('../../src/repositories/booking.repository');
jest.mock('../../src/repositories/hall.repository');
jest.mock('../../src/repositories/customer.repository');
jest.mock('../../src/repositories/auditLog.repository');
jest.mock('../../src/repositories/resource.repository');
jest.mock('../../src/repositories/decoration.repository');
jest.mock('../../src/repositories/bookingContact.repository');
jest.mock('../../src/repositories/bookingStaff.repository');
jest.mock('../../src/repositories/bookingCatering.repository');
jest.mock('../../src/repositories/bookingPackage.repository');
jest.mock('../../src/repositories/notification.repository');
jest.mock('../../src/services/operationalCharge.service');
jest.mock('../../src/services/payment.service');
jest.mock('../../src/services/settings.service');
jest.mock('../../src/services/dashboard.service');
jest.mock('../../src/services/notification.service');

const bookingRepo  = require('../../src/repositories/booking.repository');
const hallRepo     = require('../../src/repositories/hall.repository');
const customerRepo = require('../../src/repositories/customer.repository');
const auditLogRepo = require('../../src/repositories/auditLog.repository');
const notificationRepo = require('../../src/repositories/notification.repository');
const resourceRepo = require('../../src/repositories/resource.repository');
const decorationRepo = require('../../src/repositories/decoration.repository');
const bookingCateringRepo = require('../../src/repositories/bookingCatering.repository');
const bookingPackageRepo = require('../../src/repositories/bookingPackage.repository');
const settingsService = require('../../src/services/settings.service');
const paymentService = require('../../src/services/payment.service');
const notif = require('../../src/services/notification.service');
const bookingService = require('../../src/services/booking.service');
const { NotFoundError, ValidationError, ConflictError } = require('../../src/api/v1/middleware/errorHandler');

const actor = { companyId: 1, userId: 1, branchId: 2 };

const activeHall = {
    hall_id: 1, company_id: 1, branch_id: 2, capacity: 200,
    is_active: true, is_under_maintenance: false, base_price: 100000,
};

beforeEach(() => {
    jest.clearAllMocks();
    settingsService.getBookingDefaults.mockResolvedValue({
        advancePct: 25, setupMinutes: 30, cleanupMinutes: 30, cooloffMinutes: 15,
    });
    // Fire-and-forget side effects (email/notification dispatch) — the
    // service chains .catch() onto these, so the mock must resolve to a
    // real Promise rather than automock's default `undefined` return.
    notif.sendBookingConfirmationEmail.mockResolvedValue(undefined);
    notificationRepo.notifyManagers.mockResolvedValue(undefined);
    // update()/reschedule() both call the internal recalculateBookingTotal(),
    // which pulls catering/resource line items — default to "none" so those
    // tests aren't tripped up by an unrelated undefined-array crash.
    bookingCateringRepo.listItemsForBooking.mockResolvedValue([]);
    resourceRepo.getAllocationsForBooking.mockResolvedValue([]);
    decorationRepo.getAllocationsForBooking.mockResolvedValue([]);
    bookingRepo.updateTotalAmount.mockResolvedValue(undefined);
});

describe('booking.service — checkAvailability', () => {
    it('404s when the hall does not exist under the given company', async () => {
        hallRepo.findById.mockResolvedValue(null);
        await expect(bookingService.checkAvailability({ hallId: 99, eventDate: '2027-01-01', startTime: '09:00', endTime: '18:00', companyId: 1 }))
            .rejects.toBeInstanceOf(NotFoundError);
        expect(bookingRepo.checkAvailability).not.toHaveBeenCalled();
    });

    it('delegates the actual conflict check to the repository', async () => {
        hallRepo.findById.mockResolvedValue(activeHall);
        bookingRepo.checkAvailability.mockResolvedValue(false);

        const result = await bookingService.checkAvailability({ hallId: 1, eventDate: '2027-01-01', startTime: '09:00', endTime: '18:00', companyId: 1 });

        expect(bookingRepo.checkAvailability).toHaveBeenCalledWith(
            expect.objectContaining({ hallId: 1, eventDate: '2027-01-01' })
        );
        expect(result).toEqual({ available: false, hall: activeHall });
    });
});

describe('booking.service — create', () => {
    const validPayload = () => ({
        hallId: 1, customerId: 5, eventDate: '2027-06-01',
        eventTimeStart: '09:00', eventTimeEnd: '18:00', totalAmount: 100000, guestCount: 100,
    });

    it('404s when the hall does not exist', async () => {
        hallRepo.findById.mockResolvedValue(null);
        await expect(bookingService.create(validPayload(), actor)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects booking an inactive hall', async () => {
        hallRepo.findById.mockResolvedValue({ ...activeHall, is_active: false });
        await expect(bookingService.create(validPayload(), actor)).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects booking a hall under maintenance', async () => {
        hallRepo.findById.mockResolvedValue({ ...activeHall, is_under_maintenance: true, maintenance_note: 'Re-flooring' });
        await expect(bookingService.create(validPayload(), actor)).rejects.toMatchObject({
            message: expect.stringContaining('maintenance'),
        });
    });

    it('rejects a guest count over the hall capacity', async () => {
        hallRepo.findById.mockResolvedValue(activeHall);
        await expect(bookingService.create({ ...validPayload(), guestCount: 500 }, actor))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it('404s when the customer does not exist', async () => {
        hallRepo.findById.mockResolvedValue(activeHall);
        customerRepo.findById.mockResolvedValue(null);
        await expect(bookingService.create(validPayload(), actor)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects when no branch can be resolved (no actor branch, no hall branch)', async () => {
        hallRepo.findById.mockResolvedValue({ ...activeHall, branch_id: null });
        customerRepo.findById.mockResolvedValue({ customer_id: 5, email: 'c@x.com', first_name: 'A' });
        const superAdminActor = { ...actor, branchId: null };
        await expect(bookingService.create(validPayload(), superAdminActor)).rejects.toBeInstanceOf(ValidationError);
    });

    it('creates the booking, computes the advance amount from company defaults, and logs an audit entry', async () => {
        hallRepo.findById.mockResolvedValue(activeHall);
        customerRepo.findById.mockResolvedValue({ customer_id: 5, email: 'c@x.com', first_name: 'A' });
        bookingRepo.create.mockResolvedValue({
            booking_id: 10, booking_ref: 'BK-0010', status: 'draft', event_date: '2027-06-01', hall_id: 1,
        });

        await bookingService.create(validPayload(), actor);

        expect(bookingRepo.create).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 1,
            branchId: 2,
            createdBy: 1,
            advancePaid: 25000, // 25% of totalAmount 100000
        }));
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 1,
            action: 'booking.created',
            entityType: 'booking',
            entityId: 10,
        }));
    });

    it('honors an explicitly supplied advancePaid instead of the auto-calculated one', async () => {
        hallRepo.findById.mockResolvedValue(activeHall);
        customerRepo.findById.mockResolvedValue({ customer_id: 5, email: 'c@x.com', first_name: 'A' });
        bookingRepo.create.mockResolvedValue({ booking_id: 11, booking_ref: 'BK-0011', status: 'draft', event_date: '2027-06-01', hall_id: 1 });

        await bookingService.create({ ...validPayload(), advancePaid: 5000 }, actor);

        expect(bookingRepo.create).toHaveBeenCalledWith(expect.objectContaining({ advancePaid: 5000 }));
    });

    it('adds a 20% priority surcharge when isPriority is set', async () => {
        hallRepo.findById.mockResolvedValue(activeHall);
        customerRepo.findById.mockResolvedValue({ customer_id: 5, email: 'c@x.com', first_name: 'A' });
        bookingRepo.create.mockResolvedValue({ booking_id: 12, booking_ref: 'BK-0012', status: 'draft', event_date: '2027-06-01', hall_id: 1 });

        await bookingService.create({ ...validPayload(), isPriority: true }, actor);

        expect(bookingRepo.create).toHaveBeenCalledWith(expect.objectContaining({ priority_surcharge: 20000 }));
    });
});

describe('booking.service — updateStatus', () => {
    it('404s when the booking does not exist', async () => {
        bookingRepo.findById.mockResolvedValue(null);
        await expect(bookingService.updateStatus(1, 'confirmed', actor)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects an illegal status transition (e.g. draft -> completed)', async () => {
        bookingRepo.findById.mockResolvedValue({ booking_id: 1, status: 'draft', booking_ref: 'BK-0001' });
        await expect(bookingService.updateStatus(1, 'completed', actor)).rejects.toBeInstanceOf(ValidationError);
        expect(bookingRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects a terminal-state transition (cancelled has no allowed next states)', async () => {
        bookingRepo.findById.mockResolvedValue({ booking_id: 1, status: 'cancelled', booking_ref: 'BK-0001' });
        await expect(bookingService.updateStatus(1, 'confirmed', actor)).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects marking a booking completed while a balance is still outstanding', async () => {
        bookingRepo.findById.mockResolvedValue({
            booking_id: 1, status: 'advance_paid', booking_ref: 'BK-0001',
            total_amount: 100000, amount_paid: 50000,
        });
        await expect(bookingService.updateStatus(1, 'completed', actor)).rejects.toMatchObject({
            message: expect.stringContaining('outstanding'),
        });
        expect(bookingRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('allows a legal transition and logs an audit entry', async () => {
        bookingRepo.findById.mockResolvedValue({ booking_id: 1, status: 'tentative', booking_ref: 'BK-0001' });
        bookingRepo.updateStatus.mockResolvedValue({ booking_id: 1, status: 'confirmed' });

        const result = await bookingService.updateStatus(1, 'confirmed', actor);

        expect(bookingRepo.updateStatus).toHaveBeenCalledWith(1, 1, 'confirmed', 1);
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'booking.status_changed',
            oldValues: { status: 'tentative' },
            newValues: { status: 'confirmed' },
        }));
        expect(result).toEqual({ booking_id: 1, status: 'confirmed' });
    });

    it('allows completing a booking once the balance is fully settled', async () => {
        bookingRepo.findById.mockResolvedValue({
            booking_id: 1, status: 'fully_paid', booking_ref: 'BK-0001',
            total_amount: 100000, amount_paid: 100000,
        });
        bookingRepo.updateStatus.mockResolvedValue({ booking_id: 1, status: 'completed' });

        await expect(bookingService.updateStatus(1, 'completed', actor)).resolves.toMatchObject({ status: 'completed' });
    });
});

describe('booking.service — update', () => {
    const existingBooking = () => ({
        booking_id: 1, booking_ref: 'BK-0001', status: 'tentative',
        hall_id: 1, event_date: '2027-06-01', event_name: 'Old Name', event_type: 'wedding',
        guest_count: 100, notes: 'old notes', total_amount: 100000, is_priority: false,
        package_id: null, package_base_price: null, catering_package_id: null,
    });

    it('404s when the booking does not exist', async () => {
        bookingRepo.findById.mockResolvedValue(null);
        await expect(bookingService.update(1, { guestCount: 150 }, actor)).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each(['cancelled', 'completed', 'archived'])('rejects editing a %s booking', async (status) => {
        bookingRepo.findById.mockResolvedValue({ ...existingBooking(), status });
        await expect(bookingService.update(1, { guestCount: 150 }, actor)).rejects.toBeInstanceOf(ValidationError);
        expect(bookingRepo.update).not.toHaveBeenCalled();
    });

    it('404s when switching to a package that does not exist', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        bookingPackageRepo.findPackageById.mockResolvedValue(null);
        await expect(bookingService.update(1, { packageId: 99 }, actor)).rejects.toBeInstanceOf(NotFoundError);
        expect(bookingRepo.update).not.toHaveBeenCalled();
    });

    it('rejects switching to an inactive package', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        bookingPackageRepo.findPackageById.mockResolvedValue({ package_id: 5, is_active: false });
        await expect(bookingService.update(1, { packageId: 5 }, actor)).rejects.toBeInstanceOf(ValidationError);
    });

    it('updates fields, re-prices via the selected package, and logs an audit entry with old and new values', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        hallRepo.findById.mockResolvedValue(activeHall);
        bookingPackageRepo.findPackageById.mockResolvedValue({
            package_id: 5, is_active: true, calc_type: 'full_day', overtime_rate_per_hour: 1000, max_extension_hours: 2,
        });
        bookingRepo.update.mockResolvedValue(undefined);

        const result = await bookingService.update(1, { guestCount: 150, packageId: 5 }, actor);

        expect(bookingRepo.update).toHaveBeenCalledWith(1, 1, expect.objectContaining({
            guestCount: 150,
            packageId: 5,
            packageOvertimeRate: 1000,
            packageMaxExtensionHours: 2,
            packageIdProvided: true,
        }));
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'booking.updated',
            entityId: 1,
            oldValues: expect.objectContaining({ event_name: 'Old Name', guest_count: 100 }),
            newValues: { guestCount: 150, packageId: 5 },
        }));
        expect(result).toEqual(existingBooking());
    });

    it('clears the package when packageId is explicitly set to null', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        hallRepo.findById.mockResolvedValue(activeHall);
        bookingRepo.update.mockResolvedValue(undefined);

        await bookingService.update(1, { packageId: null }, actor);

        expect(bookingPackageRepo.findPackageById).not.toHaveBeenCalled();
        expect(bookingRepo.update).toHaveBeenCalledWith(1, 1, expect.objectContaining({
            packageOvertimeRate: null, packageMaxExtensionHours: null, packageBasePrice: null, packageIdProvided: true,
        }));
    });

    it('leaves package fields untouched when packageId is omitted entirely', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        hallRepo.findById.mockResolvedValue(activeHall);
        bookingRepo.update.mockResolvedValue(undefined);

        await bookingService.update(1, { guestCount: 120 }, actor);

        expect(bookingPackageRepo.findPackageById).not.toHaveBeenCalled();
        expect(bookingRepo.update).toHaveBeenCalledWith(1, 1, expect.objectContaining({ packageIdProvided: false }));
    });
});

describe('booking.service — reschedule', () => {
    const existingBooking = () => ({
        booking_id: 1, booking_ref: 'BK-0001', status: 'confirmed',
        hall_id: 1, event_date: '2027-06-01', event_time_start: '09:00', event_time_end: '18:00',
        total_amount: 100000, is_priority: false, package_id: null, package_base_price: null, catering_package_id: null,
    });
    const newSchedule = { eventDate: '2027-07-01', eventTimeStart: '10:00', eventTimeEnd: '20:00' };

    it('404s when the booking does not exist', async () => {
        bookingRepo.findById.mockResolvedValue(null);
        await expect(bookingService.reschedule(1, newSchedule, actor)).rejects.toBeInstanceOf(NotFoundError);
        expect(bookingRepo.reschedule).not.toHaveBeenCalled();
    });

    it.each(['cancelled', 'completed', 'archived'])('rejects rescheduling a %s booking', async (status) => {
        bookingRepo.findById.mockResolvedValue({ ...existingBooking(), status });
        await expect(bookingService.reschedule(1, newSchedule, actor)).rejects.toBeInstanceOf(ValidationError);
        expect(bookingRepo.reschedule).not.toHaveBeenCalled();
    });

    it('reschedules, re-prices for the new date, and logs an audit entry with the old and new schedule', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        hallRepo.findById.mockResolvedValue(activeHall);
        bookingRepo.reschedule.mockResolvedValue(undefined);

        const result = await bookingService.reschedule(1, newSchedule, actor);

        expect(bookingRepo.reschedule).toHaveBeenCalledWith(1, 1, newSchedule);
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'booking.rescheduled',
            entityId: 1,
            oldValues: { event_date: '2027-06-01', event_time_start: '09:00', event_time_end: '18:00' },
            newValues: newSchedule,
        }));
        expect(result).toEqual(existingBooking());
    });
});

describe('booking.service — cancel', () => {
    const existingBooking = (status = 'confirmed') => ({
        booking_id: 1, booking_ref: 'BK-0001', status, event_name: 'Reception',
    });

    it('404s when the booking does not exist', async () => {
        bookingRepo.findById.mockResolvedValue(null);
        await expect(bookingService.cancel(1, 'Customer request', actor)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects cancelling an already-cancelled booking', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking('cancelled'));
        await expect(bookingService.cancel(1, 'reason', actor)).rejects.toBeInstanceOf(ConflictError);
        expect(bookingRepo.cancel).not.toHaveBeenCalled();
    });

    it.each(['completed', 'archived'])('rejects cancelling a %s booking', async (status) => {
        bookingRepo.findById.mockResolvedValue(existingBooking(status));
        await expect(bookingService.cancel(1, 'reason', actor)).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects a refund request with no paymentId', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        await expect(bookingService.cancel(1, 'reason', actor, { refundAmount: 5000 }))
            .rejects.toBeInstanceOf(ValidationError);
        expect(bookingRepo.cancel).not.toHaveBeenCalled();
    });

    it('cancels the booking and logs an audit entry (no refund)', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        bookingRepo.cancel.mockResolvedValue({ booking_id: 1, status: 'cancelled' });

        const result = await bookingService.cancel(1, 'Customer request', actor, { cancellationCharge: 2000 });

        expect(bookingRepo.cancel).toHaveBeenCalledWith(1, 1, 'Customer request', 1, 2000);
        expect(paymentService.refund).not.toHaveBeenCalled();
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'booking.cancelled',
            oldValues: { status: 'confirmed' },
            newValues: expect.objectContaining({ status: 'cancelled', reason: 'Customer request', cancellationCharge: 2000 }),
        }));
        expect(result).toEqual(expect.objectContaining({ booking_id: 1, status: 'cancelled', refund: null }));
    });

    it('cancels the booking and processes a refund against the given payment', async () => {
        bookingRepo.findById.mockResolvedValue(existingBooking());
        bookingRepo.cancel.mockResolvedValue({ booking_id: 1, status: 'cancelled' });
        paymentService.refund.mockResolvedValue({ refund_id: 9, amount: 10000 });

        const result = await bookingService.cancel(1, 'reason', actor, { refundAmount: 10000, paymentId: 3 });

        expect(paymentService.refund).toHaveBeenCalledWith(3, expect.objectContaining({ refundAmount: 10000 }), actor);
        expect(result.refund).toEqual({ refund_id: 9, amount: 10000 });
    });
});

describe('booking.service — updateDecorationAllocations', () => {
    it('404s when the booking does not exist', async () => {
        bookingRepo.findById.mockResolvedValue(null);
        await expect(bookingService.updateDecorationAllocations(1, 1, [{ decorationId: 1, quantity: 2 }], actor))
            .rejects.toBeInstanceOf(NotFoundError);
        expect(decorationRepo.reallocateForBooking).not.toHaveBeenCalled();
    });

    it.each(['cancelled', 'completed', 'archived'])('rejects reallocating decorations for a %s booking', async (status) => {
        bookingRepo.findById.mockResolvedValue({ booking_id: 1, status, event_date: '2027-06-01' });
        await expect(bookingService.updateDecorationAllocations(1, 1, [{ decorationId: 1, quantity: 2 }], actor))
            .rejects.toBeInstanceOf(ValidationError);
        expect(decorationRepo.reallocateForBooking).not.toHaveBeenCalled();
    });

    it('reallocates decorations, recalculates the total, and logs an audit entry', async () => {
        bookingRepo.findById.mockResolvedValue({ booking_id: 1, status: 'confirmed', event_date: '2027-06-01', booking_ref: 'BK-0001', hall_id: 1, total_amount: 0 });
        hallRepo.findById.mockResolvedValue(activeHall);
        decorationRepo.reallocateForBooking.mockResolvedValue(undefined);
        decorationRepo.getAllocationsForBooking.mockResolvedValue([
            { decoration_id: 1, quantity_allocated: 2, rental_price: 1000, installation_cost: 200, removal_cost: 0, tax_percent: 0, discount_percent: 0 },
        ]);

        const decorations = [{ decorationId: 1, quantity: 2 }];
        const result = await bookingService.updateDecorationAllocations(1, 1, decorations, actor);

        expect(decorationRepo.reallocateForBooking).toHaveBeenCalledWith(1, 1, decorations, '2027-06-01');
        expect(bookingRepo.updateTotalAmount).toHaveBeenCalledWith(1, 1, 102200); // hallPrice 100000 + decoration (2*1000 + 200)
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            action: 'booking.decorations_updated',
            entityId: 1,
            newValues: { decorations },
        }));
        expect(result).toEqual([expect.objectContaining({ decoration_id: 1 })]);
    });
});

describe('booking.service — getDecorationAllocations', () => {
    it('404s when the booking does not exist', async () => {
        bookingRepo.findById.mockResolvedValue(null);
        await expect(bookingService.getDecorationAllocations(1, 1)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('delegates to the repository for an existing booking', async () => {
        bookingRepo.findById.mockResolvedValue({ booking_id: 1 });
        decorationRepo.getAllocationsForBooking.mockResolvedValue([{ decoration_id: 1 }]);
        await expect(bookingService.getDecorationAllocations(1, 1)).resolves.toEqual([{ decoration_id: 1 }]);
    });
});

describe('booking.service — recalculateBookingTotal decoration cost fallback', () => {
    it('falls back to the legacy flat decoration_charge column when no catalog allocations exist', async () => {
        bookingRepo.findById.mockResolvedValue({
            booking_id: 1, status: 'tentative', event_date: '2027-06-01', booking_ref: 'BK-0001',
            hall_id: 1, total_amount: 0, decoration_charge: 5000,
        });
        hallRepo.findById.mockResolvedValue(activeHall);
        decorationRepo.getAllocationsForBooking.mockResolvedValue([]);
        bookingRepo.updateStatus.mockResolvedValue({ booking_id: 1, status: 'confirmed' });

        await bookingService.updateStatus(1, 'confirmed', actor);

        // recalculateBookingTotal isn't called from updateStatus, so trigger it via
        // updateDecorationAllocations instead (also exercises the empty-allocation path).
        bookingRepo.findById.mockResolvedValue({
            booking_id: 1, status: 'confirmed', event_date: '2027-06-01', booking_ref: 'BK-0001',
            hall_id: 1, total_amount: 0, decoration_charge: 5000,
        });
        decorationRepo.reallocateForBooking.mockResolvedValue(undefined);
        await bookingService.updateDecorationAllocations(1, 1, [], actor);

        expect(bookingRepo.updateTotalAmount).toHaveBeenCalledWith(1, 1, 105000); // hallPrice 100000 + legacy decoration_charge 5000
    });
});
