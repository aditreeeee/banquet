/**
 * Menu Item Repository — catering menu with tax/margin computation
 */

'use strict';

const { executeQuery } = require('../config/database');

const SELECT_COMPUTED = `
    mi.item_id, mi.company_id, mi.category_id, mc.category_name, mi.item_name, mi.description, mi.food_type, mi.unit,
    mi.base_price, mi.tax_percent, mi.unit_cost, mi.is_active, mi.created_at,
    CAST(mi.base_price * mi.tax_percent / 100 AS DECIMAL(10,2)) AS tax_amount,
    CAST(mi.base_price - mi.unit_cost AS DECIMAL(10,2)) AS margin,
    CAST(mi.base_price * (1 + mi.tax_percent / 100) AS DECIMAL(10,2)) AS final_price
`;

const list = async (companyId) => {
    return executeQuery(
        `SELECT ${SELECT_COMPUTED} FROM MenuItems mi
         LEFT JOIN MenuCategories mc ON mc.category_id = mi.category_id
         WHERE mi.company_id = @companyId AND mi.is_active = 1 ORDER BY mi.item_name`,
        { companyId }
    );
};

const findById = async (itemId, companyId) => {
    const rows = await executeQuery(
        `SELECT ${SELECT_COMPUTED} FROM MenuItems mi
         LEFT JOIN MenuCategories mc ON mc.category_id = mi.category_id
         WHERE mi.item_id = @itemId AND mi.company_id = @companyId`,
        { itemId, companyId }
    );
    return rows[0] || null;
};

const listCategories = async (companyId) => {
    return executeQuery(
        `SELECT category_id, category_name, food_type, sort_order
         FROM MenuCategories WHERE company_id = @companyId AND is_active = 1 ORDER BY sort_order, category_name`,
        { companyId }
    );
};

const create = async ({ companyId, categoryId, itemName, description, foodType, unit, basePrice, taxPercent, unitCost }) => {
    const result = await executeQuery(
        `INSERT INTO MenuItems (company_id, category_id, item_name, description, food_type, unit, base_price, tax_percent, unit_cost, is_active, created_at)
         OUTPUT INSERTED.item_id AS id
         VALUES (@companyId, @categoryId, @itemName, @description, @foodType, @unit, @basePrice, @taxPercent, @unitCost, 1, GETUTCDATE())`,
        {
            companyId,
            categoryId,
            itemName,
            description: description || null,
            foodType,
            unit:        unit || 'plate',
            basePrice,
            taxPercent:  taxPercent || 0,
            unitCost:    unitCost   || 0,
        }
    );
    return findById(result[0].id, companyId);
};

const update = async (itemId, companyId, { itemName, description, basePrice, taxPercent, unitCost, isActive }) => {
    await executeQuery(
        `UPDATE MenuItems
         SET item_name   = ISNULL(@itemName,   item_name),
             description = ISNULL(@description, description),
             base_price  = ISNULL(@basePrice,  base_price),
             tax_percent = ISNULL(@taxPercent, tax_percent),
             unit_cost   = ISNULL(@unitCost,   unit_cost),
             is_active   = ISNULL(@isActive,   is_active)
         WHERE item_id = @itemId AND company_id = @companyId`,
        {
            itemId,
            companyId,
            itemName:    itemName    || null,
            description: description || null,
            basePrice:   basePrice   || null,
            taxPercent:  taxPercent  != null ? taxPercent : null,
            unitCost:    unitCost    != null ? unitCost   : null,
            isActive:    isActive    != null ? isActive   : null,
        }
    );
    return findById(itemId, companyId);
};

module.exports = { list, findById, create, update, listCategories };
