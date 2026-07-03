/**
 * Auth Repository — All DB operations for authentication
 */

'use strict';

const { executeQuery, withTransaction } = require('../config/database');

// ─── User Lookups ─────────────────────────────────────────────────────────────

const findByEmail = async (email) => {
    const rows = await executeQuery(
        `SELECT
            u.user_id, u.email, u.password_hash,
            u.first_name, u.last_name, u.phone,
            u.role_id, r.role_slug, r.role_name,
            u.company_id, u.branch_id,
            u.is_active, u.is_email_verified,
            u.failed_login_attempts, u.account_locked_until,
            u.last_login_at, u.last_login_ip,
            u.avatar_url, u.timezone, u.created_at
         FROM Users u
         JOIN Roles r ON r.role_id = u.role_id
         WHERE u.email = @email`,
        { email }
    );
    return rows[0] || null;
};

const findById = async (userId) => {
    const rows = await executeQuery(
        `SELECT
            u.user_id, u.email,
            u.first_name, u.last_name, u.phone,
            u.role_id, r.role_slug, r.role_name,
            u.company_id, u.branch_id,
            u.is_active, u.is_email_verified,
            u.avatar_url, u.timezone,
            u.last_login_at, u.created_at
         FROM Users u
         JOIN Roles r ON r.role_id = u.role_id
         WHERE u.user_id = @userId AND u.is_active = 1`,
        { userId }
    );
    return rows[0] || null;
};

// ─── Login Tracking ───────────────────────────────────────────────────────────

const recordSuccessfulLogin = async (userId, ipAddress) => {
    await executeQuery(
        `UPDATE Users
         SET failed_login_attempts = 0,
             account_locked_until  = NULL,
             last_login_at         = GETUTCDATE(),
             last_login_ip         = @ip,
             updated_at            = GETUTCDATE()
         WHERE user_id = @userId`,
        { userId, ip: ipAddress }
    );
};

const recordFailedLogin = async (userId, maxAttempts = 5, lockMinutes = 30) => {
    await executeQuery(
        `UPDATE Users
         SET failed_login_attempts = failed_login_attempts + 1,
             account_locked_until = CASE
                 WHEN failed_login_attempts + 1 >= @maxAttempts
                 THEN DATEADD(MINUTE, @lockMinutes, GETUTCDATE())
                 ELSE account_locked_until
             END,
             updated_at = GETUTCDATE()
         WHERE user_id = @userId`,
        { userId, maxAttempts, lockMinutes }
    );
};

// ─── Refresh Tokens ───────────────────────────────────────────────────────────

const saveRefreshToken = async ({ userId, tokenHash, expiresAt, ipAddress, userAgent }) => {
    await executeQuery(
        `INSERT INTO RefreshTokens
            (user_id, token_hash, expires_at, ip_address, user_agent, created_at)
         VALUES
            (@userId, @tokenHash, @expiresAt, @ip, @userAgent, GETUTCDATE())`,
        { userId, tokenHash, expiresAt, ip: ipAddress || null, userAgent: userAgent || null }
    );
};

const findRefreshToken = async (tokenHash) => {
    const rows = await executeQuery(
        `SELECT rt.id, rt.user_id, rt.expires_at, rt.is_revoked
         FROM RefreshTokens rt
         WHERE rt.token_hash = @tokenHash`,
        { tokenHash }
    );
    return rows[0] || null;
};

const revokeRefreshToken = async (tokenHash) => {
    await executeQuery(
        `UPDATE RefreshTokens
         SET is_revoked = 1, revoked_at = GETUTCDATE()
         WHERE token_hash = @tokenHash`,
        { tokenHash }
    );
};

const revokeAllUserTokens = async (userId) => {
    await executeQuery(
        `UPDATE RefreshTokens
         SET is_revoked = 1, revoked_at = GETUTCDATE()
         WHERE user_id = @userId AND is_revoked = 0`,
        { userId }
    );
};

// ─── Password Reset ───────────────────────────────────────────────────────────

const savePasswordResetToken = async (userId, tokenHash, expiresAt) => {
    await withTransaction(async (tx) => {
        await tx.execute(
            `UPDATE PasswordResetTokens SET is_used = 1 WHERE user_id = @userId AND is_used = 0`,
            { userId }
        );
        await tx.execute(
            `INSERT INTO PasswordResetTokens (user_id, token_hash, expires_at, created_at)
             VALUES (@userId, @tokenHash, @expiresAt, GETUTCDATE())`,
            { userId, tokenHash, expiresAt }
        );
    });
};

const findPasswordResetToken = async (tokenHash) => {
    const rows = await executeQuery(
        `SELECT id, user_id, expires_at, is_used
         FROM PasswordResetTokens
         WHERE token_hash = @tokenHash
           AND is_used    = 0
           AND expires_at > GETUTCDATE()`,
        { tokenHash }
    );
    return rows[0] || null;
};

const applyPasswordReset = async (userId, passwordHash, tokenHash) => {
    await withTransaction(async (tx) => {
        await tx.execute(
            `UPDATE Users
             SET password_hash = @passwordHash,
                 failed_login_attempts = 0,
                 account_locked_until  = NULL,
                 updated_at = GETUTCDATE()
             WHERE user_id = @userId`,
            { userId, passwordHash }
        );
        await tx.execute(
            `UPDATE PasswordResetTokens
             SET is_used = 1, used_at = GETUTCDATE()
             WHERE token_hash = @tokenHash`,
            { tokenHash }
        );
        await tx.execute(
            `UPDATE RefreshTokens
             SET is_revoked = 1, revoked_at = GETUTCDATE()
             WHERE user_id = @userId AND is_revoked = 0`,
            { userId }
        );
    });
};

const updatePassword = async (userId, passwordHash) => {
    await executeQuery(
        `UPDATE Users
         SET password_hash = @passwordHash,
             updated_at    = GETUTCDATE()
         WHERE user_id = @userId`,
        { userId, passwordHash }
    );
};

const getPasswordHash = async (userId) => {
    const rows = await executeQuery(
        `SELECT password_hash FROM Users WHERE user_id = @userId AND is_active = 1`,
        { userId }
    );
    return rows[0]?.password_hash || null;
};

const findPermissions = async (userId) => {
    const rows = await executeQuery(
        `SELECT p.permission_key
         FROM Permissions p
         JOIN RolePermissions rp ON rp.permission_id = p.permission_id
         JOIN Users u ON u.role_id = rp.role_id
         WHERE u.user_id = @userId AND u.is_active = 1`,
        { userId }
    );
    return rows.map(r => r.permission_key);
};

module.exports = {
    findByEmail,
    findById,
    recordSuccessfulLogin,
    recordFailedLogin,
    saveRefreshToken,
    findRefreshToken,
    revokeRefreshToken,
    revokeAllUserTokens,
    savePasswordResetToken,
    findPasswordResetToken,
    applyPasswordReset,
    updatePassword,
    getPasswordHash,
    findPermissions,
};
