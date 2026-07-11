/**
 * User Service — Staff user management
 */
'use strict';

const userRepo    = require('../repositories/user.repository');
const companyRepo = require('../repositories/company.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { hashPassword } = require('../utils/encryption');
const { NotFoundError, ConflictError, ForbiddenError, ValidationError } = require('../api/v1/middleware/errorHandler');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { resolveBranchScope, resolveCompanyScope } = require('../utils/branchScope');
const logger = require('../utils/logger');

// Valid status buckets a user can be filtered/displayed by — kept in sync
// with user.repository.js's STATUS_CASE SQL expression and mapUser() below.
const VALID_STATUSES = ['active', 'inactive', 'pending', 'rejected'];
const normalizeStatusFilter = (status) => (VALID_STATUSES.includes(status) ? status : null);

// The edit form's Status field only ever offers active/inactive (approval
// status pending/rejected is managed exclusively via approve()/reject()) —
// any other value is treated as "no change" rather than fabricating one.
const statusToIsActive = (status) => {
    if (status === 'active')   return true;
    if (status === 'inactive') return false;
    return null;
};

/**
 * Resolve and validate the Company/Property + Branch a user is being
 * assigned to. This is the single choke point for organizational
 * assignment — nothing downstream ever writes a company_id/branch_id that
 * didn't pass through here, so there is no path (create, update, or the
 * dedicated reassignCompany flow) that can silently default a user onto a
 * hardcoded tenant.
 *
 * - Super Admin: may assign any Company/Property + Branch, but must supply
 *   it explicitly (companyId required when `requireCompany`); every value
 *   is re-validated server-side against the DB (exists, active, and for
 *   branch — belongs to the chosen company). Frontend values are never
 *   trusted on their own.
 * - Everyone else: locked to their own company (actor.companyId, which
 *   reflects their real Users.company_id — never an impersonation
 *   default). Attempting to send a different company_id is rejected
 *   outright rather than silently ignored, so a tampered request fails
 *   loudly. Branch may still be picked, but only from branches that
 *   belong to that same company.
 *
 * @returns {Promise<{ companyId: number|null, branchId: number|null, branchIdProvided: boolean }>}
 */
const resolveOrgAssignment = async (data, actor, { requireCompany }) => {
    const rawCompanyId = data.companyId ?? data.company_id;
    const rawBranchId  = data.branchId  ?? data.branch_id;
    const branchIdProvided = rawBranchId !== undefined;
    const branchId = branchIdProvided && rawBranchId !== null && rawBranchId !== ''
        ? parseInt(rawBranchId, 10)
        : null;

    if (actor.roleSlug === 'super_admin') {
        const companyIdProvided = rawCompanyId !== undefined && rawCompanyId !== null && rawCompanyId !== '';
        if (!companyIdProvided) {
            if (requireCompany) {
                throw new ValidationError('Company (Property) is required', [
                    { field: 'companyId', message: 'Select the Company/Property this user belongs to' },
                ]);
            }
            // Editing an already-assigned user without changing their company —
            // branch (if supplied) must still belong to their CURRENT company,
            // validated by the caller once it knows that company.
            return { companyId: undefined, branchId, branchIdProvided };
        }

        const companyId = parseInt(rawCompanyId, 10);
        const companyOk = await companyRepo.existsAndActive(companyId);
        if (!companyOk) {
            throw new ValidationError('Selected Company/Property does not exist or is inactive', [
                { field: 'companyId', message: 'Choose an active, existing Company/Property' },
            ]);
        }

        if (branchIdProvided && branchId !== null) {
            const branchOk = await userRepo.branchExistsAndActive(branchId, companyId);
            if (!branchOk) {
                throw new ValidationError('Selected Branch does not exist, is inactive, or does not belong to the selected Company/Property', [
                    { field: 'branchId', message: 'Choose an active branch that belongs to the selected Company/Property' },
                ]);
            }
        }

        return { companyId, branchId, branchIdProvided };
    }

    // Non-super-admin actors can never change a user's Company/Property —
    // reject the attempt instead of silently overwriting it with their own.
    if (rawCompanyId !== undefined && rawCompanyId !== null && rawCompanyId !== '' && parseInt(rawCompanyId, 10) !== actor.companyId) {
        throw new ForbiddenError('Only a Super Admin can assign or change a user\'s Company/Property');
    }

    if (branchIdProvided && branchId !== null) {
        const branchOk = await userRepo.branchExistsAndActive(branchId, actor.companyId);
        if (!branchOk) {
            throw new ValidationError('Selected Branch does not exist, is inactive, or does not belong to your Company/Property', [
                { field: 'branchId', message: 'Choose an active branch within your own Company/Property' },
            ]);
        }
    }

    return { companyId: actor.companyId, branchId, branchIdProvided };
};

// Adds UI-facing derived fields on top of the raw repository row without
// renaming/losing the underlying DB columns.
const mapUser = (u) => ({
    ...u,
    status:     u.approval_status === 'pending' ? 'pending' : (u.approval_status === 'rejected' ? 'rejected' : (u.is_active ? 'active' : 'inactive')),
    last_login: u.last_login_at || null,
});

const getAll = async (query, actor) => {
    const p = parsePagination(query, ['first_name', 'created_at', 'last_login_at', 'updated_at']);
    const branchId = resolveBranchScope(actor, query);
    let companyId = resolveCompanyScope(actor); // null => every tenant (Super Admin, not impersonating)
    // "Show All Users" (Super Admin only) lets the Company/Property filter be
    // picked explicitly, independent of whatever tenant is being
    // impersonated right now — never honored for any other role, so a
    // tampered ?company_id= can't leak another tenant's users to them.
    if (actor.roleSlug === 'super_admin' && query.company_id) {
        companyId = parseInt(query.company_id, 10);
    }
    const [{ rows, total }, stats] = await Promise.all([
        userRepo.findAll({
            companyId,
            branchId,
            roleId:    query.role   ? parseInt(query.role, 10) : null,
            status:    normalizeStatusFilter(query.status),
            search:    query.search || null,
            ...p,
        }),
        userRepo.getStats({ companyId, branchId }),
    ]);
    return { rows: rows.map(mapUser), meta: buildMeta(total, p), stats };
};

const getById = async (id, actor) => {
    const u = await userRepo.findById(id, resolveCompanyScope(actor));
    if (!u) throw new NotFoundError('User');
    const roles = await userRepo.findRoles(id);
    return { ...mapUser(u), role_ids: roles.map(r => r.role_id) };
};

/**
 * A user's activity trail (login history, role changes, org reassignment,
 * approval/deletion). Visibility mirrors getById exactly — anyone who can't
 * see the user at all can't see their audit trail either, so a company_admin
 * probing another tenant's user_id gets the same 404 either way, not a 403
 * that would confirm the id exists.
 */
const getAuditLog = async (id, actor) => {
    const u = await userRepo.findById(id, resolveCompanyScope(actor));
    if (!u) throw new NotFoundError('User');
    return auditLogRepo.findForUser(id);
};

const create = async (data, actor) => {
    // A brand-new user has no company yet, so this MUST be resolved before
    // the uniqueness check below (which is itself scoped by company) — a
    // super admin creating a user is required to pick a Company/Property
    // explicitly here; there is no fallback to any default tenant.
    const { companyId, branchId } = await resolveOrgAssignment(data, actor, { requireCompany: true });

    const existing = await userRepo.findByEmail(data.email, companyId);
    if (existing) throw new ConflictError('A user with this email already exists');

    // The add-user form submits snake_case fields (first_name, role_id,
    // branch_id); the repository expects camelCase. See update() for the
    // same mapping requirement. role_ids (array) is optional — when omitted,
    // the user is assigned just their single role_id.
    const passwordHash = await hashPassword(data.password || Math.random().toString(36).slice(2) + 'Aa1!');
    const user = await userRepo.create({
        companyId,
        firstName: data.firstName ?? data.first_name,
        lastName:  data.lastName  ?? data.last_name,
        email:     data.email,
        phone:     data.phone,
        roleId:    data.roleId    ?? data.role_id,
        roleIds:   data.roleIds   ?? data.role_ids,
        branchId,
        assignedBy: actor.userId,
    }, passwordHash);

    logger.info('User created', { newUserId: user.user_id, createdBy: actor.userId, companyId, branchId });
    await auditLogRepo.log({
        companyId,
        userId:     actor.userId,
        action:     'user.created',
        entityType: 'user',
        entityId:   user.user_id,
        description: `User ${user.email} created`,
        newValues:  { role_id: user.role_id, role_ids: data.roleIds ?? data.role_ids ?? [user.role_id], company_id: companyId, branch_id: branchId },
    });
    return mapUser(user);
};

const update = async (id, data, actor) => {
    const existing = await userRepo.findById(id, resolveCompanyScope(actor));
    if (!existing) throw new NotFoundError('User');

    // Prevent demoting/modifying super_admin unless you are one
    if (existing.role_slug === 'super_admin' && actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Cannot modify a Super Admin account');
    }

    // update() never moves a user between companies — that's reassignCompany's
    // job exclusively (see its own docstring for why). Branch, however, can
    // be (re)assigned here, validated against the user's CURRENT company —
    // for a super admin that's existing.company_id, not whatever tenant
    // they happen to be impersonating right now.
    const { branchId, branchIdProvided } = await resolveOrgAssignment(
        { branchId: data.branchId ?? data.branch_id },
        { roleSlug: 'company_scoped', companyId: existing.company_id },
        { requireCompany: false }
    );

    // The edit form submits snake_case fields (first_name, role_id, branch_id,
    // status); the repository expects camelCase (firstName, roleId, branchId,
    // isActive). Without this mapping every field silently no-ops because
    // ISNULL(@undefinedParam, column) just keeps the existing value.
    const mapped = {
        firstName: data.firstName ?? data.first_name,
        lastName:  data.lastName  ?? data.last_name,
        phone:     data.phone,
        branchId,
        branchIdProvided,
        roleId:    data.roleId    ?? data.role_id,
        roleIds:   data.roleIds   ?? data.role_ids,
        isActive:  data.isActive != null ? data.isActive : statusToIsActive(data.status),
        assignedBy: actor.userId,
    };

    const roleChangeRequested = mapped.roleId || (mapped.roleIds && mapped.roleIds.length);
    const beforeRoleIds = roleChangeRequested ? (await userRepo.findRoles(id)).map(r => r.role_id) : null;

    // Scoped by the row's own company, not actor.companyId — for a super
    // admin the latter reflects whatever tenant they're impersonating right
    // now (or none), which would silently no-op this write for any user
    // outside that one tenant.
    const updated = await userRepo.update(id, existing.company_id, mapped);
    if (roleChangeRequested) {
        await auditLogRepo.log({
            companyId:  existing.company_id,
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

const getPending = async (actor) => (await userRepo.findPending(resolveCompanyScope(actor))).map(mapUser);

const approve = async (id, actor) => {
    const existing = await userRepo.findById(id, resolveCompanyScope(actor));
    if (!existing) throw new NotFoundError('User');
    if (existing.approval_status !== 'pending') throw new ConflictError('This account is not pending approval');

    const updated = await userRepo.setApprovalStatus(id, existing.company_id, 'approved');
    await auditLogRepo.log({
        companyId:  existing.company_id,
        userId:     actor.userId,
        action:     'user.approved',
        entityType: 'user',
        entityId:   id,
        description: `Registration approved for ${updated.email}`,
    });
    return mapUser(updated);
};

const reject = async (id, actor) => {
    const existing = await userRepo.findById(id, resolveCompanyScope(actor));
    if (!existing) throw new NotFoundError('User');
    if (existing.approval_status !== 'pending') throw new ConflictError('This account is not pending approval');

    const updated = await userRepo.setApprovalStatus(id, existing.company_id, 'rejected');
    await auditLogRepo.log({
        companyId:  existing.company_id,
        userId:     actor.userId,
        action:     'user.rejected',
        entityType: 'user',
        entityId:   id,
        description: `Registration rejected for ${updated.email}`,
    });
    return mapUser(updated);
};

/**
 * Move a user to a different company — Super Admin only (also enforced at
 * the route level, but checked again here since this bypasses every other
 * user-management path's own-company scoping by design and shouldn't be
 * reachable any other way). Records an audit entry under the new company,
 * since that's the tenant this action is actually relevant to going forward.
 *
 * @param {number} id
 * @param {number} newCompanyId
 * @param {number|null} newBranchId - optional; if supplied it must belong to
 *   newCompanyId. If omitted, the user's branch is cleared rather than left
 *   pointing at a branch that belongs to their old company.
 * @param {object} actor
 */
const reassignCompany = async (id, newCompanyId, newBranchId, actor) => {
    if (actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Only a Super Admin can move a user to a different company');
    }
    // Looked up without a company filter (super admin, cross-tenant by
    // design) — the actual current company comes from the row itself, never
    // from actor.companyId (which for a super admin reflects whatever tenant
    // they're impersonating right now, not the target user's tenant).
    const existing = await userRepo.findById(id);
    if (!existing) throw new NotFoundError('User');

    const companyOk = await companyRepo.existsAndActive(newCompanyId);
    if (!companyOk) {
        throw new ValidationError('Selected Company/Property does not exist or is inactive', [
            { field: 'companyId', message: 'Choose an active, existing Company/Property' },
        ]);
    }

    let validatedBranchId = null;
    if (newBranchId != null) {
        const branchOk = await userRepo.branchExistsAndActive(newBranchId, newCompanyId);
        if (!branchOk) {
            throw new ValidationError('Selected Branch does not exist, is inactive, or does not belong to the selected Company/Property', [
                { field: 'branchId', message: 'Choose an active branch that belongs to the selected Company/Property' },
            ]);
        }
        validatedBranchId = newBranchId;
    }

    if (existing.company_id === newCompanyId && existing.branch_id === validatedBranchId) {
        return mapUser(existing);
    }

    const updated = await userRepo.reassignCompany(id, existing.company_id, newCompanyId, validatedBranchId);
    if (!updated) throw new NotFoundError('User');

    await auditLogRepo.log({
        companyId:  newCompanyId,
        userId:     actor.userId,
        action:     'user.company_reassigned',
        entityType: 'user',
        entityId:   id,
        description: `${existing.email} moved from company_id=${existing.company_id} to company_id=${newCompanyId}`,
        oldValues:  { company_id: existing.company_id, branch_id: existing.branch_id },
        newValues:  { company_id: newCompanyId, branch_id: validatedBranchId },
    });
    return mapUser(updated);
};

const toggleStatus = async (id, actor) => {
    const existing = await userRepo.findById(id, resolveCompanyScope(actor));
    if (!existing) throw new NotFoundError('User');
    if (existing.role_slug === 'super_admin' && actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Cannot modify a Super Admin account');
    }
    const newStatus = existing.is_active ? 0 : 1;
    return mapUser(await userRepo.update(id, existing.company_id, { isActive: newStatus }));
};

/**
 * Soft-delete — distinct from deactivate/toggleStatus. See
 * hall.service.js:remove for the same pattern. Blocked while the user still
 * holds a staff assignment on any non-terminal booking, and (like every
 * other modification path here) a super_admin can only be deleted by
 * another super_admin. A user can't delete their own account through this
 * path either — that's an account-settings action, not an admin action.
 */
const remove = async (id, actor) => {
    const existing = await userRepo.findById(id, resolveCompanyScope(actor));
    if (!existing) throw new NotFoundError('User');
    if (existing.role_slug === 'super_admin' && actor.roleSlug !== 'super_admin') {
        throw new ForbiddenError('Cannot modify a Super Admin account');
    }
    if (id === actor.userId) {
        throw new ValidationError('You cannot delete your own account');
    }

    const activeAssignments = await userRepo.countActiveAssignments(id, existing.company_id);
    if (activeAssignments > 0) {
        const name = `${existing.first_name} ${existing.last_name || ''}`.trim();
        throw new ValidationError(
            `Cannot delete ${name} — still staffed on ${activeAssignments} active booking(s). Reassign or complete them first.`
        );
    }

    await userRepo.softDelete(id, existing.company_id);

    await auditLogRepo.log({
        companyId:  existing.company_id,
        userId:     actor.userId,
        action:     'user.deleted',
        entityType: 'user',
        entityId:   id,
        description: `User ${existing.email} deleted`,
        oldValues:  { email: existing.email },
    });
};

module.exports = { getAll, getById, create, update, reassignCompany, toggleStatus, remove, getRoles, getPending, approve, reject, getAuditLog };
