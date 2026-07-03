/**
 * Standardized API Response Helpers
 * All controllers use these to ensure consistent response shape
 */

'use strict';

/**
 * Success response
 * @param {Response} res
 * @param {*} data
 * @param {string} message
 * @param {number} statusCode
 * @param {Object} meta  - pagination, totals, etc.
 */
const success = (res, data = null, message = 'Success', statusCode = 200, meta = null) => {
    const body = {
        success:    true,
        statusCode,
        message,
        timestamp:  new Date().toISOString(),
        requestId:  res.req?.requestId,
    };
    if (data !== null)  body.data = data;
    if (meta !== null)  body.meta = meta;
    return res.status(statusCode).json(body);
};

/**
 * Created response (201)
 */
const created = (res, data, message = 'Created successfully') =>
    success(res, data, message, 201);

/**
 * No content (204 — used for DELETE)
 */
const noContent = (res) => res.status(204).send();

/**
 * Paginated list response
 */
const paginated = (res, rows, pagination, message = 'Retrieved successfully') =>
    success(res, rows, message, 200, {
        page:        pagination.page,
        limit:       pagination.limit,
        total:       pagination.total,
        totalPages:  Math.ceil(pagination.total / pagination.limit),
        hasNext:     pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrev:     pagination.page > 1,
    });

module.exports = { success, created, noContent, paginated };
