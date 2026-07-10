/**
 * Catering Repository — Catering Packages, now backed by the centralized
 * Master Menu (MenuItems) via CateringPackageItems rather than duplicating
 * menu data per package.
 */

'use strict';

const { executeQuery } = require('../config/database');

const listPackages = async (companyId) => {
    return executeQuery(
        `SELECT package_id, package_name, package_type, description, price_per_plate, min_plates, is_active
         FROM CateringPackages WHERE (@companyId IS NULL OR company_id = @companyId) AND is_active = 1 ORDER BY package_name`,
        { companyId: companyId || null }
    );
};

const findPackageById = async (packageId, companyId) => {
    const rows = await executeQuery(
        `SELECT package_id, company_id, package_name, package_type, description, price_per_plate, min_plates, is_active
         FROM CateringPackages WHERE package_id = @packageId AND company_id = @companyId`,
        { packageId, companyId }
    );
    return rows[0] || null;
};

const createPackage = async ({ companyId, packageName, packageType, description, pricePerPlate, minPlates }) => {
    const result = await executeQuery(
        `INSERT INTO CateringPackages (company_id, package_name, package_type, description, price_per_plate, min_plates, is_active, created_at)
         OUTPUT INSERTED.package_id AS id
         VALUES (@companyId, @name, @type, @desc, @price, @minPlates, 1, GETUTCDATE())`,
        {
            companyId,
            name: packageName,
            type: packageType,
            desc: description || null,
            price: pricePerPlate || 0,
            minPlates: minPlates || 50,
        }
    );
    return findPackageById(result[0].id, companyId);
};

const updatePackagePrice = async (packageId, companyId, pricePerPlate) => {
    await executeQuery(
        `UPDATE CateringPackages SET price_per_plate = @price WHERE package_id = @packageId AND company_id = @companyId`,
        { packageId, companyId, price: pricePerPlate }
    );
    return findPackageById(packageId, companyId);
};

const setPackageActive = async (packageId, companyId, isActive) => {
    await executeQuery(
        `UPDATE CateringPackages SET is_active = @isActive WHERE package_id = @packageId AND company_id = @companyId`,
        { packageId, companyId, isActive }
    );
    return findPackageById(packageId, companyId);
};

/**
 * The Master Menu items linked to a package, with each item's tax/margin
 * computed from MenuItems (the single source of truth) — never duplicated
 * onto the package itself.
 */
const getPackageItems = async (packageId) => {
    return executeQuery(
        `SELECT cpi.package_item_id, cpi.item_id, cpi.quantity_per_plate,
                mi.item_name, mi.food_type, mi.unit, mi.base_price, mi.tax_percent, mi.unit_cost,
                CAST(mi.base_price * mi.tax_percent / 100 AS DECIMAL(10,2)) AS tax_amount,
                CAST(mi.base_price * (1 + mi.tax_percent / 100) AS DECIMAL(10,2)) AS final_price
         FROM CateringPackageItems cpi
         JOIN MenuItems mi ON mi.item_id = cpi.item_id
         WHERE cpi.package_id = @packageId
         ORDER BY mi.item_name`,
        { packageId }
    );
};

const addPackageItem = async (packageId, itemId, quantityPerPlate) => {
    await executeQuery(
        `INSERT INTO CateringPackageItems (package_id, item_id, quantity_per_plate, created_at)
         VALUES (@packageId, @itemId, @qty, SYSUTCDATETIME())`,
        { packageId, itemId, qty: quantityPerPlate || 1 }
    );
};

const removePackageItem = async (packageId, itemId) => {
    await executeQuery(
        `DELETE FROM CateringPackageItems WHERE package_id = @packageId AND item_id = @itemId`,
        { packageId, itemId }
    );
};

module.exports = {
    listPackages, findPackageById, createPackage, updatePackagePrice, setPackageActive,
    getPackageItems, addPackageItem, removePackageItem,
};
