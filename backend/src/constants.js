/**
 * Application-wide constants
 * Single source of truth for permission keys, status values, pagination defaults.
 * All values must match what is seeded in the Permissions table.
 */

'use strict';

// ─── Pagination ────────────────────────────────────────────────────────────────
const PAGINATION = {
    DEFAULT_PAGE:  1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT:     100,
};

// ─── Booking status values ─────────────────────────────────────────────────────
const BOOKING_STATUS = {
    DRAFT:        'draft',
    TENTATIVE:    'tentative',
    CONFIRMED:    'confirmed',
    ADVANCE_PAID: 'advance_paid',
    FULLY_PAID:   'fully_paid',
    COMPLETED:    'completed',
    ARCHIVED:     'archived',
    CANCELLED:    'cancelled',
    NO_SHOW:      'no_show',
};

// ─── Permission keys (must match permission_key column in Permissions table) ───
const PERMISSIONS = {
    // Dashboard
    DASHBOARD_READ:       'dashboard:read',

    // Companies
    COMPANIES_CREATE:     'companies:create',
    COMPANIES_READ:       'companies:read',
    COMPANIES_UPDATE:     'companies:update',
    COMPANIES_DELETE:     'companies:delete',

    // Branches
    BRANCHES_CREATE:      'branches:create',
    BRANCHES_READ:        'branches:read',
    BRANCHES_UPDATE:      'branches:update',
    BRANCHES_DELETE:      'branches:delete',

    // Banquets
    BANQUETS_CREATE:      'banquets:create',
    BANQUETS_READ:        'banquets:read',
    BANQUETS_UPDATE:      'banquets:update',
    BANQUETS_DELETE:      'banquets:delete',

    // Halls
    HALLS_CREATE:         'halls:create',
    HALLS_READ:           'halls:read',
    HALLS_UPDATE:         'halls:update',
    HALLS_DELETE:         'halls:delete',

    // Bookings
    BOOKINGS_CREATE:      'bookings:create',
    BOOKINGS_READ:        'bookings:read',
    BOOKINGS_UPDATE:      'bookings:update',
    BOOKINGS_CANCEL:      'bookings:cancel',
    BOOKINGS_CONFIRM:     'bookings:confirm',

    // Customers
    CUSTOMERS_CREATE:     'customers:create',
    CUSTOMERS_READ:       'customers:read',
    CUSTOMERS_UPDATE:     'customers:update',
    CUSTOMERS_DELETE:     'customers:delete',

    // Payments
    PAYMENTS_CREATE:      'payments:create',
    PAYMENTS_READ:        'payments:read',
    PAYMENTS_REFUND:      'payments:refund',

    // Invoices
    INVOICES_CREATE:      'invoices:create',
    INVOICES_READ:        'invoices:read',
    INVOICES_SEND:        'invoices:send',

    // Reports
    REPORTS_READ:         'reports:read',
    REPORTS_EXPORT:       'reports:export',

    // Users
    USERS_CREATE:         'users:create',
    USERS_READ:           'users:read',
    USERS_UPDATE:         'users:update',
    USERS_DELETE:         'users:delete',

    // Settings
    SETTINGS_READ:        'settings:read',
    SETTINGS_UPDATE:      'settings:update',

    // Audit logs
    AUDIT_LOGS_READ:      'audit_logs:read',

    // Resources / inventory
    RESOURCES_CREATE:     'resources:create',
    RESOURCES_READ:       'resources:read',
    RESOURCES_UPDATE:     'resources:update',

    // Availability calendar
    AVAILABILITY_READ:    'availability:read',
    AVAILABILITY_MANAGE:  'availability:manage',

    // Pricing
    PRICING_CREATE:       'pricing:create',
    PRICING_READ:         'pricing:read',
    PRICING_UPDATE:       'pricing:update',

    // Coupons
    COUPONS_CREATE:       'coupons:create',
    COUPONS_READ:         'coupons:read',
    COUPONS_UPDATE:       'coupons:update',

    // Catering
    CATERING_READ:        'catering:read',
    CATERING_CREATE:      'catering:create',
    CATERING_UPDATE:      'catering:update',

    // Notifications
    NOTIFICATIONS_READ:   'notifications:read',
    NOTIFICATIONS_MANAGE: 'notifications:manage',

    // Sales pipeline / leads
    LEADS_READ:           'leads:read',
    LEADS_CREATE:         'leads:create',
    LEADS_UPDATE:         'leads:update',

    // Marketing automation
    MARKETING_READ:       'marketing:read',
    MARKETING_SEND:       'marketing:send',
};

// ─── Payment status / types ────────────────────────────────────────────────────
const PAYMENT_STATUS = {
    PENDING:   'pending',
    COMPLETED: 'completed',
    FAILED:    'failed',
    REFUNDED:  'refunded',
};

const PAYMENT_TYPE = {
    ADVANCE:   'advance',
    PARTIAL:   'partial',
    FULL:      'full',
    REFUND:    'refund',
};

// ─── Role slugs ────────────────────────────────────────────────────────────────
const USER_ROLES = {
    SUPER_ADMIN:         'super_admin',
    COMPANY_ADMIN:       'company_admin',
    BRANCH_MANAGER:      'branch_manager',
    BOOKING_EXECUTIVE:   'booking_executive',
    CUSTOMER:            'customer',
    BUSINESS_OWNER:      'business_owner',
    OPERATIONS_MANAGER:  'operations_manager',
    SALES_MANAGER:       'sales_manager',
    FINANCE_MANAGER:     'finance_manager',
    STAFF:               'staff',
    RECEPTIONIST:        'receptionist',
};

// ─── Cache TTL (seconds) ───────────────────────────────────────────────────────
const CACHE_TTL = {
    DASHBOARD:   300,   // 5 minutes
    REPORTS:     600,   // 10 minutes
    PERMISSIONS: 300,   // 5 minutes
    SETTINGS:    900,   // 15 minutes
};

module.exports = {
    PAGINATION,
    BOOKING_STATUS,
    PERMISSIONS,
    PAYMENT_STATUS,
    PAYMENT_TYPE,
    USER_ROLES,
    CACHE_TTL,
};
