/**
 * Company Routes — /api/v1/companies
 * Stub: full implementation in Phase 6 (multi-tenant admin panel)
 */
'use strict';

const { Router }       = require('express');
const { requireRole }  = require('../middleware/auth');
const { executeQuery } = require('../../../config/database');
const response         = require('../../../utils/response');
const { USER_ROLES }   = require('../../../constants');

const router = Router();

router.get('/', requireRole(USER_ROLES.SUPER_ADMIN), async (req, res) => {
    const rows = await executeQuery(
        `SELECT company_id, company_name, email, phone, city, is_active, created_at
         FROM Companies ORDER BY company_name`
    );
    return response.success(res, rows);
});

router.get('/:id', requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN), async (req, res) => {
    const rows = await executeQuery(
        `SELECT * FROM Companies WHERE company_id = :id`,
        { id: parseInt(req.params.id, 10) }
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Company not found' });
    return response.success(res, rows[0]);
});

router.post('/', requireRole(USER_ROLES.SUPER_ADMIN), async (req, res) => {
    const { companyName, email, phone, address, city, state } = req.body;
    if (!companyName) return res.status(400).json({ success: false, message: 'companyName required' });

    const result = await executeQuery(
        `INSERT INTO Companies (company_name, email, phone, address, city, state, is_active, created_at, updated_at)
         VALUES (:name, :email, :phone, :address, :city, :state, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        {
            name:    companyName,
            email:   email   || null,
            phone:   phone   || null,
            address: address || null,
            city:    city    || null,
            state:   state   || null,
        }
    );
    return response.created(res, { company_id: result.insertId });
});

router.patch('/:id', requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN), async (req, res) => {
    const { companyName, email, phone, address, city, state, isActive } = req.body;
    await executeQuery(
        `UPDATE Companies
         SET company_name = IFNULL(:name,     company_name),
             email        = IFNULL(:email,    email),
             phone        = IFNULL(:phone,    phone),
             address      = IFNULL(:address,  address),
             city         = IFNULL(:city,     city),
             state        = IFNULL(:state,    state),
             is_active    = IFNULL(:isActive, is_active),
             updated_at   = UTC_TIMESTAMP()
         WHERE company_id = :id`,
        {
            id:       parseInt(req.params.id, 10),
            name:     companyName || null,
            email:    email       || null,
            phone:    phone       || null,
            address:  address     || null,
            city:     city        || null,
            state:    state       || null,
            isActive: isActive != null ? isActive : null,
        }
    );
    return response.success(res, null, 'Company updated');
});

module.exports = router;
