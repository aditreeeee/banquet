/**
 * Rate Limiter Middleware
 * Global + per-route limiting to prevent abuse
 */

'use strict';

const rateLimit = require('express-rate-limit');

const createLimiter = (options) => rateLimit({
    windowMs:         options.windowMs  || parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
    max:              options.max,
    standardHeaders:  true,   // Return rate limit info in RateLimit-* headers
    legacyHeaders:    false,
    skipSuccessfulRequests: options.skipSuccess || false,
    message: {
        success:    false,
        statusCode: 429,
        code:       'RATE_LIMIT_EXCEEDED',
        message:    options.message || 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000),
    },
    keyGenerator: (req) => {
        // Use user ID if authenticated, else IP
        return req.user?.user_id
            ? `user_${req.user.user_id}`
            : req.ip;
    },
});

module.exports = {
    // Global API limit: 100 req/min per IP/user
    global: createLimiter({
        windowMs: 60_000,
        max:      parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    }),

    // Auth endpoints: 10 attempts/min (brute-force protection)
    auth: createLimiter({
        windowMs: 60_000,
        max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
        message:  'Too many login attempts. Please try again in 1 minute.',
        skipSuccess: true,
    }),

    // Password reset: 5 per 15 min
    passwordReset: createLimiter({
        windowMs: 15 * 60_000,
        max:      5,
        message:  'Too many password reset requests.',
    }),

    // OTP: 3 per 10 min
    otp: createLimiter({
        windowMs: 10 * 60_000,
        max:      3,
        message:  'Too many OTP requests. Please try again later.',
    }),

    // Report export: 10 per hour
    reportExport: createLimiter({
        windowMs: 60 * 60_000,
        max:      10,
        message:  'Export limit reached. Please try again in an hour.',
    }),
};
