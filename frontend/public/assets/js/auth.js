/**
 * AUTH — Banquet Hall Booking System
 * Manages session state, role checks, login/logout
 */

const Auth = (() => {
    'use strict';

    // Set true only for UI prototyping; false enforces real JWT auth
    const SKIP_AUTH = false;

    const USER_KEY  = 'bnq_user';
    const THEME_KEY = 'bnq_theme';

    /* ── Storage ── */
    // NOTE: DEMO_USER is defined later in populateUserUI scope; forward-ref resolved at call time
    function getUser() {
        try {
            const stored = JSON.parse(localStorage.getItem(USER_KEY));
            if (stored) return stored;
            // In demo mode return a Super Admin stub so role checks pass everywhere
            if (SKIP_AUTH) {
                return { user_id:1, first_name:'Suresh', last_name:'Mehta', email:'suresh@banquetpro.in', role_id:1, role_slug:'super_admin', company_id:1, branch_id:null, permissions:[] };
            }
            return null;
        } catch { return null; }
    }
    function setUser(user)    { localStorage.setItem(USER_KEY, JSON.stringify(user)); }
    function clearUser()      { localStorage.removeItem(USER_KEY); }

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
        if (SKIP_AUTH) return true;
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

    function redirectToLogin() {
        clearUser();
        API.clearToken();
        window.location.href = resolvePage('auth/login.html');
    }

    function getDefaultPage() {
        const role = getRole();
        if (role === ROLES.CUSTOMER) return resolvePage('dashboard/index.html');
        return resolvePage('dashboard/index.html');
    }

    /* ── Login ── */
    async function login(email, password, remember = false) {
        const res  = await API.auth.login(email, password);
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
        });
        return data;
    }

    /* ── Logout ── */
    async function logout() {
        try { await API.auth.logout(); } catch (_) { /* ignore */ }
        clearUser();
        API.clearToken();
        window.location.href = resolvePage('auth/login.html');
    }

    /* ── Refresh user profile ── */
    async function refreshUser() {
        try {
            const res  = await API.auth.me();
            const data = res.data;
            const cur  = getUser() || {};
            setUser({ ...cur, ...data.user, permissions: data.permissions });
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
    const DEMO_USER = {
        user_id: 1, first_name: 'Suresh', last_name: 'Mehta',
        email: 'suresh@banquetpro.in', role_id: 1, role_slug: 'super_admin',
        company_id: 1, branch_id: null, avatar_url: null,
        permissions: [],
    };

    function populateUserUI() {
        // In demo mode fall back to the demo user so UI renders correctly
        const user = getUser() || (SKIP_AUTH ? DEMO_USER : null);
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
        requireAuth, requireGuest, requireRole, redirectToLogin, getDefaultPage,
        login, logout, refreshUser,
        getTheme, setTheme, toggleTheme, applyTheme,
        populateUserUI, highlightNav,
    };
})();

window.Auth = Auth;
