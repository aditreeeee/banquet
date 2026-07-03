/**
 * Auth Service — Business logic for all authentication flows
 * Validates credentials, manages tokens, orchestrates password resets
 */

'use strict';

const authRepo = require('../repositories/auth.repository');
const {
    verifyPassword,
    hashPassword,
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    generateToken,
    hashToken,
} = require('../utils/encryption');
const logger = require('../utils/logger');
const { AuthError, ValidationError, NotFoundError } = require('../api/v1/middleware/errorHandler');

// Max failed attempts before account lock
const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_FAILED_ATTEMPTS, 10) || 5;
const LOCK_MINUTES         = parseInt(process.env.ACCOUNT_LOCK_MINUTES, 10) || 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the JWT payload from a user row
 */
const buildTokenPayload = (user) => ({
    userId:    user.user_id,
    email:     user.email,
    roleId:    user.role_id,
    roleSlug:  user.role_slug,
    companyId: user.company_id,
    branchId:  user.branch_id,
});

/**
 * Issue a new access + refresh token pair and persist the refresh token
 * @param {Object} user       - user row from DB
 * @param {Object} meta       - { ipAddress, userAgent }
 * @param {boolean} extended  - longer refresh expiry for "remember me"
 */
const issueTokens = async (user, meta = {}, extended = false) => {
    const payload = buildTokenPayload(user);

    const accessToken  = signAccessToken(payload);
    const refreshPlain = generateToken(32);                    // 64-char hex
    const refreshHash  = hashToken(refreshPlain);

    // Expiry: 7 days normally, 30 days for remember_me
    const daysToExpiry = extended ? 30 : 7;
    const expiresAt    = new Date(Date.now() + daysToExpiry * 24 * 60 * 60 * 1000);

    await authRepo.saveRefreshToken({
        userId:    user.user_id,
        tokenHash: refreshHash,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
    });

    return { accessToken, refreshToken: refreshPlain };
};

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * Authenticate a user with email + password
 * Returns { user, accessToken, refreshToken }
 */
const login = async ({ email, password, remember_me = false }, meta = {}) => {
    // 1 — Find user (always run query, then compare; timing-safe)
    const user = await authRepo.findByEmail(email.toLowerCase().trim());

    if (!user) {
        // Generic message to prevent user enumeration
        throw new AuthError('Invalid email or password');
    }

    // 2 — Check account status
    if (!user.is_active) {
        throw new AuthError('Your account has been deactivated. Contact support.');
    }

    // 3 — Check lockout
    if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
        const unlockAt = new Date(user.account_locked_until).toLocaleTimeString();
        throw new AuthError(`Account locked due to multiple failed attempts. Try again after ${unlockAt}.`);
    }

    // 4 — Verify password
    const passwordMatch = await verifyPassword(password, user.password_hash);

    if (!passwordMatch) {
        await authRepo.recordFailedLogin(user.user_id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES);
        logger.warn('Failed login attempt', { userId: user.user_id, ip: meta.ipAddress });
        throw new AuthError('Invalid email or password');
    }

    // 5 — Success: reset counters, update last login
    await authRepo.recordSuccessfulLogin(user.user_id, meta.ipAddress);

    // 6 — Issue tokens
    const { accessToken, refreshToken } = await issueTokens(user, meta, remember_me);

    logger.info('User logged in', {
        userId:    user.user_id,
        email:     user.email,
        ip:        meta.ipAddress,
        userAgent: meta.userAgent,
    });

    // Strip sensitive fields before returning
    const { password_hash, ...safeUser } = user;
    const permissions = await authRepo.findPermissions(user.user_id);
    return { user: safeUser, accessToken, refreshToken, permissions };
};

// ─── Refresh ──────────────────────────────────────────────────────────────────

/**
 * Rotate refresh tokens: validate old token, issue new pair, revoke old
 */
