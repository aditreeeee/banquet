/**
 * Company (Tenant) Service — platform-level tenant management. Only Super
 * Admin routes call this (see company.routes.js's requireRole guard); it
 * intentionally has no company_id scoping parameter anywhere, mirroring
 * hall.service.js/banquet.service.js's CRUD + soft-delete pattern.
 */
'use strict';

const repo = require('../repositories/company.repository');
const menuItemRepo = require('../repositories/menuItem.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const getAll = async (query) => {
    return repo.findAll({
        search: query.search || null,
        isActive: query.is_active != null ? query.is_active === 'true' : null,
    });
};

const getById = async (id) => {
    const c = await repo.findById(id);
    if (!c) throw new NotFoundError('Company');
    return c;
};

const create = async (data, actor) => {
    if (!data.companyName) throw new ValidationError('companyName is required');
    if (!data.email) throw new ValidationError('email is required');
    if (!data.phone) throw new ValidationError('phone is required');
    if (!data.addressLine1) throw new ValidationError('addressLine1 is required');

    const company = await repo.create({ ...data, createdBy: actor.userId });
    await menuItemRepo.seedDefaultCategories(company.company_id);

    await auditLogRepo.log({
        companyId: null, userId: actor.userId,
        action: 'company.created', entityType: 'company', entityId: company.company_id,
        description: `Tenant "${company.company_name}" created`,
        newValues: { company_name: company.company_name, subscription_plan: company.subscription_plan },
    });

    return company;
};

const update = async (id, data, actor) => {
    const existing = await repo.findById(id);
    if (!existing) throw new NotFoundError('Company');
    const updated = await repo.update(id, data);

    await auditLogRepo.log({
        companyId: null, userId: actor.userId,
        action: 'company.updated', entityType: 'company', entityId: id,
        description: `Tenant "${existing.company_name}" updated`,
    });

    return updated;
};

/** Suspend/activate — distinct from delete, same pattern as every other module's setActive. */
const setActive = async (id, isActive, actor) => {
    const existing = await repo.findById(id);
    if (!existing) throw new NotFoundError('Company');
    await repo.toggleActive(id, isActive);

    await auditLogRepo.log({
        companyId: null, userId: actor.userId,
        action: isActive ? 'company.activated' : 'company.suspended',
        entityType: 'company', entityId: id,
        description: `Tenant "${existing.company_name}" ${isActive ? 'activated' : 'suspended'}`,
    });
};

/** Soft-delete — blocked while the tenant still has any active (non-deleted) user. */
const remove = async (id, actor) => {
    const existing = await repo.findById(id);
    if (!existing) throw new NotFoundError('Company');

    const activeUsers = await repo.countActiveUsers(id);
    if (activeUsers > 0) {
        throw new ValidationError(
            `Cannot delete tenant "${existing.company_name}" — it still has ${activeUsers} active user(s). Deactivate or reassign them first.`
        );
    }

    await repo.softDelete(id);

    await auditLogRepo.log({
        companyId: null, userId: actor.userId,
        action: 'company.deleted', entityType: 'company', entityId: id,
        description: `Tenant "${existing.company_name}" deleted`,
    });
};

module.exports = { getAll, getById, create, update, setActive, remove };
