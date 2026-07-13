/**
 * AUTH — Banquet Hall Booking System
 * Manages session state, role checks, login/logout
 */

const Auth = (() => {
    'use strict';

    const USER_KEY  = 'bnq_user';
    const THEME_KEY = 'bnq_theme';

    /* ── Storage ── */
    function getUser() {
        try {
            return JSON.parse(localStorage.getItem(USER_KEY)) || null;
        } catch { return null; }
    }
    function setUser(user)    { localStorage.setItem(USER_KEY, JSON.stringify(user)); }
    function clearUser()      { localStorage.removeItem(USER_KEY); localStorage.removeItem('bnq_session_started_at'); }

    /* ── Session check ── */
    function isLoggedIn()     { return !!API.getToken() && !!getUser(); }

    /* ── Role constants (match DB seeds) ── */
    const ROLES = {
        SUPER_ADMIN:       'super_admin',
        COMPANY_ADMIN:     'company_admin',
        BRANCH_MANAGER:    'branch_manager',
        BOOKING_EXECUTIVE: 'booking_executive',
        CUSTOMER:          'customer',
    };

    function getRole()        { return getUser()?.role_slug || null; }
    function hasRole(...slugs){ return slugs.includes(getRole()); }
    function isSuperAdmin()   { return getRole() === ROLES.SUPER_ADMIN; }
    function isCustomer()     { return getRole() === ROLES.CUSTOMER; }
    function isAdmin()        { return hasRole(ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN); }
    function isManager()      { return hasRole(ROLES.SUPER_ADMIN, ROLES.COMPANY_ADMIN, ROLES.BRANCH_MANAGER); }

    function hasPermission(key) {
        const user = getUser();
        if (!user) return false;
        if (user.role_slug === ROLES.SUPER_ADMIN) return true;
        return Array.isArray(user.permissions) && user.permissions.includes(key);
    }

    /* ── Navigation guard ── */
    function requireAuth(redirectTo = null) {
        if (!isLoggedIn()) {
            const loginPath = redirectTo || resolvePage('auth/login.html');
            const next = encodeURIComponent(window.location.href);
            window.location.href = `${loginPath}?next=${next}`;
            return false;
        }
        return true;
    }

    function requireGuest(redirectTo = '/dashboard/index.html') {
        if (isLoggedIn()) {
            window.location.href = getDefaultPage();
            return false;
        }
        return true;
    }

    /**
     * Require user to have one of the given role IDs.
     * Accepts an array of role_id numbers, e.g. Auth.requireRole([1, 2])
     * Redirects to dashboard if role not in list.
     */
    function requireRole(roleIds = [], redirectTo = '../dashboard/index.html') {
        if (!requireAuth()) return false;
        const user = getUser();
        if (!roleIds.includes(user?.role_id)) {
            Utils.toast('You do not have permission to view this page.', 'error');
            setTimeout(() => { window.location.href = redirectTo; }, 1200);
            return false;
        }
        return true;
    }

    /**
     * Require the user to hold a given permission key to view this page.
     * Direct-URL protection: pages that gate a whole section (e.g. Users,
     * Settings) should call this instead of/alongside requireAuth().
     */
    function requirePermission(permKey, redirectTo = '../dashboard/index.html') {
        if (!requireAuth()) return false;
        if (!hasPermission(permKey)) {
            Utils.toast('You do not have permission to view this page.', 'error');
            setTimeout(() => { window.location.href = redirectTo; }, 1200);
            return false;
        }
        return true;
    }

    /**
     * Resolve a page path relative to the src/pages/ root.
     * Works regardless of where Live Server is rooted, because all pages
     * sit exactly one directory deep under src/pages/.
     */
    function resolvePage(relativePath) {
        // e.g. relativePath = 'dashboard/index.html'
        // Current page is always .../src/pages/SECTION/file.html
        // Going '../' takes us to .../src/pages/, then append target
        return '../' + relativePath;
    }

    function redirectToLogin(reason = null) {
        if (reason === 'timeout') window.dispatchEvent(new CustomEvent('bnq:session-timeout'));
        clearUser();
        API.clearToken();
        const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : '';
        window.location.href = resolvePage('auth/login.html') + suffix;
    }

    function getDefaultPage() {
        const role = getRole();
        if (role === ROLES.CUSTOMER) return resolvePage('dashboard/index.html');
        return resolvePage('dashboard/index.html');
    }

    /* ── Login ── */
    async function login(email, password, remember = false) {
        const res  = await API.auth.login(email, password, remember);
        const data = res.data;
        // Backend returns camelCase: accessToken (not access_token)
        API.setToken(data.accessToken);
        setUser({
            user_id:     data.user.user_id,
            first_name:  data.user.first_name,
            last_name:   data.user.last_name,
            email:       data.user.email,
            phone:       data.user.phone,
            role_id:     data.user.role_id,
            role_slug:   data.user.role_slug,
            company_id:  data.user.company_id,
            branch_id:   data.user.branch_id,
            avatar_url:  data.user.avatar_url,
            permissions: data.permissions || [],
            roles:       data.roles || [],
        });
        markActivity();
        initSessionManager();
        return data;
    }

    /* ── Logout ──
       reason: 'manual' (default, user-initiated) or 'timeout' (idle/absolute
       session expiry — see initSessionManager below), recorded server-side
       in the audit log and shown to the user on the next login page load. */
    async function logout(reason = 'manual') {
        // Dispatched before anything else so pages get the full listener
        // window to synchronously autosave an in-progress form draft (see
        // formDraft.js) before the redirect below fires.
        if (reason === 'timeout') window.dispatchEvent(new CustomEvent('bnq:session-timeout'));
        try { await API.auth.logout({ reason }); } catch (_) { /* ignore — logout must always succeed locally */ }
        clearUser();
        API.clearToken();
        const suffix = reason === 'timeout' ? '?reason=timeout' : '';
        window.location.href = resolvePage('auth/login.html') + suffix;
    }

    /* ── Refresh user profile ── */
    async function refreshUser() {
        try {
            const res  = await API.auth.me();
            const data = res.data;
            const cur  = getUser() || {};
            setUser({ ...cur, ...data.user, permissions: data.permissions, roles: data.roles || [] });
        } catch (_) { /* silently fail */ }
    }

    /* ── Dark / Light mode ── */
    function getTheme()    { return localStorage.getItem(THEME_KEY) || 'light'; }
    function setTheme(t)   {
        localStorage.setItem(THEME_KEY, t);
        document.documentElement.setAttribute('data-theme', t);
        // Update toggle icon if present
        const icon = document.getElementById('themeIcon');
        if (icon) icon.innerHTML = t === 'dark'
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle;"><path d="M20 15.5A8.5 8.5 0 1 1 8.5 4a7 7 0 0 0 11.5 11.5Z"/></svg>';
    }
    function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }
    function applyTheme()  { setTheme(getTheme()); }

    /* ── Populate UI with user info ── */
    function populateUserUI() {
        const user = getUser();
        if (!user) return;
        const name = `${user.first_name} ${user.last_name}`;

        document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = name);
        document.querySelectorAll('[data-user-email]').forEach(el => el.textContent = user.email);
        document.querySelectorAll('[data-user-role]').forEach(el => el.textContent = Utils.titleCase(user.role_slug));
        document.querySelectorAll('[data-user-avatar]').forEach(el => {
            if (user.avatar_url) {
                el.innerHTML = `<img src="${user.avatar_url}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
            } else {
                el.textContent = Utils.initials(name);
            }
        });

        /* Hide/show role-gated nav items */
        document.querySelectorAll('[data-require-role]').forEach(el => {
            const roles = el.dataset.requireRole.split(',').map(s => s.trim());
            el.style.display = hasRole(...roles) ? '' : 'none';
        });
        document.querySelectorAll('[data-require-perm]').forEach(el => {
            el.style.display = hasPermission(el.dataset.requirePerm) ? '' : 'none';
        });
    }

    /* ── Session manager: proactive refresh + configurable idle timeout +
       absolute session lifetime + a real "Stay Signed In" / "Log Out Now"
       modal — all thresholds come from Settings -> Security (Super-Admin
       editable, see settings.service.js's getSessionPolicy), fetched once at
       init with hardcoded fallbacks so the manager still works if that call
       fails. Session start time is stored in localStorage (not just an
       in-memory variable) so the absolute-lifetime clock survives page
       reloads/navigation within the same login — only a fresh login resets
       it, exactly like the server's own sessionStartedAt JWT claim it mirrors
       (see auth.service.js buildTokenPayload). ── */
    const SESSION_START_KEY = 'bnq_session_started_at';

    const FALLBACK_POLICY = {
        idleTimeoutMinutes: 30,
        absoluteSessionHours: 8,
        warningBeforeLogoutMinutes: 2,
    };

    let policy = { ...FALLBACK_POLICY };
    let lastActivity  = Date.now();
    let warningShown  = false;
    let warningModalInst = null;
    let countdownInterval = null;

    function markActivity() {
        lastActivity = Date.now();
        if (warningShown) dismissIdleWarning();
    }

    function getSessionStartedAt() {
        const raw = localStorage.getItem(SESSION_START_KEY);
        return raw ? parseInt(raw, 10) : Date.now();
    }

    // Not every page loads Bootstrap's JS bundle — the React-based dashboard
    // pages (dashboard/index.html, dashboard/command_center.html) render
    // their own layout and don't include it. Use bootstrap.Modal when
    // available and fall back to a plain fixed-overlay div otherwise, so the
    // warning still works everywhere a user can be idle.
    const hasBootstrapJs = () => typeof window.bootstrap?.Modal === 'function';

    function ensureWarningModal() {
        if (document.getElementById('bnqSessionWarningModal')) return;
        const el = document.createElement('div');
        if (hasBootstrapJs()) {
            el.innerHTML = `
            <div class="modal fade" id="bnqSessionWarningModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
              <div class="modal-dialog modal-dialog-centered modal-sm">
                <div class="modal-content">
                  <div class="modal-header"><h5 class="modal-title">Session ending soon</h5></div>
                  <div class="modal-body">
                    <p style="color:var(--text-secondary, #555)">You'll be signed out due to inactivity in <strong id="bnqSessionCountdown">120</strong>s.</p>
                  </div>
                  <div class="modal-footer">
                    <button type="button" class="btn-ghost" id="bnqLogOutNowBtn">Log Out Now</button>
                    <button type="button" class="btn-primary-brand" id="bnqStaySignedInBtn">Stay Signed In</button>
                  </div>
                </div>
              </div>
            </div>`;
        } else {
            el.innerHTML = `
            <div id="bnqSessionWarningModal" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)">
              <div style="background:#fff;color:#1A2B4A;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:22px 24px;max-width:320px;font:14px/1.5 Inter,sans-serif">
                <h5 style="margin:0 0 10px;font-size:16px;font-weight:700">Session ending soon</h5>
                <p style="margin:0 0 16px">You'll be signed out due to inactivity in <strong id="bnqSessionCountdown">120</strong>s.</p>
                <div style="display:flex;justify-content:flex-end;gap:10px">
                  <button type="button" id="bnqLogOutNowBtn" style="background:none;border:1px solid #ccc;color:#1A2B4A;padding:7px 14px;border-radius:8px;cursor:pointer;font-weight:600">Log Out Now</button>
                  <button type="button" id="bnqStaySignedInBtn" style="background:#C5A059;border:none;color:#1A2B4A;padding:7px 14px;border-radius:8px;cursor:pointer;font-weight:700">Stay Signed In</button>
                </div>
              </div>
            </div>`;
        }
        document.body.appendChild(el);
        document.getElementById('bnqStaySignedInBtn').addEventListener('click', async () => {
            // extend:true tells the server this is an explicit "Stay Signed
            // In" click, not a routine background refresh — it gets its own
            // audit-log entry (user.session_extended) unlike the silent
            // proactive refresh below.
            try { await API.auth.refresh({ extend: true }); } catch (_) { /* fall through to logout on next watchdog tick */ }
            markActivity();
        });
        document.getElementById('bnqLogOutNowBtn').addEventListener('click', () => {
            dismissIdleWarning();
            logout('manual');
        });
    }

    function showIdleWarning(secondsLeft) {
        const alreadyShowing = warningShown;
        warningShown = true;
        ensureWarningModal();
        // Fired once per warning (not every countdown tick) so pages can
        // save an in-progress form as a draft before the forced logout —
        // see formDraft.js. Dispatched here rather than only right before
        // logout() so there's a full warning window (default 2 min) to
        // autosave, not just the instant before redirect.
        if (!alreadyShowing) window.dispatchEvent(new CustomEvent('bnq:session-warning'));
        document.getElementById('bnqSessionCountdown').textContent = secondsLeft;
        if (!warningModalInst) {
            const modalEl = document.getElementById('bnqSessionWarningModal');
            warningModalInst = hasBootstrapJs() ? new bootstrap.Modal(modalEl) : { hide: () => modalEl.remove() };
            if (hasBootstrapJs()) warningModalInst.show();
        }
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const el = document.getElementById('bnqSessionCountdown');
            if (el) el.textContent = Math.max(0, Math.ceil((policy.idleTimeoutMinutes * 60000 - (Date.now() - lastActivity)) / 1000));
        }, 1000);
    }

    function dismissIdleWarning() {
        warningShown = false;
        clearInterval(countdownInterval);
        warningModalInst?.hide();
        warningModalInst = null;
        // hasBootstrapJs()'s modal leaves the element in the DOM (bootstrap
        // owns its lifecycle via fade transitions); the plain fallback path
        // removes it directly in hide(). Either way, drop the stale node so
        // the next warning starts clean rather than double-appending.
        document.getElementById('bnqSessionWarningModal')?.remove();
    }

    async function loadSessionPolicy() {
        try {
            const res = await API.platform.getSessionTimeout();
            policy = { ...FALLBACK_POLICY, ...res.data };
        } catch (_) { /* keep fallback defaults */ }
    }

    async function initSessionManager() {
        if (!isLoggedIn()) return;
        if (!localStorage.getItem(SESSION_START_KEY)) localStorage.setItem(SESSION_START_KEY, String(Date.now()));

        await loadSessionPolicy();

        const idleTimeoutMs   = policy.idleTimeoutMinutes * 60 * 1000;
        const warningMs       = policy.warningBeforeLogoutMinutes * 60 * 1000;
        const absoluteMs      = policy.absoluteSessionHours * 60 * 60 * 1000;
        const proactiveRefreshMs = Math.max(60000, Math.round(idleTimeoutMs * 0.4)); // refresh well inside the idle window while active

        ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt =>
            window.addEventListener(evt, markActivity, { passive: true })
        );

        // Proactive refresh — keeps the access token alive for as long as the
        // user is active, so it never silently expires mid-session.
        setInterval(() => {
            if (!isLoggedIn()) return;
            const idleFor = Date.now() - lastActivity;
            if (idleFor < idleTimeoutMs) {
                API.auth.refresh({ silent: true }).catch(() => { /* try again next cycle */ });
            }
        }, proactiveRefreshMs);

        // Idle + absolute-lifetime watchdog
        setInterval(() => {
            if (!isLoggedIn()) return;

            // Absolute Session Lifetime — hard cap regardless of activity;
            // "Stay Signed In" cannot extend past this (matches the server's
            // own enforcement in authenticate middleware / refreshTokens).
            if (Date.now() - getSessionStartedAt() >= absoluteMs) {
                dismissIdleWarning();
                localStorage.removeItem(SESSION_START_KEY);
                logout('timeout');
                return;
            }

            const idleFor = Date.now() - lastActivity;
            if (idleFor >= idleTimeoutMs) {
                dismissIdleWarning();
                localStorage.removeItem(SESSION_START_KEY);
                logout('timeout');
            } else if (idleFor >= idleTimeoutMs - warningMs) {
                showIdleWarning(Math.ceil((idleTimeoutMs - idleFor) / 1000));
            }
        }, 1000);
    }

    initSessionManager();

    /* ── Active nav link ── */
    function highlightNav() {
        const path = window.location.pathname;
        document.querySelectorAll('.sidebar-link').forEach(link => {
            const href = link.getAttribute('href') || '';
            const match = href && (path.endsWith(href) || path.includes(href.replace(/\/index\.html$/, '')));
            link.classList.toggle('active', match);
        });
    }

    return {
        ROLES,
        getUser, setUser, clearUser,
        isLoggedIn, getRole, hasRole, hasPermission,
        isSuperAdmin, isCustomer, isAdmin, isManager,
        requireAuth, requireGuest, requireRole, requirePermission, redirectToLogin, getDefaultPage,
        login, logout, refreshUser,
        getTheme, setTheme, toggleTheme, applyTheme,
        populateUserUI, highlightNav,
    };
})();

window.Auth = Auth;
