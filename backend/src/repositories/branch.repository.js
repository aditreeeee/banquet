/**
 * Branch Repository — tenant-scoped (company_id always required for reads/
 * writes). Companies own their Branches; a Branch never exists independent
 * of a company_id, so every query here takes it explicitly rather than
 * inferring it from request context.
 */
'use strict';

const { executeQuery } = require('../config/database');

const findAll = async (companyId, { activeOnly } = {}) => {
    return executeQuery(
        `SELECT branch_id, branch_name, branch_code, address_line1, phone, is_active, created_at
         FROM Branches WHERE company_id = @companyId ${activeOnly ? 'AND is_active = 1' : ''} ORDER BY branch_name`,
        { companyId }
    );
};

const findById = async (branchId, companyId) => {
    const rows = await executeQuery(
        `SELECT * FROM Branches WHERE branch_id = @id AND company_id = @companyId`,
        { id: branchId, companyId }
    );
    return rows[0] || null;
};

const create = async (companyId, { branchName, branchCode, address, phone }) => {
    const result = await executeQuery(
        `INSERT INTO Branches (company_id, branch_name, branch_code, address_line1, phone, is_active, created_at, updated_at)
         OUTPUT INSERTED.branch_id AS insertId
         VALUES (@companyId, @name, @code, @address, @phone, 1, GETUTCDATE(), GETUTCDATE())`,
        { companyId, name: branchName, code: branchCode, address, phone: phone || null }
    );
    return result[0].insertId;
};

/**
 * Scoped by both branch_id and company_id so a Super Admin's write can never
 * silently drift onto the wrong tenant's branch. Returns the updated row, or
 * null if nothing matched (wrong id, wrong company, or both) — callers must
 * check this and 404 rather than assume success the way a bare row-count-less
 * UPDATE would.
 */
const update = async (branchId, companyId, { branchName, address, phone, isActive }) => {
    const result = await executeQuery(
        `UPDATE Branches
         SET branch_name   = ISNULL(@name,     branch_name),
             address_line1 = ISNULL(@address,  address_line1),
             phone         = ISNULL(@phone,    phone),
             is_active     = ISNULL(@isActive, is_active),
             updated_at    = GETUTCDATE()
         OUTPUT INSERTED.branch_id AS branchId
         WHERE branch_id = @id AND company_id = @companyId`,
        {
            id:        branchId,
            companyId: companyId,
            name:      branchName || null,
            address:   address    || null,
            phone:     phone      || null,
            isActive:  isActive != null ? isActive : null,
        }
    );
    return result[0] || null;
};

const existsAndActive = async (branchId, companyId) => {
    const rows = await executeQuery(
        `SELECT branch_id FROM Branches WHERE branch_id = @id AND company_id = @companyId AND is_active = 1`,
        { id: branchId, companyId }
    );
    return !!rows[0];
};

module.exports = { findAll, findById, create, update, existsAndActive };
