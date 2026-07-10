'use strict';

const {
    validateCreate, validateUpdate, validateReschedule, validateStatus,
    validateCancel, validateAvailability, validateClone,
} = require('../../src/api/v1/validators/booking.validator');

const run = (middleware, body) => {
    const req = { body };
    const next = jest.fn();
    middleware(req, {}, next);
    return { req, next };
};

const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

describe('booking.validator — create', () => {
    const validPayload = () => ({
        hallId: 1, customerId: 2, eventDate: tomorrow(),
        eventTimeStart: '09:00', eventTimeEnd: '23:00', totalAmount: 50000,
    });

    it('accepts a minimal valid payload', () => {
        const { next } = run(validateCreate, validPayload());
        expect(next).toHaveBeenCalledWith();
    });

    it('accepts today\'s date (same-day walk-in booking)', () => {
        const { next } = run(validateCreate, { ...validPayload(), eventDate: today() });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a past event date', () => {
        const { next } = run(validateCreate, { ...validPayload(), eventDate: '2020-01-01' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a malformed time string', () => {
        const { next } = run(validateCreate, { ...validPayload(), eventTimeStart: '9am' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects an out-of-range hour (25:00)', () => {
        const { next } = run(validateCreate, { ...validPayload(), eventTimeEnd: '25:00' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a negative totalAmount', () => {
        const { next } = run(validateCreate, { ...validPayload(), totalAmount: -100 });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a missing hallId', () => {
        const payload = validPayload(); delete payload.hallId;
        const { next } = run(validateCreate, payload);
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('defaults isPriority/asTentative to false when omitted', () => {
        const { req } = run(validateCreate, validPayload());
        expect(req.body.isPriority).toBe(false);
        expect(req.body.asTentative).toBe(false);
    });

    it('accepts a valid resources array', () => {
        const { next } = run(validateCreate, { ...validPayload(), resources: [{ resourceId: 1, quantity: 5 }] });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a resources entry with a zero quantity', () => {
        const { next } = run(validateCreate, { ...validPayload(), resources: [{ resourceId: 1, quantity: 0 }] });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });
});

describe('booking.validator — update', () => {
    it('accepts a partial update with just guestCount', () => {
        const { next } = run(validateUpdate, { guestCount: 150 });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects guestCount below 1', () => {
        const { next } = run(validateUpdate, { guestCount: 0 });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('accepts setup/cleanup/cooloff minutes within range', () => {
        const { next } = run(validateUpdate, { setupMinutes: 60, cleanupMinutes: 30, cooloffMinutes: 15 });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects setupMinutes over the 1440-minute (24h) cap', () => {
        const { next } = run(validateUpdate, { setupMinutes: 2000 });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });
});

describe('booking.validator — reschedule', () => {
    it('accepts a valid reschedule payload', () => {
        const { next } = run(validateReschedule, { eventDate: tomorrow(), eventTimeStart: '10:00', eventTimeEnd: '18:00' });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects eventEndDate before eventDate (multi-day booking spanning backwards)', () => {
        const start = tomorrow();
        const before = new Date(start); before.setDate(before.getDate() - 5);
        const { next } = run(validateReschedule, {
            eventDate: start, eventTimeStart: '10:00', eventTimeEnd: '18:00',
            eventEndDate: before.toISOString().slice(0, 10),
        });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });
});

describe('booking.validator — status/cancel/clone/availability', () => {
    it('accepts a known status value', () => {
        const { next } = run(validateStatus, { status: 'confirmed' });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects an unknown status value', () => {
        const { next } = run(validateStatus, { status: 'made_up_status' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('accepts a cancel payload with no fields at all (all optional)', () => {
        const { next } = run(validateCancel, {});
        expect(next).toHaveBeenCalledWith();
    });

    it('accepts a full clone payload', () => {
        const { next } = run(validateClone, { eventDate: tomorrow(), eventTimeStart: '09:00', eventTimeEnd: '17:00' });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects an availability check missing eventDate', () => {
        const { next } = run(validateAvailability, { hallId: 1, startTime: '09:00', endTime: '17:00' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });
});
