/**
 * Shared Sidebar Component — collapsible accordion navigation.
 * Every non-auth page includes this script and calls Sidebar.render() once
 * Auth/API are available, instead of hand-copying the sidebar markup.
 */
'use strict';

const Sidebar = (() => {
    const ICONS = {
        overview:  '<path d="M4 19V10"></path><path d="M12 19V5"></path><path d="M20 19v-7"></path>',
        command:   '<path d="M3 21h18M5 21V7l7-4 7 4v14"></path><path d="M9 21v-6h6v6"></path>',
        hall:      '<path d="M5 20V9.5A1.5 1.5 0 0 1 6.5 8h11A1.5 1.5 0 0 1 19 9.5V20"></path><path d="M9 20v-4h6v4"></path><path d="M12 8v6"></path>',
        banquet:   '<path d="M4 20V9l8-5 8 5v11"></path><path d="M8 20v-5h8v5"></path><path d="M10 9h4"></path>',
        bookings:  '<rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 9h18"></path>',
        newBooking:'<path d="M12 5v14"></path><path d="M5 12h14"></path>',
        cancelled: '<circle cx="12" cy="12" r="9"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path>',
        menu:      '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"></path><line x1="8" y1="9" x2="16" y2="9"></line><line x1="8" y1="13" x2="16" y2="13"></line>',
        inventory: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"></path><path d="M3 8l9 5 9-5"></path><path d="M12 13v8"></path>',
        decor:     '<path d="M12 3v4"></path><path d="M12 17v4"></path><path d="M3 12h4"></path><path d="M17 12h4"></path><path d="m5.6 5.6 2.8 2.8"></path><path d="m15.6 15.6 2.8 2.8"></path><path d="m18.4 5.6-2.8 2.8"></path><path d="m8.4 15.6-2.8 2.8"></path>',
        customers: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"></path><circle cx="9.5" cy="7" r="3"></circle><path d="M17 8a3 3 0 1 1 0 6"></path><path d="M20 19v-1a2 2 0 0 0-1.4-1.9"></path>',
        pipeline:  '<path d="M4 18 9 13l3 3 8-9"></path><path d="M18 7h3v3"></path>',
        payments:  '<path d="M12 3v18"></path><path d="M16 7H8a3 3 0 1 0 0 6h8a3 3 0 1 1 0 6H8"></path>',
        invoices:  '<path d="M7 3h8l4 4v14H7z"></path><path d="M15 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h4"></path>',
        quotations: '<path d="M17 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z"></path><path d="M9 7h6"></path><path d="M9 11h6"></path><path d="M9 15h4"></path>',
        reports:   '<path d="M4 18 9 13l3 3 8-9"></path><path d="M18 7h3v3"></path>',
        occupancy: '<path d="M4 8.5 12 3l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"></path><path d="M9 21v-6h6v6"></path><path d="M9 10h6"></path>',
        revenue:   '<path d="M12 3v18"></path><path d="M16 7H8a3 3 0 1 0 0 6h8a3 3 0 1 1 0 6H8"></path>',
        analytics: '<path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path>',
        users:     '<circle cx="12" cy="8" r="4"></circle><path d="M4 20a8 8 0 0 1 16 0"></path>',
        staff:     '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
        settings:  '<circle cx="12" cy="12" r="3"></circle><path d="M19 12a7 7 0 0 0-.1-1l2.1-1.6-2-3.5-2.5 1A7 7 0 0 0 15 4.4L14 2h-4l-1 2.4a7 7 0 0 0-1.5 1.5L5 5.9l-2 3.5 2.1 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1L3 14.6l2 3.5 2.5-1a7 7 0 0 0 1.5 1.5l1 2.4h4l1-2.4a7 7 0 0 0 1.5-1.5l2.5 1 2-3.5-2.1-1.6c.1-.3.1-.7.1-1z"></path>',
        chevron:   '<path d="m9 18 6-6-6-6"></path>',
    };
    const svg = (path, size=17) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle">${path}</svg>`;

    // Each leaf needs: label, href, icon, perm (permission key required to see it, or null for always-visible).
    // Groups with a single leaf render as a flat top-level link instead of a 1-item accordion.
    const NAV = [
        { group: 'Dashboard', items: [
            { label: 'Overview',       href: '../dashboard/index.html',          icon: ICONS.overview, perm: 'dashboard:read' },
            { label: 'Command Center', href: '../dashboard/command_center.html', icon: ICONS.command,  perm: 'dashboard:read' },
        ]},
        { group: 'Venue Management', items: [
            { label: 'Halls',    href: '../halls/index.html',    icon: ICONS.hall,    perm: 'halls:read' },
            { label: 'Banquets', href: '../banquets/index.html', icon: ICONS.banquet, perm: 'banquets:read' },
        ]},
        { group: 'Bookings', items: [
            { label: 'All Bookings',  href: '../bookings/index.html',                     icon: ICONS.bookings,   perm: 'bookings:read' },
            { label: 'New Booking',   href: '../bookings/create.html',                    icon: ICONS.newBooking, perm: 'bookings:create' },
        ]},
        { group: 'Catalog & Inventory', items: [
            { label: 'Master Menu',       href: '../catering/menu.html',          icon: ICONS.menu,      perm: 'catering:read' },
            { label: 'Packages & Promotions', href: '../booking-packages/index.html', icon: ICONS.newBooking, perm: 'bookings:read' },
            { label: 'Decorations',       href: '../decorations/index.html',      icon: ICONS.decor,     perm: 'decorations:read' },
            { label: 'Inventory',         href: '../inventory/index.html',        icon: ICONS.inventory, perm: 'resources:read' },
        ]},
        { group: 'CRM', items: [
            { label: 'Customers',     href: '../customers/index.html', icon: ICONS.customers, perm: 'customers:read' },
            { label: 'Sales Pipeline', href: '../leads/index.html',     icon: ICONS.pipeline,  perm: 'leads:read' },
        ]},
        { group: 'Finance', items: [
            { label: 'Payments',    href: '../payments/index.html',    icon: ICONS.payments,   perm: 'payments:read' },
            { label: 'Invoices',    href: '../invoices/index.html',    icon: ICONS.invoices,   perm: 'invoices:read' },
            { label: 'Quotations', href: '../quotations/index.html', icon: ICONS.quotations, perm: 'quotations:read' },
        ]},
        { group: 'Reports', items: [
            { label: 'Booking Reports', href: '../reports/bookings.html',       icon: ICONS.reports,   perm: 'reports:read' },
            { label: 'Occupancy',       href: '../reports/occupancy.html',      icon: ICONS.occupancy, perm: 'reports:read' },
            { label: 'Revenue',         href: '../reports/revenue.html',        icon: ICONS.revenue,   perm: 'reports:read' },
            { label: 'Owner Analytics', href: '../reports/owner-analytics.html',icon: ICONS.analytics, perm: 'reports:read' },
        ]},
        { group: 'Administration', items: [
            { label: 'Users',            href: '../users/index.html',    icon: ICONS.users,    perm: 'users:read' },
            { label: 'Staff Management', href: '../staff/index.html',    icon: ICONS.staff,    perm: 'users:read' },
        ]},
        { group: 'Settings', items: [
            { label: 'Settings',         href: '../settings/index.html', icon: ICONS.settings, perm: 'settings:read' },
        ]},
        { group: 'Platform', items: [
            { label: 'Platform Dashboard', href: '../platform/dashboard.html', icon: ICONS.analytics, perm: 'companies:read' },
            { label: 'Properties',         href: '../platform/tenants.html',   icon: ICONS.banquet,   perm: 'companies:read' },
        ]},
    ];

    const STORAGE_KEY = 'bp_sidebar_expanded';

    const loadExpanded = () => {
        try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
    };
    const saveExpanded = (state) => {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable — non-fatal */ }
    };

    const currentFile = () => location.pathname.split('/').filter(Boolean).slice(-2).join('/');

    const isActiveHref = (href) => {
        // Compare by page + query string so filtered links (e.g. ?status=cancelled) can be
        // distinguished from the base page (e.g. All Bookings) even though both point at index.html.
        const hrefUrl = new URL(href, location.href);
        return hrefUrl.pathname === location.pathname && hrefUrl.search === location.search;
    };

    function render(containerId = 'sidebar') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const expanded = loadExpanded();
        const canSee = (perm) => !perm || (typeof Auth === 'undefined') || Auth.hasPermission(perm);

        let activeGroupIdx = -1;
        const groupsHtml = NAV.map((g, gi) => {
            const visibleItems = g.items.filter(it => canSee(it.perm));
            if (!visibleItems.length) return '';

            const hasActive = visibleItems.some(it => isActiveHref(it.href));
            if (hasActive) activeGroupIdx = gi;
            const isExpanded = expanded[g.group] ?? hasActive;

            // A single-item group (e.g. Settings, promoted out of
            // Administration) is just one destination — a flat top-level
            // link reads better than a 1-item accordion the user has to
            // expand first to reach the only thing inside it.
            if (visibleItems.length === 1) {
                const it = visibleItems[0];
                return `
                <a href="${it.href}" class="sidebar-link ${isActiveHref(it.href) ? 'active' : ''}" data-href="${it.href}">
                    <span class="sidebar-icon">${svg(it.icon)}</span>
                    <span class="sidebar-text">${g.group}</span>
                </a>`;
            }

            const itemsHtml = visibleItems.map(it => `
                <a href="${it.href}" class="sidebar-link nav-child-link ${isActiveHref(it.href) ? 'active' : ''}" data-href="${it.href}">
                    <span class="sidebar-icon">${svg(it.icon, 15)}</span>
                    <span class="sidebar-text">${it.label}</span>
                </a>`).join('');

            return `
            <div class="nav-group" data-group="${g.group}">
                <div class="nav-group-header ${isExpanded ? 'expanded' : ''} ${hasActive ? 'has-active' : ''}" onclick="Sidebar.toggleGroup('${g.group.replace(/'/g,"\\'")}')">
                    <span class="sidebar-icon">${svg(visibleItems[0].icon)}</span>
                    <span class="sidebar-text nav-group-label">${g.group}</span>
                    <span class="nav-group-chevron">${svg(ICONS.chevron, 14)}</span>
                </div>
                <div class="nav-group-children ${isExpanded ? 'expanded' : ''}">
                    ${itemsHtml}
                </div>
            </div>`;
        }).join('');

        container.innerHTML = `
            <a href="../dashboard/index.html" class="sidebar-brand">
                <div class="sidebar-brand-icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M4 8.5 12 3l8 5.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"></path><path d="M9 21v-6h6v6"></path><path d="M9 10h6"></path></svg></div>
                <span class="sidebar-brand-text">BanquetPro</span>
            </a>
            <nav class="sidebar-nav">${groupsHtml}</nav>
            <div class="sidebar-footer">
                <div style="display:flex;align-items:center;gap:10px;padding:8px">
                    <div class="avatar" data-user-avatar style="width:34px;height:34px;font-size:12px"></div>
                    <div class="sidebar-text">
                        <div style="color:white;font-size:13px;font-weight:600" data-user-name></div>
                        <div style="color:rgba(255,255,255,.5);font-size:11px" data-user-role></div>
                    </div>
                </div>
            </div>`;
        // Deliberately synchronous, no DOMContentLoaded wrapper — callers invoke this
        // from an inline <script> placed right after the empty <aside id="sidebar">,
        // so the markup exists before app.js's own DOMContentLoaded handler runs
        // (sidebar toggle wiring, Auth.populateUserUI, Auth.highlightNav).
    }

    function toggleGroup(groupName) {
        const header = document.querySelector(`.nav-group[data-group="${CSS.escape(groupName)}"] .nav-group-header`);
        const children = document.querySelector(`.nav-group[data-group="${CSS.escape(groupName)}"] .nav-group-children`);
        if (!header || !children) return;

        // While collapsed, .nav-group-children is forced display:none by CSS
        // regardless of the .expanded class — toggling it here is a silent
        // no-op with no flyout to fall back on, so a multi-item group's icon
        // was completely unclickable/undirected when collapsed. Navigate to
        // the group's first item instead, same as a single-item group (which
        // renders as a plain link and was never affected by this).
        if (document.getElementById('sidebar')?.classList.contains('collapsed')) {
            const firstLink = children.querySelector('.sidebar-link');
            if (firstLink) window.location.href = firstLink.getAttribute('href');
            return;
        }

        // Read the *actual* current DOM state rather than re-deriving it from storage —
        // storage's "unset" case means "whatever render() decided" (active-group default),
        // which doesn't match a naive true/false fallback here and silently no-ops the
        // first click on a collapsed, never-toggled group.
        const nowExpanded = !header.classList.contains('expanded');
        header.classList.toggle('expanded', nowExpanded);
        children.classList.toggle('expanded', nowExpanded);

        const expanded = loadExpanded();
        expanded[groupName] = nowExpanded;
        saveExpanded(expanded);
    }

    return { render, toggleGroup };
})();
