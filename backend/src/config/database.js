/**
 * Database Configuration — MSSQL (Microsoft SQL Server)
 * Uses the `mssql` package (Tedious driver) with connection pooling.
 * Supports 1000+ concurrent users via pool settings.
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
        max:                     parseInt(process.env.DB_POOL_MAX, 10) || 20,
        min:                     parseInt(process.env.DB_POOL_MIN, 10) || 0,
        idleTimeoutMillis:       30000,
    },
    options: {
        encrypt:                String(process.env.DB_ENCRYPT).toLowerCase() === 'true',
        trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
        enableArithAbort:       true,
        useUTC:                 true,
    },
    connectionTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 15000,
    requestTimeout:    parseInt(process.env.DB_REQUEST_TIMEOUT, 10) || 15000,
};

// ─── Singleton Pool Instance ───────────────────────────────────────────────
let pool = null;
let poolPromise = null;

/**
 * Get or lazily create the connection pool.
 * mssql pool creation is asynchronous, so we cache the connect promise
 * to avoid creating multiple pools under concurrent first-use calls.
 * @returns {Promise<sql.ConnectionPool>}
 */
const getPool = async () => {
    if (pool && pool.connected) {
        return pool;
    }
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(poolConfig)
            .connect()
            .then((connectedPool) => {
                pool = connectedPool;
                pool.on('error', (err) => {
                    logger.error('MSSQL pool error', { error: err.message });
                });
                logger.info('MSSQL connection pool created', {
                    host:     poolConfig.server,
                    database: poolConfig.database,
                    max:      poolConfig.pool.max,
                });
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
 * @param {sql.Request} request
 * @param {Object} params - { paramName: value }
 */
const bindParams = (request, params = {}) => {
    Object.entries(params).forEach(([key, value]) => {
        request.input(key, value === undefined ? null : value);
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
    } catch {
        return false;
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

module.exports = { getPool, executeQuery, executeStoredProcedure, withTransaction, healthCheck, closePool };
