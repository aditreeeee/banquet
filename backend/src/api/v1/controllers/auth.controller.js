/**
 * Auth Controller — HTTP request/response handling for auth endpoints
 * Delegates all business logic to AuthService
 */

'use strict';

const authService = require('../../../services/auth.service');
const response    = require('../../../utils/response');
const logger      = require('../../../utils/logger');

// Cookie options for the refresh token (HttpOnly, Secure in prod)
const REFRESH_COOKIE_OPTIONS = {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path:     '/api/v1/auth',           // Scope cookie to auth path only
};

const REFRESH_COOKIE_OPTIONS_EXTENDED = {
    ...REFRESH_COOKIE_OPTIONS,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days for remember_me
};

/**
 * Extract request metadata (IP, User-Agent) for audit logging
 */
const getMeta = (req) => ({
    ipAddress: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'] || '',
});

// ─── POST /auth/register ──────────────────────────────────────────────────────

const register = async (req, res) => {
    const user = await authService.register(req.body);
    return response.success(
        res,
        { user },
        'Registration submitted. Your account is awaiting administrator approval.',
        201
    );
};

// ─── POST /auth/login ─────────────────────────────────────────────────────────

const login = async (req, res) => {
    const { email, password, remember_me } = req.body;
    const meta = getMeta(req);

    const { user, accessToken, refreshToken, permissions, roles } = await authService.login(
        { email, password, remember_me },
        meta
    );

    // Send refresh token in HttpOnly cookie (not accessible to JS)
    res.cookie(
        'refreshToken',
        refreshToken,
        remember_me ? REFRESH_COOKIE_OPTIONS_EXTENDED : REFRESH_COOKIE_OPTIONS
    );

    return response.success(res, {
        user,
        accessToken,
        permissions,
        roles,
        // Also return in body for non-browser clients (mobile / API)
        refreshToken,
        tokenType: 'Bearer',
    }, 'Login successful');
};

// ─── POST /auth/logout ────────────────────────────────────────────────────────

const logout = async (req, res) => {
    // Accept token from cookie or Authorization header body
    const refreshToken = req.cookies?.refreshToken || req.body?.refresh_token;
    const userId       = req.user?.user_id;

    await authService.logout(refreshToken, userId);

    // Clear the cookie
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });

    return response.success(res, null, 'Logged out successfully');
};

// ─── POST /auth/logout-all ────────────────────────────────────────────────────

const logoutAll = async (req, res) => {
    await authService.logoutAll(req.user.user_id);
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return response.success(res, null, 'Logged out from all devices');
};

// ─── POST /auth/refresh ───────────────────────────────────────────────────────

const refresh = async (req, res) => {
    // Accept from cookie (browser) or body (mobile/API clients)
    const refreshToken = req.cookies?.refreshToken || req.body?.refresh_token;

    if (!refreshToken) {
        return res.status(401).json({
            success:    false,
            statusCode: 401,
            message:    'Refresh token required',
        });
    }

    const meta   = getMeta(req);
    const tokens = await authService.refreshTokens(refreshToken, meta);

    // Rotate cookie
    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

    return response.success(res, {
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType:    'Bearer',
    }, 'Token refreshed');
};

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

const me = async (req, res) => {
    const { user, permissions, roles } = await authService.me(req.user.user_id);
    return response.success(res, { user, permissions, roles }, 'Profile retrieved');
};

// ─── POST /auth/forgot-password ───────────────────────────────────────────────

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    // Always returns 200 — do not expose whether email exists
    await authService.forgotPassword(email);
    return response.success(
        res, null,
        'If that email is registered you will receive a reset link shortly'
    );
};

// ─── POST /auth/reset-password ────────────────────────────────────────────────

const resetPassword = async (req, res) => {
    const { token, password } = req.body;
    await authService.resetPassword({ token, password });
    return response.success(res, null, 'Password reset successfully. Please log in.');
};

// ─── POST /auth/change-password ───────────────────────────────────────────────

const changePassword = async (req, res) => {
    await authService.changePassword(req.user.user_id, req.body);
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    return response.success(res, null, 'Password changed. Please log in again on other devices.');
};

module.exports = {
    login,
    register,
    logout,
    logoutAll,
    refresh,
    me,
    forgotPassword,
    resetPassword,
    changePassword,
};
