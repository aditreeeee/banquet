/**
 * Banquet Service
 */
'use strict';

const QRCode = require('qrcode');
const repo = require('../repositories/banquet.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { resolveBranchScope, resolveCompanyScope } = require('../utils/branchScope');

/**
 * The single place a property_token gets turned into a URL — every QR code
 * and future public-facing integration should point here, never at a raw
 * banquet_id. Points at the human-facing /inquiry/:token redirect (see
 * app.js) — a scanned QR code should land a person on the public inquiry
 * page, not a raw JSON API response. That redirect route itself forwards to
 * frontend/src/pages/public/inquiry.html?token=..., which calls the
 * GET /api/v1/public/properties/:token API directly.
 */
const buildPropertyUrl = (token) => {
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    return `${baseUrl}/inquiry/${token}`;
};

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

/**
 * Property Token — Super Admin only (enforced at the route via requireRole,
 * not re-checked here; this service trusts its callers same as every other
 * banquet.service function). companyId is still threaded through so a
 * company-scoped call (were one ever added) can't cross tenants by accident.
 */
const getToken = async (id, companyId) => {
    const row = await repo.getToken(id, companyId);
    if (!row) throw new NotFoundError('Banquet');
    return { propertyToken: row.property_token, isActive: row.is_active, propertyUrl: buildPropertyUrl(row.property_token) };
};

/**
 * Renders the property's QR code as a PNG buffer. Generated on demand from
 * the current token rather than stored — a stored image would go stale the
 * instant the token is regenerated, and PNG encoding a short URL is cheap
 * enough to not need caching.
 */
const getTokenQrCode = async (id, companyId) => {
    const row = await repo.getToken(id, companyId);
    if (!row) throw new NotFoundError('Banquet');
    const url = buildPropertyUrl(row.property_token);
    const buffer = await QRCode.toBuffer(url, { type: 'png', width: 400, margin: 2 });
    return { buffer, url };
};

const regenerateToken = async (id, actor) => {
    const existing = await repo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('Banquet');

    const newToken = await repo.regenerateToken(id, actor.companyId);

    await auditLogRepo.log({
        companyId:  existing.company_id,
        userId:     actor.userId,
        action:     'banquet.property_token_regenerated',
        entityType: 'banquet',
        entityId:   id,
        description: `Property token regenerated for "${existing.banquet_name}" — every previously issued public URL/QR code for this property is now invalid`,
    });

    return { propertyToken: newToken };
};

module.exports = { getAll, getById, create, update, setActive, remove, getToken, getTokenQrCode, regenerateToken };
