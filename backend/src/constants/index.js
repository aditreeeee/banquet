/**
 * Application Constants
 * Centralized enum values, status codes, and config constants
 */
'use strict';

// ─── Booking Statuses ─────────────────────────────────────────────────────────
const BOOKING_STATUS = Object.freeze({
    DRAFT:          'draft',
    TENTATIVE:      'tentative',
    CONFIRMED:      'confirmed',
    ADVANCE_PAID:   'advance_paid',
    FULLY_PAID:     'fully_paid',
    CANCELLED:      'cancelled',
    COMPLETED:      'completed',
    ARCHIVED:       'archived',
    NO_SHOW:        'no_show',
});

// ─── Payment Statuses ─────────────────────────────────────────────────────────
const PAYMENT_STATUS = Object.freeze({
    PENDING:    'pending',
    COMPLETED:  'completed',
    FAILED:     'failed',
    REFUNDED:   'refunded',
});

// ─── Payment Methods ──────────────────────────────────────────────────────────
const PAYMENT_METHOD = Object.freeze({
    CASH:           'cash',
    CARD:           'card',
    UPI:            'upi',
    BANK_TRANSFER:  'bank_transfer',
    CHEQUE:         'cheque',
    ONLINE:         'online',
});

// ─── Payment Types ────────────────────────────────────────────────────────────
const PAYMENT_TYPE = Object.freeze({
    ADVANCE:        'advance',
    PARTIAL:        'partial',
    FULL:           'full',
    REFUND:         'refund',
    INSTALLMENT:    'installment',
});

// ─── User Roles ───────────────────────────────────────────────────────────────
const USER_ROLES = Object.freeze({
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
});

// ─── OTP Purposes ────────────────────────────────────────────────────────────
const OTP_PURPOSE = Object.freeze({
    EMAIL_VERIFY:   'email_verify',
    PHONE_VERIFY:   'phone_verify',
    PASSWORD_RESET: 'password_reset',
    LOGIN_2FA:      'login_2fa',
});

// ─── Notification Channels ────────────────────────────────────────────────────
const NOTIFICATION_CHANNEL = Object.freeze({
    EMAIL:      'email',
    SMS:        'sms',
    PUSH:       'push',
    WHATSAPP:   'whatsapp',
});

// ─── Permissions ─────────────────────────────────────────────────────────────
const PERMISSIONS = Object.freeze({
    DASHBOARD_READ:         'dashboard:read',
    COMPANIES_CREATE:       'companies:create',
    COMPANIES_READ:         'companies:read',
    COMPANIES_UPDATE:       'companies:update',
    COMPANIES_DELETE:       'companies:delete',
    BANQUETS_CREATE:        'banquets:create',
    BANQUETS_READ:          'banquets:read',
    BANQUETS_UPDATE:        'banquets:update',
    BANQUETS_DELETE:        'banquets:delete',
    HALLS_CREATE:           'halls:create',
    HALLS_READ:             'halls:read',
    HALLS_UPDATE:           'halls:update',
    HALLS_DELETE:           'halls:delete',
    BOOKINGS_CREATE:        'bookings:create',
    BOOKINGS_READ:          'bookings:read',
    BOOKINGS_UPDATE:        'bookings:update',
    BOOKINGS_CANCEL:        'bookings:cancel',
    BOOKINGS_CONFIRM:       'bookings:confirm',
    CUSTOMERS_CREATE:       'customers:create',
    CUSTOMERS_READ:         'customers:read',
    CUSTOMERS_UPDATE:       'customers:update',
    CUSTOMERS_DELETE:       'customers:delete',
    PAYMENTS_CREATE:        'payments:create',
    PAYMENTS_READ:          'payments:read',
    PAYMENTS_REFUND:        'payments:refund',
    INVOICES_CREATE:        'invoices:create',
    INVOICES_READ:          'invoices:read',
    INVOICES_SEND:          'invoices:send',
    REPORTS_READ:           'reports:read',
    REPORTS_EXPORT:         'reports:export',
    PRICING_CREATE:         'pricing:create',
    PRICING_READ:           'pricing:read',
    PRICING_UPDATE:         'pricing:update',
    USERS_CREATE:           'users:create',
    USERS_READ:             'users:read',
    USERS_UPDATE:           'users:update',
    USERS_DELETE:           'users:delete',
    SETTINGS_READ:          'settings:read',
    SETTINGS_UPDATE:        'settings:update',
    AUDIT_LOGS_READ:        'audit_logs:read',
    COUPONS_CREATE:         'coupons:create',
    COUPONS_READ:           'coupons:read',
    COUPONS_UPDATE:         'coupons:update',
    AVAILABILITY_MANAGE:    'availability:manage',
    AVAILABILITY_READ:      'availability:read',
    RESOURCES_CREATE:       'resources:create',
    RESOURCES_READ:         'resources:read',
    RESOURCES_UPDATE:       'resources:update',
});

// ─── Pagination Defaults ──────────────────────────────────────────────────────
const PAGINATION = Object.freeze({
    DEFAULT_PAGE:  1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT:     100,
});

// ─── File Upload ─────────────────────────────────────────────────────────────
const UPLOAD = Object.freeze({
    MAX_SIZE_BYTES:     10 * 1024 * 1024, // 10 MB
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    ALLOWED_DOC_TYPES:   ['application/pdf'],
});

// ─── Cache TTLs (seconds) ─────────────────────────────────────────────────────
const CACHE_TTL = Object.freeze({
    PERMISSIONS:    300,    // 5 min
    AVAILABILITY:    30,    // 30 sec
    PRICING:        600,    // 10 min
    DASHBOARD:       60,    // 1 min
    REPORTS:        300,    // 5 min
});

module.exports = {
    BOOKING_STATUS,
    PAYMENT_STATUS,
    PAYMENT_METHOD,
    PAYMENT_TYPE,
    USER_ROLES,
    OTP_PURPOSE,
    NOTIFICATION_CHANNEL,
    PERMISSIONS,
    PAGINATION,
    UPLOAD,
    CACHE_TTL,
};
