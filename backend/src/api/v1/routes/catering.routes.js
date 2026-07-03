/**
 * Catering Routes — /api/v1/catering
 * Catering packages and menu items
 */
'use strict';

const { Router }       = require('express');
const { executeQuery } = require('../../../config/database');
const response         = require('../../../utils/response');

const router = Router();

router.get('/packages', async (req, res) => {
    const rows = await executeQuery(
        `SELECT package_id, package_name, package_type, description, price_per_plate, is_active
         FROM CateringPackages WHERE company_id = :companyId AND is_active = 1 ORDER BY package_name`,
        { companyId: req.companyId }
    );
    return response.success(res, rows);
});

router.post('/packages', async (req, res) => {
    const { packageName, packageType, description, pricePerPlate, minPlates } = req.body;
    if (!packageName) return res.status(400).json({ success: false, message: 'packageName required' });
    if (!packageType) return res.status(400).json({ success: false, message: 'packageType required (veg/non_veg/jain/mixed)' });

    const result = await executeQuery(
        `INSERT INTO CateringPackages (company_id, package_name, package_type, description, price_per_plate, min_plates, is_active, created_at)
         VALUES (:companyId, :name, :type, :desc, :price, :minPlates, 1, UTC_TIMESTAMP())`,
        {
            companyId: req.companyId,
            name:      packageName,
            type:      packageType,
            desc:      description  || null,
            price:     pricePerPlate || 0,
            minPlates: minPlates    || 50,
        }
    );
    return response.created(res, { package_id: result.insertId });
});

module.exports = router;
