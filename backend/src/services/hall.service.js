/**
 * Hall Service
 */
'use strict';

const repo        = require('../repositories/hall.repository');
const banquetRepo = require('../repositories/banquet.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');

const BLOCK_TYPES = ['maintenance', 'vip_hold', 'emergency_closure', 'blackout'];

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['hall_name', 'capacity', 'base_price', 'created_at']);
    const { rows, total } = await repo.findAll({
        companyId:  actor.companyId,
        branchId:   actor.branchId || query.branch_id || null,
        banquetId:  query.banquet_id ? parseInt(query.banquet_id, 10) : null,
        minCapacity: query.min_capacity ? parseInt(query.min_capacity, 10) : null,
        maxCapacity: query.max_capacity ? parseInt(query.max_capacity, 10) : null,
        hallType:   query.hall_type  || null,
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
    hallCode:            data.hallCode           || data.hall_code           || null,
    banquetId:           data.banquetId          || data.banquet_id          || null,
    description:         data.description                                     || null,
    hallType:            data.hallType           || data.hall_type            || null,
    capacity:            data.capacity           || data.capacity_seated      || null,
    capacitySeated:      data.capacitySeated     || data.capacity_seated      || null,
    capacityStanding:    data.capacityStanding   || data.capacity_standing    || null,
    capacityTheatre:     data.capacityTheatre    || data.capacity_theatre     || null,
    hasAc:               data.hasAc              ?? data.has_ac              ?? null,
    hasStage:            data.hasStage           ?? data.has_stage           ?? null,
    hasPowerBackup:      data.hasPowerBackup     ?? data.has_power_backup    ?? null,
    hasKitchen:          data.hasKitchen         ?? data.has_kitchen         ?? null,
    hasParking:          data.hasParking         ?? data.has_parking         ?? null,
    hasWashroom:         data.hasWashroom        ?? data.has_washroom        ?? null,
    hasGreenRoom:        data.hasGreenRoom       ?? data.has_green_room      ?? null,
    hasBridalRoom:       data.hasBridalRoom      ?? data.has_bridal_room     ?? null,
    floorNumber:         data.floorNumber        || data.floor_number         || null,
    areaSqft:            data.areaSqft           || data.area_sqft            || null,
    basePrice:           data.basePrice          || data.base_price           || 0,
    weekendSurchargePct: data.weekendSurchargePct|| data.weekend_multiplier   || 0,
    imageUrl:            data.imageUrl           || data.image_url            || null,
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

    const blockedDates = await repo.getBlockedDates(id, fromDate, toDate, actor.companyId);
    return { hall, blockedDates, fromDate, toDate };
};

/**
 * Owner override — block a hall for maintenance/VIP hold/emergency closure/blackout.
 * Every override is logged to the audit trail.
 */
const block = async (id, data, actor) => {
    const hall = await repo.findById(id, actor.companyId);
    if (!hall) throw new NotFoundError('Hall');

    const blockType = data.blockType || data.block_type || 'maintenance';
    if (!BLOCK_TYPES.includes(blockType)) {
        throw new ValidationError(`blockType must be one of: ${BLOCK_TYPES.join(', ')}`);
    }

    const blockedDate = data.blockedDate || data.blocked_date;
    const startTime    = data.startTime   || data.start_time   || null;
    const endTime      = data.endTime     || data.end_time     || null;
    const reason       = data.reason      || null;

    const result = await repo.blockDate({
        hallId: id,
        companyId: actor.companyId,
        blockedDate, startTime, endTime, blockType, reason,
        blockedBy: actor.userId,
    });

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'hall.blocked',
        entityType: 'hall',
        entityId:   id,
        description: `Hall ${hall.hall_name} blocked (${blockType}) on ${blockedDate}${reason ? `: ${reason}` : ''}`,
        newValues:  { blockType, blockedDate, startTime, endTime, reason },
    });

    return result;
};

const unblock = async (id, blockId, actor) => {
    const hall = await repo.findById(id, actor.companyId);
    if (!hall) throw new NotFoundError('Hall');
    await repo.unblockDate(blockId, id, actor.companyId);

    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'hall.unblocked',
        entityType: 'hall',
        entityId:   id,
        description: `Hall ${hall.hall_name} block ${blockId} removed`,
    });
};

module.exports = { getAll, getById, create, update, setActive, getAvailability, block, unblock };
