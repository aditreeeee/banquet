/**
 * Resource Routes — /api/v1/resources
 * (Extra equipment/services bookable alongside halls)
 */
'use strict';

const { Router }            = require('express');
const { requirePermission } = require('../middleware/auth');
const { executeQuery }      = require('../../../config/database');
const response              = require('../../../utils/response');
const { PERMISSIONS }       = require('../../../constants');

const router = Router();

router.get('/', requirePermission(PERMISSIONS.RESOURCES_READ), async (req, res) => {
    const rows = await executeQuery(
        `SELECT resource_id, resource_name, resource_type, unit_price, quantity_available, is_active
         FROM Resources WHERE company_id = @companyId AND is_active = 1 ORDER BY resource_name`,
        { companyId: req.companyId }
    );
    return response.success(res, rows);
});

router.post('/', requirePermission(PERMISSIONS.RESOURCES_CREATE), async (req, res) => {
    const { resourceName, resourceType, unitPrice, quantityAvailable } = req.body;
    if (!resourceName) return res.status(400).json({ success: false, message: 'resourceName required' });

    const result = await executeQuery(
        `INSERT INTO Resources (company_id, resource_name, resource_type, unit_price, quantity_available, is_active, created_at)
         OUTPUT INSERTED.resource_id AS insertId
         VALUES (@companyId, @name, @type, @price, @qty, 1, GETUTCDATE())`,
        {
            companyId: req.companyId,
            name:      resourceName,
            type:      resourceType       || null,
            price:     unitPrice          || 0,
            qty:       quantityAvailable  || 0,
        }
    );
    return response.created(res, { resource_id: result[0].insertId });
});

router.put('/:id', requirePermission(PERMISSIONS.RESOURCES_UPDATE), async (req, res) => {
    const { resourceName, unitPrice, quantityAvailable, isActive } = req.body;
    await executeQuery(
        `UPDATE Resources
         SET resource_name      = ISNULL(@name,     resource_name),
             unit_price         = ISNULL(@price,    unit_price),
             quantity_available = ISNULL(@qty,      quantity_available),
             is_active          = ISNULL(@isActive, is_active)
         WHERE resource_id = @id AND company_id = @companyId`,
        {
            id:        parseInt(req.params.id, 10),
            companyId: req.companyId,
            name:      resourceName       || null,
            price:     unitPrice          || null,
            qty:       quantityAvailable  || null,
            isActive:  isActive != null   ? isActive : null,
        }
    );
    return response.success(res, null, 'Resource updated');
});

router.patch('/:id', requirePermission(PERMISSIONS.RESOURCES_UPDATE), async (req, res) => {
    const { resourceName, unitPrice, quantityAvailable, isActive } = req.body;
    await executeQuery(
        `UPDATE Resources
         SET resource_name      = ISNULL(@name,     resource_name),
             unit_price         = ISNULL(@price,    unit_price),
             quantity_available = ISNULL(@qty,      quantity_available),
             is_active          = ISNULL(@isActive, is_active)
         WHERE resource_id = @id AND company_id = @companyId`,
        {
            id:        parseInt(req.params.id, 10),
            companyId: req.companyId,
            name:      resourceName       || null,
            price:     unitPrice          || null,
            qty:       quantityAvailable  || null,
            isActive:  isActive != null   ? isActive : null,
        }
    );
    return response.success(res, null, 'Resource updated');
});

module.exports = router;
