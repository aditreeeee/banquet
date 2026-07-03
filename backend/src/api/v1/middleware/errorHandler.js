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

    // Handle MySQL errors (mysql2 uses err.code string, not err.number)
    if (err.code && typeof err.code === 'string' && err.code.startsWith('ER_')) {
        switch (err.code) {
            case 'ER_DUP_ENTRY':           // Unique constraint violation
                statusCode = 409;
                message    = 'A record with these details already exists';
                code       = 'DUPLICATE_ENTRY';
                break;
            case 'ER_NO_REFERENCED_ROW_2': // FK constraint violation (child row)
            case 'ER_NO_REFERENCED_ROW':
                statusCode = 422;
                message    = 'Related record not found or constraint violated';
                code       = 'CONSTRAINT_VIOLATION';
                break;
            case 'ER_ROW_IS_REFERENCED_2': // FK constraint (parent row deletion)
            case 'ER_ROW_IS_REFERENCED':
                statusCode = 409;
                message    = 'Cannot delete — record is referenced by other data';
                code       = 'CONSTRAINT_VIOLATION';
                break;
            case 'ER_DATA_TOO_LONG':
                statusCode = 422;
                message    = 'One or more fields exceed the maximum allowed length';
                code       = 'VALIDATION_ERROR';
                break;
            case 'ER_BAD_NULL_ERROR':
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
