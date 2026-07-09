/**
 * Booking Package Service
 */
'use strict';

const repo = require('../repositories/bookingPackage.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const CATEGORIES = ['corporate', 'social'];
const CALC_TYPES = ['hourly', 'half_day', 'full_day', 'fixed_session'];

const validate = (data, { partial = false } = {}) => {
    if (!partial || data.packageCategory !== undefined) {
        if (!CATEGORIES.includes(data.packageCategory)) {
            throw new ValidationError(`packageCategory must be one of: ${CATEGORIES.join(', ')}`);
        }
    }
    if (!partial || data.calcType !== undefined) {
        if (!CALC_TYPES.includes(data.calcType)) {
            throw new ValidationError(`calcType must be one of: ${CALC_TYPES.join(', ')}`);
        }
    }
    if (data.calcType === 'hourly' && !data.includedHours && !partial) {
        throw new ValidationError('includedHours is required for hourly packages');
    }
};

const list = (companyId, query = {}) => repo.listPackages(companyId, {
    category: query.category || null,
    isActive: query.is_active != null ? query.is_active === 'true' : null,
});

const getById = async (packageId, companyId) => {
    const pkg = await repo.findPackageById(packageId, companyId);
    if (!pkg) throw new NotFoundError('Booking package');
    return pkg;
};

const create = async (data, actor) => {
    if (!data.packageName) throw new ValidationError('packageName is required');
    validate(data);

    const pkg = await repo.createPackage({ ...data, companyId: actor.companyId });

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'booking_package.created', entityType: 'booking_package', entityId: pkg.package_id,
        description: `Booking package "${pkg.package_name}" created`,
        newValues: { base_price: pkg.base_price, calc_type: pkg.calc_type },
    });

    return pkg;
};

const update = async (packageId, data, actor) => {
    const existing = await getById(packageId, actor.companyId);
    validate(data, { partial: true });
    const updated = await repo.updatePackage(packageId, actor.companyId, data);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'booking_package.updated', entityType: 'booking_package', entityId: packageId,
        description: `Booking package "${existing.package_name}" updated`,
    });

    return updated;
};

const setActive = async (packageId, isActive, actor) => {
    const existing = await getById(packageId, actor.companyId);
    const updated = await repo.setPackageActive(packageId, actor.companyId, isActive);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: isActive ? 'booking_package.activated' : 'booking_package.deactivated',
        entityType: 'booking_package', entityId: packageId,
        description: `Booking package "${existing.package_name}" ${isActive ? 'activated' : 'deactivated'}`,
    });

    return updated;
};

/** Soft-delete — same pattern as Halls/Banquets/Users/Companies. Blocked while any non-terminal booking still references the package. */
const remove = async (packageId, actor) => {
    const existing = await getById(packageId, actor.companyId);
    const activeBookings = await repo.countActiveBookings(packageId, actor.companyId);
    if (activeBookings > 0) {
        throw new ValidationError(
            `Cannot delete package "${existing.package_name}" — it is used by ${activeBookings} active booking(s).`
        );
    }
    await repo.softDelete(packageId, actor.companyId);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'booking_package.deleted', entityType: 'booking_package', entityId: packageId,
        description: `Booking package "${existing.package_name}" deleted`,
    });
};

module.exports = { list, getById, create, update, setActive, remove, CATEGORIES, CALC_TYPES };
