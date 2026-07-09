/**
 * User Repository — Manage system users (staff accounts)
 */
'use strict';

const { executeQuery, withTransaction } = require('../config/database');

const BASE_SELECT = `
    SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
           u.role_id, r.role_slug, r.role_name,
           u.company_id, u.branch_id,
           u.is_active, u.is_email_verified, u.approval_status,
           u.last_login_at, u.created_at,
           u.avatar_url, u.timezone,
           br.branch_name,
           c.company_name
    FROM Users u
    JOIN Roles r ON r.role_id = u.role_id
    LEFT JOIN Branches br ON br.branch_id = u.branch_id
    LEFT JOIN Companies c ON c.company_id = u.company_id
`;

const findPending = async (companyId) => {
    return executeQuery(
        `${BASE_SELECT} WHERE u.company_id = @companyId AND u.approval_status = 'pending' AND u.deleted_at IS NULL ORDER BY u.created_at ASC`,
        { companyId }
    );
};

const setApprovalStatus = async (userId, companyId, status) => {
    await executeQuery(
        `UPDATE Users SET approval_status = @status, updated_at = GETUTCDATE()
         WHERE user_id = @userId AND company_id = @companyId AND approval_status = 'pending'`,
        { userId, companyId, status }
    );
    return findById(userId, companyId);
};

const findById = async (userId, companyId = null) => {
    const rows = await executeQuery(
        `${BASE_SELECT}
         WHERE u.user_id = @id
           AND u.deleted_at IS NULL
           AND (@companyId IS NULL OR u.company_id = @companyId)`,
        { id: userId, companyId: companyId || null }
    );
    return rows[0] || null;
};

// Deliberately does NOT filter deleted_at — Users.email has a hard UNIQUE
// constraint (UQ_users_email) that a soft-deleted row still occupies, so this
// uniqueness pre-check must still see deleted users to surface a clean
// validation error instead of an unhandled DB constraint violation.
const findByEmail = async (email, companyId) => {
    const rows = await executeQuery(
        `SELECT user_id FROM Users WHERE email = @email AND company_id = @companyId`,
        { email, companyId }
    );
    return rows[0] || null;
};

