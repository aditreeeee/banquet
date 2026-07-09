/**
 * Menu Item Service
 */

'use strict';

const { parse } = require('fast-csv');
const { Readable } = require('stream');
const menuItemRepo = require('../repositories/menuItem.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const FOOD_TYPES = ['veg', 'non_veg', 'jain', 'vegan', 'mixed'];

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

/**
 * CSV import — expects columns: category_name,item_name,description,food_type,
 * unit,base_price,tax_percent,unit_cost. Categories are matched by name or
 * created on the fly (findOrCreateCategoryByName), so a company never needs
 * to pre-create categories before importing. Bad rows are skipped and
 * reported rather than aborting the whole import.
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
                const rowNum = i + 2; // +1 header, +1 to make it 1-indexed
                try {
                    if (!row.item_name)  throw new Error('item_name is required');
                    if (!row.category_name) throw new Error('category_name is required');
                    const basePrice = parseFloat(row.base_price);
                    if (Number.isNaN(basePrice)) throw new Error('base_price must be a number');
                    const foodType = FOOD_TYPES.includes(row.food_type) ? row.food_type : 'veg';

                    const categoryId = await menuItemRepo.findOrCreateCategoryByName(companyId, row.category_name.trim());
                    await menuItemRepo.create({
                        companyId, categoryId,
                        itemName:    row.item_name.trim(),
                        description: row.description || null,
                        foodType,
                        unit:        row.unit || 'plate',
                        basePrice,
                        taxPercent:  parseFloat(row.tax_percent) || 0,
                        unitCost:    parseFloat(row.unit_cost) || 0,
                    });
                    created++;
                } catch (err) {
                    errors.push({ row: rowNum, message: err.message });
                }
            }
            resolve({ totalRows: rows.length, created, failed: errors.length, errors });
        });
});

module.exports = { list, getById, create, update, listCategories, importCsv };
