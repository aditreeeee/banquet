/**
 * Banquet Hall Booking System — Express Application Entry
 * Production-ready with security, logging, and error handling
 */

'use strict';

require('dotenv').config();

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const compression   = require('compression');
const cookieParser  = require('cookie-parser');
const morgan        = require('morgan');
const path          = require('path');

const logger            = require('./utils/logger');
const { healthCheck }   = require('./config/database');
const rateLimiter       = require('./api/v1/middleware/rateLimiter');
const errorHandler      = require('./api/v1/middleware/errorHandler');
const requestId         = require('./api/v1/middleware/requestId');
const routes            = require('./api/v1/routes/index');

const app = express();

// ─── Trust Proxy (IIS / Nginx) ──────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Security Headers (Helmet) ───────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:     ["'self'"],
            styleSrc:       ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
            scriptSrc:      ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
            imgSrc:         ["'self'", 'data:', 'https:'],
            fontSrc:        ["'self'", 'https:', 'data:'],
            connectSrc:     ["'self'"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
}));

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error(`CORS: Origin ${origin} not allowed`));
        }
    },
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // X-Impersonate-Company-Id is the Super Admin "View As Tenant" header
    // (see auth.js's scopeToCompany + frontend api.js's Impersonation
    // helper) — omitting it here means the browser's CORS preflight
    // silently blocks every single API call the moment impersonation is
    // active, on any deployment where the frontend and backend aren't on
    // the exact same origin.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token', 'X-Impersonate-Company-Id'],
    exposedHeaders: ['X-Request-ID', 'X-Rate-Limit-Remaining'],
}));

// ─── Compression ─────────────────────────────────────────────────────────────
app.use(compression({ level: 6 }));

// ─── Body Parsers ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// ─── Request ID ──────────────────────────────────────────────────────────────
app.use(requestId);

// ─── HTTP Logger ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined', {
        stream: { write: (msg) => logger.http(msg.trim()) },
        skip: (req) => req.path === '/api/v1/health',
    }));
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────
app.use('/api/', rateLimiter.global);

// ─── Health Check (public — must be before auth-protected routes) ─────────────
app.get('/api/v1/health', async (req, res) => {
    const dbOk = await healthCheck();
    const status = dbOk ? 200 : 503;

    res.status(status).json({
        success: dbOk,
        status:  dbOk ? 'healthy' : 'degraded',
        version: process.env.API_VERSION || 'v1',
        uptime:  Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        services: {
            database: dbOk ? 'up' : 'down',
        },
    });
});

// ─── Static Files (Uploads) ──────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
    maxAge: '1d',
    etag: true,
}));

// ─── Pretty public inquiry URL ────────────────────────────────────────────────
// The frontend is a separate static site with no server-side router, so
// /inquiry/:token (the URL printed on signage / encoded in the property QR
// code) is a thin redirect into the real page rather than a rendered route.
// Kept top-level (not under /api/v1) since it's meant to be typed/scanned by
// a human, not called by client code.
app.get('/inquiry/:token', (req, res) => {
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/$/, '');
    res.redirect(302, `${frontendUrl}/src/pages/public/inquiry.html?token=${encodeURIComponent(req.params.token)}`);
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        success:    false,
        statusCode: 404,
        message:    `Route ${req.method} ${req.path} not found`,
        timestamp:  new Date().toISOString(),
    });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
