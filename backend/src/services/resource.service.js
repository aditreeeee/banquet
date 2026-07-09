/**
 * Resource Service — shared/structured inventory business logic
 */

'use strict';

const { parse } = require('fast-csv');
const { Readable } = require('stream');
const resourceRepo = require('../repositories/resource.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const CATEGORIES = ['furniture', 'decor', 'lighting', 'audio', 'visual', 'signage', 'custom'];

const list = (companyId) => resourceRepo.list(companyId);

const getById = async (resourceId, companyId) => {
    const resource = await resourceRepo.findById(resourceId, companyId);
    if (!resource) throw new NotFoundError('Resource');
    return resource;
};

const create = async ({ resourceName, resourceType, category, supplier, unitPrice, costPrice, quantityAvailable, isBillable }, companyId) => {
    if (!resourceName) throw new ValidationError('resourceName is required');
    if (category && !CATEGORIES.includes(category)) throw new ValidationError(`category must be one of: ${CATEGORIES.join(', ')}`);
    return resourceRepo.create({ companyId, resourceName, resourceType, category, supplier, unitPrice, costPrice, quantityAvailable, isBillable });
};

const update = async (resourceId, data, companyId) => {
    await getById(resourceId, companyId);
    if (data.category && !CATEGORIES.includes(data.category)) throw new ValidationError(`category must be one of: ${CATEGORIES.join(', ')}`);
    return resourceRepo.update(resourceId, companyId, data);
};

const getAvailability = async ({ resourceId, eventDate, companyId }) => {
    const availability = await resourceRepo.getAvailability({ resourceId, eventDate, companyId });
    if (!availability) throw new NotFoundError('Resource');
    return availability;
};

/**
 * Reserved-vs-available snapshot across all inventory for a given date —
 * powers the Command Center's inventory-alert cards ("shortage" = nothing
 * left to allocate for that day).
 */
const getInventorySnapshot = (companyId, eventDate) => resourceRepo.getInventorySnapshot(companyId, eventDate);

/**
 * CSV import — expects columns: resource_name,resource_type,category,supplier,
 * unit_price,cost_price,quantity_available,is_billable. Rows created here go
 * through the same create() path as the manual "Add Resource" form (is_active
 * defaults true in the repository insert), so imported inventory is queryable
 * by availability/recommendation checks immediately — no separate activation
 * step or cache to invalidate.
 */
const importCsv = (buffer, companyId) => new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
        .pipe(parse({ headers: true, trim: true }))
        .on('error', reject)
        .on('data', (row) => rows.push(row))
        .on('end', async () => {
            let created = 0;
            const errors = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2;
                try {
                    if (!row.resource_name) throw new Error('resource_name is required');
                    const category = CATEGORIES.includes(row.category) ? row.category : 'custom';
                    await create({
                        resourceName:      row.resource_name.trim(),
                        resourceType:      row.resource_type || null,
                        category,
                        supplier:          row.supplier || null,
                        unitPrice:         parseFloat(row.unit_price) || 0,
                        costPrice:         parseFloat(row.cost_price) || 0,
                        quantityAvailable: parseInt(row.quantity_available, 10) || 0,
                        isBillable:        String(row.is_billable).toLowerCase() === 'true',
                    }, companyId);
                    created++;
                } catch (err) {
                    errors.push({ row: rowNum, message: err.message });
                }
            }
            resolve({ totalRows: rows.length, created, failed: errors.length, errors });
        });
});

module.exports = { list, getById, create, update, getAvailability, getInventorySnapshot, CATEGORIES, importCsv };
