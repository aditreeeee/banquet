/**
 * UTILS — Banquet Hall Booking System
 * Formatters, helpers, toast, validators
 */

const Utils = (() => {
    'use strict';

    /* ── Number / Currency ── */
    function formatCurrency(amount, currency = 'INR') {
        if (amount === null || amount === undefined) return '—';
        return new Intl.NumberFormat('en-IN', {
            style: 'currency', currency,
            minimumFractionDigits: 0, maximumFractionDigits: 0
        }).format(amount);
    }

    function formatNumber(n) {
        if (n === null || n === undefined) return '—';
        return new Intl.NumberFormat('en-IN').format(n);
    }

    function formatPercent(n, decimals = 1) {
        if (n === null || n === undefined) return '—';
        return n.toFixed(decimals) + '%';
    }

    /** Compact currency: ₹2.8L, ₹45K, ₹3.2Cr */
    function formatCurrencyShort(amount) {
        if (amount === null || amount === undefined) return '—';
        if (amount >= 10000000) return '₹' + (amount / 10000000).toFixed(1) + 'Cr';
        if (amount >= 100000)   return '₹' + (amount / 100000).toFixed(1) + 'L';
        if (amount >= 1000)     return '₹' + (amount / 1000).toFixed(1) + 'K';
        return '₹' + amount;
    }

    /* ── Date / Time ── */
    function formatDate(date, opts = {}) {
        if (!date) return '—';
        const d = new Date(date);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', ...opts
        });
    }

    function formatDateTime(date) {
        if (!date) return '—';
        const d = new Date(date);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    }

    function formatTime(time) {
        if (!time) return '—';
        // Expects HH:MM or HH:MM:SS
        const [h, m] = time.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12  = h % 12 || 12;
        return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    }

    function timeAgo(date) {
        if (!date) return '';
        const diff = Date.now() - new Date(date).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1)  return 'Just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        const dy = Math.floor(h / 24);
        if (dy < 7) return `${dy}d ago`;
        return formatDate(date);
    }

    /* ── String helpers ── */
    function capitalize(s = '') {
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }

    function titleCase(s = '') {
        return s.replace(/_/g, ' ').replace(/\w\S*/g, capitalize);
    }

    function truncate(s = '', len = 40) {
        return s.length > len ? s.slice(0, len - 3) + '…' : s;
    }

    function initials(name = '') {
        return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    }

    function slugify(s = '') {
        return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    /* ── Status badge ── */
    function statusBadge(status, customLabel) {
        const label = customLabel || titleCase(status || '');
        return `<span class="badge-status badge-${status}">${label}</span>`;
    }

    /* ── Form helpers ── */
    function serializeForm(form) {
        const data = {};
        new FormData(form).forEach((v, k) => {
            data[k] = v === '' ? null : v;
        });
        return data;
    }

    function setFieldError(fieldId, message) {
        const el  = document.getElementById(fieldId);
        const err = document.getElementById(fieldId + '_error');
        if (el)  el.classList.add('is-invalid');
        if (err) { err.textContent = message; err.style.display = 'block'; }
    }

    function clearFieldError(fieldId) {
        const el  = document.getElementById(fieldId);
        const err = document.getElementById(fieldId + '_error');
        if (el)  el.classList.remove('is-invalid', 'is-valid');
        if (err) { err.style.display = 'none'; }
    }

    function clearAllErrors(form) {
        form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        form.querySelectorAll('.invalid-feedback').forEach(el => el.style.display = 'none');
    }

    function applyServerErrors(errors = []) {
        errors.forEach(({ field, message }) => setFieldError(field, message));
    }

    /* ── Validators ── */
    const Validators = {
        required:     v => v !== null && v !== undefined && String(v).trim() !== '',
        email:        v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        phone:        v => /^[+]?[\d\s\-()]{8,15}$/.test(v),
        minLen:   (n) => v => String(v).length >= n,
        maxLen:   (n) => v => String(v).length <= n,
        numeric:      v => !isNaN(parseFloat(v)) && isFinite(v),
        positive:     v => Number(v) > 0,
        gst:          v => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v),
        pan:          v => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
        pincode:      v => /^[1-9][0-9]{5}$/.test(v),
        password:     v => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(v),
    };

    /* ── Toast notifications ── */
    function ensureToastContainer() {
        let c = document.getElementById('toastContainer');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toastContainer';
            c.className = 'toast-container';
            document.body.appendChild(c);
        }
        return c;
    }

    function toast(message, type = 'info', duration = 4000) {
        const icons = { success: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><path d="M20 6 9 17l-5-5"></path></svg>', error: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>', warning: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><path d="M12 3 2 20h20Z"></path><path d="M12 9v4"></path><path d="M12 16h.01"></path></svg>', info: 'ℹ' };
        const container = ensureToastContainer();
        const item = document.createElement('div');
        item.className = `toast-item ${type}`;
        item.innerHTML = `
            <span style="font-size:18px;color:var(--color-${type === 'error' ? 'danger' : type})">${icons[type] || 'ℹ'}</span>
            <span style="flex:1">${message}</span>
            <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;">×</button>`;
        container.appendChild(item);
        if (duration > 0) {
            setTimeout(() => {
                item.classList.add('removing');
                setTimeout(() => item.remove(), 300);
            }, duration);
        }
        return item;
    }

    /* ── Confirm dialog ── */
    function confirm(msg, { title = 'Confirm', danger = false } = {}) {
        return new Promise(resolve => {
            const id = 'confirmModal_' + Date.now();
            const modal = document.createElement('div');
            modal.innerHTML = `
            <div class="modal fade" id="${id}" tabindex="-1">
              <div class="modal-dialog modal-dialog-centered modal-sm">
                <div class="modal-content">
                  <div class="modal-header">
                    <h5 class="modal-title">${title}</h5>
                    <button class="btn-close" data-bs-dismiss="modal">×</button>
                  </div>
                  <div class="modal-body"><p style="color:var(--text-secondary)">${msg}</p></div>
                  <div class="modal-footer">
                    <button class="btn-ghost" data-bs-dismiss="modal">Cancel</button>
                    <button class="btn-primary-brand ${danger ? 'bg-danger' : ''}" id="${id}_ok">
                      ${danger ? 'Delete' : 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            </div>`;
            document.body.appendChild(modal);
            const bsModal = new bootstrap.Modal(document.getElementById(id));
            document.getElementById(id + '_ok').onclick = () => {
                bsModal.hide();
                resolve(true);
            };
            document.getElementById(id).addEventListener('hidden.bs.modal', () => {
                modal.remove();
                resolve(false);
            });
            bsModal.show();
        });
    }

    /* ── Loading overlay ── */
    function showLoader(el, text = 'Loading…') {
        if (!el) return;
        el.dataset.origHtml = el.innerHTML;
        el.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${text}`;
        el.disabled = true;
    }

    function hideLoader(el) {
        if (!el || !el.dataset.origHtml) return;
        el.innerHTML = el.dataset.origHtml;
        el.disabled = false;
        delete el.dataset.origHtml;
    }

    /* ── Debounce ── */
    function debounce(fn, delay = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    /* ── Deep clone ── */
    function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

    /* ── Query params from URL ── */
    function getQueryParam(key) {
        return new URLSearchParams(window.location.search).get(key);
    }

    /* ── Set page title ── */
    function setTitle(title) {
        document.title = `${title} | Banquet System`;
    }

    /* ── Color for event types (FullCalendar) ── */
    const EVENT_COLORS = [
        '#7C3AED','#10B981','#F59E0B','#EF4444','#3B82F6',
        '#EC4899','#14B8A6','#8B5CF6','#F97316','#06B6D4'
    ];
    function eventColor(index) {
        return EVENT_COLORS[index % EVENT_COLORS.length];
    }

    /* ── Build URL with params ── */
    function buildUrl(path, params = {}) {
        const qs = new URLSearchParams(
            Object.entries(params).filter(([,v]) => v !== null && v !== undefined && v !== '')
        ).toString();
        return qs ? `${path}?${qs}` : path;
    }

    /* ── Paginated table helper ── */
    function renderPagination(containerId, { page, limit, total }, onPageChange) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const totalPages = Math.ceil(total / limit);
        const from = total === 0 ? 0 : (page - 1) * limit + 1;
        const to   = Math.min(page * limit, total);

        const pages = [];
        const range = 2;
        for (let i = Math.max(1, page - range); i <= Math.min(totalPages, page + range); i++) {
            pages.push(i);
        }

        el.innerHTML = `
        <div class="pagination-wrap">
            <span>Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}</span>
            <ul class="pagination">
                <li class="page-item ${page <= 1 ? 'disabled' : ''}">
                    <a class="page-link" href="#" data-page="${page - 1}">‹</a>
                </li>
                ${pages.map(p => `
                <li class="page-item ${p === page ? 'active' : ''}">
                    <a class="page-link" href="#" data-page="${p}">${p}</a>
                </li>`).join('')}
                <li class="page-item ${page >= totalPages ? 'disabled' : ''}">
                    <a class="page-link" href="#" data-page="${page + 1}">›</a>
                </li>
            </ul>
        </div>`;

        el.querySelectorAll('[data-page]').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const p = parseInt(link.dataset.page);
                if (p >= 1 && p <= totalPages) onPageChange(p);
            });
        });
    }

    return {
        formatCurrency, formatCurrencyShort, formatNumber, formatPercent,
        formatDate, formatDateTime, formatTime, timeAgo,
        capitalize, titleCase, truncate, initials, slugify,
        statusBadge,
        serializeForm, setFieldError, clearFieldError, clearAllErrors, applyServerErrors,
        Validators,
        toast,
        confirm,
        showLoader, hideLoader,
        debounce, clone,
        getQueryParam, setTitle,
        eventColor, buildUrl, renderPagination,
    };
})();

window.Utils = Utils;
