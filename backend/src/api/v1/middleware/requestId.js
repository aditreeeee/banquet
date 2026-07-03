/**
 * Request ID Middleware
 * Assigns a unique ID to every request for tracing
 */
'use strict';
const { v4: uuidv4 } = require('uuid');

module.exports = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
};
