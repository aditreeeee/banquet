/**
 * User Service — Staff user management
 */
'use strict';

const userRepo  = require('../repositories/user.repository');
const { hashPassword } = require('../utils/encryption');
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const logger = require('../utils/logger');

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['first_name', 'created_at', 'last_login_at']);
    const { rows, total } = await userRepo.findAll({
        companyId: actor.companyId,
        branchId:  actor.branchId || query.branch_id || null,
        roleId:    query.role_id  ? parseInt(query.role_id, 10) : null,
        isActive:  query.is_active != null ? query.is_active === 'true' : null,
        search:    query.search   || null,
        ...p,
    });
    return { rows, meta: buildMeta(total, p) };
};

const getById = async (id, companyId) => {
    const u = await userRepo.findById(id, companyId);
    if (!u) throw new NotFoundError('User');
    return u;
};

const create = async (data, actor) => {
    const existing = await userRepo.findByEmail(data.email, actor.companyId);
    if (existing) throw new ConflictError('A user with this email already exists');

    const passwordHash = await hashPassword(data.password || Math.random().toString(36).slice(2) + 'Aa1!');
    const user = await userRepo.create({ ...data, companyId: actor.companyId }, passwordHash);

    logger.info('User created', { newUserId: user.user_id, createdBy: actor.userId });
    return user;
};

const update = async (id, data, actor) => {
    const existing = await userRepo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('User');

    // Prevent demoting/modifying super_admin unless you are one
    if (existing.role_slug === 'super_admin' && actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Cannot modify a Super Admin account');
    }

    return userRepo.update(id, actor.companyId, data);
};

const getRoles = async () => userRepo.getRoles();

const toggleStatus = async (id, actor) => {
    const existing = await userRepo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('User');
    if (existing.role_slug === 'super_admin' && actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Cannot modify a Super Admin account');
    }
    const newStatus = existing.is_active ? 0 : 1;
    return userRepo.update(id, actor.companyId, { isActive: newStatus });
};

module.exports = { getAll, getById, create, update, toggleStatus, getRoles };
