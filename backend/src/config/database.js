/**
 * Database Configuration — MySQL
 * Uses mysql2/promise with connection pooling and named placeholders
 * Supports 1000+ concurrent users via pool settings
 */

'use strict';

const mysql  = require('mysql2/promise');
const logger = require('../utils/logger');

// ─── Pool Configuration ────────────────────────────────────────────────────
const poolConfig = {
    host:                 process.env.DB_HOST     || 'localhost',
    port:                 parseInt(process.env.DB_PORT, 10) || 3306,
    database:             process.env.DB_NAME     || 'banquet_booking',
    user:                 process.env.DB_USER     || 'root',
    password:             process.env.DB_PASSWORD || '',
    connectionLimit:      parseInt(process.env.DB_POOL_MAX, 10) || 20,
    queueLimit:           0,
    waitForConnections:   true,
    timezone:             '+00:00',        // all dates stored / retrieved as UTC
    charset:              'utf8mb4',
    connectTimeout:       parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 15000,
    enableKeepAlive:      true,
    keepAliveInitialDelay: 10000,
    namedPlaceholders:    true,            // enables :param syntax in queries
};

// ─── Singleton Pool Instance ───────────────────────────────────────────────
let pool = null;

/**
 * Get or lazily create the connection pool.
 * mysql2 createPool is synchronous; actual connections are made on first use.
 * @returns {mysql.Pool}
 */
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool(poolConfig);

        logger.info('MySQL connection pool created', {
            host:     poolConfig.host,
            database: poolConfig.database,
            limit:    poolConfig.connectionLimit,
        });
    }
    return pool;
};

/**
 * Execute a parameterized query (SQL-injection safe via mysql2 prepared stmts)
 *
 * @param {string} query   - SQL with :paramName placeholders
 * @param {Object} params  - Named params object  { paramName: value }
 * @returns {Promise<Array|Object>}
 *   SELECT → array of row objects
 *   INSERT / UPDATE / DELETE → ResultSetHeader { insertId, affectedRows, … }
 */
const executeQuery = async (query, params = {}) => {
    const db = getPool();
    // query() does client-side interpolation and handles LIMIT/OFFSET correctly.
    // execute() uses server-side prepared statements which reject LIMIT as a bound param.
    const [rows] = await db.query(query, params);
    return rows;
};

/**
 * Execute a stored procedure
 * @param {string} procedureName
 * @param {Array}  values  - positional values (stored procedures use ? placeholders)
 * @returns {Promise<Array>}
 */
const executeStoredProcedure = async (procedureName, values = []) => {
    const db   = getPool();
    const ph   = values.map(() => '?').join(', ');
    const [rows] = await db.query(`CALL ${procedureName}(${ph})`, values);
    return rows;
};

/**
 * Execute multiple queries within an atomic transaction.
 *
 * @param {Function} callback  - async (tx) => { … }
 *   tx.execute(query, params) mirrors executeQuery inside the transaction
 * @returns {Promise<any>} whatever callback returns
 */
const withTransaction = async (callback) => {
    const db   = getPool();
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        // Thin wrapper so repository callbacks use the same API as executeQuery
        const tx = {
            execute: async (query, params = {}) => {
                const [rows] = await conn.query(query, params);
                return rows;
            },
        };

        const result = await callback(tx);
        await conn.commit();
        return result;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
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
        await pool.end();
        pool = null;
        logger.info('MySQL connection pool closed');
    }
};

process.on('SIGINT',  closePool);
process.on('SIGTERM', closePool);

module.exports = { getPool, executeQuery, executeStoredProcedure, withTransaction, healthCheck, closePool };
