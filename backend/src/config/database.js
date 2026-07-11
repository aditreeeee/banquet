/**
 * Database Configuration — MSSQL (Microsoft SQL Server)
 * Uses the `mssql` package (Tedious driver) with connection pooling.
 * Supports 1000+ concurrent users via pool settings.
 *
 * Resilient connection manager:
 *  - Single shared pool (never competing pools) guarded by a cached
 *    connect promise.
 *  - Exponential backoff retry (1s → 30s cap) for at least 60s before
 *    a getPool() call gives up and throws.
 *  - Auto-reconnect: a pool/network error tears down the cached pool so
 *    the next getPool() call transparently reconnects.
 */

'use strict';

const sql    = require('mssql');
const logger = require('../utils/logger');

// ─── Pool Configuration ────────────────────────────────────────────────────
const poolConfig = {
    server:   process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_NAME || 'banquet_booking',
    user:     process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    pool: {
        max:               parseInt(process.env.DB_POOL_MAX, 10) || 20,
        min:               parseInt(process.env.DB_POOL_MIN, 10) || 0,
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT, 10) || 30000,
    },
    options: {
        encrypt:                String(process.env.DB_ENCRYPT).toLowerCase() === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === undefined
            ? true
            : String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
        enableArithAbort:       true,
        useUTC:                 true,
    },
    connectionTimeout: Math.max(parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 30000, 30000),
    requestTimeout:    Math.max(parseInt(process.env.DB_REQUEST_TIMEOUT, 10) || 30000, 30000),
};

// Windows Auth (trusted connection) is used whenever DB_USER isn't supplied.
const usingWindowsAuth = !process.env.DB_USER;
if (usingWindowsAuth) {
    poolConfig.options.trustedConnection = true;
}

// ─── Retry Policy ───────────────────────────────────────────────────────────
const RETRY_BASE_MS   = parseInt(process.env.DB_RETRY_BASE_MS, 10) || 1000;
const RETRY_MAX_MS    = parseInt(process.env.DB_RETRY_MAX_MS, 10) || 30000;
const RETRY_BUDGET_MS = parseInt(process.env.DB_RETRY_BUDGET_MS, 10) || 60000; // retry at least 60s before giving up

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logConnectionTarget = () => {
    logger.info('MSSQL target', {
        instance: `${poolConfig.server},${poolConfig.port}`,
        database: poolConfig.database,
        authMode: usingWindowsAuth ? 'Windows Authentication' : 'SQL Server Authentication',
        encrypt:  poolConfig.options.encrypt,
    });
};

// ─── Singleton Pool Instance ───────────────────────────────────────────────
let pool = null;
let poolPromise = null;

/**
 * Attempt a single connection.
 */
const connectOnce = async () => {
    const connectedPool = await new sql.ConnectionPool(poolConfig).connect();

    connectedPool.on('error', (err) => {
        logger.error('MSSQL pool error — pool will reconnect on next use', { error: err.message });
        // Tear down the shared references so the next getPool() call
        // transparently reconnects instead of reusing a dead pool.
        pool = null;
        poolPromise = null;
    });

    return connectedPool;
};

/**
 * Connect with exponential backoff, retrying for at least
 * DB_RETRY_BUDGET_MS (default 60s) before giving up.
 */
const connectWithBackoff = async () => {
    logConnectionTarget();

    const startedAt = Date.now();
    let attempt = 0;
    let delay = RETRY_BASE_MS;

    for (;;) {
        attempt += 1;
        logger.info('Attempting MSSQL connection', { attempt });
        try {
            const connectedPool = await connectOnce();
            logger.info('MSSQL connection pool created', {
                attempt,
                host:     poolConfig.server,
                database: poolConfig.database,
                max:      poolConfig.pool.max,
            });
            return connectedPool;
        } catch (err) {
            const elapsed = Date.now() - startedAt;
            logger.error('MSSQL connection attempt failed', {
                attempt, elapsedMs: elapsed, error: err.message,
            });

            if (elapsed >= RETRY_BUDGET_MS) {
                logger.error('MSSQL connection retry budget exhausted — giving up for now', {
                    attempts: attempt, elapsedMs: elapsed,
                });
                throw err;
            }

            await sleep(delay);
            delay = Math.min(delay * 2, RETRY_MAX_MS);
        }
    }
};

/**
 * Get or lazily create the connection pool. Always returns a valid,
 * connected pool (or throws after exhausting the retry budget). Concurrent
 * callers share the same in-flight connect promise, so only one pool is
 * ever created.
 * @returns {Promise<sql.ConnectionPool>}
 */
