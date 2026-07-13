/**
 * Auth Service — Business logic for all authentication flows
 * Validates credentials, manages tokens, orchestrates password resets
 */

'use strict';

const authRepo = require('../repositories/auth.repository');
const companyRepo = require('../repositories/company.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const settingsService = require('./settings.service');
const {
    verifyPassword,
    hashPassword,
    signAccessToken,
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
 * Build the JWT payload from a user row.
 * roleId/roleSlug reflect the user's primary/default role (Users.role_id) for
 * display purposes only — every request re-derives the user's full role set
 * and permissions from UserRoles via the `authenticate` middleware, so these
 * claims are never used for authorization decisions.
 */
/**
 * sessionStartedAt is when this *session* (not this token) first began —
 * carried through unchanged across every refresh/rotation so absolute
 * session lifetime is measured from first login, never reset by activity
 * (that's what idle-timeout is for). Only login() mints a new one.
 */
const buildTokenPayload = (user, sessionStartedAt) => ({
    userId:    user.user_id,
    email:     user.email,
    roleId:    user.role_id,
    roleSlug:  user.role_slug,
    companyId: user.company_id,
    branchId:  user.branch_id,
    sessionStartedAt,
});

/**
 * Issue a new access + refresh token pair and persist the refresh token
 * @param {Object} user             - user row from DB
 * @param {Object} meta             - { ipAddress, userAgent }
 * @param {boolean} extended        - longer refresh expiry for "Keep Me Signed In"
 * @param {number} [sessionStartedAt] - ms epoch of session start; omit only
 *   on the very first issuance (login), where it's set to now
 */
const issueTokens = async (user, meta = {}, extended = false, sessionStartedAt = null) => {
    const policy = await settingsService.getSessionPolicy();
    const startedAt = sessionStartedAt || Date.now();
    const payload = buildTokenPayload(user, startedAt);

    const accessToken  = signAccessToken(payload, `${policy.accessTokenMinutes}m`);
    const refreshPlain = generateToken(32);                    // 64-char hex
    const refreshHash  = hashToken(refreshPlain);

    // Expiry: 7 days normally, "Keep Me Signed In" duration (configurable,
    // default 30 days) when the user opted in at login.
    const daysToExpiry = extended ? policy.keepSignedInDays : 7;
    const expiresAt    = new Date(Date.now() + daysToExpiry * 24 * 60 * 60 * 1000);

    await authRepo.saveRefreshToken({
        userId:    user.user_id,
        tokenHash: refreshHash,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        isExtended: extended,
        sessionStartedAt: new Date(startedAt),
    });

    // Maximum Concurrent Sessions — revoke the oldest active sessions beyond
    // the configured limit now that this new one exists. A brand-new login
    // is exactly the moment a user could exceed the cap, so this is the
    // natural enforcement point (not a periodic sweep).
    await authRepo.enforceMaxConcurrentSessions(user.user_id, policy.maxConcurrentSessions);

    return { accessToken, refreshToken: refreshPlain, isExtended: extended };
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
    if (user.approval_status === 'pending') {
        throw new AuthError('Your account is awaiting administrator approval.');
    }
    if (user.approval_status === 'rejected') {
        throw new AuthError('Your registration was not approved. Contact support.');
    }
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

    // entity_type/entity_id='user'/<self> so this shows up in that user's
    // own audit trail (see auditLogRepo.findForUser) alongside every
    // administrative action taken on their account.
    await auditLogRepo.log({
        companyId:  user.company_id,
        userId:     user.user_id,
        action:     'user.login',
        entityType: 'user',
        entityId:   user.user_id,
        description: `${user.email} logged in`,
    });

    // Strip sensitive fields before returning
    const { password_hash, ...safeUser } = user;
    const permissions = await authRepo.findPermissions(user.user_id);
    const roles = await authRepo.findRoles(user.user_id);
    return { user: safeUser, accessToken, refreshToken, permissions, roles: roles.map(r => r.role_slug) };
};

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Self-service registration. The account is created in a locked-out
 * ('pending') state — see auth.repository.js register() — so it cannot log
 * in until an admin approves it via userService.approve/reject.
 */
const register = async ({ first_name, last_name, email, phone, password, company_id }) => {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await authRepo.findByEmail(normalizedEmail);
    if (existing) {
        throw new ValidationError('An account with this email already exists', [
            { field: 'email', message: 'Email already registered' },
        ]);
    }

    const roleId = await authRepo.findRoleIdBySlug('customer');
    if (!roleId) {
        throw new Error('Customer role is not configured');
    }

    // No hardcoded default tenant — the signup form's Company/Property picker
    // (fed by GET /public/companies) requires an explicit choice, and it's
    // re-validated here exactly like admin-driven user creation
    // (user.service.js:resolveOrgAssignment) so a tampered/forged request
    // can't land on a deleted or deactivated company either.
    const companyId = parseInt(company_id, 10);
    const companyOk = await companyRepo.existsAndActive(companyId);
    if (!companyOk) {
        throw new ValidationError('Selected Company/Property does not exist or is inactive', [
            { field: 'company_id', message: 'Choose an active, existing Company/Property' },
        ]);
    }

    const passwordHash = await hashPassword(password);
    const user = await authRepo.register({
        firstName: first_name,
        lastName:  last_name,
        email:     normalizedEmail,
        phone,
        passwordHash,
        roleId,
        companyId,
    });

    logger.info('New user registered — pending approval', { userId: user.user_id, email: normalizedEmail, companyId });
    return user;
};

// ─── Refresh ──────────────────────────────────────────────────────────────────

/**
 * Rotate refresh tokens: validate old token, issue new pair, revoke old.
 *
 * The refresh token itself is an opaque random hex string (generateToken(32)
 * in issueTokens), never a signed JWT — it was never valid input for
 * verifyRefreshToken/jwt.verify, which throws JsonWebTokenError on any
 * non-JWT string. That call used to run here unconditionally and always
 * threw, meaning /auth/refresh silently failed on every single request
 * regardless of whether the token was actually valid — sessions never
 * survived past the access-token's own expiry, no matter how active the
 * user was. Validation is (and always should have been) the DB hash lookup
 * below, exactly like logout()/revokeRefreshToken() already do.
 */
const refreshTokens = async (refreshToken, meta = {}, options = {}) => {
    const tokenHash = hashToken(refreshToken);
    const stored    = await authRepo.findRefreshToken(tokenHash);

    if (!stored || stored.is_revoked || new Date(stored.expires_at) < new Date()) {
        // Possible token reuse — revoke all tokens for this user (security)
        if (stored?.user_id) {
            await authRepo.revokeAllUserTokens(stored.user_id);
            logger.warn('Refresh token reuse detected — all tokens revoked', { userId: stored.user_id });
        }
        throw new AuthError('Refresh token invalid or expired');
    }

    // Absolute Session Lifetime — this caps total session age regardless of
    // activity, so it is checked here (server-side, can't be bypassed by a
    // scripted client that just keeps calling refresh) rather than only
    // client-side like idle timeout. session_started_at is carried forward
    // from the original login, not reset by rotation.
    const policy = await settingsService.getSessionPolicy();
    const sessionAgeMs = Date.now() - new Date(stored.session_started_at).getTime();
    if (sessionAgeMs > policy.absoluteSessionHours * 60 * 60 * 1000) {
        await authRepo.revokeRefreshToken(tokenHash);
        throw new AuthError('Session expired — please sign in again');
    }

    // Revoke used token immediately (rotation)
    await authRepo.revokeRefreshToken(tokenHash);

    // Load fresh user row (role/company may have changed)
    const user = await authRepo.findById(stored.user_id);
    if (!user || !user.is_active) {
        throw new AuthError('Account not found or deactivated');
    }

    // Issue new token pair — is_extended and session_started_at both carry
    // forward unchanged, so "Keep Me Signed In" doesn't degrade to a 7-day
    // cookie on the very next silent refresh, and the absolute-lifetime
    // clock keeps counting from the real session start.
    const tokens = await issueTokens(user, meta, !!stored.is_extended, new Date(stored.session_started_at).getTime());

    if (options.extend) {
        await auditLogRepo.log({
            companyId:  user.company_id,
            userId:     user.user_id,
            action:     'user.session_extended',
            entityType: 'user',
            entityId:   user.user_id,
            description: `${user.email} extended their session ("Stay Signed In")`,
        });
    }

    return tokens;
};

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * Revoke the provided refresh token (single-device logout).
 * @param {string} reason - 'manual' (default) or 'timeout' (idle/absolute
 *   session expiry client-side) — recorded in the audit log so "why did this
 *   user get logged out" is answerable later, per the spec's audit
 *   requirement to distinguish timeout from a deliberate logout.
 */
const logout = async (refreshToken, userId, reason = 'manual', companyId = null) => {
    try {
        const tokenHash = hashToken(refreshToken);
        await authRepo.revokeRefreshToken(tokenHash);
        logger.info('User logged out', { userId, reason });
    } catch (err) {
        // Do not throw — logout should always succeed from user's perspective
        logger.warn('Logout: could not revoke token', { error: err.message, userId });
    }

    if (userId) {
        await auditLogRepo.log({
            companyId,
            userId,
            action:     reason === 'timeout' ? 'user.session_timeout' : 'user.logout',
            entityType: 'user',
            entityId:   userId,
            description: reason === 'timeout'
                ? 'Session ended automatically due to inactivity or reaching the absolute session limit'
                : 'User logged out',
        });
    }
};

/**
 * Revoke all refresh tokens for a user (all-device logout)
 */
const logoutAll = async (userId, companyId = null) => {
    await authRepo.revokeAllUserTokens(userId);
    logger.info('User logged out from all devices', { userId });
    if (userId) {
        await auditLogRepo.log({
            companyId,
            userId,
            action:     'user.logout_all',
            entityType: 'user',
            entityId:   userId,
            description: 'User logged out from all devices',
        });
    }
};

// ─── Me ───────────────────────────────────────────────────────────────────────

/**
 * Return the authenticated user's profile
 */
const me = async (userId) => {
    const user = await authRepo.findById(userId);
    if (!user) throw new AuthError('User not found');
    const permissions = await authRepo.findPermissions(userId);
    const roles = await authRepo.findRoles(userId);
    return { user, permissions, roles: roles.map(r => r.role_slug) };
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
    register,
    logout,
    logoutAll,
    refreshTokens,
    me,
    forgotPassword,
    resetPassword,
    changePassword,
};
