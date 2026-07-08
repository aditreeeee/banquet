/**
 * Shared nav config for the React-based dashboard pages (index.html,
 * command_center.html). These pages render their own sidebar (distinct from
 * the vanilla-JS Sidebar.render() used elsewhere) because they need React
 * icon components, not the SVG-path icons sidebar.js uses — but the nav
 * structure itself must stay a single source, not copy-pasted per page.
 */
function getDashboardNav(I) {
    return [
        { s:'Dashboard', items:[
            { id:'dashboard',      icon:I.dashboard,   label:'Overview',        href:'index.html', perm:'dashboard:read' },
            { id:'commandCenter',  icon:I.building,    label:'Command Center',  href:'command_center.html', perm:'dashboard:read' },
        ]},
        { s:'Venue Management', items:[
            { id:'halls',     icon:I.home,          label:'Halls',     href:'../halls/index.html', perm:'halls:read' },
            { id:'banquets',  icon:I.building,      label:'Banquets',  href:'../banquets/index.html', perm:'banquets:read' },
        ]},
        { s:'Bookings', items:[
            { id:'bookings',    icon:I.calendar,   label:'All Bookings',  href:'../bookings/index.html', perm:'bookings:read'  },
            { id:'newBooking',  icon:I.calendar,   label:'New Booking',   href:'../bookings/create.html', perm:'bookings:create' },
        ]},
        { s:'Catering & Inventory', items:[
            { id:'masterMenu', icon:I.fileText,      label:'Master Menu', href:'../catering/menu.html', perm:'catering:read'   },
            { id:'inventory',  icon:I.clipboardList, label:'Inventory',   href:'../inventory/index.html', perm:'resources:read' },
        ]},
        { s:'CRM', items:[
            { id:'customers', icon:I.users,         label:'Customers',      href:'../customers/index.html', perm:'customers:read' },
            { id:'leads',     icon:I.clipboardList, label:'Sales Pipeline', href:'../leads/index.html', perm:'leads:read'     },
        ]},
        { s:'Finance', items:[
            { id:'payments',  icon:I.creditCard,    label:'Payments',  href:'../payments/index.html', perm:'payments:read'  },
            { id:'invoices',  icon:I.fileText,      label:'Invoices',  href:'../invoices/index.html', perm:'invoices:read'  },
        ]},
        { s:'Reports', items:[
            { id:'r-bk',      icon:I.clipboardList, label:'Booking Reports',href:'../reports/bookings.html', perm:'reports:read'        },
            { id:'r-occ',     icon:I.calendarDays,  label:'Occupancy',      href:'../reports/occupancy.html', perm:'reports:read'       },
            { id:'r-rev',     icon:I.trendingUp,    label:'Revenue',        href:'../reports/revenue.html', perm:'reports:read'         },
            { id:'r-own',     icon:I.trendingUp,    label:'Owner Analytics',href:'../reports/owner-analytics.html', perm:'reports:read' },
        ]},
        { s:'Administration', items:[
            { id:'users',    icon:I.user,           label:'Users',    href:'../users/index.html', perm:'users:read'    },
            { id:'staff',    icon:I.users,          label:'Staff Management', href:'../staff/index.html', perm:'users:read' },
            { id:'settings', icon:I.settings,       label:'Settings', href:'../settings/index.html', perm:'settings:read' },
        ]},
    ];
}
