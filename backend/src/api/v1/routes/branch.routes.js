/**
 * Branch Routes — /api/v1/branches
 */
'use strict';

const { Router }       = require('express');
const { executeQuery } = require('../../../config/database');
const response         = require('../../../utils/response');

const router = Router();

router.get('/', async (req, res) => {
    const rows = await executeQuery(
        `SELECT branch_id, branch_name, city, phone, is_active, created_at
         FROM Branches WHERE company_id = @companyId ORDER BY branch_name`,
        { companyId: req.companyId }
    );
    return response.success(res, rows);
});

router.get('/:id', async (req, res) => {
    const rows = await executeQuery(
        `SELECT * FROM Branches WHERE branch_id = @id AND company_id = @companyId`,
        { id: parseInt(req.params.id, 10), companyId: req.companyId }
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Branch not found' });
    return response.success(res, rows[0]);
});

router.post('/', async (req, res) => {
    const { branchName, city, address, phone } = req.body;
    if (!branchName) return res.status(400).json({ success: false, message: 'branchName required' });

    const result = await executeQuery(
        `INSERT INTO Branches (company_id, branch_name, city, address, phone, is_active, created_at, updated_at)
         OUTPUT INSERTED.branch_id AS insertId
         VALUES (@companyId, @name, @city, @address, @phone, 1, GETUTCDATE(), GETUTCDATE())`,
        {
            companyId: req.companyId,
            name:      branchName,
            city:      city    || null,
            address:   address || null,
            phone:     phone   || null,
        }
    );
    return response.created(res, { branch_id: result[0].insertId });
});

router.patch('/:id', async (req, res) => {
    const { branchName, city, address, phone, isActive } = req.body;
    await executeQuery(
        `UPDATE Branches
         SET branch_name = ISNULL(@name,     branch_name),
             city        = ISNULL(@city,     city),
             address     = ISNULL(@address,  address),
             phone       = ISNULL(@phone,    phone),
             is_active   = ISNULL(@isActive, is_active),
             updated_at  = GETUTCDATE()
         WHERE branch_id = @id AND company_id = @companyId`,
        {
            id:        parseInt(req.params.id, 10),
            companyId: req.companyId,
            name:      branchName || null,
            city:      city       || null,
            address:   address    || null,
            phone:     phone      || null,
            isActive:  isActive != null ? isActive : null,
        }
    );
    return response.success(res, null, 'Branch updated');
});

module.exports = router;
