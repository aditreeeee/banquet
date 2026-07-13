/**
 * Decoration Controller
 */
'use strict';

const svc      = require('../../../services/decoration.service');
const response = require('../../../utils/response');
const { ValidationError } = require('../middleware/errorHandler');

// ─── Categories ───────────────────────────────────────────────────────────────
const listCategories  = async (req, res) => response.success(res, await svc.listCategories(req.companyId));
const createCategory  = async (req, res) => response.created(res, await svc.createCategory(req.companyId, req.body.categoryName), 'Category created');

// ─── Items ────────────────────────────────────────────────────────────────────
const listItems = async (req, res) => {
    const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === '1';
    return response.success(res, await svc.listItems(req.companyId, { activeOnly }));
};
const getItemById = async (req, res) => response.success(res, await svc.getItemById(parseInt(req.params.id, 10), req.companyId));
const createItem  = async (req, res) => response.created(res, await svc.createItem(req.companyId, req.body, req.user.user_id), 'Decoration item created');
const updateItem  = async (req, res) => response.success(res, await svc.updateItem(parseInt(req.params.id, 10), req.companyId, req.body), 'Decoration item updated');
const importCsv = async (req, res) => {
    if (!req.file) throw new ValidationError('CSV file is required');
    const result = await svc.importCsv(req.file.buffer, req.companyId, req.user.user_id);
    return response.success(res, result, `Imported ${result.created}/${result.totalRows} decoration items`);
};

// ─── Packages ─────────────────────────────────────────────────────────────────
const listPackages   = async (req, res) => response.success(res, await svc.listPackages(req.companyId));
const getPackageById = async (req, res) => response.success(res, await svc.getPackageById(parseInt(req.params.id, 10), req.companyId));
const createPackage  = async (req, res) => response.created(res, await svc.createPackage(req.companyId, req.body, req.user.user_id), 'Decoration package created');
const updatePackage  = async (req, res) => response.success(res, await svc.updatePackage(parseInt(req.params.id, 10), req.companyId, req.body), 'Decoration package updated');
const deletePackage  = async (req, res) => { await svc.deletePackage(parseInt(req.params.id, 10), req.companyId); return response.success(res, null, 'Decoration package deleted'); };
const getPackagePricing = async (req, res) => response.success(res, await svc.getPackagePricing(parseInt(req.params.id, 10), req.companyId));
const addPackageItem = async (req, res) => {
    const items = await svc.addItemToPackage(parseInt(req.params.id, 10), req.companyId, parseInt(req.body.decorationId, 10), parseInt(req.body.quantity, 10) || 1);
    return response.success(res, items, 'Item added to package');
};
const removePackageItem = async (req, res) => {
    const items = await svc.removeItemFromPackage(parseInt(req.params.id, 10), req.companyId, parseInt(req.params.itemId, 10));
    return response.success(res, items, 'Item removed from package');
};

const getSnapshot = async (req, res) => {
    const eventDate = req.query.event_date || new Date().toISOString().slice(0, 10);
    return response.success(res, await svc.getInventorySnapshot(req.companyId, eventDate));
};

module.exports = {
    listCategories, createCategory,
    listItems, getItemById, createItem, updateItem, importCsv,
    listPackages, getPackageById, createPackage, updatePackage, deletePackage,
    getPackagePricing, addPackageItem, removePackageItem,
    getSnapshot,
};
