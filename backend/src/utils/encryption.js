/**
 * Encryption Utilities — JWT + bcrypt + token generation
 */

'use strict';

const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');

const SALT_ROUNDS = 12;

// ─── Password ────────────────────────────────────────────────────────────────
const hashPassword  = (plain)         => bcrypt.hash(plain, SALT_ROUNDS);
const verifyPassword = (plain, hash)  => bcrypt.compare(plain, hash);

// ─── JWT ─────────────────────────────────────────────────────────────────────
/**
 * Sign an access token (short-lived)
 */
const signAccessToken = (payload) =>
    jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
        expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
        issuer:    'banquetpro',
        audience:  'banquetpro-api',
    });

/**
 * Sign a refresh token (long-lived)
 */
const signRefreshToken = (payload) =>
    jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
        issuer:    'banquetpro',
        audience:  'banquetpro-api',
    });

/**
 * Verify access token — throws on invalid/expired
 */
const verifyAccessToken = (token) =>
    jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
        issuer:   'banquetpro',
        audience: 'banquetpro-api',
    });

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) =>
    jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
        issuer:   'banquetpro',
        audience: 'banquetpro-api',
    });

// ─── Tokens ──────────────────────────────────────────────────────────────────
/** Generate a cryptographically-secure random hex token */
const generateToken  = (bytes = 32)  => crypto.randomBytes(bytes).toString('hex');

/** Generate a 6-digit numeric OTP */
const generateOtp    = ()            => String(Math.floor(100000 + Math.random() * 900000));

/** Hash a plain token for DB storage (SHA-256 is sufficient for random tokens) */
const hashToken      = (plain)       => crypto.createHash('sha256').update(plain).digest('hex');

module.exports = {
    hashPassword, verifyPassword,
    signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken,
    generateToken, generateOtp, hashToken,
};
