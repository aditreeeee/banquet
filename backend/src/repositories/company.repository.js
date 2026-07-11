/**
 * Company (Tenant) Repository — platform-level, no company_id scoping by
 * design: this is the one module that operates ABOVE the tenant boundary
 * (only Super Admin routes ever call it). Every other repository in this
 * codebase scopes by company_id; this one manages the Companies rows
 * themselves.
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT company_id, company_name, company_slug, legal_name, gst_number, pan_number,
           registration_no, logo_url, website, email, phone, alternate_phone,
           address_line1, address_line2, city_id, state_id, country_id, pincode,
           currency_code, timezone, date_format,
           subscription_plan, subscription_expiry, max_branches, max_banquets,
           is_active, is_verified, created_at, updated_at,
           (SELECT COUNT(*) FROM Users u WHERE u.company_id = c.company_id AND u.deleted_at IS NULL) AS user_count,
           (SELECT COUNT(*) FROM Banquets b WHERE b.company_id = c.company_id AND b.deleted_at IS NULL) AS banquet_count,
           (SELECT COUNT(*) FROM Halls h WHERE h.company_id = c.company_id AND h.deleted_at IS NULL) AS hall_count,
           (SELECT COUNT(*) FROM Bookings bk WHERE bk.company_id = c.company_id) AS booking_count
    FROM Companies c
`;

const slugify = (name) =>
    (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 180) + '-' + Date.now().toString(36);

const findAll = async ({ search, isActive } = {}) => {
    const where = [
        'c.deleted_at IS NULL',
        `(@search IS NULL OR c.company_name LIKE CONCAT('%', @search, '%') OR c.email LIKE CONCAT('%', @search, '%'))`,
        '(@isActive IS NULL OR c.is_active = @isActive)',
    ].join(' AND ');
    return executeQuery(
        `${BASE_SELECT} WHERE ${where} ORDER BY c.company_name`,
        { search: search || null, isActive: isActive != null ? isActive : null }
    );
};

const findById = async (companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE c.company_id = @id AND c.deleted_at IS NULL`,
        { id: companyId }
    );
    return rows[0] || null;
};

const create = async (data) => {
    const result = await executeQuery(
        `INSERT INTO Companies
            (company_name, company_slug, legal_name, gst_number, pan_number, registration_no,
             logo_url, website, email, phone, alternate_phone,
             address_line1, address_line2, city_id, state_id, country_id, pincode,
             currency_code, timezone, date_format, subscription_plan, subscription_expiry,
             max_branches, max_banquets, is_active, is_verified, created_at, updated_at, created_by)
         OUTPUT INSERTED.company_id AS id
         VALUES
            (@name, @slug, @legalName, @gstNumber, @panNumber, @registrationNo,
             @logoUrl, @website, @email, @phone, @altPhone,
             @addressLine1, @addressLine2, @cityId, @stateId, @countryId, @pincode,
             @currencyCode, @timezone, @dateFormat, @subscriptionPlan, @subscriptionExpiry,
             @maxBranches, @maxBanquets, @isActive, @isVerified, GETUTCDATE(), GETUTCDATE(), @createdBy)`,
        {
            name: data.companyName,
            slug: data.companySlug || slugify(data.companyName),
            legalName: data.legalName || null,
            gstNumber: data.gstNumber || null,
            panNumber: data.panNumber || null,
            registrationNo: data.registrationNo || null,
            logoUrl: data.logoUrl || null,
            website: data.website || null,
            email: data.email,
            phone: data.phone,
            altPhone: data.alternatePhone || null,
            addressLine1: data.addressLine1,
            addressLine2: data.addressLine2 || null,
            cityId: data.cityId || null,
            stateId: data.stateId || null,
            countryId: data.countryId || 1,
            pincode: data.pincode || null,
            currencyCode: data.currencyCode || 'INR',
            timezone: data.timezone || 'Asia/Kolkata',
            dateFormat: data.dateFormat || 'DD/MM/YYYY',
            subscriptionPlan: data.subscriptionPlan || 'basic',
            subscriptionExpiry: data.subscriptionExpiry ? new Date(data.subscriptionExpiry) : null,
            maxBranches: data.maxBranches || 1,
            maxBanquets: data.maxBanquets || 5,
            isActive: data.isActive != null ? !!data.isActive : true,
            isVerified: data.isVerified != null ? !!data.isVerified : false,
            createdBy: data.createdBy || null,
        }
    );
    return findById(result[0].id);
};

const update = async (companyId, data) => {
    await executeQuery(
        `UPDATE Companies
         SET company_name       = ISNULL(@name,           company_name),
             legal_name         = ISNULL(@legalName,       legal_name),
             gst_number         = ISNULL(@gstNumber,       gst_number),
             pan_number         = ISNULL(@panNumber,       pan_number),
             registration_no    = ISNULL(@registrationNo,  registration_no),
             logo_url           = ISNULL(@logoUrl,         logo_url),
             website            = ISNULL(@website,         website),
             email              = ISNULL(@email,           email),
             phone              = ISNULL(@phone,           phone),
             alternate_phone    = ISNULL(@altPhone,        alternate_phone),
             address_line1      = ISNULL(@addressLine1,    address_line1),
             address_line2      = ISNULL(@addressLine2,    address_line2),
             city_id            = ISNULL(@cityId,          city_id),
             state_id           = ISNULL(@stateId,         state_id),
             pincode            = ISNULL(@pincode,         pincode),
             currency_code      = ISNULL(@currencyCode,    currency_code),
             timezone           = ISNULL(@timezone,        timezone),
             date_format        = ISNULL(@dateFormat,      date_format),
             subscription_plan  = ISNULL(@subscriptionPlan, subscription_plan),
             subscription_expiry= ISNULL(@subscriptionExpiry, subscription_expiry),
             max_branches       = ISNULL(@maxBranches,     max_branches),
             max_banquets       = ISNULL(@maxBanquets,     max_banquets),
             is_verified        = ISNULL(@isVerified,      is_verified),
             updated_at         = GETUTCDATE()
         WHERE company_id = @id AND deleted_at IS NULL`,
        {
            id: companyId,
            name: data.companyName || null,
            legalName: data.legalName || null,
            gstNumber: data.gstNumber || null,
            panNumber: data.panNumber || null,
            registrationNo: data.registrationNo || null,
            logoUrl: data.logoUrl || null,
            website: data.website || null,
            email: data.email || null,
            phone: data.phone || null,
            altPhone: data.alternatePhone || null,
            addressLine1: data.addressLine1 || null,
            addressLine2: data.addressLine2 || null,
            cityId: data.cityId || null,
            stateId: data.stateId || null,
            pincode: data.pincode || null,
            currencyCode: data.currencyCode || null,
            timezone: data.timezone || null,
            dateFormat: data.dateFormat || null,
            subscriptionPlan: data.subscriptionPlan || null,
            subscriptionExpiry: data.subscriptionExpiry ? new Date(data.subscriptionExpiry) : null,
            maxBranches: data.maxBranches || null,
            maxBanquets: data.maxBanquets || null,
            isVerified: data.isVerified != null ? !!data.isVerified : null,
        }
    );
    return findById(companyId);
};

const toggleActive = async (companyId, isActive) => {
    await executeQuery(
        `UPDATE Companies SET is_active = @isActive, updated_at = GETUTCDATE() WHERE company_id = @id`,
        { id: companyId, isActive }
    );
};

/** Any non-deleted user still assigned to this tenant blocks deletion. */
const countActiveUsers = async (companyId) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS cnt FROM Users WHERE company_id = @companyId AND deleted_at IS NULL`,
        { companyId }
    );
    return rows[0].cnt;
};

const softDelete = async (companyId) => {
    await executeQuery(
        `UPDATE Companies SET deleted_at = GETUTCDATE(), updated_at = GETUTCDATE() WHERE company_id = @id AND deleted_at IS NULL`,
        { id: companyId }
    );
};

/**
 * Existence + active-status check used to validate a Super-Admin-supplied
 * company_id before it's written onto a user — never trust the frontend
 * value alone (a deleted or deactivated company must never be assignable).
 */
const existsAndActive = async (companyId) => {
    const rows = await executeQuery(
        `SELECT company_id FROM Companies WHERE company_id = @id AND is_active = 1 AND deleted_at IS NULL`,
        { id: companyId }
    );
    return !!rows[0];
};

module.exports = { findAll, findById, create, update, toggleActive, countActiveUsers, softDelete, existsAndActive };
