/**
 * Global Error Handler Middleware
 * Catches all unhandled errors and returns standardized responses
 */

'use strict';

const logger = require('../../../utils/logger');

// ─── Custom Error Classes ─────────────────────────────────────────────────────
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
    }
}

class ValidationError extends AppError {
    constructor(message, errors = []) {
        super(message, 422, 'VALIDATION_ERROR');
        this.errors = errors;
    }
}

class AuthError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 401, 'UNAUTHORIZED');
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403, 'FORBIDDEN');
    }
}

class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
    }
}

class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(message, 409, 'CONFLICT');
    }
}

// ─── Error Handler Middleware ────────────────────────────────────────────────
const errorHandler = (err, req, res, next) => {
    // Default values
    let statusCode = err.statusCode || 500;
    let message    = err.message    || 'An unexpected error occurred';
    let code       = err.code       || 'INTERNAL_ERROR';
    let errors     = err.errors     || undefined;

    // Handle MSSQL errors (the `mssql` package surfaces the SQL Server error
    // number as err.number, unlike mysql2 which used a string err.code)
    if (typeof err.number === 'number') {
        switch (err.number) {
            case 2627: // Violation of PRIMARY KEY / UNIQUE constraint
            case 2601: // Cannot insert duplicate key row (unique index)
                statusCode = 409;
                message    = 'A record with these details already exists';
                code       = 'DUPLICATE_ENTRY';
                break;
            case 547:  // FOREIGN KEY constraint violation (insert/update/delete)
                statusCode = 422;
                message    = 'Related record not found or constraint violated';
                code       = 'CONSTRAINT_VIOLATION';
                break;
            case 8152: // String or binary data would be truncated
            case 2628: // String or binary data would be truncated in table/variable
                statusCode = 422;
                message    = 'One or more fields exceed the maximum allowed length';
                code       = 'VALIDATION_ERROR';
                break;
            case 515:  // Cannot insert the value NULL into column (NOT NULL violation)
                statusCode = 422;
                message    = 'A required field is missing';
                code       = 'VALIDATION_ERROR';
                break;
            default:
                statusCode = 500;
                message    = process.env.NODE_ENV === 'production'
                    ? 'A database error occurred'
                    : err.message;
        }
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError')  { statusCode = 401; message = 'Invalid token';  code = 'INVALID_TOKEN'; }
    if (err.name === 'TokenExpiredError')  { statusCode = 401; message = 'Token expired';  code = 'TOKEN_EXPIRED'; }

    // Handle Multer errors
    if (err.code === 'LIMIT_FILE_SIZE')    { statusCode = 413; message = 'File too large'; code = 'FILE_TOO_LARGE'; }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') { statusCode = 422; message = 'Unexpected file field'; }

    // Log server errors with full details
    if (statusCode >= 500) {
        logger.error('Unhandled server error', {
            message:    err.message,
            stack:      err.stack,
            statusCode,
            path:       req.path,
            method:     req.method,
            requestId:  req.requestId,
            userId:     req.user?.user_id,
            ip:         req.ip,
        });
    }

    // Response
    const response = {
        success:    false,
        statusCode,
        code,
        message,
        timestamp:  new Date().toISOString(),
        requestId:  req.requestId,
    };

    if (errors) response.errors = errors;

    // Don't leak internal details in production
    if (process.env.NODE_ENV === 'production' && statusCode === 500) {
        response.message = 'An internal server error occurred. Please try again later.';
        delete response.code;
    }

    res.status(statusCode).json(response);
};

module.exports = errorHandler;
module.exports.AppError       = AppError;
module.exports.ValidationError = ValidationError;
module.exports.AuthError      = AuthError;
module.exports.ForbiddenError = ForbiddenError;
module.exports.NotFoundError  = NotFoundError;
module.exports.ConflictError  = ConflictError;
