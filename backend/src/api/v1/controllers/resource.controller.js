/**
 * Resource Controller
 */
'use strict';

const resourceService = require('../../../services/resource.service');
const recommendationService = require('../../../services/inventoryRecommendation.service');
const response         = require('../../../utils/response');
const { ValidationError } = require('../middleware/errorHandler');

const list = async (req, res) => {
    const resources = await resourceService.list(req.companyId);
    return response.success(res, resources);
};

const getById = async (req, res) => {
    const resource = await resourceService.getById(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, resource);
};

const create = async (req, res) => {
    const { resourceName, resourceType, category, supplier, unitPrice, costPrice, quantityAvailable, isBillable } = req.body;
    const resource = await resourceService.create(
        { resourceName, resourceType, category, supplier, unitPrice, costPrice, quantityAvailable, isBillable },
        req.companyId
    );
    return response.created(res, resource, 'Resource created');
};

const update = async (req, res) => {
    const { resourceName, category, supplier, unitPrice, costPrice, quantityAvailable, isActive, isBillable } = req.body;
    const resource = await resourceService.update(
        parseInt(req.params.id, 10),
        { resourceName, category, supplier, unitPrice, costPrice, quantityAvailable, isActive, isBillable },
        req.companyId
    );
    return response.success(res, resource, 'Resource updated');
};

const getAvailability = async (req, res) => {
    const { event_date } = req.query;
    const availability = await resourceService.getAvailability({
        resourceId: parseInt(req.params.id, 10),
        eventDate:  event_date,
        companyId:  req.companyId,
    });
    return response.success(res, availability);
};

const getSnapshot = async (req, res) => {
    const eventDate = req.query.event_date || new Date().toISOString().slice(0, 10);
    const snapshot = await resourceService.getInventorySnapshot(req.companyId, eventDate);
    return response.success(res, snapshot);
};

const getRecommendations = async (req, res) => {
    const { guest_count, event_date } = req.query;
    const recommendations = await recommendationService.recommendForBooking({
        companyId:  req.companyId,
        guestCount: guest_count,
        eventDate:  event_date || new Date().toISOString().slice(0, 10),
    });
    return response.success(res, recommendations);
};

const importCsv = async (req, res) => {
    if (!req.file) throw new ValidationError('CSV file is required');
    const result = await resourceService.importCsv(req.file.buffer, req.companyId);
    return response.success(res, result, `Imported ${result.created}/${result.totalRows} inventory items`);
};

module.exports = { list, getById, create, update, getAvailability, getSnapshot, getRecommendations, importCsv };
