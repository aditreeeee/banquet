/**
 * Report Service — Aggregates report data; handles date range validation and caching
 */
'use strict';

const reportRepo = require('../repositories/report.repository');
const NodeCache  = require('node-cache');
const { CACHE_TTL } = require('../constants');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { ValidationError } = require('../api/v1/middleware/errorHandler');

const cache = new NodeCache({ stdTTL: CACHE_TTL.REPORTS });

const MAX_RANGE_DAYS = 366;

const validateDateRange = (fromDate, toDate) => {
    if (!fromDate || !toDate) throw new ValidationError('from_date and to_date are required');

    const from = new Date(fromDate);
    const to   = new Date(toDate);

    if (isNaN(from) || isNaN(to))     throw new ValidationError('Invalid date format');
    if (from > to)                     throw new ValidationError('from_date must be before to_date');
    if ((to - from) / 86400000 > MAX_RANGE_DAYS) {
        throw new ValidationError(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }

    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

const getRevenueReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);
    const groupBy = ['day', 'month'].includes(query.group_by) ? query.group_by : 'month';
    const key = `revenue:c${actor.companyId}:b${actor.branchId || 0}:${from}:${to}:${groupBy}`;

    const cached = cache.get(key);
    if (cached) return cached;

    const [series, summary] = await Promise.all([
        reportRepo.getRevenueReport({ companyId: actor.companyId, branchId: actor.branchId || null, fromDate: from, toDate: to, groupBy }),
        reportRepo.getSummaryStats({  companyId: actor.companyId, branchId: actor.branchId || null, fromDate: from, toDate: to }),
    ]);

    const data = { summary, series, from, to, groupBy };
    cache.set(key, data);
    return data;
};

const getBookingReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);
    const p = parsePagination(query, ['event_date']);

    const { rows, total } = await reportRepo.getBookingReport({
        companyId: actor.companyId,
        branchId:  actor.branchId || query.branch_id || null,
        fromDate:  from,
        toDate:    to,
        status:    query.status || null,
        ...p,
    });

    return { rows, meta: buildMeta(total, p), from, to };
};

const getOccupancyReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);
    const key = `occupancy:c${actor.companyId}:b${actor.branchId || 0}:${from}:${to}`;

    const cached = cache.get(key);
    if (cached) return cached;

    const data = await reportRepo.getOccupancyReport({
        companyId: actor.companyId,
        branchId:  actor.branchId || query.branch_id || null,
        fromDate:  from,
        toDate:    to,
    });

    cache.set(key, data);
    return data;
};

const getPaymentReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);

    const [payments, summary] = await Promise.all([
        reportRepo.getPaymentReport({ companyId: actor.companyId, branchId: actor.branchId || null, fromDate: from, toDate: to }),
        reportRepo.getSummaryStats({  companyId: actor.companyId, branchId: actor.branchId || null, fromDate: from, toDate: to }),
    ]);

    return { summary, payments, from, to };
};

module.exports = { getRevenueReport, getBookingReport, getOccupancyReport, getPaymentReport };
