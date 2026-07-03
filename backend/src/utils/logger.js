/**
 * Logger — Winston with daily file rotation + console
 * Log levels: error > warn > info > http > debug
 */

'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// ─── Format ──────────────────────────────────────────────────────────────────
const jsonFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level}] ${message}${metaStr}`;
    })
);

// ─── Transports ──────────────────────────────────────────────────────────────
const transports = [
    // All logs
    new DailyRotateFile({
        dirname:        LOG_DIR,
        filename:       'app-%DATE%.log',
        datePattern:    'YYYY-MM-DD',
        maxFiles:       process.env.LOG_MAX_FILES || '30d',
        maxSize:        process.env.LOG_MAX_SIZE  || '50m',
        format:         jsonFormat,
        level:          LOG_LEVEL,
    }),
    // Errors only
    new DailyRotateFile({
        dirname:        LOG_DIR,
        filename:       'error-%DATE%.log',
        datePattern:    'YYYY-MM-DD',
        maxFiles:       '60d',
        maxSize:        '50m',
        format:         jsonFormat,
        level:          'error',
    }),
    // Audit actions
    new DailyRotateFile({
        dirname:        LOG_DIR,
        filename:       'audit-%DATE%.log',
        datePattern:    'YYYY-MM-DD',
        maxFiles:       '90d',
        maxSize:        '100m',
        format:         jsonFormat,
        level:          'info',
    }),
];

// Add console in development
if (process.env.NODE_ENV !== 'production') {
    transports.push(new winston.transports.Console({ format: consoleFormat }));
}

// ─── Logger Instance ─────────────────────────────────────────────────────────
const logger = winston.createLogger({
    level:              LOG_LEVEL,
    levels:             winston.config.npm.levels,
    defaultMeta:        { service: 'banquet-api' },
    transports,
    exceptionHandlers: [
        new DailyRotateFile({
            dirname:     LOG_DIR,
            filename:    'exceptions-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles:    '30d',
        }),
    ],
    rejectionHandlers: [
        new DailyRotateFile({
            dirname:     LOG_DIR,
            filename:    'rejections-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles:    '30d',
        }),
    ],
});

module.exports = logger;