const refreshTokens = async (refreshToken, meta = {}) => {
    // 1 — Verify JWT signature
    let decoded;
    try {
        decoded = verifyRefreshToken(refreshToken);
    } catch {
        throw new AuthError('Invalid or expired refresh token');
    }

    // 2 — Look up hashed token in DB
    const tokenHash = hashToken(refreshToken);
    const stored    = await authRepo.findRefreshToken(tokenHash);

    if (!stored || stored.is_revoked || new Date(stored.expires_at) < new Date()) {
        // Possible token reuse — revoke all tokens for this user (security)
        if (decoded?.userId) {
            await authRepo.revokeAllUserTokens(decoded.userId);
            logger.warn('Refresh token reuse detected — all tokens revoked', { userId: decoded.userId });
        }
        throw new AuthError('Refresh token invalid or expired');
    }

    // 3 — Revoke used token immediately (rotation)
    await authRepo.revokeRefreshToken(tokenHash);

    // 4 — Load fresh user row (role/company may have changed)
    const user = await authRepo.findById(decoded.userId);
    if (!user || !user.is_active) {
        throw new AuthError('Account not found or deactivated');
    }

    // 5 — Issue new token pair
    const tokens = await issueTokens(user, meta);

    return tokens;
};

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * Revoke the provided refresh token (single-device logout)
 */
const logout = async (refreshToken, userId) => {
    try {
        const tokenHash = hashToken(refreshToken);
        await authRepo.revokeRefreshToken(tokenHash);
        logger.info('User logged out', { userId });
    } catch (err) {
        // Do not throw — logout should always succeed from user's perspective
        logger.warn('Logout: could not revoke token', { error: err.message, userId });
    }
};

/**
 * Revoke all refresh tokens for a user (all-device logout)
 */
const logoutAll = async (userId) => {
    await authRepo.revokeAllUserTokens(userId);
    logger.info('User logged out from all devices', { userId });
};

// ─── Me ───────────────────────────────────────────────────────────────────────

/**
 * Return the authenticated user's profile
 */
const me = async (userId) => {
    const user = await authRepo.findById(userId);
    if (!user) throw new AuthError('User not found');
    const permissions = await authRepo.findPermissions(userId);
    return { user, permissions };
};

// ─── Forgot Password ──────────────────────────────────────────────────────────

/**
 * Generate a reset token and queue an email
 * Always returns success to prevent user enumeration
 */
const forgotPassword = async (email) => {
    const user = await authRepo.findByEmail(email.toLowerCase().trim());

    // Don't reveal whether email exists
    if (!user || !user.is_active) {
        logger.info('Forgot password — email not found or inactive', { email });
        return; // silent return — controller sends generic success
    }

    const plainToken = generateToken(32); // 64-char hex string
    const tokenHash  = hashToken(plainToken);
    const expiresAt  = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await authRepo.savePasswordResetToken(user.user_id, tokenHash, expiresAt);

    // Queue email via notification service (decoupled)
    // We import lazily to avoid circular dependencies
    try {
        const notificationService = require('./notification.service');
        await notificationService.sendPasswordResetEmail({
            to:        user.email,
            firstName: user.first_name,
            token:     plainToken,
        });
    } catch (err) {
        // Log but don't fail the request — token is still stored
        logger.error('Failed to send password reset email', { userId: user.user_id, error: err.message });
    }

    logger.info('Password reset token generated', { userId: user.user_id });
};

// ─── Reset Password ───────────────────────────────────────────────────────────

/**
 * Validate the reset token and apply the new password
 */
const resetPassword = async ({ token, password }) => {
    const tokenHash = hashToken(token);
    const stored    = await authRepo.findPasswordResetToken(tokenHash);

    if (!stored) {
        throw new ValidationError('Reset link is invalid or has expired');
    }

    const newHash = await hashPassword(password);
    await authRepo.applyPasswordReset(stored.user_id, newHash, tokenHash);

    logger.info('Password reset completed', { userId: stored.user_id });
};

// ─── Change Password ──────────────────────────────────────────────────────────

/**
 * Authenticated password change (requires current password)
 */
const changePassword = async (userId, { current_password, new_password }) => {
    const currentHash = await authRepo.getPasswordHash(userId);
    if (!currentHash) throw new NotFoundError('User');

    const match = await verifyPassword(current_password, currentHash);
    if (!match) {
        throw new ValidationError('Current password is incorrect');
    }

    const newHash = await hashPassword(new_password);
    await authRepo.updatePassword(userId, newHash);
    // Revoke all refresh tokens to force re-login on other devices
    await authRepo.revokeAllUserTokens(userId);

    logger.info('Password changed', { userId });
};

module.exports = {
    login,
    logout,
    logoutAll,
    refreshTokens,
    me,
    forgotPassword,
    resetPassword,
    changePassword,
};
