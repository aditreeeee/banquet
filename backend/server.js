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

// ─── Start ───────────────────────────────────────────────────────────────────
(async () => {
    try {
        // Pre-warm the DB connection pool
        await getPool();

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
