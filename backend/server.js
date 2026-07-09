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

const DB_STARTUP_RETRY_MS   = parseInt(process.env.DB_STARTUP_RETRY_MS, 10) || 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keeps retrying the DB connection forever in the background so a slow-starting
// SQL Server (e.g. right after a host reboot, when it initializes slower than
// Node) never requires a manual restart — the API just self-heals once SQL
// Server finishes coming up. Never throws and never exits the process: the
// HTTP server stays up and serving (health check reports "degraded") the
// whole time, and every route that touches the DB will start working the
// moment a connection attempt finally succeeds.
const connectWithRetry = async () => {
    let attempt = 0;
    for (;;) {
        attempt += 1;
        try {
            await getPool();
            logger.info('MSSQL connection established', { attempt });
            return;
        } catch (err) {
            logger.error('DB connection attempt failed, retrying', {
                attempt, error: err.message,
            });
            await sleep(DB_STARTUP_RETRY_MS);
        }
    }
};

// ─── Start ───────────────────────────────────────────────────────────────────
(async () => {
    try {
        // Start accepting HTTP connections immediately — don't block on the DB.
        // If SQL Server isn't ready yet, the site is still reachable and the
        // health endpoint reflects "degraded" until the DB comes online.
        const server = app.listen(PORT, () => {
            logger.info('BanquetPro API server started', { port: PORT, env: ENV });
        });

        // Warm the DB pool in the background, retrying indefinitely.
        connectWithRetry();

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
