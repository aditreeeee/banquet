/**
 * BanquetPro — Server Entry Point
 * Compatible with Node.js standalone and iisnode (IIS/Windows Server)
 */

'use strict';

require('dotenv').config();
require('express-async-errors'); // Patch async errors globally

const app    = require('./src/app');
const logger = require('./src/utils/logger');
const { waitUntilReady, closePool } = require('./src/config/database');
const expireTentativeHoldsJob = require('./src/jobs/expireTentativeHolds.job');

const PORT = process.env.PORT || 3000;
const ENV  = process.env.NODE_ENV || 'development';

let server = null;

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
// Registered up front so Ctrl+C works even while still waiting on the DB.
const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    if (server) {
        server.close(async () => {
            await closePool();
            logger.info('Server closed');
            process.exit(0);
        });
        // Force-kill after 15 s
        setTimeout(() => { logger.error('Force shutdown'); process.exit(1); }, 15000);
    } else {
        await closePool();
        process.exit(0);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Start ───────────────────────────────────────────────────────────────────
(async () => {
    try {
        // Readiness gate: do not accept HTTP traffic until SQL Server responds
        // to a real query. This is what makes a fresh host reboot (SQL Server
        // still initializing when Node starts) self-heal without a manual app
        // or SQL Server restart — waitUntilReady() retries with exponential
        // backoff for as long as it takes.
        await waitUntilReady();

        server = app.listen(PORT, () => {
            logger.info('BanquetPro API server started', { port: PORT, env: ENV });
        });

        expireTentativeHoldsJob.start();
    } catch (err) {
        logger.error('Failed to start server', { error: err.message, stack: err.stack });
        process.exit(1);
    }
})();
