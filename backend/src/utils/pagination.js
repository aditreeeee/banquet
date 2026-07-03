/**
 * Pagination Utilities
 * Parses query params and builds SQL OFFSET / FETCH clauses
 */

'use strict';

const { PAGINATION } = require('../constants');

/**
 * Parse pagination from Express request query
 * Returns { page, limit, offset, sortBy, sortDir }
 */
const parsePagination = (query, allowedSortFields = []) => {
    const page  = Math.max(1, parseInt(query.page,  10) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
        parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT,
        PAGINATION.MAX_LIMIT
    );
    const offset = (page - 1) * limit;

    // Sort field whitelist (prevents SQL injection via sort)
    const sortDir = query.sort_dir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const sortBy  = allowedSortFields.includes(query.sort_by)
        ? query.sort_by
        : (allowedSortFields[0] || null);

    return { page, limit, offset, sortBy, sortDir };
};

/**
 * Build MSSQL paging clause (T-SQL)
 * Appended after ORDER BY in the query. Requires an ORDER BY clause.
 * Uses literal integers (page/limit/offset are validated integers above,
 * never raw user input) rather than bound params to keep call sites simple.
 */
const buildSqlPaging = ({ offset, limit }) =>
    `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

/**
 * Build pagination meta for response
 */
const buildMeta = (total, { page, limit }) => ({
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNext:    page < Math.ceil(total / limit),
    hasPrev:    page > 1,
});

module.exports = { parsePagination, buildSqlPaging, buildMeta };
