/**
 * Hall Service
 */
'use strict';

const repo        = require('../repositories/hall.repository');
const banquetRepo = require('../repositories/banquet.repository');
const { NotFoundError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['hall_name', 'capacity', 'base_price', 'created_at']);
    const { rows, total } = await repo.findAll({
        companyId:  actor.companyId,
        branchId:   actor.branchId || query.branch_id || null,
        banquetId:  query.banquet_id ? parseInt(query.banquet_id, 10) : null,
        minCapacity: query.min_capacity ? parseInt(query.min_capacity, 10) : null,
        maxCapacity: query.max_capacity ? parseInt(query.max_capacity, 10) : null,
        search:     query.search    || null,
        isActive:   query.is_active != null ? query.is_active === 'true' : null,
        ...p,
    });
    return { rows, meta: buildMeta(total, p) };
};

const getById = async (id, companyId) => {
    const h = await repo.findById(id, companyId);
    if (!h) throw new NotFoundError('Hall');
    return h;
};

/**
 * Normalize incoming data: accept both snake_case (frontend) and camelCase (programmatic)
 */
const normalize = (data) => ({
    hallName:            data.hallName           || data.hall_name           || null,
    banquetId:           data.banquetId          || data.banquet_id          || null,
    description:         data.description                                     || null,
    capacity:            data.capacity           || data.capacity_seated      || null,
    floorNumber:         data.floorNumber        || data.floor_number         || null,
    areaSqft:            data.areaSqft           || data.area_sqft            || null,
    basePrice:           data.basePrice          || data.base_price           || 0,
    weekendSurchargePct: data.weekendSurchargePct|| data.weekend_multiplier   || 0,
    branchId:            data.branchId           || data.branch_id            || null,
    isActive:            data.isActive           ?? data.is_active            ?? 1,
});

const create = async (data, actor) => {
    const normalized = normalize(data);
    const banquet = await banquetRepo.findById(parseInt(normalized.banquetId), actor.companyId);
    if (!banquet) throw new NotFoundError('Banquet');
    return repo.create({ ...normalized, companyId: actor.companyId });
};

const update = async (id, data, actor) => {
    const existing = await repo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('Hall');
    return repo.update(id, actor.companyId, normalize(data));
};

const setActive = async (id, isActive, actor) => {
    const existing = await repo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('Hall');
    await repo.toggleActive(id, actor.companyId, isActive);
};

const getAvailability = async (id, query, actor) => {
    const hall = await repo.findById(id, actor.companyId);
    if (!hall) throw new NotFoundError('Hall');

    const fromDate = query.from_date || new Date().toISOString().slice(0, 10);
    const toDate   = query.to_date   || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const blockedDates = await repo.getBlockedDates(id, fromDate, toDate);
    return { hall, blockedDates, fromDate, toDate };
};

const block = async (id, data, actor) => {
    const hall = await repo.findById(id, actor.companyId);
    if (!hall) throw new NotFoundError('Hall');
    return repo.blockDate({
        hallId:      id,
        blockedDate: data.blockedDate || data.blocked_date,
        startTime:   data.startTime   || data.start_time   || null,
        endTime:     data.endTime     || data.end_time     || null,
        reason:      data.reason      || null,
        blockedBy:   actor.userId,
    });
};

const unblock = async (id, blockId, actor) => {
    const hall = await repo.findById(id, actor.companyId);
    if (!hall) throw new NotFoundError('Hall');
    await repo.unblockDate(blockId, id);
};

module.exports = { getAll, getById, create, update, setActive, getAvailability, block, unblock };
