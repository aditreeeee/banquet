/**
 * Menu Item Controller
 */
'use strict';

const menuItemService = require('../../../services/menuItem.service');
const response = require('../../../utils/response');

const list = async (req, res) => {
    const items = await menuItemService.list(req.companyId);
    return response.success(res, items);
};

const getById = async (req, res) => {
    const item = await menuItemService.getById(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, item);
};

const create = async (req, res) => {
    const { categoryId, itemName, description, foodType, unit, basePrice, taxPercent, unitCost } = req.body;
    const item = await menuItemService.create(
        { categoryId, itemName, description, foodType, unit, basePrice, taxPercent, unitCost },
        req.companyId
    );
    return response.created(res, item, 'Menu item created');
};

const update = async (req, res) => {
    const { itemName, description, basePrice, taxPercent, unitCost, isActive } = req.body;
    const item = await menuItemService.update(
        parseInt(req.params.id, 10),
        { itemName, description, basePrice, taxPercent, unitCost, isActive },
        req.companyId
    );
    return response.success(res, item, 'Menu item updated');
};

const listCategories = async (req, res) => {
    const categories = await menuItemService.listCategories(req.companyId);
    return response.success(res, categories);
};

module.exports = { list, getById, create, update, listCategories };
