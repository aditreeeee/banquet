'use strict';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';

jest.mock('../../src/repositories/auth.repository');
jest.mock('../../src/repositories/company.repository');
jest.mock('../../src/repositories/auditLog.repository');
jest.mock('../../src/services/settings.service');

const authRepo = require('../../src/repositories/auth.repository');
const auditLogRepo = require('../../src/repositories/auditLog.repository');
const settingsService = require('../../src/services/settings.service');
const authService = require('../../src/services/auth.service');
const { AuthError } = require('../../src/api/v1/middleware/errorHandler');

const activeUser = {
    user_id: 1, email: 'a@x.com', company_id: 1, branch_id: null,
    role_id: 2, role_slug: 'company_admin', is_active: true,
};

const defaultPolicy = {
    accessTokenMinutes: 15, idleTimeoutMinutes: 30, absoluteSessionHours: 8,
    warningBeforeLogoutMinutes: 2, keepSignedInDays: 30, maxConcurrentSessions: 0,
};

beforeEach(() => {
    jest.clearAllMocks();
    settingsService.getSessionPolicy.mockResolvedValue(defaultPolicy);
    authRepo.enforceMaxConcurrentSessions.mockResolvedValue(undefined);
});

describe('auth.service — refreshTokens', () => {
    /**
     * Regression test for the bug where every single refresh silently
     * failed: refreshTokens() used to call verifyRefreshToken() (a jwt.verify
     * for a JWT) on the opaque random-hex refresh token, which always threw.
     * A valid, unexpired, unrevoked token in the DB must now succeed.
     */
    it('succeeds for a valid, unexpired, unrevoked token (the core regression case)', async () => {
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: false,
            expires_at: new Date(Date.now() + 3600000),
            session_started_at: new Date(Date.now() - 60000),
            is_extended: false,
        });
        authRepo.findById.mockResolvedValue(activeUser);

        const result = await authService.refreshTokens('some-opaque-hex-token');

        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
        expect(authRepo.revokeAllUserTokens).not.toHaveBeenCalled();
    });

    it('rejects a token that does not exist in the DB', async () => {
        authRepo.findRefreshToken.mockResolvedValue(null);
        await expect(authService.refreshTokens('bogus')).rejects.toBeInstanceOf(AuthError);
    });

    it('rejects a revoked token and revokes all of the user\'s remaining sessions (reuse detection)', async () => {
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: true, expires_at: new Date(Date.now() + 3600000),
        });
        await expect(authService.refreshTokens('reused-token')).rejects.toBeInstanceOf(AuthError);
        expect(authRepo.revokeAllUserTokens).toHaveBeenCalledWith(1);
    });

    it('rejects an expired token', async () => {
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: false, expires_at: new Date(Date.now() - 1000),
        });
        await expect(authService.refreshTokens('expired')).rejects.toBeInstanceOf(AuthError);
    });

    it('rejects and revokes a session that has exceeded the absolute session lifetime', async () => {
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: false,
            expires_at: new Date(Date.now() + 3600000),
            session_started_at: new Date(Date.now() - 9 * 3600000), // 9h ago, policy cap is 8h
            is_extended: false,
        });

        await expect(authService.refreshTokens('stale-session')).rejects.toBeInstanceOf(AuthError);
        expect(authRepo.revokeRefreshToken).toHaveBeenCalled();
    });

    it('preserves is_extended (Keep Me Signed In) across rotation instead of degrading to the short expiry', async () => {
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: false,
            expires_at: new Date(Date.now() + 3600000),
            session_started_at: new Date(Date.now() - 60000),
            is_extended: true,
        });
        authRepo.findById.mockResolvedValue(activeUser);

        const result = await authService.refreshTokens('extended-session-token');

        expect(result.isExtended).toBe(true);
        expect(authRepo.saveRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ isExtended: true }));
    });

    it('logs a session_extended audit entry only when options.extend is passed ("Stay Signed In")', async () => {
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: false,
            expires_at: new Date(Date.now() + 3600000),
            session_started_at: new Date(Date.now() - 60000),
            is_extended: false,
        });
        authRepo.findById.mockResolvedValue(activeUser);

        await authService.refreshTokens('token', {}, { extend: true });

        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.session_extended' }));
    });

    it('does not log a session_extended entry for a routine background refresh', async () => {
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: false,
            expires_at: new Date(Date.now() + 3600000),
            session_started_at: new Date(Date.now() - 60000),
            is_extended: false,
        });
        authRepo.findById.mockResolvedValue(activeUser);

        await authService.refreshTokens('token');

        expect(auditLogRepo.log).not.toHaveBeenCalled();
    });
});

describe('auth.service — logout', () => {
    it('logs action user.logout for a manual logout', async () => {
        await authService.logout('sometoken', 1, 'manual', 1);
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.logout' }));
    });

    it('logs action user.session_timeout when reason is timeout', async () => {
        await authService.logout('sometoken', 1, 'timeout', 1);
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.session_timeout' }));
    });
});

describe('auth.service — issueTokens max concurrent sessions', () => {
    it('enforces the configured maxConcurrentSessions after issuing a new token', async () => {
        settingsService.getSessionPolicy.mockResolvedValue({ ...defaultPolicy, maxConcurrentSessions: 3 });
        authRepo.findRefreshToken.mockResolvedValue({
            id: 1, user_id: 1, is_revoked: false,
            expires_at: new Date(Date.now() + 3600000),
            session_started_at: new Date(Date.now() - 60000),
            is_extended: false,
        });
        authRepo.findById.mockResolvedValue(activeUser);

        await authService.refreshTokens('token');

        expect(authRepo.enforceMaxConcurrentSessions).toHaveBeenCalledWith(1, 3);
    });
});
