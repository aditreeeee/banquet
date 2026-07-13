/**
 * Dashboard Service — Aggregates multi-source data for dashboard API
 * Uses NodeCache (5 min TTL) to reduce DB load on high traffic
 */

'use strict';

const dashRepo   = require('../repositories/dashboard.repository');
const { executeQuery } = require('../config/database');
const NodeCache  = require('node-cache');
const logger     = require('../utils/logger');
const { CACHE_TTL } = require('../constants');
const { onInvalidate, broadcastInvalidate } = require('../utils/clusterCache');

const cache = new NodeCache({ stdTTL: CACHE_TTL.DASHBOARD, checkperiod: 30 });

const cacheKey = (prefix, scope, period) =>
    `${prefix}:c${scope.companyId}:b${scope.branchId || 0}:${period}`;

// Revenue targets are configurable per company via Settings (CompanySettings,
// setting_group='targets') — no dedicated table needed, reuses the existing
// generic settings store/endpoint.
const TARGET_SETTING_KEY = {
    week: 'revenue_target_monthly', // no separate weekly setting; prorated from monthly below
    month: 'revenue_target_monthly',
    quarter: 'revenue_target_quarterly',
    year: 'revenue_target_yearly',
};

const getRevenueTarget = async (companyId, period) => {
    const key = TARGET_SETTING_KEY[period] || TARGET_SETTING_KEY.month;
    const rows = await executeQuery(
        `SELECT setting_value FROM CompanySettings WHERE company_id = @companyId AND setting_key = @key`,
        { companyId, key }
    );
    const monthlyOrPeriodTarget = parseFloat(rows[0]?.setting_value) || 0;
    // Weeks don't have their own setting — approximate from the monthly target.
    return period === 'week' ? monthlyOrPeriodTarget / 4.345 : monthlyOrPeriodTarget;
};

/**
 * Full dashboard data bundle — runs all queries in parallel
 * @param {Object} scope  - { companyId, branchId, userId, roleSlug }
 * @param {string} period - 'week' | 'month' | 'quarter' | 'year'
 */
const getDashboardData = async (scope, period = 'month') => {
    const key = cacheKey('dashboard', scope, period);
    const hit = cache.get(key);
    if (hit) return hit;

    const [kpi, newCustomers, revenueSeries, statusDist, upcoming, occupancy, activity, revenueTarget] =
        await Promise.all([
            dashRepo.getKpiStats({ ...scope, period }),
            dashRepo.getNewCustomers({ ...scope, period }),
            dashRepo.getRevenueSeries({ ...scope, period }),
            dashRepo.getStatusDistribution({ ...scope, period }),
            dashRepo.getUpcomingBookings({ ...scope, limit: 10 }),
            dashRepo.getHallOccupancy({ ...scope, period }),
            dashRepo.getRecentActivity({ companyId: scope.companyId, limit: 15 }),
            getRevenueTarget(scope.companyId, period),
        ]);

    // Spread the period target evenly across the series buckets (the SQL series
    // itself has no notion of a target — that lives in Settings, not Bookings).
    const bucketTarget = revenueSeries.length ? revenueTarget / revenueSeries.length : 0;
    const revenueSeriesWithTarget = revenueSeries.map(r => ({ ...r, target: Number(bucketTarget.toFixed(2)) }));

    const totalRevenue = Number(kpi.total_revenue) || 0;
    const revenueAchievedPct = revenueTarget > 0 ? Number(((totalRevenue / revenueTarget) * 100).toFixed(1)) : 0;
    const revenueRemaining = Math.max(0, Number((revenueTarget - totalRevenue).toFixed(2)));

    const data = {
        kpi: {
            ...kpi,
            new_customers: newCustomers,
            revenue_target: revenueTarget,
            revenue_achieved_pct: revenueAchievedPct,
            revenue_remaining: revenueRemaining,
        },
        charts: {
            revenue:  revenueSeriesWithTarget,
            status:   statusDist,
            occupancy,
        },
        upcoming,
        activity,
        period,
        generated_at: new Date().toISOString(),
    };

    cache.set(key, data);
    return data;
};

/**
 * Bookings for a specific date (mini-calendar click)
 * Short TTL — 30 seconds (more real-time feel)
 */
const getBookingsByDate = async (scope, date) => {
    return dashRepo.getBookingsByDate({ ...scope, date });
};

/**
 * Invalidate dashboard cache for a company (call after booking create/update/cancel)
 * on THIS worker only — invalidateDashboardCache also broadcasts to every
 * sibling PM2 cluster worker so a write handled by one worker doesn't leave
 * the others serving a stale dashboard for up to 5 minutes (see clusterCache.js).
 */
const invalidateLocalCache = (companyId) => {
    const keys = cache.keys().filter(k => k.includes(`c${companyId}:`));
    keys.forEach(k => cache.del(k));
    logger.debug('Dashboard cache invalidated', { companyId, keys: keys.length });
};

const invalidateDashboardCache = (companyId) => {
    invalidateLocalCache(companyId);
    broadcastInvalidate('dashboard:invalidate', { companyId });
};

onInvalidate('dashboard:invalidate', ({ companyId }) => invalidateLocalCache(companyId));

module.exports = { getDashboardData, getBookingsByDate, invalidateDashboardCache };
