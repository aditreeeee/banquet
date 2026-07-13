/**
 * Decoration Service — Decorations catalog business logic (items, categories,
 * packages). Cloned from resource.service.js + catering.service.js.
 */

'use strict';

const { parse } = require('fast-csv');
const { Readable } = require('stream');
const decorationRepo = require('../repositories/decoration.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const NAME_MAX_LENGTH = 200;

// ─── Categories ───────────────────────────────────────────────────────────────

const listCategories = (companyId) => decorationRepo.listCategories(companyId);

const createCategory = async (companyId, categoryName) => {
    if (!categoryName || !categoryName.trim()) throw new ValidationError('categoryName is required');
    const categoryId = await decorationRepo.createCategory(companyId, categoryName.trim());
    return { categoryId, categoryName: categoryName.trim() };
};

// ─── Items ────────────────────────────────────────────────────────────────────

const listItems = (companyId, opts) => decorationRepo.listItems(companyId, opts);

const getItemById = async (decorationId, companyId) => {
    const item = await decorationRepo.findItemById(decorationId, companyId);
    if (!item) throw new NotFoundError('Decoration item');
    return item;
};

const validateItemFields = (data) => {
    if (data.decorationName != null && data.decorationName.length > NAME_MAX_LENGTH) {
        throw new ValidationError(`decorationName must be ${NAME_MAX_LENGTH} characters or fewer`);
    }
    if (data.quantityAvailable != null && data.quantityAvailable < 0) {
        throw new ValidationError('quantityAvailable cannot be negative');
    }
};

const createItem = async (companyId, data, createdBy) => {
    if (!data.decorationName) throw new ValidationError('decorationName is required');
    validateItemFields(data);
    const decorationCode = data.decorationCode || await decorationRepo.nextItemCode(companyId);
    const item = await decorationRepo.createItem(companyId, { ...data, decorationCode }, createdBy);

    await auditLogRepo.log({
        companyId, userId: createdBy,
        action: 'decoration_item.created', entityType: 'decoration_item', entityId: item.decoration_id,
        description: `Decoration item "${item.decoration_name}" created`,
        newValues: data,
    });

    return item;
};

const updateItem = async (decorationId, companyId, data, userId) => {
    validateItemFields(data);
    const existing = await getItemById(decorationId, companyId);
    const updated = await decorationRepo.updateItem(decorationId, companyId, data);

    await auditLogRepo.log({
        companyId, userId,
        action: 'decoration_item.updated', entityType: 'decoration_item', entityId: decorationId,
        description: `Decoration item "${existing.decoration_name}" updated`,
        oldValues: existing, newValues: data,
    });

    return updated;
};

/**
 * CSV import — expects columns: decoration_name,category_name,theme,color_scheme,
 * vendor,unit,quantity_available,unit_cost,rental_price,installation_cost,
 * removal_cost,tax_percent,discount_percent — mirrors resource.service.js's importCsv.
 */
const importCsv = (buffer, companyId, createdBy) => new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
        .pipe(parse({ headers: true, trim: true }))
        .on('error', reject)
        .on('data', (row) => rows.push(row))
        .on('end', async () => {
            const categories = await decorationRepo.listCategories(companyId);
            const categoryByName = new Map(categories.map(c => [c.category_name.toLowerCase(), c.category_id]));

            let created = 0;
            const errors = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rowNum = i + 2;
                try {
                    if (!row.decoration_name) throw new Error('decoration_name is required');
                    await createItem(companyId, {
                        decorationName:   row.decoration_name.trim(),
                        categoryId:       row.category_name ? (categoryByName.get(row.category_name.trim().toLowerCase()) || null) : null,
                        theme:            row.theme || null,
                        colorScheme:      row.color_scheme || null,
                        vendor:           row.vendor || null,
                        unit:             row.unit || 'piece',
                        quantityAvailable: parseInt(row.quantity_available, 10) || 0,
                        unitCost:         parseFloat(row.unit_cost) || 0,
                        rentalPrice:      parseFloat(row.rental_price) || 0,
                        installationCost: parseFloat(row.installation_cost) || 0,
                        removalCost:      parseFloat(row.removal_cost) || 0,
                        taxPercent:       parseFloat(row.tax_percent) || 0,
                        discountPercent:  parseFloat(row.discount_percent) || 0,
                    }, createdBy);
                    created++;
                } catch (err) {
                    errors.push({ row: rowNum, message: err.message });
                }
            }
            resolve({ totalRows: rows.length, created, failed: errors.length, errors });
        });
});

