'use strict';

const { validateCreate, validateUpdate } = require('../../src/api/v1/validators/user.validator');

const run = (middleware, body) => {
    const req = { body };
    const next = jest.fn();
    middleware(req, {}, next);
    return { req, next };
};

describe('user.validator — create', () => {
    it('accepts a valid camelCase payload', () => {
        const { next } = run(validateCreate, {
            email: 'jane@example.com', password: 'Password123', firstName: 'Jane', lastName: 'Doe', roleId: 3,
        });
        expect(next).toHaveBeenCalledWith();
    });

    it('accepts a valid snake_case payload (the Users page form shape)', () => {
        const { next } = run(validateCreate, {
            email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe', role_id: 3, role_ids: [3], branch_id: 2,
        });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a missing email', () => {
        const { next } = run(validateCreate, { first_name: 'Jane', last_name: 'Doe' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a malformed email', () => {
        const { next } = run(validateCreate, { email: 'not-an-email', first_name: 'Jane', last_name: 'Doe' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a payload missing both firstName and first_name', () => {
        const { next } = run(validateCreate, { email: 'jane@example.com', last_name: 'Doe' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a payload missing both lastName and last_name', () => {
        const { next } = run(validateCreate, { email: 'jane@example.com', first_name: 'Jane' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('rejects a password shorter than 8 characters when provided', () => {
        const { next } = run(validateCreate, { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe', password: 'short' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('allows password to be omitted (service generates a random one)', () => {
        const { next } = run(validateCreate, { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' });
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects a non-array role_ids', () => {
        const { next } = run(validateCreate, { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe', role_ids: 'not-an-array' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });
});

describe('user.validator — update', () => {
    it('accepts a partial snake_case update (edit form shape)', () => {
        const { next } = run(validateUpdate, { first_name: 'Janet', status: 'active' });
        expect(next).toHaveBeenCalledWith();
    });

    it('accepts an empty body (no-op update)', () => {
        const { next } = run(validateUpdate, {});
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects an invalid status value', () => {
        const { next } = run(validateUpdate, { status: 'deleted' });
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('accepts isActive as a boolean', () => {
        const { next } = run(validateUpdate, { isActive: false });
        expect(next).toHaveBeenCalledWith();
    });

    it('strips an unrecognized field without erroring', () => {
        const { req, next } = run(validateUpdate, { first_name: 'Janet', someRandomField: 'x' });
        expect(next).toHaveBeenCalledWith();
        expect(req.body.someRandomField).toBeUndefined();
    });
});
