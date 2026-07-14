/**
 * Report Service — Aggregates report data; handles date range validation and caching
 */
'use strict';

const reportRepo = require('../repositories/report.repository');
const NodeCache  = require('node-cache');
const { CACHE_TTL } = require('../constants');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { ValidationError } = require('../api/v1/middleware/errorHandler');
const { resolveBranchScope } = require('../utils/branchScope');

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

/** Shifts a YYYY-MM-DD date back exactly one calendar year (handles Feb 29 gracefully). */
const shiftYearBack = (dateStr) => {
    const d = new Date(dateStr);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
};

const getRevenueReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);
    const groupBy = ['day', 'week', 'month'].includes(query.group_by) ? query.group_by : 'month';
    const key = `revenue:c${actor.companyId}:b${actor.branchId || 0}:${from}:${to}:${groupBy}`;

    const cached = cache.get(key);
    if (cached) return cached;

    const branchId = resolveBranchScope(actor, query);
    const priorFrom = shiftYearBack(from);
    const priorTo   = shiftYearBack(to);

    const [series, priorYearSeries, summary, refundedAmount, gstCollected, hsnBreakdown] = await Promise.all([
        reportRepo.getRevenueReport({ companyId: actor.companyId, branchId, fromDate: from, toDate: to, groupBy }),
        reportRepo.getRevenueReport({ companyId: actor.companyId, branchId, fromDate: priorFrom, toDate: priorTo, groupBy }),
        reportRepo.getSummaryStats({  companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getRefundedAmount({ companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getGstCollected({  companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getHsnSacBreakdown({ companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
    ]);

    // Year-over-year per bucket — matched by position (bucket N this year vs bucket N last
    // year), since a "this month" vs "same month last year" range produces the same bucket
    // count. Null (not 0%) when there's no prior-year data to compare against, since a
    // 0% YoY reads as "flat", not "no history yet".
    const seriesWithYoy = series.map((row, i) => {
        const prior = priorYearSeries[i];
        const yoy_change = prior && prior.total_revenue > 0
            ? Number((((row.total_revenue - prior.total_revenue) / prior.total_revenue) * 100).toFixed(1))
            : null;
        return { ...row, yoy_change, prior_year_revenue: prior ? prior.total_revenue : null };
    });

    const netRevenue = Number(summary.total_revenue) - Number(refundedAmount);
    const cancelledAmount = seriesWithYoy.reduce((s, r) => s + (Number(r.cancelled_amount) || 0), 0);

    const data = {
        summary: { ...summary, refunded_amount: refundedAmount, net_revenue: netRevenue, cancelled_amount: cancelledAmount, gst_collected: gstCollected },
        series: seriesWithYoy,
        hsn_breakdown: hsnBreakdown,
        from, to, groupBy,
    };
    cache.set(key, data);
    return data;
};

const getBookingReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);
    const p = parsePagination(query, ['event_date', 'total_amount', 'customer_name', 'status']);

    const { rows, total } = await reportRepo.getBookingReport({
        companyId: actor.companyId,
        branchId:  resolveBranchScope(actor, query),
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

    const branchId = resolveBranchScope(actor, query);

    const [byHall, daily] = await Promise.all([
        reportRepo.getOccupancyReport({ companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getDailyOccupancy({ companyId: actor.companyId, branchId, fromDate: from, toDate: to }),
    ]);

    const totalOccupied = byHall.reduce((s, h) => s + Number(h.occupied_days || 0), 0);
    const totalAvailable = byHall.reduce((s, h) => s + Number(h.total_days || 0), 0);
    const avgOccupancyPct = totalAvailable > 0 ? Number((totalOccupied * 100 / totalAvailable).toFixed(1)) : 0;
    const peakDay = daily.reduce((best, d) =>
        (!best || Number(d.occupancy_pct) > Number(best.occupancy_pct)) ? d : best, null);

    const data = {
        kpi: {
            avg_occupancy_pct: avgOccupancyPct,
            peak_day: peakDay ? peakDay.occ_date : null,
            peak_day_pct: peakDay ? Number(peakDay.occupancy_pct) : 0,
            total_booked_hall_days: totalOccupied,
            total_available_hall_days: totalAvailable,
        },
        by_hall: byHall,
        daily,
        from, to,
    };

    cache.set(key, data);
    return data;
};

const getPaymentReport = async (query, actor) => {
    const { from, to } = validateDateRange(query.from_date, query.to_date);

    const branchId = resolveBranchScope(actor, query);
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
    const branchId = resolveBranchScope(actor, query);
    const companyId = actor.companyId;

    // Previous period of equal length, immediately preceding `from`, for month-over-month comparison.
    const rangeDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    const previousTo = new Date(new Date(from).getTime() - 86400000);
    const previousFrom = new Date(previousTo.getTime() - (rangeDays - 1) * 86400000);

    const [
        revenuePerHall, occupancy, topCustomers, rates, inventoryCost, decorationAnalytics, monthlyComparison, summary,
    ] = await Promise.all([
        reportRepo.getRevenuePerHall({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getOccupancyReport({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getTopCustomers({ companyId, branchId, fromDate: from, toDate: to, limit: 10 }),
        reportRepo.getCancellationAndRefundRates({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getInventoryCost({ companyId, branchId, fromDate: from, toDate: to }),
        reportRepo.getDecorationAnalytics({ companyId, branchId, fromDate: from, toDate: to }),
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
    const mostPopularDecorationPackage = decorationAnalytics.packageBreakdown.length
        ? decorationAnalytics.packageBreakdown[0] // pre-sorted by bookings_count DESC in the repo query
        : null;

    const avgBookingValue = summary.total_bookings > 0
        ? Number((summary.total_revenue / summary.total_bookings).toFixed(2))
        : 0;

    const netContributionMargin = Number(summary.total_revenue) - Number(inventoryCost);

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
        mostPopularDecorationPackage,
        decorationRevenue: decorationAnalytics.totalRevenue,
        decorationProfitability: decorationAnalytics.profitability,
        decorationPackageBreakdown: decorationAnalytics.packageBreakdown,
        decorationItemUtilization: decorationAnalytics.itemUtilization,
        monthlyComparison: { ...monthlyComparison, revenueChangePct, bookingsChangePct },
    };
};

module.exports = { getRevenueReport, getBookingReport, getOccupancyReport, getPaymentReport, getOwnerAnalytics };
