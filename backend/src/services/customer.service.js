/**
 * Customer Service
 */
'use strict';

const repo = require('../repositories/customer.repository');
const reviewRepo = require('../repositories/review.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ConflictError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { resolveBranchScope, resolveCompanyScope } = require('../utils/branchScope');

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['created_at', 'first_name', 'total_bookings', 'total_spend']);
    const branchId = resolveBranchScope(actor, query);
    const companyId = resolveCompanyScope(actor);
    const [{ rows, total }, stats] = await Promise.all([
        repo.findAll({
            companyId,
            branchId,
            search:    query.search   || null,
            source:    query.source   || null,
            isActive:  query.is_active != null ? query.is_active === 'true' : null,
            ...p,
        }),
        repo.getStats({ companyId, branchId }),
    ]);
    return { rows, meta: buildMeta(total, p), stats };
};

const getById = async (id, actor) => {
    const companyId = resolveCompanyScope(actor);
    const c = await repo.findById(id, companyId);
    if (!c) throw new NotFoundError('Customer');
    // customers/detail.html's Reviews tab reads c.reviews — this was never
    // populated before (always undefined -> rendered as "No reviews yet"
    // regardless of whether the customer actually had any).
    c.reviews = await reviewRepo.findByCustomer(id, companyId);
    return c;
};

/**
 * Normalize incoming data: accept both snake_case (frontend) and camelCase (programmatic)
 */
const normalize = (data) => ({
    firstName:      data.firstName      || data.first_name      || null,
    lastName:       data.lastName       || data.last_name        || null,
    email:          data.email                                   || null,
    phone:          data.phone                                   || null,
    alternatePhone: data.alternatePhone || data.alternate_phone  || null,
    address:        data.address                                 || null,
    city:           data.city                                    || null,
    state:          data.state                                   || null,
    notes:          data.notes                                   || null,
    source:         data.source                                  || null,
    branchId:       data.branchId       || data.branch_id        || null,
    isActive:       data.isActive != null ? data.isActive : (data.is_active != null ? data.is_active : null),
});

const create = async (data, actor) => {
    const normalized = normalize(data);
    // Prevent duplicate email per company
    if (normalized.email) {
        const existing = await repo.findByEmail(normalized.email, actor.companyId);
        if (existing) throw new ConflictError('A customer with this email already exists');
    }
    const created = await repo.create({ ...normalized, companyId: actor.companyId });

    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'customer.created',
        entityType: 'customer',
        entityId: created.customer_id,
        description: `Customer "${created.first_name} ${created.last_name}" created`,
        newValues: normalized,
    });

    return created;
};

const update = async (id, data, actor) => {
    const existing = await repo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('Customer');
    const normalized = normalize(data);

    // If email is changing, check for duplicates
    if (normalized.email && normalized.email !== existing.email) {
        const dup = await repo.findByEmail(normalized.email, actor.companyId);
        if (dup && dup.customer_id !== id) {
            throw new ConflictError('A customer with this email already exists');
        }
    }
    const updated = await repo.update(id, actor.companyId, normalized);

    // isActive-only updates come from the deactivate ("delete") route — log
    // that distinctly so the audit trail reads as a deactivation, not a
    // no-op field edit.
    const isDeactivation = normalized.isActive === false && Object.keys(data).length === 1;
    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: isDeactivation ? 'customer.deactivated' : 'customer.updated',
        entityType: 'customer',
        entityId: id,
        description: isDeactivation
            ? `Customer "${existing.first_name} ${existing.last_name}" deactivated`
            : `Customer "${existing.first_name} ${existing.last_name}" updated`,
        oldValues: {
            first_name: existing.first_name, last_name: existing.last_name, email: existing.email,
            phone: existing.phone, is_active: existing.is_active,
        },
        newValues: normalized,
    });

    return updated;
};

const getBookingHistory = async (id, actor, query) => {
    const companyId = resolveCompanyScope(actor);
    const existing = await repo.findById(id, companyId);
    if (!existing) throw new NotFoundError('Customer');

    const p = parsePagination(query, ['event_date']);
    const rows = await repo.getBookingHistory(id, companyId, p);
    return { rows, customer: existing };
};

module.exports = { getAll, getById, create, update, getBookingHistory };
