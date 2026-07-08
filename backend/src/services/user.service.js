/**
 * User Service — Staff user management
 */
'use strict';

const userRepo  = require('../repositories/user.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { hashPassword } = require('../utils/encryption');
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const logger = require('../utils/logger');

// Frontend only distinguishes active/inactive; any other value (e.g. "suspended",
// which is not a status the schema currently supports) is treated as "no filter"
// rather than fabricating a status that doesn't exist in the data.
const statusToIsActive = (status) => {
    if (status === 'active')   return true;
    if (status === 'inactive') return false;
    return null;
};

// Adds UI-facing derived fields on top of the raw repository row without
// renaming/losing the underlying DB columns.
const mapUser = (u) => ({
    ...u,
    status:     u.approval_status === 'pending' ? 'pending' : (u.approval_status === 'rejected' ? 'rejected' : (u.is_active ? 'active' : 'inactive')),
    last_login: u.last_login_at || null,
});

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['first_name', 'created_at', 'last_login_at']);
    const branchId = actor.branchId || query.branch_id || null;
    const [{ rows, total }, stats] = await Promise.all([
        userRepo.findAll({
            companyId: actor.companyId,
            branchId,
            roleId:    query.role   ? parseInt(query.role, 10) : null,
            isActive:  statusToIsActive(query.status),
            search:    query.search || null,
            ...p,
        }),
        userRepo.getStats({ companyId: actor.companyId, branchId }),
    ]);
    return { rows: rows.map(mapUser), meta: buildMeta(total, p), stats };
};

const getById = async (id, companyId) => {
    const u = await userRepo.findById(id, companyId);
    if (!u) throw new NotFoundError('User');
    const roles = await userRepo.findRoles(id);
    return { ...mapUser(u), role_ids: roles.map(r => r.role_id) };
};

const create = async (data, actor) => {
    const existing = await userRepo.findByEmail(data.email, actor.companyId);
    if (existing) throw new ConflictError('A user with this email already exists');

    // The add-user form submits snake_case fields (first_name, role_id,
    // branch_id); the repository expects camelCase. See update() for the
    // same mapping requirement. role_ids (array) is optional — when omitted,
    // the user is assigned just their single role_id.
    const passwordHash = await hashPassword(data.password || Math.random().toString(36).slice(2) + 'Aa1!');
    const user = await userRepo.create({
        companyId: actor.companyId,
        firstName: data.firstName ?? data.first_name,
        lastName:  data.lastName  ?? data.last_name,
        email:     data.email,
        phone:     data.phone,
        roleId:    data.roleId    ?? data.role_id,
        roleIds:   data.roleIds   ?? data.role_ids,
        branchId:  data.branchId  ?? data.branch_id,
        assignedBy: actor.userId,
    }, passwordHash);

    logger.info('User created', { newUserId: user.user_id, createdBy: actor.userId });
    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'user.created',
        entityType: 'user',
        entityId:   user.user_id,
        description: `User ${user.email} created`,
        newValues:  { role_id: user.role_id, role_ids: data.roleIds ?? data.role_ids ?? [user.role_id] },
    });
    return mapUser(user);
};

const update = async (id, data, actor) => {
    const existing = await userRepo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('User');

    // Prevent demoting/modifying super_admin unless you are one
    if (existing.role_slug === 'super_admin' && actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Cannot modify a Super Admin account');
    }

    // The edit form submits snake_case fields (first_name, role_id, branch_id,
    // status); the repository expects camelCase (firstName, roleId, branchId,
    // isActive). Without this mapping every field silently no-ops because
    // ISNULL(@undefinedParam, column) just keeps the existing value.
    const mapped = {
        firstName: data.firstName ?? data.first_name,
        lastName:  data.lastName  ?? data.last_name,
        phone:     data.phone,
        branchId:  data.branchId  ?? data.branch_id,
        roleId:    data.roleId    ?? data.role_id,
        roleIds:   data.roleIds   ?? data.role_ids,
        isActive:  data.isActive != null ? data.isActive : statusToIsActive(data.status),
        assignedBy: actor.userId,
    };

    const roleChangeRequested = mapped.roleId || (mapped.roleIds && mapped.roleIds.length);
    const beforeRoleIds = roleChangeRequested ? (await userRepo.findRoles(id)).map(r => r.role_id) : null;

    const updated = await userRepo.update(id, actor.companyId, mapped);
    if (roleChangeRequested) {
        await auditLogRepo.log({
            companyId:  actor.companyId,
            userId:     actor.userId,
            action:     'role.assigned',
            entityType: 'user',
            entityId:   id,
            description: `Roles updated for ${updated.email}`,
            oldValues:  { role_ids: beforeRoleIds },
            newValues:  { role_ids: mapped.roleIds && mapped.roleIds.length ? mapped.roleIds : [mapped.roleId] },
        });
    }
    return mapUser(updated);
};

const getRoles = async () => userRepo.getRoles();

const getPending = async (actor) => (await userRepo.findPending(actor.companyId)).map(mapUser);

const approve = async (id, actor) => {
    const existing = await userRepo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('User');
    if (existing.approval_status !== 'pending') throw new ConflictError('This account is not pending approval');

    const updated = await userRepo.setApprovalStatus(id, actor.companyId, 'approved');
    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'user.approved',
        entityType: 'user',
        entityId:   id,
        description: `Registration approved for ${updated.email}`,
    });
    return mapUser(updated);
};

const reject = async (id, actor) => {
    const existing = await userRepo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('User');
    if (existing.approval_status !== 'pending') throw new ConflictError('This account is not pending approval');

    const updated = await userRepo.setApprovalStatus(id, actor.companyId, 'rejected');
    await auditLogRepo.log({
        companyId:  actor.companyId,
        userId:     actor.userId,
        action:     'user.rejected',
        entityType: 'user',
        entityId:   id,
        description: `Registration rejected for ${updated.email}`,
    });
    return mapUser(updated);
};

const toggleStatus = async (id, actor) => {
    const existing = await userRepo.findById(id, actor.companyId);
    if (!existing) throw new NotFoundError('User');
    if (existing.role_slug === 'super_admin' && actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Cannot modify a Super Admin account');
    }
    const newStatus = existing.is_active ? 0 : 1;
    return mapUser(await userRepo.update(id, actor.companyId, { isActive: newStatus }));
};

module.exports = { getAll, getById, create, update, toggleStatus, getRoles, getPending, approve, reject };
