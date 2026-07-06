/**
 * Catering Service — Catering Packages computed from the centralized Master Menu.
 * When a package is selected for a booking, pricing/tax/inventory all derive
 * from MenuItems (the Master Menu), never duplicated per package.
 */

'use strict';

const cateringRepo = require('../repositories/catering.repository');
const menuItemRepo = require('../repositories/menuItem.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const listPackages = (companyId) => cateringRepo.listPackages(companyId);

const getPackage = async (packageId, companyId) => {
    const pkg = await cateringRepo.findPackageById(packageId, companyId);
    if (!pkg) throw new NotFoundError('Catering package');
    return pkg;
};

const createPackage = async ({ packageName, packageType, description, pricePerPlate, minPlates }, companyId) => {
    if (!packageName) throw new ValidationError('packageName is required');
    if (!packageType) throw new ValidationError('packageType is required (veg/non_veg/jain/mixed)');
    return cateringRepo.createPackage({ companyId, packageName, packageType, description, pricePerPlate, minPlates });
};

/**
 * Full pricing breakdown for a package: each Master Menu item's contribution
 * (price, tax, margin) plus the computed per-plate total — this is what
 * "pricing/tax/inventory populate automatically" means in practice.
 */
const getPackagePricing = async (packageId, companyId) => {
    const pkg = await getPackage(packageId, companyId);
    const items = await cateringRepo.getPackageItems(packageId);

    const computedPerPlate = items.reduce((sum, i) => sum + (i.final_price * i.quantity_per_plate), 0);
    const taxPerPlate = items.reduce((sum, i) => sum + (i.tax_amount * i.quantity_per_plate), 0);
    const costPerPlate = items.reduce((sum, i) => sum + (i.unit_cost * i.quantity_per_plate), 0);

    return {
        package: pkg,
        items,
        computed_price_per_plate: Number(computedPerPlate.toFixed(2)),
        computed_tax_per_plate: Number(taxPerPlate.toFixed(2)),
        computed_cost_per_plate: Number(costPerPlate.toFixed(2)),
        computed_margin_per_plate: Number((computedPerPlate - taxPerPlate - costPerPlate).toFixed(2)),
        // price_per_plate on the package itself may be a manual override; expose both.
        stored_price_per_plate: Number(pkg.price_per_plate),
    };
};

/**
 * Calculate the full catering bill for a booking's guest count — this is
 * "inventory requirements calculate automatically" + "final bill updates
 * automatically" from the spec.
 */
const calculateBillForGuests = async (packageId, companyId, guestCount) => {
    const pricing = await getPackagePricing(packageId, companyId);
    const plates = guestCount || 0;
    return {
        ...pricing,
        guest_count: plates,
        total_bill: Number((pricing.computed_price_per_plate * plates).toFixed(2)),
        total_tax: Number((pricing.computed_tax_per_plate * plates).toFixed(2)),
        inventory_consumption: pricing.items.map(i => ({
            item_id: i.item_id,
            item_name: i.item_name,
            unit: i.unit,
            total_quantity_needed: Number((i.quantity_per_plate * plates).toFixed(2)),
        })),
    };
};

const addItemToPackage = async (packageId, companyId, { itemId, quantityPerPlate }) => {
    await getPackage(packageId, companyId);
    const item = await menuItemRepo.findById(itemId, companyId);
    if (!item) throw new NotFoundError('Menu item');
    await cateringRepo.addPackageItem(packageId, itemId, quantityPerPlate);
    return cateringRepo.getPackageItems(packageId);
};

const removeItemFromPackage = async (packageId, companyId, itemId) => {
    await getPackage(packageId, companyId);
    await cateringRepo.removePackageItem(packageId, itemId);
    return cateringRepo.getPackageItems(packageId);
};

/** Recompute price_per_plate from the linked Master Menu items and store it. */
const syncPackagePriceFromMenu = async (packageId, companyId) => {
    const pricing = await getPackagePricing(packageId, companyId);
    return cateringRepo.updatePackagePrice(packageId, companyId, pricing.computed_price_per_plate);
};

module.exports = {
    listPackages, getPackage, createPackage, getPackagePricing, calculateBillForGuests,
    addItemToPackage, removeItemFromPackage, syncPackagePriceFromMenu,
};
