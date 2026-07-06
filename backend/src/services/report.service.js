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

    const branchId = actor.branchId || query.branch_id || null;
    const [series, summary] = await Promise.all([
        reportRepo.getRevenueReport({ companyId: actor.companyId, branchId, fromDate: from, toDate: to, groupBy }),
        reportRepo.getSummaryStats({  companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
    ]);

    const data = { summary, series, from, to, groupBy };
    cache.set(key, data);
    return data;
};

const getBookingReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);
    const p = parsePagination(query, ['event_date', 'total_amount', 'customer_name', 'status']);

    const { rows, total } = await reportRepo.getBookingReport({
        companyId: actor.companyId,
        branchId:  actor.branchId || query.branch_id || null,
        fromDate:  from,
        toDate:    to,
        status:    query.status || null,
        search:    query.search || null,
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
    // NOTE: branchId already falls back to query.branch_id when actor has no fixed branch.

    cache.set(key, data);
    return data;
};

const getPaymentReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);

    const branchId = actor.branchId || query.branch_id || null;
    const [payments, summary] = await Promise.all([
        reportRepo.getPaymentReport({ companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getSummaryStats({  companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
    ]);

    return { summary, payments, from, to };
};

// ─── Owner Analytics ────────────────────────────────────────────────────────
/**
 * Combined owner-facing analytics: revenue per hall (and per sqft), average
 * booking value, cancellation/refund rates, hall utilization (reuses the
 * occupancy report), most popular hall, top customers, inventory cost, and
 * a month-over-month comparison.
 *
 * NOTE: labour cost and utility cost are NOT included — this schema has no
 * fields tracking either yet, so "net contribution margin" here is revenue
 * minus tracked inventory cost and discounts only, not a full P&L margin.
 */
const getOwnerAnalytics = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);
    const branchId = actor.branchId || query.branch_id || null;
    const companyId = actor.companyId;

    // Previous period of equal length, immediately preceding `from`, for month-over-month comparison.
    const rangeDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    const previousTo = new Date(new Date(from).getTime() - 86400000);
    const previousFrom = new Date(previousTo.getTime() - (rangeDays - 1) * 86400000);

    const [
        revenuePerHall, occupancy, topCustomers, rates, inventoryCost, monthlyComparison, summary,
    ] = await Promise.all([
        reportRepo.getRevenuePerHall({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getOccupancyReport({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getTopCustomers({ companyId, branchId, fromDate: from, toDate: to, limit: 10 }),
        reportRepo.getCancellationAndRefundRates({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getInventoryCost({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getMonthlyComparison({
            companyId, branchId,
            currentFrom: from, currentTo: to,
            previousFrom: previousFrom.toISOString().slice(0, 10),
            previousTo:   previousTo.toISOString().slice(0, 10),
        }),
        reportRepo.getSummaryStats({ companyId, branchId, fromDate: from, toDate: to }),
    ]);

    const mostPopularHall = revenuePerHall.reduce((best, h) =>
        (!best || h.bookings_count > best.bookings_count) ? h : best, null);
    const peakOccupancyHall = occupancy.length ? occupancy[0] : null;

    const avgBookingValue = summary.total_bookings > 0
        ? Number((summary.gross_revenue / summary.total_bookings).toFixed(2))
        : 0;

    const netContributionMargin = Number(summary.gross_revenue) - Number(inventoryCost);

    const revenueChangePct = monthlyComparison.previous.revenue > 0
        ? Number((((monthlyComparison.current.revenue - monthlyComparison.previous.revenue) / monthlyComparison.previous.revenue) * 100).toFixed(2))
        : null;
    const bookingsChangePct = monthlyComparison.previous.bookings_count > 0
        ? Number((((monthlyComparison.current.bookings_count - monthlyComparison.previous.bookings_count) / monthlyComparison.previous.bookings_count) * 100).toFixed(2))
        : null;

    return {
        from, to,
        revenuePerHall,
        hallUtilization: occupancy,
        mostPopularHall,
        peakOccupancyHall,
        topCustomers,
        avgBookingValue,
        cancellationRate: rates.cancellation_rate,
        refundRate: rates.refund_rate,
        inventoryCost,
        netContributionMargin,
        monthlyComparison: { ...monthlyComparison, revenueChangePct, bookingsChangePct },
    };
};

module.exports = { getRevenueReport, getBookingReport, getOccupancyReport, getPaymentReport, getOwnerAnalytics };