const findAll = async ({ companyId, branchId, roleId, isActive, search, offset, limit, sortBy, sortDir }) => {
    const where = [
        'u.company_id = @companyId',
        'u.deleted_at IS NULL',
        '(@branchId IS NULL OR u.branch_id = @branchId)',
        '(@roleId   IS NULL OR u.role_id   = @roleId)',
        '(@isActive IS NULL OR u.is_active = @isActive)',
        `(@search IS NULL OR CONCAT(u.first_name, ' ', u.last_name) LIKE CONCAT('%', @search, '%') OR u.email LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const col = ['first_name', 'created_at', 'last_login_at'].includes(sortBy) ? `u.${sortBy}` : 'u.first_name';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId: branchId || null,
        roleId:   roleId   || null,
        isActive: isActive != null ? isActive : null,
        search:   search   || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(`SELECT COUNT(*) AS total FROM Users u WHERE ${where}`, params),
    ]);

    return { rows, total: countRows[0].total };
};

/** Real dashboard stats for the users index page's KPI strip. */
const getStats = async ({ companyId, branchId }) => {
    const rows = await executeQuery(
        `SELECT r.role_slug, COUNT(*) AS cnt, SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS active_cnt
         FROM Users u
         JOIN Roles r ON r.role_id = u.role_id
         WHERE u.company_id = @companyId AND (@branchId IS NULL OR u.branch_id = @branchId)
         GROUP BY r.role_slug`,
        { companyId, branchId: branchId || null }
    );
    const byRole = {};
    let active = 0;
    rows.forEach(r => { byRole[r.role_slug] = r.cnt; active += r.active_cnt; });
    return {
        super_admin:    byRole.super_admin    || 0,
        company_admin:  byRole.company_admin  || 0,
        branch_manager: byRole.branch_manager || 0,
        booking_exec:   byRole.booking_executive || 0,
        active,
    };
};

const create = async (data, passwordHash) => {
    const result = await executeQuery(
        `INSERT INTO Users
            (company_id, branch_id, role_id, first_name, last_name, email, phone,
             password_hash, is_active, is_email_verified, created_at, updated_at)
         OUTPUT INSERTED.user_id AS id
         VALUES
            (@companyId, @branchId, @roleId, @firstName, @lastName, @email, @phone,
             @passwordHash, 1, 0, GETUTCDATE(), GETUTCDATE())`,
        {
            companyId:    data.companyId,
            branchId:     data.branchId  || null,
            roleId:       data.roleId,
            firstName:    data.firstName,
            lastName:     data.lastName  || null,
            email:        data.email,
            phone:        data.phone     || null,
            passwordHash,
        }
    );
    const userId = result[0].id;
    const roleIds = Array.isArray(data.roleIds) && data.roleIds.length ? data.roleIds : [data.roleId];
    await setUserRoles(userId, roleIds, data.assignedBy || null);
    return findById(userId, data.companyId);
};

const update = async (userId, companyId, data) => {
    await executeQuery(
        `UPDATE Users
         SET first_name = ISNULL(@firstName, first_name),
             last_name  = ISNULL(@lastName,  last_name),
             phone      = ISNULL(@phone,     phone),
             branch_id  = ISNULL(@branchId,  branch_id),
             role_id    = ISNULL(@roleId,    role_id),
             is_active  = ISNULL(@isActive,  is_active),
             updated_at = GETUTCDATE()
         WHERE user_id = @id AND company_id = @companyId`,
        {
            id:        userId,
            companyId,
            firstName: data.firstName || null,
            lastName:  data.lastName  || null,
            phone:     data.phone     || null,
            branchId:  data.branchId  || null,
            roleId:    data.roleId    || null,
            isActive:  data.isActive  != null ? data.isActive : null,
        }
    );
    if (Array.isArray(data.roleIds) && data.roleIds.length) {
        await setUserRoles(userId, data.roleIds, data.assignedBy || null);
    } else if (data.roleId) {
        // Legacy single-role update path — keep UserRoles in sync with Users.role_id.
        await setUserRoles(userId, [data.roleId], data.assignedBy || null);
    }
    return findById(userId, companyId);
};

/** Replace a user's full set of assigned roles (multi-role support). */
const setUserRoles = async (userId, roleIds, assignedBy) => {
    const uniqueRoleIds = [...new Set(roleIds.filter(Boolean).map(Number))];
    if (!uniqueRoleIds.length) return;
    await withTransaction(async (tx) => {
        await tx.execute('DELETE FROM UserRoles WHERE user_id = @userId', { userId });
        for (const roleId of uniqueRoleIds) {
            await tx.execute(
                `INSERT INTO UserRoles (user_id, role_id, assigned_by, assigned_at)
                 VALUES (@userId, @roleId, @assignedBy, GETUTCDATE())`,
                { userId, roleId, assignedBy }
            );
        }
    });
};

const findRoles = async (userId) => {
    const rows = await executeQuery(
        `SELECT r.role_id, r.role_slug, r.role_name
         FROM UserRoles ur JOIN Roles r ON r.role_id = ur.role_id
         WHERE ur.user_id = @userId ORDER BY r.role_id`,
        { userId }
    );
    return rows;
};

const getRoles = async () => {
    const rows = await executeQuery(`SELECT role_id, role_slug, role_name FROM Roles ORDER BY role_id`);
    return rows;
};

/**
 * Count staff assignments this user still holds on non-terminal bookings —
 * a user can't be deleted while staffed on an upcoming/active event.
 */
const countActiveAssignments = async (userId, companyId) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS cnt
         FROM BookingStaffAssignments bsa
         JOIN Bookings b ON b.booking_id = bsa.booking_id
         WHERE bsa.user_id = @userId AND b.company_id = @companyId
           AND b.status NOT IN ('cancelled', 'completed', 'archived')`,
        { userId, companyId }
    );
    return rows[0].cnt;
};

const softDelete = async (userId, companyId) => {
    await executeQuery(
        `UPDATE Users SET deleted_at = GETUTCDATE(), updated_at = GETUTCDATE()
         WHERE user_id = @id AND company_id = @companyId AND deleted_at IS NULL`,
        { id: userId, companyId }
    );
};

module.exports = { findById, findByEmail, findAll, create, update, getRoles, getStats, setUserRoles, findRoles, findPending, setApprovalStatus, countActiveAssignments, softDelete };
