/**
 * FormDraft — localStorage-backed draft auto-save/restore.
 * Used to save unfinished forms (Bookings, Quotations, Customers, Payments,
 * Invoices) right before a session-timeout logout (see auth.js's
 * 'bnq:session-warning'/'bnq:session-timeout' events) and restore them after
 * the next login, per the session-timeout spec's draft-recovery requirement.
 * Drafts expire after 24h so a restore prompt never surfaces stale data.
 */
const FormDraft = (() => {
    'use strict';

    const PREFIX  = 'bnq_draft_';
    const TTL_MS  = 24 * 60 * 60 * 1000;

    function save(key, data) {
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
        } catch (_) { /* storage full/unavailable — non-fatal, best-effort */ }
    }

    /** Returns the saved data, or null if none exists or it has expired. */
    function load(key) {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (!raw) return null;
            const { data, savedAt } = JSON.parse(raw);
            if (Date.now() - savedAt > TTL_MS) { clear(key); return null; }
            return data;
        } catch (_) { return null; }
    }

    function has(key) {
        return load(key) !== null;
    }

    function savedAt(key) {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (!raw) return null;
            return JSON.parse(raw).savedAt;
        } catch (_) { return null; }
    }

    function clear(key) {
        localStorage.removeItem(PREFIX + key);
    }

    /**
     * Generic best-effort autosave for simple (non-wizard) forms — serializes
     * every named input/select/textarea inside `containerEl` to a flat
     * {name: value} map, and restores by re-setting matching elements'
     * values. Good enough for flat create/edit forms (Quotations, Customers,
     * Payments, Invoices); multi-step flows like the booking wizard save
     * their own richer `state` object directly via save()/load() instead.
     */
    function serializeForm(containerEl) {
        const out = {};
        containerEl.querySelectorAll('[name], [id]').forEach(el => {
            if (!el.id && !el.name) return;
            if (el.type === 'password' || el.type === 'file') return;
            const key = el.name || el.id;
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (el.checked) out[key] = el.value || true;
            } else {
                out[key] = el.value;
            }
        });
        return out;
    }

    function restoreForm(containerEl, values) {
        Object.entries(values || {}).forEach(([key, value]) => {
            const el = containerEl.querySelector(`[name="${key}"], #${CSS.escape(key)}`);
            if (!el) return;
            if (el.type === 'checkbox' || el.type === 'radio') {
                el.checked = (el.value === value) || value === true;
            } else {
                el.value = value;
            }
        });
    }

    /**
     * One-call wiring for a simple flat form: autosaves on session-warning/
     * timeout, and on load offers to restore any unexpired draft. Call once
     * per page after the form's DOM exists.
     */
    function autoSaveForm(key, containerSelector) {
        const containerEl = document.querySelector(containerSelector);
        if (!containerEl) return;

        const trySave = () => save(key, serializeForm(containerEl));
        window.addEventListener('bnq:session-warning', trySave);
        window.addEventListener('bnq:session-timeout', trySave);

        const draft = load(key);
        if (draft && Object.keys(draft).length) {
            Utils.confirm(
                `We found unsaved changes from ${Utils.timeAgo ? Utils.timeAgo(savedAt(key)) : 'earlier'} — restore them?`,
                { title: 'Restore Draft' }
            ).then(ok => {
                if (ok) restoreForm(containerEl, draft);
                else clear(key);
            });
        }
    }

    return { save, load, has, savedAt, clear, serializeForm, restoreForm, autoSaveForm };
})();

window.FormDraft = FormDraft;
