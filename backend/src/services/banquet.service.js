/**
 * Banquet Service
 */
'use strict';

const repo = require('../repositories/banquet.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { resolveBranchScope, resolveCompanyScope } = require('../utils/branchScope');

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['banquet_name', 'city', 'created_at']);
    const { rows, total } = await repo.findAll({
        companyId: resolveCompanyScope(actor),
        branchId:  resolveBranchScope(actor, query),
        search:    query.search   || null,
        isActive:  query.is_active != null ? query.is_active === 'true' : null,
        ...p,
    });
    return { rows, meta: buildMeta(total, p) };
};

const getById = async (id, companyId) => {
    const b = await repo.findById(id, companyId);
    if (!b) throw new NotFoundError('Banquet');
    return b;
};

/**
 * Normalize incoming data: accept both snake_case (frontend) and camelCase (programmatic)
 */
const normalize = (data) => ({
    banquetName:  data.banquetName  || data.banquet_name || data.name || null,
    description:  data.description                                    || null,
    address:      data.address                                        || null,
    city:         data.city                                           || null,
    state:        data.state                                          || null,
    pincode:      data.pincode                                        || null,
    gstNumber:    data.gstNumber    || data.gst_number                 || null,
    phone:        data.phone                                          || null,
    email:        data.email                                          || null,
    imageUrl:     data.imageUrl     || data.image_url                  || null,
    totalCapacity: data.totalCapacity || data.total_capacity           || null,
    branchId:     data.branchId     || data.branch_id                 || null,
    // Frontend uses a 3-way status dropdown (active/inactive/maintenance) but the
    // schema only has a boolean is_active — "maintenance" is treated as active
    // (still bookable) since there's no separate maintenance flag on Banquets.
    isActive:     data.isActive     ?? data.is_active ?? (data.status ? data.status !== 'inactive' : null),
});

const create = async (data, actor) => {
    const normalized = normalize(data);

    if (!normalized.branchId) {
        throw new ValidationError('branch_id is required');
    }
    if (!normalized.address) {
        throw new ValidationError('address is required');
    }

    return repo.create({ ...normalized, companyId: actor.companyId });
};

const update = async (id, data, actor) => {
    const existing = await repo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('Banquet');
    return repo.update(id, actor.companyId, normalize(data));
};

const setActive = async (id, isActive, actor) => {
    const existing = await repo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('Banquet');
    await repo.toggleActive(id, actor.companyId, isActive);
};

/**
 * Soft-delete — distinct from deactivate. See hall.service.js:remove for the
 * same pattern. Blocked while any hall still exists under this banquet
 * (delete/reassign halls first) — that transitively guarantees no active
 * bookings are orphaned either, since a hall itself can't be deleted while
 * it has active bookings.
 */
const remove = async (id, actor) => {
    const existing = await repo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('Banquet');

    const activeHalls = await repo.countActiveHalls(id, actor.companyId);
    if (activeHalls > 0) {
        throw new ValidationError(
            `Cannot delete banquet "${existing.banquet_name}" — it still has ${activeHalls} hall(s). Delete or reassign them first.`
        );
    }

    await repo.softDelete(id, actor.companyId);

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'banquet.deleted',
        entityType: 'banquet',
        entityId:   id,
        description: `Banquet ${existing.banquet_name} deleted`,
        oldValues:  { banquet_name: existing.banquet_name },
    });
};

module.exports = { getAll, getById, create, update, setActive, remove };
