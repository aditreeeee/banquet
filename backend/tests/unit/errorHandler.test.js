'use strict';

const errorHandler = require('../../src/api/v1/middleware/errorHandler');
const { AppError, ValidationError, AuthError, ForbiddenError, NotFoundError, ConflictError } = errorHandler;

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const mockReq = (overrides = {}) => ({
    path: '/api/v1/test', method: 'GET', requestId: 'req-1', ip: '127.0.0.1', user: null,
    ...overrides,
});

describe('custom error classes', () => {
    it('AppError defaults to 500 / INTERNAL_ERROR', () => {
        const err = new AppError('boom');
        expect(err.statusCode).toBe(500);
        expect(err.code).toBe('INTERNAL_ERROR');
        expect(err.isOperational).toBe(true);
    });

    it('ValidationError carries a 422 status and a field-error list', () => {
        const err = new ValidationError('bad input', [{ field: 'email', message: 'required' }]);
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.errors).toEqual([{ field: 'email', message: 'required' }]);
    });

    it('AuthError defaults to 401', () => {
        expect(new AuthError().statusCode).toBe(401);
        expect(new AuthError().code).toBe('UNAUTHORIZED');
    });

    it('ForbiddenError defaults to 403', () => {
        expect(new ForbiddenError().statusCode).toBe(403);
    });

    it('NotFoundError includes the resource name in its message', () => {
        const err = new NotFoundError('Booking');
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe('Booking not found');
    });

    it('ConflictError defaults to 409', () => {
        expect(new ConflictError().statusCode).toBe(409);
    });
});

describe('errorHandler middleware', () => {
    const ORIGINAL_ENV = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = ORIGINAL_ENV; });

    it('returns the error\'s own statusCode/code/message for operational errors', () => {
        process.env.NODE_ENV = 'development';
        const res = mockRes();
        errorHandler(new NotFoundError('Hall'), mockReq(), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(404);
        const body = res.json.mock.calls[0][0];
        expect(body).toMatchObject({ success: false, statusCode: 404, code: 'NOT_FOUND', message: 'Hall not found' });
    });

    it('includes the errors[] array from a ValidationError', () => {
        const res = mockRes();
        const err = new ValidationError('Validation failed', [{ field: 'amount', message: 'must be positive' }]);
        errorHandler(err, mockReq(), res, jest.fn());
        const body = res.json.mock.calls[0][0];
        expect(body.errors).toEqual([{ field: 'amount', message: 'must be positive' }]);
    });

    it('maps MSSQL unique-constraint violation (2627) to 409 DUPLICATE_ENTRY', () => {
        const res = mockRes();
        errorHandler({ number: 2627, message: 'PK violation' }, mockReq(), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json.mock.calls[0][0].code).toBe('DUPLICATE_ENTRY');
    });

    it('maps MSSQL foreign-key violation (547) to 422 CONSTRAINT_VIOLATION', () => {
        const res = mockRes();
        errorHandler({ number: 547, message: 'FK violation' }, mockReq(), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json.mock.calls[0][0].code).toBe('CONSTRAINT_VIOLATION');
    });

    it('maps an unrecognized MSSQL error number to a generic 500 in production (no message leak)', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler({ number: 99999, message: 'some raw SQL detail' }, mockReq(), res, jest.fn());
        const body = res.json.mock.calls[0][0];
        expect(res.status).toHaveBeenCalledWith(500);
        expect(body.message).not.toMatch(/raw SQL detail/);
    });

    it('maps an unrecognized MSSQL error number to the real message outside production', () => {
        process.env.NODE_ENV = 'development';
        const res = mockRes();
        errorHandler({ number: 99999, message: 'some raw SQL detail' }, mockReq(), res, jest.fn());
        expect(res.json.mock.calls[0][0].message).toBe('some raw SQL detail');
    });

    it('maps JsonWebTokenError to 401 INVALID_TOKEN', () => {
        const res = mockRes();
        const err = new Error('jwt malformed'); err.name = 'JsonWebTokenError';
        errorHandler(err, mockReq(), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json.mock.calls[0][0].code).toBe('INVALID_TOKEN');
    });

    it('maps TokenExpiredError to 401 TOKEN_EXPIRED', () => {
        const res = mockRes();
        const err = new Error('jwt expired'); err.name = 'TokenExpiredError';
        errorHandler(err, mockReq(), res, jest.fn());
        expect(res.json.mock.calls[0][0].code).toBe('TOKEN_EXPIRED');
    });

    it('maps Multer file-size errors to 413 FILE_TOO_LARGE', () => {
        const res = mockRes();
        errorHandler({ code: 'LIMIT_FILE_SIZE', message: 'File too large' }, mockReq(), res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json.mock.calls[0][0].code).toBe('FILE_TOO_LARGE');
    });

    it('suppresses message/code and replaces with a generic message for unhandled 500s in production', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(new Error('Cannot read property x of undefined at /secret/path.js:42'), mockReq(), res, jest.fn());
        const body = res.json.mock.calls[0][0];
        expect(body.message).toBe('An internal server error occurred. Please try again later.');
        expect(body.code).toBeUndefined();
    });

    it('does not suppress the message for unhandled 500s outside production', () => {
        process.env.NODE_ENV = 'development';
        const res = mockRes();
        errorHandler(new Error('some dev-only detail'), mockReq(), res, jest.fn());
        expect(res.json.mock.calls[0][0].message).toBe('some dev-only detail');
    });

    it('always includes requestId and an ISO timestamp', () => {
        const res = mockRes();
        errorHandler(new AppError('x'), mockReq({ requestId: 'abc-123' }), res, jest.fn());
        const body = res.json.mock.calls[0][0];
        expect(body.requestId).toBe('abc-123');
        expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    });
});
