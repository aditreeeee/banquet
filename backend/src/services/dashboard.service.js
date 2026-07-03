/**
 * Dashboard Service — Aggregates multi-source data for dashboard API
 * Uses NodeCache (5 min TTL) to reduce DB load on high traffic
 */

'use strict';

const dashRepo   = require('../repositories/dashboard.repository');
const NodeCache  = require('node-cache');
const logger     = require('../utils/logger');
const { CACHE_TTL } = require('../constants');

const cache = new NodeCache({ stdTTL: CACHE_TTL.DASHBOARD, checkperiod: 30 });

const cacheKey = (prefix, scope, period) =>
    `${prefix}:c${scope.companyId}:b${scope.branchId || 0}:${period}`;

/**
 * Full dashboard data bundle — runs all queries in parallel
 * @param {Object} scope  - { companyId, branchId, userId, roleSlug }
 * @param {string} period - 'week' | 'month' | 'quarter' | 'year'
 */
const getDashboardData = async (scope, period = 'month') => {
    const key = cacheKey('dashboard', scope, period);
    const hit = cache.get(key);
    if (hit) return hit;

    const [kpi, newCustomers, revenueSeries, statusDist, upcoming, occupancy, activity] =
        await Promise.all([
            dashRepo.getKpiStats({ ...scope, period }),
            dashRepo.getNewCustomers({ ...scope, period }),
            dashRepo.getRevenueSeries({ ...scope, period }),
            dashRepo.getStatusDistribution({ ...scope, period }),
            dashRepo.getUpcomingBookings({ ...scope, limit: 10 }),
            dashRepo.getHallOccupancy({ ...scope, period }),
            dashRepo.getRecentActivity({ companyId: scope.companyId, limit: 15 }),
        ]);

    const data = {
        kpi: {
            ...kpi,
            new_customers: newCustomers,
        },
        charts: {
            revenue:  revenueSeries,
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
 */
const invalidateDashboardCache = (companyId) => {
    const periods = ['week', 'month', 'quarter', 'year'];
    const keys    = cache.keys().filter(k => k.includes(`c${companyId}:`));
    keys.forEach(k => cache.del(k));
    logger.debug('Dashboard cache invalidated', { companyId, keys: keys.length });
};

module.exports = { getDashboardData, getBookingsByDate, invalidateDashboardCache };
