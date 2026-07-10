'use strict';

const { validateCreate, validateRefund } = require('../../src/api/v1/validators/payment.validator');

const run = (middleware, body) => {
    const req = { body };
    const next = jest.fn();
    middleware(req, {}, next);
    return { req, next };
};

describe('payment.validator — create', () => {
    it('accepts a valid camelCase payload and calls next() with no error', () => {
        const { next } = run(validateCreate, {
            bookingId: 5, amount: 1000, paymentMethod: 'cash', paymentType: 'advance',
        });
        expect(next).toHaveBeenCalledWith(); // called with no args = success
    });

    it('accepts a valid snake_case payload (the Payments page form shape)', () => {
        const { next } = run(validateCreate, {
            booking_id: 5, amount: 1000, payment_method: 'cash', payment_type: 'advance',
        });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a payload missing bookingId/booking_id entirely', () => {
        const { next } = run(validateCreate, { amount: 1000, paymentMethod: 'cash', paymentType: 'advance' });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });

    it('rejects a non-positive amount', () => {
        const { next } = run(validateCreate, { bookingId: 1, amount: -5, paymentMethod: 'cash', paymentType: 'advance' });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });

    it('rejects amount = 0', () => {
        const { next } = run(validateCreate, { bookingId: 1, amount: 0, paymentMethod: 'cash', paymentType: 'advance' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a non-numeric bookingId', () => {
        const { next } = run(validateCreate, { bookingId: 'not-a-number', amount: 100, paymentMethod: 'cash', paymentType: 'advance' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('strips unknown fields and normalizes req.body on success', () => {
        const { req } = run(validateCreate, {
            bookingId: 5, amount: 1000, paymentMethod: 'cash', paymentType: 'advance', totallyUnknownField: 'x',
        });
        expect(req.body.totallyUnknownField).toBeUndefined();
        expect(req.body.amount).toBe(1000);
    });

    it('accepts an unlisted-but-plausible payment_method (free text, no enum lock-in)', () => {
        const { next } = run(validateCreate, { bookingId: 1, amount: 100, paymentMethod: 'crypto_wallet', paymentType: 'advance' });
        expect(next).toHaveBeenCalledWith();
    });

    it('collects multiple field errors at once (abortEarly: false)', () => {
        const { next } = run(validateCreate, { amount: -1 });
        const err = next.mock.calls[0][0];
        expect(err.errors.length).toBeGreaterThan(1);
    });
});

describe('payment.validator — refund', () => {
    it('accepts a valid refund payload', () => {
        const { next } = run(validateRefund, { refundAmount: 500, reason: 'Customer cancelled', method: 'cash' });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a missing reason', () => {
        const { next } = run(validateRefund, { refundAmount: 500 });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a non-positive refundAmount', () => {
        const { next } = run(validateRefund, { refundAmount: 0, reason: 'test' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('allows method to be omitted (optional)', () => {
        const { next } = run(validateRefund, { refundAmount: 200, reason: 'test' });
        expect(next).toHaveBeenCalledWith();
    });
});
