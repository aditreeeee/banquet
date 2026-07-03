/**
 * User Repository — Manage system users (staff accounts)
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
           u.role_id, r.role_slug, r.role_name,
           u.company_id, u.branch_id,
           u.is_active, u.is_email_verified,
           u.last_login_at, u.created_at,
           u.avatar_url, u.timezone,
           br.branch_name
    FROM Users u
    JOIN Roles r ON r.role_id = u.role_id
    LEFT JOIN Branches br ON br.branch_id = u.branch_id
`;

const findById = async (userId, companyId = null) => {
    const rows = await executeQuery(
        `${BASE_SELECT}
         WHERE u.user_id = @id
           AND (@companyId IS NULL OR u.company_id = @companyId)`,
        { id: userId, companyId: companyId || null }
    );
    return rows[0] || null;
};

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
    return findById(result[0].id, data.companyId);
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
    return findById(userId, companyId);
};

const getRoles = async () => {
    const rows = await executeQuery(`SELECT role_id, role_slug, role_name FROM Roles ORDER BY role_id`);
    return rows;
};

module.exports = { findById, findByEmail, findAll, create, update, getRoles };