const getPool = async () => {
    if (pool && pool.connected) {
        return pool;
    }
    if (!poolPromise) {
        poolPromise = connectWithBackoff()
            .then((connectedPool) => {
                pool = connectedPool;
                return pool;
            })
            .catch((err) => {
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
};

/**
 * Bind a params object onto an mssql Request via request.input().
 * The mssql driver infers native JS types (string/number/boolean/Date/Buffer)
 * automatically, which is sufficient for the vast majority of queries here.
 *
 * A bare JS `null` with no type hint is inferred by the driver as NVarChar(1).
 * That's harmless for direct comparisons, but it's a landmine for the very
 * common `ISNULL(@param, existingColumn)` partial-update pattern used across
 * the repositories: SQL Server's ISNULL takes its *result type* from the
 * first argument's *declared* type — so even though @param being NULL means
 * "keep the existing value", the returned string gets silently truncated to
 * 1 character by the implicit conversion. Explicitly typing null params as
 * NVarChar(MAX) avoids this.
 *
 * @param {sql.Request} request
 * @param {Object} params - { paramName: value }
 */
const bindParams = (request, params = {}) => {
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            request.input(key, sql.NVarChar(sql.MAX), null);
        } else {
            request.input(key, value);
        }
    });
};

/**
 * Execute a parameterized query (SQL-injection safe via mssql prepared params)
 *
 * @param {string} query   - SQL with @paramName placeholders
 * @param {Object} params  - Named params object  { paramName: value }
 * @returns {Promise<Array>} recordset rows
 */
const executeQuery = async (query, params = {}) => {
    const db      = await getPool();
    const request = db.request();
    bindParams(request, params);
    const result = await request.query(query);
    return result.recordset || [];
};

/**
 * Execute a stored procedure
 * @param {string} procedureName
 * @param {Object} params - named params object { paramName: value }
 * @returns {Promise<Array>}
 */
const executeStoredProcedure = async (procedureName, params = {}) => {
    const db      = await getPool();
    const request = db.request();
    bindParams(request, params);
    const result = await request.execute(procedureName);
    return result.recordset || [];
};

/**
 * Execute multiple queries within an atomic transaction.
 *
 * @param {Function} callback  - async (tx) => { … }
 *   tx.execute(query, params) mirrors executeQuery inside the transaction
 * @returns {Promise<any>} whatever callback returns
 */
const withTransaction = async (callback) => {
    const db  = await getPool();
    const tx  = new sql.Transaction(db);

    await tx.begin();

    try {
        const txApi = {
            execute: async (query, params = {}) => {
                const request = new sql.Request(tx);
                bindParams(request, params);
                const result = await request.query(query);
                return result.recordset || [];
            },
        };

        const result = await callback(txApi);
        await tx.commit();
        return result;
    } catch (err) {
        try {
            await tx.rollback();
        } catch (rollbackErr) {
            logger.error('MSSQL transaction rollback failed', { error: rollbackErr.message });
        }
        throw err;
    }
};

/**
 * Health check — returns true if DB is reachable
 */
const healthCheck = async () => {
    try {
        const rows = await executeQuery('SELECT 1 AS ok');
        return rows[0]?.ok === 1;
    } catch (err) {
        logger.error('Health check DB query failed', { error: err.message });
        return false;
    }
};

/**
 * Block until the database responds to a simple query, retrying with
 * exponential backoff indefinitely (never gives up, since a fresh boot's
 * SQL Server may legitimately take longer than one 60s retry budget).
 * Intended to be awaited once at process startup, before the HTTP server
 * begins accepting requests.
 */
const waitUntilReady = async () => {
    logger.info('Waiting for SQL Server...');
    // eslint-disable-next-line no-console
    console.log('Waiting for SQL Server...');

    for (;;) {
        try {
            await getPool();
            logger.info('Database connected. Starting server.');
            // eslint-disable-next-line no-console
            console.log('Database connected. Starting server.');
            return;
        } catch (err) {
            logger.error('Still waiting for SQL Server — will keep retrying', { error: err.message });
        }
    }
};

/**
 * Gracefully close the pool (used on process shutdown)
 */
const closePool = async () => {
    if (pool) {
        await pool.close();
        pool = null;
        poolPromise = null;
        logger.info('MSSQL connection pool closed');
    }
};

process.on('SIGINT',  closePool);
process.on('SIGTERM', closePool);

module.exports = {
    getPool,
    executeQuery,
    executeStoredProcedure,
    withTransaction,
    healthCheck,
    waitUntilReady,
    closePool,
};
