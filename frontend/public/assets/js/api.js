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

    /* ── Refresh access token using HttpOnly refresh cookie ──
       `silent: true` is used for the proactive background refresh (see auth.js
       session manager) — a failure there just means "try again next cycle",
       not "the session is dead", so it must NOT force a redirect. Only a
       refresh triggered by an actual 401 (a real invalid/expired session)
       should hard-redirect to login. */
    let refreshPromise = null;
    async function refreshAccessToken({ silent = false } = {}) {
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
            if (!silent) {
                clearToken();
                Auth.redirectToLogin();
            }
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

        /* ── Authenticated file download (exports) — plain <a href> can't carry the Bearer token ── */
        download: async (path, params, filename) => {
            const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));
            const res = await fetch(`${BASE_URL}${path}?${qs.toString()}`, { headers: headers() });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `Export failed (${res.status})`);
            }
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        },

        /* ─ Auth endpoints ─ */
        auth: {
            login:         (email, password) => request('POST', '/auth/login',          { body: { email, password } }),
            register:      (d)               => request('POST', '/auth/register',       { body: d }),
            logout:        ()                => request('POST', '/auth/logout',         {}),
            refresh:       (opts)            => refreshAccessToken(opts),
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

        /* ─ Branches ─ */
        branches: {
            list: (p) => request('GET', '/branches', { params: p }),
        },

        /* ─ Halls ─ */
        halls: {
            list:         (p)    => request('GET',  '/halls',               { params: p }),
            get:          (id)   => request('GET',  `/halls/${id}`),
            upsert:       (d)    => request('POST', '/halls',               { body: d }),
            update:       (id,d) => request('PUT',  `/halls/${id}`,         { body: d }),
            availability: (id,p) => request('GET',  `/halls/${id}/availability`, { params: p }),
            block:        (id,d) => request('POST', `/halls/${id}/block`,   { body: d }),
            activate:     (id)   => request('PATCH', `/halls/${id}/activate`),
            deactivate:   (id)   => request('PATCH', `/halls/${id}/deactivate`),
        },

        /* ─ Bookings ─ */
        bookings: {
            list:     (p)    => request('GET',   '/bookings',          { params: p }),
            get:      (id)   => request('GET',   `/bookings/${id}`),
            create:   (d)    => request('POST',  '/bookings',          { body: d }),
            update:   (id,d) => request('PUT',   `/bookings/${id}`,    { body: d }),
            reschedule: (id,d) => request('PATCH', `/bookings/${id}/reschedule`, { body: d }),
            cancel:   (id,r,extra) => request('POST',  `/bookings/${id}/cancel`, { body: { reason: r, ...extra } }),
            status:   (id,s) => request('PATCH', `/bookings/${id}/status`, { body: { status: s } }),
            price:    (d)    => request('POST',  '/bookings/calculate-price', { body: d }),
            checkAvail:(d)   => request('POST',  '/bookings/check-availability', { body: d }),
            activities: (id)    => request('GET',  `/bookings/${id}/activities`),
            resources:  (id)    => request('GET',  `/bookings/${id}/resources`),
            updateResources: (id, resources) => request('PUT', `/bookings/${id}/resources`, { body: { resources } }),
            contacts:   (id)    => request('GET',  `/bookings/${id}/contacts`),
            addContact: (id,d)  => request('POST', `/bookings/${id}/contacts`, { body: d }),
            removeContact: (id,contactId) => request('DELETE', `/bookings/${id}/contacts/${contactId}`),
            staff:      (id)    => request('GET',  `/bookings/${id}/staff`),
            assignStaff:(id,d)  => request('POST', `/bookings/${id}/staff`, { body: d }),
            removeStaff:(id,assignmentId) => request('DELETE', `/bookings/${id}/staff/${assignmentId}`),
        },

        /* ─ Customers ─ */
        customers: {
            list:   (p)    => request('GET',  '/customers',       { params: p }),
            get:    (id)   => request('GET',  `/customers/${id}`),
            create: (d)    => request('POST', '/customers',        { body: d }),
            update: (id,d) => request('PUT',  `/customers/${id}`,  { body: d }),
            delete: (id)   => request('DELETE', `/customers/${id}`),
            bookingHistory: (id,p) => request('GET', `/customers/${id}/booking-history`, { params: p }),
        },

        /* ─ Payments ─ */
        payments: {
            list:     (p)    => request('GET',  '/payments',          { params: p }),
            get:      (id)   => request('GET',  `/payments/${id}`),
            record:   (d)    => request('POST', '/payments',          { body: d }),
            refund:   (id,d) => request('POST', `/payments/${id}/refund`, { body: d }),
            getRefunds: (id) => request('GET',  `/payments/${id}/refunds`),
            allRefunds: ()   => request('GET',  '/payments/refunds'),
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
            snapshot: (p) => request('GET', '/resources/snapshot', { params: p }),
            recommendations: (p) => request('GET', '/resources/recommendations', { params: p }),
        },

        /* ─ Catering (Master Menu packages) ─ */
        catering: {
            packages:    (p)     => request('GET',  '/catering/packages',        { params: p }),
            package:     (id)    => request('GET',  `/catering/packages/${id}`),
            createPackage: (d)   => request('POST', '/catering/packages',        { body: d }),
            pricing:     (id)    => request('GET',  `/catering/packages/${id}/pricing`),
            bill:        (id,p)  => request('GET',  `/catering/packages/${id}/bill`, { params: p }),
            addItem:     (id,d)  => request('POST', `/catering/packages/${id}/items`, { body: d }),
            removeItem:  (id,itemId) => request('DELETE', `/catering/packages/${id}/items/${itemId}`),
            syncPrice:   (id)    => request('POST', `/catering/packages/${id}/sync-price`),
            deletePackage: (id)  => request('DELETE', `/catering/packages/${id}`),
        },

        /* ─ Master Menu (menu items) ─ */
        menuItems: {
            list:       (p)    => request('GET',  '/menu-items',      { params: p }),
            get:        (id)   => request('GET',  `/menu-items/${id}`),
            create:     (d)    => request('POST', '/menu-items',       { body: d }),
            update:     (id,d) => request('PUT',  `/menu-items/${id}`, { body: d }),
            categories: ()     => request('GET',  '/menu-items/categories'),
        },

        /* ─ Operational Charges ─ */
        operationalCharges: {
            list:      ()      => request('GET', '/operational-charges'),
            calculate: (p)     => request('GET', '/operational-charges/calculate', { params: p }),
            upsert:    (type,d)=> request('PUT', `/operational-charges/${type}`,   { body: d }),
        },

        /* ─ Reports ─ */
        reports: {
            revenue:    (p) => request('GET', '/reports/revenue',     { params: p }),
            bookings:   (p) => request('GET', '/reports/bookings',    { params: p }),
            occupancy:  (p) => request('GET', '/reports/occupancy',   { params: p }),
            customers:  (p) => request('GET', '/reports/customers',   { params: p }),
            tax:        (p) => request('GET', '/reports/tax',         { params: p }),
            ownerAnalytics: (p) => request('GET', '/reports/owner-analytics', { params: p }),
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
            update: (key, value, group) => request('PATCH', `/settings/${key}`, { body: { value, group } }),
        },

        /* ─ Users ─ */
        users: {
            list:   (p)    => request('GET',  '/users',       { params: p }),
            get:    (id)   => request('GET',  `/users/${id}`),
            create: (d)    => request('POST', '/users',        { body: d }),
            update: (id,d) => request('PUT',  `/users/${id}`,  { body: d }),
            toggle: (id)   => request('PATCH',`/users/${id}/toggle-status`),
            schedule: (id) => request('GET',  `/users/${id}/schedule`),
            pending:  ()   => request('GET',  '/users/pending'),
            approve:  (id) => request('PATCH',`/users/${id}/approve`),
            reject:   (id) => request('PATCH',`/users/${id}/reject`),
        },

        /* ─ Audit logs ─ */
        audit: {
            list: (p) => request('GET', '/audit-logs', { params: p }),
        },

        /* ─ Leads (Sales Pipeline) ─ */
        leads: {
            list:    (p)    => request('GET',   '/leads',           { params: p }),
            get:     (id)   => request('GET',   `/leads/${id}`),
            create:  (d)    => request('POST',  '/leads',           { body: d }),
            update:  (id,d) => request('PUT',   `/leads/${id}`,     { body: d }),
            stage:   (id,d) => request('PATCH', `/leads/${id}/stage`, { body: d }),
            convert: (id,d) => request('POST',  `/leads/${id}/convert`, { body: d }),
        },

        /* ─ Marketing Automation ─ */
        marketing: {
            send:    (d) => request('POST', '/marketing/send', { body: d }),
            history: (p) => request('GET',  '/marketing/history', { params: p }),
            upload:  (file) => { const fd = new FormData(); fd.append('file', file); return request('POST', '/marketing/upload', { body: fd, rawForm: true }); },
        },

        /* ─ Reviews ─ */
        reviews: {
            forBanquet: (banquetId, p) => request('GET', `/reviews/banquet/${banquetId}`, { params: p }),
            create:     (d) => request('POST', '/reviews', { body: d }),
        },

        getToken,
        setToken,
        clearToken,
    };
})();

window.API = API;