// ─── Packages ─────────────────────────────────────────────────────────────────

const listPackages = (companyId) => decorationRepo.listPackages(companyId);

const getPackageById = async (packageId, companyId) => {
    const pkg = await decorationRepo.findPackageById(packageId, companyId);
    if (!pkg) throw new NotFoundError('Decoration package');
    return pkg;
};

const createPackage = async (companyId, data, createdBy) => {
    if (!data.packageName) throw new ValidationError('packageName is required');
    const pkg = await decorationRepo.createPackage(companyId, data, createdBy);

    await auditLogRepo.log({
        companyId, userId: createdBy,
        action: 'decoration_package.created', entityType: 'decoration_package', entityId: pkg.package_id,
        description: `Decoration package "${pkg.package_name}" created`,
        newValues: data,
    });

    return pkg;
};

const updatePackage = async (packageId, companyId, data, userId) => {
    const existing = await getPackageById(packageId, companyId);
    const updated = await decorationRepo.updatePackage(packageId, companyId, data);

    await auditLogRepo.log({
        companyId, userId,
        action: 'decoration_package.updated', entityType: 'decoration_package', entityId: packageId,
        description: `Decoration package "${existing.package_name}" updated`,
        oldValues: existing, newValues: data,
    });

    return updated;
};

const deletePackage = async (packageId, companyId, userId) => {
    const existing = await getPackageById(packageId, companyId);
    const result = await decorationRepo.updatePackage(packageId, companyId, { isActive: false });

    await auditLogRepo.log({
        companyId, userId,
        action: 'decoration_package.deleted', entityType: 'decoration_package', entityId: packageId,
        description: `Decoration package "${existing.package_name}" deleted`,
    });

    return result;
};

/**
 * A package's live price is derived from its linked items (rental + install +
 * removal, less discount, plus tax) — never duplicated onto the package row
 * itself, same principle as catering.service.js's getPackagePricing(). A
 * package may also carry an admin-set flat_price override ("Save as
 * Template"), in which case that wins instead.
 */
const getPackagePricing = async (packageId, companyId) => {
    const pkg = await getPackageById(packageId, companyId);
    const items = await decorationRepo.getPackageItems(packageId);

    const computed = items.reduce((sum, i) => {
        const base = (parseFloat(i.rental_price) || 0) * i.quantity;
        const withInstall = base + (parseFloat(i.installation_cost) || 0) + (parseFloat(i.removal_cost) || 0);
        const discounted = withInstall * (1 - (parseFloat(i.discount_percent) || 0) / 100);
        const taxed = discounted * (1 + (parseFloat(i.tax_percent) || 0) / 100);
        return sum + taxed;
    }, 0);

    const totalPrice = pkg.flat_price != null ? parseFloat(pkg.flat_price) : Math.round(computed);

    return { package: pkg, items, computedPrice: Math.round(computed), totalPrice };
};

const addItemToPackage = async (packageId, companyId, decorationId, quantity) => {
    await getPackageById(packageId, companyId);
    await getItemById(decorationId, companyId);
    await decorationRepo.addPackageItem(packageId, decorationId, quantity);
    return decorationRepo.getPackageItems(packageId);
};

const removeItemFromPackage = async (packageId, companyId, decorationId) => {
    await getPackageById(packageId, companyId);
    await decorationRepo.removePackageItem(packageId, decorationId);
    return decorationRepo.getPackageItems(packageId);
};

const getInventorySnapshot = (companyId, eventDate) => decorationRepo.getInventorySnapshot(companyId, eventDate);

module.exports = {
    listCategories, createCategory,
    listItems, getItemById, createItem, updateItem, importCsv,
    listPackages, getPackageById, createPackage, updatePackage, deletePackage,
    getPackagePricing, addItemToPackage, removeItemFromPackage,
    getInventorySnapshot,
};
