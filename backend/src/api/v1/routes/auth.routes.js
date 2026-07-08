/**
 * Auth Routes — /api/v1/auth
 * Public: login, forgot-password, reset-password, refresh
 * Protected: me, logout, logout-all, change-password
 */

'use strict';

const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { validate }   = require('../validators/auth.validator');
const { authenticate } = require('../middleware/auth');
const { auth: authLimiter, passwordReset: resetLimiter } = require('../middleware/rateLimiter');

const router = Router();

// ─── Public Routes ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/login
 * Rate-limited to 10 attempts/min (authLimiter already set to skipSuccessfulRequests: true)
 */
router.post('/login',
    authLimiter,
    validate('login'),
    authController.login
);

/**
 * POST /api/v1/auth/register
 * Creates a new account in 'pending' approval status — cannot log in until
 * an administrator approves it (see PATCH /users/:id/approve).
 */
router.post('/register',
    authLimiter,
    validate('register'),
    authController.register
);

/**
 * POST /api/v1/auth/refresh
 * Rotates the refresh token; accepts token from cookie or body
 */
router.post('/refresh',
    authController.refresh
);

/**
 * POST /api/v1/auth/forgot-password
 * Rate-limited to 5 requests / 15 min per IP
 */
router.post('/forgot-password',
    resetLimiter,
    validate('forgotPassword'),
    authController.forgotPassword
);

/**
 * POST /api/v1/auth/reset-password
 * Rate-limited same as forgot-password (shares window)
 */
router.post('/reset-password',
    resetLimiter,
    validate('resetPassword'),
    authController.resetPassword
);

// ─── Protected Routes (require valid JWT) ─────────────────────────────────────

/**
 * GET /api/v1/auth/me
 * Returns the authenticated user's profile and permissions
 */
router.get('/me',
    authenticate,
    authController.me
);

/**
 * POST /api/v1/auth/logout
 * Revokes the current device's refresh token
 */
router.post('/logout',
    authenticate,
    authController.logout
);

/**
 * POST /api/v1/auth/logout-all
 * Revokes ALL refresh tokens for this user (all devices)
 */
router.post('/logout-all',
    authenticate,
    authController.logoutAll
);

/**
 * POST /api/v1/auth/change-password
 * Authenticated password change; revokes all sessions after success
 */
router.post('/change-password',
    authenticate,
    validate('changePassword'),
    authController.changePassword
);

module.exports = router;
