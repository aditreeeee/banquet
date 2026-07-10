/**
 * Booking Package Repository — company-configurable hall/event rental
 * presets (2 Hours / Half Day / Full Day for corporate events; Breakfast/
 * Lunch/High Tea/Dinner/Reception/Wedding Ceremony/Full Wedding for social
 * events). Mirrors catering.repository.js's company-scoped CRUD shape.
 */
'use strict';

const { executeQuery } = require('../config/database');

const COLUMNS = `
    package_id, company_id, package_name, package_category, calc_type,
    included_hours, base_price, overtime_rate_per_hour, max_extension_hours,
    default_setup_minutes, default_cleanup_minutes, default_cooloff_minutes,
    description, is_active, created_at, updated_at
`;

const listPackages = async (companyId, { category, isActive } = {}) => {
    const where = [
        // NULL companyId means "every tenant" — see resolveCompanyScope in
        // utils/branchScope.js (Super Admin, not impersonating).
        '(@companyId IS NULL OR company_id = @companyId)',
        'deleted_at IS NULL',
        '(@category IS NULL OR package_category = @category)',
        '(@isActive IS NULL OR is_active = @isActive)',
    ].join(' AND ');
    return executeQuery(
        `SELECT ${COLUMNS} FROM BookingPackages WHERE ${where} ORDER BY package_category, base_price`,
        { companyId: companyId || null, category: category || null, isActive: isActive != null ? isActive : null }
    );
};

const findPackageById = async (packageId, companyId) => {
    const rows = await executeQuery(
        `SELECT ${COLUMNS} FROM BookingPackages WHERE package_id = @packageId AND company_id = @companyId AND deleted_at IS NULL`,
        { packageId, companyId }
    );
    return rows[0] || null;
};

const createPackage = async (data) => {
    const result = await executeQuery(
        `INSERT INTO BookingPackages
            (company_id, package_name, package_category, calc_type, included_hours, base_price,
             overtime_rate_per_hour, max_extension_hours,
             default_setup_minutes, default_cleanup_minutes, default_cooloff_minutes,
             description, is_active, created_at, updated_at)
         OUTPUT INSERTED.package_id AS id
         VALUES
            (@companyId, @packageName, @packageCategory, @calcType, @includedHours, @basePrice,
             @overtimeRate, @maxExtensionHours,
             @setupMinutes, @cleanupMinutes, @cooloffMinutes,
             @description, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        {
            companyId: data.companyId,
            packageName: data.packageName,
            packageCategory: data.packageCategory,
            calcType: data.calcType,
            includedHours: data.includedHours != null ? data.includedHours : null,
            basePrice: data.basePrice || 0,
            overtimeRate: data.overtimeRatePerHour || 0,
            maxExtensionHours: data.maxExtensionHours || 0,
            setupMinutes: data.defaultSetupMinutes || 0,
            cleanupMinutes: data.defaultCleanupMinutes || 0,
            cooloffMinutes: data.defaultCooloffMinutes || 0,
            description: data.description || null,
        }
    );
    return findPackageById(result[0].id, data.companyId);
};

const updatePackage = async (packageId, companyId, data) => {
    await executeQuery(
        `UPDATE BookingPackages
         SET package_name            = ISNULL(@packageName,       package_name),
             package_category        = ISNULL(@packageCategory,   package_category),
             calc_type               = ISNULL(@calcType,          calc_type),
             included_hours          = ISNULL(@includedHours,     included_hours),
             base_price              = ISNULL(@basePrice,         base_price),
             overtime_rate_per_hour  = ISNULL(@overtimeRate,      overtime_rate_per_hour),
             max_extension_hours     = ISNULL(@maxExtensionHours, max_extension_hours),
             default_setup_minutes   = ISNULL(@setupMinutes,      default_setup_minutes),
             default_cleanup_minutes = ISNULL(@cleanupMinutes,    default_cleanup_minutes),
             default_cooloff_minutes = ISNULL(@cooloffMinutes,    default_cooloff_minutes),
             description             = ISNULL(@description,       description),
             updated_at              = SYSUTCDATETIME()
         WHERE package_id = @packageId AND company_id = @companyId`,
        {
            packageId, companyId,
            packageName: data.packageName || null,
            packageCategory: data.packageCategory || null,
            calcType: data.calcType || null,
            includedHours: data.includedHours != null ? data.includedHours : null,
            basePrice: data.basePrice != null ? data.basePrice : null,
            overtimeRate: data.overtimeRatePerHour != null ? data.overtimeRatePerHour : null,
            maxExtensionHours: data.maxExtensionHours != null ? data.maxExtensionHours : null,
            setupMinutes: data.defaultSetupMinutes != null ? data.defaultSetupMinutes : null,
            cleanupMinutes: data.defaultCleanupMinutes != null ? data.defaultCleanupMinutes : null,
            cooloffMinutes: data.defaultCooloffMinutes != null ? data.defaultCooloffMinutes : null,
            description: data.description != null ? data.description : null,
        }
    );
    return findPackageById(packageId, companyId);
};

const setPackageActive = async (packageId, companyId, isActive) => {
    await executeQuery(
        `UPDATE BookingPackages SET is_active = @isActive, updated_at = SYSUTCDATETIME() WHERE package_id = @packageId AND company_id = @companyId`,
        { packageId, companyId, isActive }
    );
    return findPackageById(packageId, companyId);
};

/** Any non-terminal booking still referencing this package blocks deletion — its snapshot columns keep working for past bookings either way, this is just to avoid deleting something actively in use. */
const countActiveBookings = async (packageId, companyId) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS cnt FROM Bookings WHERE package_id = @packageId AND company_id = @companyId AND status NOT IN ('cancelled','completed','archived')`,
        { packageId, companyId }
    );
    return rows[0].cnt;
};

const softDelete = async (packageId, companyId) => {
    await executeQuery(
        `UPDATE BookingPackages SET deleted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE package_id = @packageId AND company_id = @companyId AND deleted_at IS NULL`,
        { packageId, companyId }
    );
};

module.exports = { listPackages, findPackageById, createPackage, updatePackage, setPackageActive, countActiveBookings, softDelete };
