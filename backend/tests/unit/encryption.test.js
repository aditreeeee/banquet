'use strict';

process.env.JWT_ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const {
    hashPassword, verifyPassword,
    signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken,
    generateToken, generateOtp, hashToken,
} = require('../../src/utils/encryption');

describe('encryption utils — passwords', () => {
    it('hashes a password to a bcrypt hash distinct from the plaintext', async () => {
        const hash = await hashPassword('Sup3rSecret!');
        expect(hash).not.toBe('Sup3rSecret!');
        expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt hash prefix
    });

    it('verifies a correct password against its own hash', async () => {
        const hash = await hashPassword('Sup3rSecret!');
        await expect(verifyPassword('Sup3rSecret!', hash)).resolves.toBe(true);
    });

    it('rejects an incorrect password against a hash', async () => {
        const hash = await hashPassword('Sup3rSecret!');
        await expect(verifyPassword('WrongPassword', hash)).resolves.toBe(false);
    });

    it('produces a different hash each time (salted)', async () => {
        const h1 = await hashPassword('SamePassword1!');
        const h2 = await hashPassword('SamePassword1!');
        expect(h1).not.toBe(h2);
    });
});

describe('encryption utils — JWT access/refresh tokens', () => {
    const payload = { userId: 42, companyId: 7, roleSlug: 'admin' };

    it('signs and verifies an access token round-trip', () => {
        const token = signAccessToken(payload);
        const decoded = verifyAccessToken(token);
        expect(decoded).toMatchObject(payload);
        expect(decoded.iss).toBe('banquetpro');
        expect(decoded.aud).toBe('banquetpro-api');
    });

    it('signs and verifies a refresh token round-trip', () => {
        const token = signRefreshToken(payload);
        const decoded = verifyRefreshToken(token);
        expect(decoded).toMatchObject(payload);
    });

    it('rejects an access token verified as a refresh token (different secrets)', () => {
        const token = signAccessToken(payload);
        expect(() => verifyRefreshToken(token)).toThrow();
    });

    it('rejects a tampered token', () => {
        const token = signAccessToken(payload);
        const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
        expect(() => verifyAccessToken(tampered)).toThrow();
    });

    it('rejects an already-expired token', () => {
        const jwt = require('jsonwebtoken');
        const expired = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
            expiresIn: -10, issuer: 'banquetpro', audience: 'banquetpro-api',
        });
        expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
    });
});

describe('encryption utils — random tokens/OTP/hashing', () => {
    it('generateToken returns a hex string of the requested byte length', () => {
        const token = generateToken(16);
        expect(token).toMatch(/^[0-9a-f]+$/);
        expect(token).toHaveLength(32); // 16 bytes -> 32 hex chars
    });

    it('generateToken defaults to 32 bytes when called with no args', () => {
        expect(generateToken()).toHaveLength(64);
    });

    it('generateToken produces distinct values across calls', () => {
        expect(generateToken()).not.toBe(generateToken());
    });

    it('generateOtp returns a 6-digit numeric string in range', () => {
        for (let i = 0; i < 20; i++) {
            const otp = generateOtp();
            expect(otp).toMatch(/^\d{6}$/);
            const n = Number(otp);
            expect(n).toBeGreaterThanOrEqual(100000);
            expect(n).toBeLessThanOrEqual(999999);
        }
    });

    it('hashToken is deterministic (same input -> same hash)', () => {
        expect(hashToken('some-refresh-token')).toBe(hashToken('some-refresh-token'));
    });

    it('hashToken produces different hashes for different inputs', () => {
        expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
    });

    it('hashToken never returns the plaintext', () => {
        expect(hashToken('plain-value')).not.toBe('plain-value');
    });
});
