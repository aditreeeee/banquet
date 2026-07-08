/**
 * BanquetPro — Server Entry Point
 * Compatible with Node.js standalone and iisnode (IIS/Windows Server)
 */

'use strict';

require('dotenv').config();
require('express-async-errors'); // Patch async errors globally

const app    = require('./src/app');
const logger = require('./src/utils/logger');
const { getPool, closePool } = require('./src/config/database');
const expireTentativeHoldsJob = require('./src/jobs/expireTentativeHolds.job');

const PORT = process.env.PORT || 3000;
const ENV  = process.env.NODE_ENV || 'development';

const DB_STARTUP_RETRIES    = parseInt(process.env.DB_STARTUP_RETRIES, 10) || 10;
const DB_STARTUP_RETRY_MS   = parseInt(process.env.DB_STARTUP_RETRY_MS, 10) || 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries pre-warming the pool so a slow-starting SQL Server (e.g. right after
// a host reboot, when it initializes slower than Node) doesn't permanently
// kill the API — a transient failure here previously required a manual restart.
const connectWithRetry = async () => {
    for (let attempt = 1; attempt <= DB_STARTUP_RETRIES; attempt += 1) {
        try {
            await getPool();
            return;
        } catch (err) {
            if (attempt === DB_STARTUP_RETRIES) {
                throw err;
            }
            logger.error('DB connection attempt failed, retrying', {
                attempt, maxAttempts: DB_STARTUP_RETRIES, error: err.message,
            });
            await sleep(DB_STARTUP_RETRY_MS);
        }
    }
};

// ─── Start ───────────────────────────────────────────────────────────────────
(async () => {
    try {
        // Pre-warm the DB connection pool (with retry — see connectWithRetry)
        await connectWithRetry();

        const server = app.listen(PORT, () => {
            logger.info('BanquetPro API server started', { port: PORT, env: ENV });
        });

        expireTentativeHoldsJob.start();

        // ─── Graceful Shutdown ──────────────────────────────────────────────
        const shutdown = async (signal) => {
            logger.info(`${signal} received — shutting down gracefully`);
            server.close(async () => {
                await closePool();
                logger.info('Server closed');
                process.exit(0);
            });
            // Force-kill after 15 s
            setTimeout(() => { logger.error('Force shutdown'); process.exit(1); }, 15000);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT',  () => shutdown('SIGINT'));

    } catch (err) {
        logger.error('Failed to start server', { error: err.message, stack: err.stack });
        process.exit(1);
    }
})();
