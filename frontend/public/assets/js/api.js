/**
 * API Client — Banquet Hall Booking System
 * Wraps all HTTP calls with JWT auth, token refresh, error normalisation
 */

const API = (() => {
    'use strict';

    const BASE_URL  = window.APP_CONFIG?.apiBase || '/api/v1';
    const TOKEN_KEY = 'bnq_access_token';

    /* ── Token helpers ── */
    const getToken  = ()    => localStorage.getItem(TOKEN_KEY);
    const setToken  = (tok) => localStorage.setItem(TOKEN_KEY, tok);
    const clearToken = ()   => localStorage.removeItem(TOKEN_KEY);

    /* ── Build headers ── */
    function headers(extra = {}) {
        const h = { 'Content-Type': 'application/json', ...extra };
        const tok = getToken();
        if (tok) h['Authorization'] = `Bearer ${tok}`;
        return h;
    }

    /* ── Refresh access token using HttpOnly refresh cookie ── */
    let refreshPromise = null;
    async function refreshAccessToken() {
        if (refreshPromise) return refreshPromise;
        refreshPromise = fetch(`${BASE_URL}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',          // sends refresh-token cookie
            headers: { 'Content-Type': 'application/json' }
        })
        .then(r => r.json())
        .then(data => {
            refreshPromise = null;
            if (data.success) {
                setToken(data.data.accessToken);
                return data.data.accessToken;
            }
            throw new Error('Session expired');
        })
        .catch(err => {
            refreshPromise = null;
            clearToken();
            Auth.redirectToLogin();
            throw err;
        });
        return refreshPromise;
    }

    /* ── Core request with auto-retry on 401 ── */
    async function request(method, path, { body, params, rawForm } = {}) {
        let url = `${BASE_URL}${path}`;

        if (params) {
            const qs = new URLSearchParams(
                Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
            );
            if (qs.toString()) url += '?' + qs.toString();
        }

        const opts = {
            method,
            credentials: 'include',
            headers: rawForm ? { Authorization: `Bearer ${getToken()}` } : headers()
        };

        if (body !== undefined) {
            opts.body = rawForm ? body : JSON.stringify(body);
        }

        let res = await fetch(url, opts);

        /* Token expired — refresh once and retry */
        if (res.status === 401 && getToken()) {
            try {
                await refreshAccessToken();
                opts.headers = rawForm ? { Authorization: `Bearer ${getToken()}` } : headers();
                res = await fetch(url, opts);
            } catch (_) {
                throw { status: 401, message: 'Session expired. Please log in again.' };
            }
        }

        let data;
        const ct = res.headers.get('Content-Type') || '';
        if (ct.includes('application/json')) {
            data = await res.json();
        } else {
            data = { success: res.ok, message: await res.text() };
        }

        if (!res.ok) {
            const err = new Error(data.message || 'Request failed');
            err.status   = res.status;
            err.code     = data.error_code;
            err.errors   = data.errors;
            throw err;
        }

        return data;
    }

    /* ── Public interface ── */
    return {
        get:    (path, params)       => request('GET',    path, { params }),
        post:   (path, body)         => request('POST',   path, { body }),
        put:    (path, body)         => request('PUT',    path, { body }),
        patch:  (path, body)         => request('PATCH',  path, { body }),
        delete: (path)               => request('DELETE', path),
        upload: (path, formData)     => request('POST',   path, { rawForm: true, body: formData }),

        /* ─ Auth endpoints ─ */
        auth: {
            login:         (email, password) => request('POST', '/auth/login',          { body: { email, password } }),
            logout:        ()                => request('POST', '/auth/logout',         {}),
            refresh:       ()                => refreshAccessToken(),
            forgotPassword:(email)           => request('POST', '/auth/forgot-password',{ body: { email } }),
            resetPassword: (token, password) => request('POST', '/auth/reset-password', { body: { token, password } }),
            verifyEmail:   (token)           => request('GET',  `/auth/verify-email/${token}`),
            me:            ()                => request('GET',  '/auth/me'),
        },

        /* ─ Dashboard ─ */
        dashboard: {
            kpis:     (params) => request('GET', '/dashboard/kpis',        { params }),
            calendar: (params) => request('GET', '/dashboard/calendar',    { params }),
            activity: (params) => request('GET', '/dashboard/activity',    { params }),
        },

        /* ─ Banquets ─ */
        banquets: {
            list:   (p) => request('GET',    '/banquets',     { params: p }),
            get:    (id)=> request('GET',    `/banquets/${id}`),
            create: (d) => request('POST',   '/banquets',     { body: d }),
            update: (id,d)=> request('PUT',  `/banquets/${id}`,{ body: d }),
            delete: (id)=> request('DELETE', `/banquets/${id}`),
        },

        /* ─ Halls ─ */
        halls: {
            list:         (p)    => request('GET',  '/halls',               { params: p }),
            get:          (id)   => request('GET',  `/halls/${id}`),
            upsert:       (d)    => request('POST', '/halls',               { body: d }),
            update:       (id,d) => request('PUT',  `/halls/${id}`,         { body: d }),
            availability: (id,p) => request('GET',  `/halls/${id}/availability`, { params: p }),
            block:        (id,d) => request('POST', `/halls/${id}/block`,   { body: d }),
        },

        /* ─ Bookings ─ */
        bookings: {
            list:     (p)    => request('GET',   '/bookings',          { params: p }),
            get:      (id)   => request('GET',   `/bookings/${id}`),
            create:   (d)    => request('POST',  '/bookings',          { body: d }),
            update:   (id,d) => request('PUT',   `/bookings/${id}`,    { body: d }),
            cancel:   (id,r) => request('POST',  `/bookings/${id}/cancel`, { body: { reason: r } }),
            price:    (d)    => request('POST',  '/bookings/calculate-price', { body: d }),
            checkAvail:(d)   => request('POST',  '/bookings/check-availability', { body: d }),
        },

        /* ─ Customers ─ */
        customers: {
            list:   (p)    => request('GET',  '/customers',       { params: p }),
            get:    (id)   => request('GET',  `/customers/${id}`),
            create: (d)    => request('POST', '/customers',        { body: d }),
            update: (id,d) => request('PUT',  `/customers/${id}`,  { body: d }),
        },

        /* ─ Payments ─ */
        payments: {
            list:     (p)    => request('GET',  '/payments',          { params: p }),
            record:   (d)    => request('POST', '/payments',          { body: d }),
            refund:   (id,d) => request('POST', `/payments/${id}/refund`, { body: d }),
            history:  (bid)  => request('GET',  `/payments/booking/${bid}`),
            pending:  (p)    => request('GET',  '/payments/pending',  { params: p }),
        },

        /* ─ Invoices ─ */
        invoices: {
            list:     (p)    => request('GET',  '/invoices',         { params: p }),
            get:      (id)   => request('GET',  `/invoices/${id}`),
            generate: (d)    => request('POST', '/invoices',         { body: d }),
            cancel:   (id)   => request('DELETE',`/invoices/${id}`),
        },

        /* ─ Resources ─ */
        resources: {
            list:   (p) => request('GET',  '/resources',       { params: p }),
            create: (d) => request('POST', '/resources',        { body: d }),
            update: (id,d)=>request('PUT', `/resources/${id}`,  { body: d }),
            delete: (id)=> request('DELETE',`/resources/${id}`),
        },

        /* ─ Reports ─ */
        reports: {
            revenue:    (p) => request('GET', '/reports/revenue',     { params: p }),
            bookings:   (p) => request('GET', '/reports/bookings',    { params: p }),
            occupancy:  (p) => request('GET', '/reports/occupancy',   { params: p }),
            customers:  (p) => request('GET', '/reports/customers',   { params: p }),
            tax:        (p) => request('GET', '/reports/tax',         { params: p }),
        },

        /* ─ Notifications ─ */
        notifications: {
            list:      ()    => request('GET',  '/notifications'),
            markRead:  (ids) => request('PUT',  '/notifications/read', { body: { ids } }),
            markAllRead:()   => request('PUT',  '/notifications/read-all'),
        },

        /* ─ Settings ─ */
        settings: {
            get:    ()   => request('GET',  '/settings'),
            update: (d)  => request('PUT',  '/settings', { body: d }),
        },

        /* ─ Users ─ */
        users: {
            list:   (p)    => request('GET',  '/users',       { params: p }),
            get:    (id)   => request('GET',  `/users/${id}`),
            create: (d)    => request('POST', '/users',        { body: d }),
            update: (id,d) => request('PUT',  `/users/${id}`,  { body: d }),
            toggle: (id)   => request('PATCH',`/users/${id}/toggle-status`),
        },

        /* ─ Audit logs ─ */
        audit: {
            list: (p) => request('GET', '/audit-logs', { params: p }),
        },

        getToken,
        setToken,
        clearToken,
    };
})();

window.API = API;
