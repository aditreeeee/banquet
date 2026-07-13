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

// Session/token policy is platform-wide, not per-tenant — different
// companies having different logout timings doesn't make sense for a
// shared JWT signing config, and "make settings global" was explicit
// feedback after this was first built as a per-company setting. There's no
// separate global-settings table, so this anchors every session-policy
// read/write to company_id=1's CompanySettings row regardless of which
// tenant is actually asking — writable only via the Super-Admin-gated
// /platform/settings/session-timeout route (see platform.routes.js), not
// the regular per-tenant /settings/:key endpoint.
const PLATFORM_SETTINGS_COMPANY_ID = 1;

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
    // Catering plate-count validation: 'warn' surfaces a toast but allows the
    // save; 'block' rejects saving a session whose ordered plates fall short
    // of the guest count/package minimum; 'off' disables the check entirely.
    'catering.min_plate_policy':         'warn',
    // How long a login stays active before the access token expires and the
    // user is signed out (matches the previous hardcoded JWT_ACCESS_EXPIRES
    // default of 15 minutes). Platform-wide, not per-company — see
    // PLATFORM_SETTINGS_COMPANY_ID/getSessionPolicy below.
    'session.access_token_minutes':      '15',
    // Idle timeout: how long with no activity (click/type/scroll/nav/API call)
    // before the client logs the user out. Enforced client-side (auth.js's
    // session manager); the server has no notion of "idle" since it's
    // stateless between requests.
    'session.idle_timeout_minutes':      '30',
    // Absolute session lifetime: hard cap on a session's total age from
    // first login, regardless of activity — enforced server-side in the
    // `authenticate` middleware via the JWT's sessionStartedAt claim, since
    // this must hold even if a client is compromised/scripted to keep
    // refreshing forever.
    'session.absolute_session_hours':    '8',
    // How long before the idle timeout fires the warning modal appears.
    'session.warning_before_logout_minutes': '2',
    // "Keep Me Signed In" — how long the refresh-token cookie survives
    // browser close when the user opts in at login (vs. the short-lived
    // default otherwise; see auth.service.js issueTokens()).
    'session.keep_signed_in_days':       '30',
    // Maximum simultaneous active sessions (refresh tokens) per user — 0
    // means unlimited. Enforced in auth.service.js after each new login by
    // revoking the oldest sessions beyond the limit.
    'session.max_concurrent_sessions':   '0',
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

const getCateringPolicy = async (companyId) => {
    const flat = await getFlatWithDefaults(companyId);
    const policy = flat['catering.min_plate_policy'];
    return ['warn', 'block', 'off'].includes(policy) ? policy : 'warn';
};

const clampedInt = (value, fallback, min, max) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** The full platform-wide session/security policy — every field an
    authenticated user's client needs to run its own idle/absolute timers,
    plus what only a Super Admin may change. Anchored to
    PLATFORM_SETTINGS_COMPANY_ID (see comment above), so every tenant's
    logins are governed by the same values. */
const getSessionPolicy = async () => {
    const flat = await getFlatWithDefaults(PLATFORM_SETTINGS_COMPANY_ID);
    return {
        accessTokenMinutes:          clampedInt(flat['session.access_token_minutes'], 15, 1, 1440),
        idleTimeoutMinutes:          clampedInt(flat['session.idle_timeout_minutes'], 30, 1, 1440),
        absoluteSessionHours:        clampedInt(flat['session.absolute_session_hours'], 8, 1, 168),
        warningBeforeLogoutMinutes:  clampedInt(flat['session.warning_before_logout_minutes'], 2, 1, 60),
        keepSignedInDays:            clampedInt(flat['session.keep_signed_in_days'], 30, 1, 365),
        maxConcurrentSessions:       clampedInt(flat['session.max_concurrent_sessions'], 0, 0, 100),
    };
};

/** Super-Admin-only write path for the platform-wide session policy — goes
    through the same cache-invalidating update() below, anchored to
    PLATFORM_SETTINGS_COMPANY_ID rather than whichever tenant the caller
    happens to be scoped to, so the change is visible on the very next read
    (login or the automatic background token refresh — see auth.js's
    silent refresh — whichever happens first for a currently-active user).
    Accepts a partial policy object — only the provided keys are written,
    each as its own audited settings.changed entry. */
const SESSION_POLICY_FIELD_TO_KEY = {
    accessTokenMinutes:         'access_token_minutes',
    idleTimeoutMinutes:         'idle_timeout_minutes',
    absoluteSessionHours:       'absolute_session_hours',
    warningBeforeLogoutMinutes: 'warning_before_logout_minutes',
    keepSignedInDays:           'keep_signed_in_days',
    maxConcurrentSessions:      'max_concurrent_sessions',
};

const updateSessionPolicy = async (policy, actor) => {
    for (const [field, key] of Object.entries(SESSION_POLICY_FIELD_TO_KEY)) {
        if (policy[field] !== undefined) {
            await update(PLATFORM_SETTINGS_COMPANY_ID, key, policy[field], 'session', actor);
        }
    }
    return getSessionPolicy();
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

module.exports = { getAll, getAllWithDefaults, getFlatWithDefaults, getOne, getBookingDefaults, getTaxRates, getCateringPolicy, getSessionPolicy, updateSessionPolicy, getCurrency, update };
