/**
 * Settings Service — CompanySettings single source of truth.
 * Other services (booking, invoice, dashboard) read defaults through the
 * getters here instead of hardcoding values, so changing a setting takes
 * effect everywhere without touching multiple files.
 */
'use strict';

const NodeCache = require('node-cache');
const settingsRepo = require('../repositories/settings.repository');
const auditLogRepo = require('../repositories/auditLog.repository');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Currency symbols for the handful of currency codes selectable in Settings.
// general.currency (code) already existed as a seeded setting; only the
// symbol lookup is new.
const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' };

// Documented fallback defaults — used only when a company hasn't configured
// the setting yet. These match the values already seeded by scripts/setup.js
// (general.currency, booking.advance_pct) plus the setup/cleanup/cooloff
// defaults the booking wizard has always pre-filled client-side.
const DEFAULTS = {
    'booking.default_setup_minutes':   '60',
    'booking.default_cleanup_minutes': '60',
    'booking.default_cooloff_minutes': '30',
    'booking.advance_pct':              '50', // required advance % when booking; same key the Billing tab's slider already saves
    'billing.cgst_rate':                '9',
    'billing.sgst_rate':                '9',
    'general.currency':                 'INR',
};

const cacheKey = (companyId) => `settings_${companyId}`;

const getAll = async (companyId) => {
    const cached = cache.get(cacheKey(companyId));
    if (cached) return cached;

    const rows = await settingsRepo.findAll(companyId);
    const grouped = {};
    for (const row of rows) {
        if (!grouped[row.setting_group]) grouped[row.setting_group] = {};
        grouped[row.setting_group][row.setting_key] = row.setting_value;
    }
    cache.set(cacheKey(companyId), grouped);
    return grouped;
};

/** Flat map of every setting (with `group.key` composite keys) merged over defaults. */
const getFlatWithDefaults = async (companyId) => {
    const grouped = await getAll(companyId);
    const flat = { ...DEFAULTS };
    for (const [group, settings] of Object.entries(grouped)) {
        for (const [key, value] of Object.entries(settings)) {
            flat[`${group}.${key}`] = value;
        }
    }
    return flat;
};

/** Grouped view with defaults merged in — what the Settings UI displays, so
    an unconfigured company sees the real effective values, not blank fields. */
const getAllWithDefaults = async (companyId) => {
    const grouped = await getAll(companyId);
    const merged = {};
    for (const [compositeKey, value] of Object.entries(DEFAULTS)) {
        const [group, key] = compositeKey.split('.');
        if (!merged[group]) merged[group] = {};
        merged[group][key] = value;
    }
    for (const [group, settings] of Object.entries(grouped)) {
        merged[group] = { ...merged[group], ...settings };
    }
    return merged;
};

const getOne = async (companyId, group, key, fallback = null) => {
    const flat = await getFlatWithDefaults(companyId);
    const value = flat[`${group}.${key}`];
    return value !== undefined ? value : fallback;
};

/** Server-side booking defaults — the client's requested values (if any) still
    win; these only fill in what the client omitted. See booking.service.js. */
const getBookingDefaults = async (companyId) => {
    const flat = await getFlatWithDefaults(companyId);
    return {
        setupMinutes:   parseInt(flat['booking.default_setup_minutes'], 10),
        cleanupMinutes: parseInt(flat['booking.default_cleanup_minutes'], 10),
        cooloffMinutes: parseInt(flat['booking.default_cooloff_minutes'], 10),
        advancePct:     parseFloat(flat['booking.advance_pct']),
    };
};

const getTaxRates = async (companyId) => {
    const flat = await getFlatWithDefaults(companyId);
    return {
        cgstRate: parseFloat(flat['billing.cgst_rate']),
        sgstRate: parseFloat(flat['billing.sgst_rate']),
    };
};

const getCurrency = async (companyId) => {
    const flat = await getFlatWithDefaults(companyId);
    const code = flat['general.currency'] || 'INR';
    return { code, symbol: CURRENCY_SYMBOLS[code] || code };
};

const update = async (companyId, key, value, group, actor) => {
    const before = await settingsRepo.findOne(companyId, key);
    await settingsRepo.upsert(companyId, key, value, group);
    cache.del(cacheKey(companyId));

    await auditLogRepo.log({
        companyId,
        userId:     actor?.userId ?? null,
        action:     'settings.changed',
        entityType: 'setting',
        entityId:   key,
        description: `Setting "${key}" changed`,
        oldValues:  before !== null ? { value: before } : null,
        newValues:  { value: String(value) },
    });
};

module.exports = { getAll, getAllWithDefaults, getFlatWithDefaults, getOne, getBookingDefaults, getTaxRates, getCurrency, update };
