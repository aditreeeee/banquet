/**
 * Branch Routes — /api/v1/branches
 */
'use strict';

const { Router }             = require('express');
const { executeQuery }       = require('../../../config/database');
const response               = require('../../../utils/response');
const { requirePermission }  = require('../middleware/auth');
const { PERMISSIONS }        = require('../../../constants');

const router = Router();

router.get('/', requirePermission(PERMISSIONS.BRANCHES_READ), async (req, res) => {
    const rows = await executeQuery(
        `SELECT branch_id, branch_name, branch_code, address_line1, phone, is_active, created_at
         FROM Branches WHERE company_id = @companyId ORDER BY branch_name`,
        { companyId: req.companyId }
    );
    return response.success(res, rows);
});

router.get('/:id', requirePermission(PERMISSIONS.BRANCHES_READ), async (req, res) => {
    const rows = await executeQuery(
        `SELECT * FROM Branches WHERE branch_id = @id AND company_id = @companyId`,
        { id: parseInt(req.params.id, 10), companyId: req.companyId }
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Branch not found' });
    return response.success(res, rows[0]);
});

router.post('/', requirePermission(PERMISSIONS.BRANCHES_CREATE), async (req, res) => {
    const { branchName, branchCode, address, phone } = req.body;
    if (!branchName) return res.status(400).json({ success: false, message: 'branchName required' });
    if (!address) return res.status(400).json({ success: false, message: 'address required' });

    const code = branchCode || branchName.trim().slice(0, 15).toUpperCase().replace(/[^A-Z0-9]/g, '-');

    const result = await executeQuery(
        `INSERT INTO Branches (company_id, branch_name, branch_code, address_line1, phone, is_active, created_at, updated_at)
         OUTPUT INSERTED.branch_id AS insertId
         VALUES (@companyId, @name, @code, @address, @phone, 1, GETUTCDATE(), GETUTCDATE())`,
        {
            companyId: req.companyId,
            name:      branchName,
            code,
            address,
            phone:     phone || null,
        }
    );
    return response.created(res, { branch_id: result[0].insertId });
});

router.patch('/:id', requirePermission(PERMISSIONS.BRANCHES_UPDATE), async (req, res) => {
    const { branchName, address, phone, isActive } = req.body;
    await executeQuery(
        `UPDATE Branches
         SET branch_name   = ISNULL(@name,     branch_name),
             address_line1 = ISNULL(@address,  address_line1),
             phone         = ISNULL(@phone,    phone),
             is_active     = ISNULL(@isActive, is_active),
             updated_at    = GETUTCDATE()
         WHERE branch_id = @id AND company_id = @companyId`,
        {
            id:        parseInt(req.params.id, 10),
            companyId: req.companyId,
            name:      branchName || null,
            address:   address    || null,
            phone:     phone      || null,
            isActive:  isActive != null ? isActive : null,
        }
    );
    return response.success(res, null, 'Branch updated');
});

module.exports = router;
