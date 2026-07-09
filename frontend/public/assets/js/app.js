/**
 * APP BOOTSTRAP — Banquet Hall Booking System
 * Sidebar, topbar, notifications, global init
 */

(function () {
    'use strict';

    /* ── Apply saved theme immediately (before paint) ── */
    Auth.applyTheme();

    /* ── DOM Ready ── */
    document.addEventListener('DOMContentLoaded', () => {
        initSidebar();
        initTopbar();
        initScrollTop();
        initImpersonationBanner();
        Auth.populateUserUI();
        Auth.highlightNav();
        Utils.loadCurrencySetting();
        loadNotifications();

        // Bootstrap tooltips
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
            new bootstrap.Tooltip(el, { trigger: 'hover' });
        });
    });

    /* ── Impersonation banner — shown on every page while a Super Admin is
       "viewing as" a tenant (see api.js's Impersonation helper). Purely
       client-side: no server session, just a header attached to requests
       until the admin clicks Exit. ── */
    function initImpersonationBanner() {
        if (typeof API === 'undefined' || !API.Impersonation) return;
        const state = API.Impersonation.get();
        if (!state) return;
        const bar = document.createElement('div');
        bar.style.cssText = 'position:sticky;top:0;z-index:1000;background:#7C3AED;color:white;padding:8px 16px;text-align:center;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px';
        bar.innerHTML = `<span>Viewing as tenant: ${state.companyName}</span><button style="background:white;color:#7C3AED;border:none;border-radius:6px;padding:3px 12px;font-size:12px;font-weight:700;cursor:pointer">Exit</button>`;
        bar.querySelector('button').onclick = () => {
            API.Impersonation.clear();
            window.location.href = '../platform/tenants.html';
        };
        document.body.prepend(bar);
    }

    /* ── SIDEBAR ── */
    function initSidebar() {
        const sidebar   = document.getElementById('sidebar');
        const main      = document.getElementById('mainContent');
        const overlay   = document.getElementById('sidebarOverlay');
        const toggle    = document.getElementById('sidebarToggle');
        const mobileBtn = document.getElementById('mobileSidebarBtn');

        if (!sidebar) return;

        const COLLAPSED_KEY = 'bnq_sidebar_collapsed';
        const isMobile = () => window.innerWidth < 1024;

        /* Restore collapsed state on desktop */
        if (!isMobile() && localStorage.getItem(COLLAPSED_KEY) === '1') {
            sidebar.classList.add('collapsed');
            main?.classList.add('sidebar-collapsed');
        }

        function openMobile() {
            sidebar.classList.add('mobile-open');
            overlay?.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeMobile() {
            sidebar.classList.remove('mobile-open');
            overlay?.classList.remove('active');
            document.body.style.overflow = '';
        }

        function toggleDesktop() {
            const collapsed = sidebar.classList.toggle('collapsed');
            main?.classList.toggle('sidebar-collapsed', collapsed);
            localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
        }

        toggle?.addEventListener('click', () => {
            if (isMobile()) { openMobile(); } else { toggleDesktop(); }
        });

        mobileBtn?.addEventListener('click', openMobile);
        overlay?.addEventListener('click', closeMobile);

        /* Close mobile sidebar on link click */
        sidebar.querySelectorAll('.sidebar-link').forEach(link => {
            link.addEventListener('click', () => { if (isMobile()) closeMobile(); });
        });

        /* Sub-menus (collapsible nav groups) */
        sidebar.querySelectorAll('.sidebar-submenu-toggle').forEach(toggle => {
            toggle.addEventListener('click', e => {
                e.preventDefault();
                const parent = toggle.closest('.sidebar-group');
                const submenu = parent?.querySelector('.sidebar-submenu');
                if (!submenu) return;
                const open = submenu.classList.toggle('open');
                submenu.style.maxHeight = open ? submenu.scrollHeight + 'px' : '0';
                toggle.querySelector('.submenu-arrow')?.classList.toggle('rotated', open);
            });
        });

        /* Auto-expand active submenu */
        sidebar.querySelectorAll('.sidebar-submenu .sidebar-link.active').forEach(link => {
            const submenu = link.closest('.sidebar-submenu');
            if (submenu) {
                submenu.classList.add('open');
                submenu.style.maxHeight = submenu.scrollHeight + 'px';
                submenu.closest('.sidebar-group')?.querySelector('.submenu-arrow')?.classList.add('rotated');
            }
        });
    }

    /* ── TOPBAR ── */
    function initTopbar() {
        /* Theme toggle */
        const themeBtn = document.getElementById('themeToggle');
        themeBtn?.addEventListener('click', () => Auth.toggleTheme());

        /* Logout */
        document.querySelectorAll('[data-action="logout"]').forEach(el => {
            el.addEventListener('click', async e => {
                e.preventDefault();
                if (await Utils.confirm('Are you sure you want to log out?', { title: 'Log Out' })) {
                    Utils.showLoader(el, 'Logging out…');
                    await Auth.logout();
                }
            });
        });
    }

    /* ── NOTIFICATIONS ── */
    const NOTIF_STORAGE_KEY = 'bnq_notifications_state';

    function normalizeNotification(n, index) {
        return {
            notification_id: n.notification_id || n.id || index + 1,
            title: n.title || 'Notification',
            body: n.body || n.message || 'You have a new update.',
            created_at: n.created_at || n.createdAt || new Date().toISOString(),
            is_read: Boolean(n.is_read ?? n.read ?? false),
            notification_type: n.notification_type || n.type || 'system'
        };
    }

    function getStoredNotifications() {
        try {
            const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.map(normalizeNotification) : null;
        } catch (_) {
            return null;
        }
    }

    function saveStoredNotifications(notifs) {
        try { localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifs)); } catch (_) {}
    }

    function setNotificationBadge(unread) {
        const badge = document.getElementById('notifBadge');
        if (badge) {
            badge.textContent = unread > 0 ? (unread > 99 ? '99+' : unread) : '';
            badge.style.display = unread > 0 ? '' : 'none';
        }
        const dot = document.querySelector('.notif-dot');
        if (dot) dot.style.display = unread > 0 ? '' : 'none';
    }

    function renderNotifications(notifs) {
        const panel = document.getElementById('notifList');
        if (!panel) return;

        if (!Array.isArray(notifs) || !notifs.length) {
            panel.innerHTML = '<div class="text-center py-4 text-muted" style="font-size:13px">No notifications</div>';
            return;
        }

        panel.innerHTML = notifs.slice(0, 10).map(n => `
            <div class="notif-item ${n.is_read ? '' : 'notif-unread'}" data-id="${n.notification_id}">
                <div class="notif-icon" style="background:${n.notification_type.includes('pay') ? 'rgba(16,185,129,.14)' : n.notification_type.includes('book') ? 'rgba(37,99,235,.14)' : 'rgba(197,160,89,.16)'};color:${n.notification_type.includes('pay') ? '#059669' : n.notification_type.includes('book') ? '#2563eb' : '#C5A059'}">
                    ${n.notification_type.includes('booking') ? '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 9h18"></path></svg>' : n.notification_type.includes('pay') ? '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><path d="M12 3v18"></path><path d="M16 7H8a3 3 0 1 0 0 6h8a3 3 0 1 1 0 6H8"></path></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><path d="M12 4a4 4 0 0 0-4 4v2.4a5 5 0 0 1-.8 2.8L6 15h12l-1.2-1.8a5 5 0 0 1-.8-2.8V8a4 4 0 0 0-4-4Z"></path><path d="M10 18a2 2 0 0 0 4 0"></path></svg>'}
                </div>
                <div class="notif-body">
                    <div class="notif-title">${Utils.truncate(n.title, 45)}</div>
                    <div class="notif-text">${Utils.truncate(n.body, 70)}</div>
                    <div class="notif-time">${Utils.timeAgo(n.created_at)}</div>
                </div>
            </div>`).join('');

        panel.querySelectorAll('.notif-item').forEach(item => {
            item.addEventListener('click', async () => {
                const id = parseInt(item.dataset.id, 10);
                if (Number.isNaN(id)) return;
                const stored = getStoredNotifications() || [];
                const updated = stored.map(n => n.notification_id === id ? { ...n, is_read: true } : n);
                saveStoredNotifications(updated);
                renderNotifications(updated);
                setNotificationBadge(updated.filter(n => !n.is_read).length);
                try { await API.notifications?.markRead?.([id]); } catch (_) {}
            });
        });
    }

    async function loadNotifications() {
        const panel = document.getElementById('notifList');
        if (!panel) return;

        const stored = getStoredNotifications() || [];
        renderNotifications(stored);
        setNotificationBadge(stored.filter(n => !n.is_read).length);

        try {
            const res = await API.notifications?.list?.();
            const apiNotifs = Array.isArray(res?.data?.notifications) ? res.data.notifications : [];
            const normalized = apiNotifs.map(normalizeNotification);
            saveStoredNotifications(normalized);
            renderNotifications(normalized);
            setNotificationBadge(normalized.filter(n => !n.is_read).length);
        } catch (_) {
            // Keep whatever was already cached from a prior successful load — never
            // substitute fabricated notifications when the live fetch fails.
        }
    }

    /* ── MARK ALL NOTIFS READ ── */
    document.addEventListener('click', async e => {
        if (e.target.closest('[data-action="mark-all-read"]')) {
            const stored = getStoredNotifications() || [];
            const updated = stored.map(n => ({ ...n, is_read: true }));
            saveStoredNotifications(updated);
            renderNotifications(updated);
            setNotificationBadge(0);
            try { await API.notifications?.markAllRead?.(); } catch (_) {}
        }
    });

    /* ── SCROLL TO TOP ── */
    function initScrollTop() {
        const btn = document.getElementById('scrollTop');
        if (!btn) return;
        window.addEventListener('scroll', () => {
            btn.classList.toggle('visible', window.scrollY > 400);
        }, { passive: true });
        btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    /* ── GLOBAL ERROR HANDLER for unhandled API failures ──
       A raw `TypeError: Failed to fetch` (no `status` field, since it never
       got an HTTP response at all) means the browser couldn't reach the API
       — e.g. the backend is still finishing its startup after a reboot.
       Retry quietly instead of dumping a scary error on the very first load. */
    let connectivityRetryScheduled = false;
    window.addEventListener('unhandledrejection', e => {
        const err = e.reason;
        if (err?.status === 403) {
            Utils.toast('You don\'t have permission to perform this action.', 'error');
        } else if (err?.status >= 500) {
            Utils.toast('Server error. Please try again shortly.', 'error');
        } else if (!err?.status && err instanceof TypeError) {
            if (connectivityRetryScheduled) return;
            connectivityRetryScheduled = true;
            Utils.toast('Connecting to server… retrying', 'info');
            setTimeout(() => window.location.reload(), 4000);
        }
    });

    /* ── Config for API base URL ── */
    window.APP_CONFIG = window.APP_CONFIG || {
        apiBase: '/api/v1',
    };

})();
