/**
 * Menu Item Service
 */

'use strict';

const menuItemRepo = require('../repositories/menuItem.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const list = (companyId) => menuItemRepo.list(companyId);

const getById = async (itemId, companyId) => {
    const item = await menuItemRepo.findById(itemId, companyId);
    if (!item) throw new NotFoundError('Menu item');
    return item;
};

const create = async (data, companyId) => {
    if (!data.itemName) throw new ValidationError('itemName is required');
    if (!data.categoryId) throw new ValidationError('categoryId is required');
    if (!data.foodType) throw new ValidationError('foodType is required');
    if (data.basePrice == null) throw new ValidationError('basePrice is required');
    return menuItemRepo.create({ ...data, companyId });
};

const update = async (itemId, data, companyId) => {
    await getById(itemId, companyId);
    return menuItemRepo.update(itemId, companyId, data);
};

const listCategories = (companyId) => menuItemRepo.listCategories(companyId);

module.exports = { list, getById, create, update, listCategories };
