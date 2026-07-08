/**
 * Resource Service — shared/structured inventory business logic
 */

'use strict';

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

module.exports = { list, getById, create, update, getAvailability, getInventorySnapshot, CATEGORIES };
