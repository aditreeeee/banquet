/**
 * Decoration Repository — Decorations catalog (categories, items, packages)
 * and per-booking allocation against DecorationItems' quantity_available.
 * Cloned from resource.repository.js's allocation pattern (UPDLOCK/HOLDLOCK
 * inside a transaction) since decoration items are finite stock exactly like
 * shared inventory — see backend/scripts/setup.js's DecorationItems block for
 * why this isn't just a filtered view of Resources.
 */

'use strict';

const { executeQuery, withTransaction } = require('../config/database');

// ─── Categories ───────────────────────────────────────────────────────────────

const listCategories = async (companyId) => {
    return executeQuery(
        `SELECT category_id, category_name, sort_order, is_active
         FROM DecorationCategories WHERE company_id = @companyId AND is_active = 1 ORDER BY sort_order, category_name`,
        { companyId }
    );
};

const createCategory = async (companyId, categoryName) => {
    const result = await executeQuery(
        `INSERT INTO DecorationCategories (company_id, category_name, sort_order, is_active, created_at)
         OUTPUT INSERTED.category_id AS id
         VALUES (@companyId, @name, 0, 1, SYSUTCDATETIME())`,
        { companyId, name: categoryName }
    );
    return result[0].id;
};

// ─── Items ────────────────────────────────────────────────────────────────────

const ITEM_SELECT = `
    SELECT di.decoration_id, di.company_id, di.category_id, dc.category_name,
           di.decoration_code, di.decoration_name, di.description, di.theme, di.color_scheme,
           di.vendor, di.unit, di.quantity_available, di.unit_cost, di.rental_price,
           di.installation_cost, di.removal_cost, di.tax_percent, di.discount_percent,
           di.images, di.notes, di.is_active, di.created_by, di.created_at, di.updated_at
    FROM DecorationItems di
    LEFT JOIN DecorationCategories dc ON dc.category_id = di.category_id
`;

const listItems = async (companyId, { activeOnly } = {}) => {
    return executeQuery(
        `${ITEM_SELECT} WHERE di.company_id = @companyId ${activeOnly ? 'AND di.is_active = 1' : ''} ORDER BY di.decoration_name`,
        { companyId }
    );
};

const findItemById = async (decorationId, companyId) => {
    const rows = await executeQuery(
        `${ITEM_SELECT} WHERE di.decoration_id = @id AND di.company_id = @companyId`,
        { id: decorationId, companyId }
    );
    return rows[0] || null;
};

const nextItemCode = async (companyId) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS cnt FROM DecorationItems WHERE company_id = @companyId`,
        { companyId }
    );
    return `DEC-${String(rows[0].cnt + 1).padStart(4, '0')}`;
};

const createItem = async (companyId, data, createdBy) => {
    const result = await executeQuery(
        `INSERT INTO DecorationItems
            (company_id, category_id, decoration_code, decoration_name, description, theme, color_scheme,
             vendor, unit, quantity_available, unit_cost, rental_price, installation_cost, removal_cost,
             tax_percent, discount_percent, images, notes, is_active, created_by, created_at, updated_at)
         OUTPUT INSERTED.decoration_id AS id
         VALUES
            (@companyId, @categoryId, @code, @name, @description, @theme, @colorScheme,
             @vendor, @unit, @quantityAvailable, @unitCost, @rentalPrice, @installationCost, @removalCost,
             @taxPercent, @discountPercent, @images, @notes, 1, @createdBy, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        {
            companyId,
            categoryId:        data.categoryId || null,
            code:              data.decorationCode,
            name:              data.decorationName,
            description:       data.description || null,
            theme:             data.theme || null,
            colorScheme:       data.colorScheme || null,
            vendor:            data.vendor || null,
            unit:              data.unit || 'piece',
            quantityAvailable: data.quantityAvailable || 0,
            unitCost:          data.unitCost || 0,
            rentalPrice:       data.rentalPrice || 0,
            installationCost:  data.installationCost || 0,
            removalCost:       data.removalCost || 0,
            taxPercent:        data.taxPercent || 0,
            discountPercent:   data.discountPercent || 0,
            images:            data.images ? JSON.stringify(data.images) : null,
            notes:             data.notes || null,
            createdBy:         createdBy || null,
        }
    );
    return findItemById(result[0].id, companyId);
};

const updateItem = async (decorationId, companyId, data) => {
    await executeQuery(
        `UPDATE DecorationItems
         SET category_id        = ISNULL(@categoryId,        category_id),
             decoration_name    = ISNULL(@name,               decoration_name),
             description        = ISNULL(@description,        description),
             theme              = ISNULL(@theme,               theme),
             color_scheme       = ISNULL(@colorScheme,         color_scheme),
             vendor             = ISNULL(@vendor,              vendor),
             unit               = ISNULL(@unit,                unit),
             quantity_available = ISNULL(@quantityAvailable,   quantity_available),
             unit_cost          = ISNULL(@unitCost,            unit_cost),
             rental_price       = ISNULL(@rentalPrice,         rental_price),
             installation_cost  = ISNULL(@installationCost,    installation_cost),
             removal_cost       = ISNULL(@removalCost,         removal_cost),
             tax_percent        = ISNULL(@taxPercent,          tax_percent),
             discount_percent   = ISNULL(@discountPercent,     discount_percent),
             images             = ISNULL(@images,              images),
             notes              = ISNULL(@notes,               notes),
             is_active          = ISNULL(@isActive,            is_active),
             updated_at         = SYSUTCDATETIME()
         WHERE decoration_id = @id AND company_id = @companyId`,
        {
            id: decorationId,
            companyId,
            categoryId:        data.categoryId != null ? data.categoryId : null,
            name:              data.decorationName || null,
            description:       data.description != null ? data.description : null,
            theme:             data.theme != null ? data.theme : null,
            colorScheme:       data.colorScheme != null ? data.colorScheme : null,
            vendor:            data.vendor != null ? data.vendor : null,
            unit:              data.unit || null,
            quantityAvailable: data.quantityAvailable != null ? data.quantityAvailable : null,
            unitCost:          data.unitCost != null ? data.unitCost : null,
            rentalPrice:       data.rentalPrice != null ? data.rentalPrice : null,
            installationCost:  data.installationCost != null ? data.installationCost : null,
            removalCost:       data.removalCost != null ? data.removalCost : null,
            taxPercent:        data.taxPercent != null ? data.taxPercent : null,
            discountPercent:   data.discountPercent != null ? data.discountPercent : null,
            images:            data.images ? JSON.stringify(data.images) : null,
            notes:             data.notes != null ? data.notes : null,
            isActive:          data.isActive != null ? data.isActive : null,
        }
    );
    return findItemById(decorationId, companyId);
};

// ─── Packages ─────────────────────────────────────────────────────────────────

const listPackages = async (companyId) => {
    return executeQuery(
        `SELECT package_id, package_name, package_type, description, flat_price, is_active, created_at
         FROM DecorationPackages WHERE company_id = @companyId AND is_active = 1 ORDER BY package_name`,
        { companyId }
    );
};

const findPackageById = async (packageId, companyId) => {
    const rows = await executeQuery(
        `SELECT package_id, company_id, package_name, package_type, description, flat_price, is_active, created_at
         FROM DecorationPackages WHERE package_id = @id AND company_id = @companyId`,
        { id: packageId, companyId }
    );
    return rows[0] || null;
};

const createPackage = async (companyId, data, createdBy) => {
    const result = await executeQuery(
        `INSERT INTO DecorationPackages (company_id, package_name, package_type, description, flat_price, is_active, created_by, created_at, updated_at)
         OUTPUT INSERTED.package_id AS id
         VALUES (@companyId, @name, @type, @description, @flatPrice, 1, @createdBy, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        {
            companyId,
            name: data.packageName,
            type: data.packageType || null,
            description: data.description || null,
            flatPrice: data.flatPrice != null ? data.flatPrice : null,
            createdBy: createdBy || null,
        }
    );
    return findPackageById(result[0].id, companyId);
};

const updatePackage = async (packageId, companyId, data) => {
    await executeQuery(
        `UPDATE DecorationPackages
         SET package_name = ISNULL(@name,        package_name),
             package_type = ISNULL(@type,         package_type),
             description  = ISNULL(@description,  description),
             flat_price   = @flatPrice,
             is_active    = ISNULL(@isActive,     is_active),
             updated_at   = SYSUTCDATETIME()
         WHERE package_id = @id AND company_id = @companyId`,
        {
            id: packageId,
            companyId,
            name: data.packageName || null,
            type: data.packageType || null,
            description: data.description != null ? data.description : null,
            flatPrice: data.flatPrice !== undefined ? data.flatPrice : null,
            isActive: data.isActive != null ? data.isActive : null,
        }
    );
    return findPackageById(packageId, companyId);
};

const getPackageItems = async (packageId) => {
    return executeQuery(
        `SELECT dpi.package_item_id, dpi.decoration_id, dpi.quantity,
                di.decoration_name, di.decoration_code, di.unit, di.rental_price,
                di.installation_cost, di.removal_cost, di.tax_percent, di.discount_percent
         FROM DecorationPackageItems dpi
         JOIN DecorationItems di ON di.decoration_id = dpi.decoration_id
         WHERE dpi.package_id = @packageId
         ORDER BY di.decoration_name`,
        { packageId }
    );
};

const addPackageItem = async (packageId, decorationId, quantity) => {
    await executeQuery(
        `INSERT INTO DecorationPackageItems (package_id, decoration_id, quantity, created_at)
         VALUES (@packageId, @decorationId, @qty, SYSUTCDATETIME())`,
        { packageId, decorationId, qty: quantity || 1 }
    );
};

const removePackageItem = async (packageId, decorationId) => {
    await executeQuery(
        `DELETE FROM DecorationPackageItems WHERE package_id = @packageId AND decoration_id = @decorationId`,
        { packageId, decorationId }
    );
};

// ─── Booking allocation (same shape/semantics as resource.repository.js) ──────

const allocateInTx = async (tx, { bookingId, companyId, decorations, eventDate }) => {
    const { ConflictError, NotFoundError } = require('../api/v1/middleware/errorHandler');

    const requested = decorations.filter(d => d.quantity && d.quantity > 0);
    if (!requested.length) return;
    const decorationIds = requested.map(d => d.decorationId);

    const itemRows = await tx.execute(
        `SELECT decoration_id, decoration_name, quantity_available
         FROM DecorationItems WHERE decoration_id IN (${decorationIds.map((_, i) => `@d${i}`).join(',')}) AND company_id = @companyId AND is_active = 1`,
        decorationIds.reduce((p, id, i) => ({ ...p, [`d${i}`]: id }), { companyId })
    );
    const itemById = new Map(itemRows.map(r => [r.decoration_id, r]));

    const allocatedRows = await tx.execute(
        `SELECT bd.decoration_id, ISNULL(SUM(bd.quantity_allocated), 0) AS allocated
         FROM BookingDecorations bd WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
         JOIN Bookings b ON b.booking_id = bd.booking_id
         WHERE bd.decoration_id IN (${decorationIds.map((_, i) => `@d${i}`).join(',')})
           AND b.event_date = @eventDate
           AND b.status NOT IN ('cancelled', 'draft')
         GROUP BY bd.decoration_id`,
        decorationIds.reduce((p, id, i) => ({ ...p, [`d${i}`]: id }), { eventDate: new Date(eventDate) })
    );
    const allocatedById = new Map(allocatedRows.map(r => [r.decoration_id, r.allocated]));

    for (const { decorationId, quantity, packageId, installationAt, removalAt, notes } of requested) {
        const item = itemById.get(decorationId);
        if (!item) throw new NotFoundError(`Decoration item ${decorationId}`);

        const allocated = allocatedById.get(decorationId) || 0;
        if (allocated + quantity > item.quantity_available) {
            throw new ConflictError(
                `Not enough "${item.decoration_name}" available on this date (requested ${quantity}, available ${item.quantity_available - allocated})`
            );
        }

        await tx.execute(
            `INSERT INTO BookingDecorations (booking_id, decoration_id, package_id, quantity_allocated, installation_at, removal_at, notes, created_at)
             VALUES (@bookingId, @decorationId, @packageId, @quantity, @installationAt, @removalAt, @notes, SYSUTCDATETIME())`,
            {
                bookingId, decorationId, quantity,
                packageId: packageId || null,
                installationAt: installationAt ? new Date(installationAt) : null,
                removalAt: removalAt ? new Date(removalAt) : null,
                notes: notes || null,
            }
        );
    }
};

const reallocateForBooking = async (bookingId, companyId, decorations, eventDate) => {
    return withTransaction(async (tx) => {
        await tx.execute(`DELETE FROM BookingDecorations WHERE booking_id = @bookingId`, { bookingId });
        await allocateInTx(tx, { bookingId, companyId, decorations, eventDate });
    });
};

const getAllocationsForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `SELECT bd.allocation_id, bd.decoration_id, di.decoration_name, di.unit,
                bd.package_id, dp.package_name, bd.quantity_allocated,
                bd.installation_at, bd.removal_at, bd.notes,
                di.rental_price, di.installation_cost, di.removal_cost, di.tax_percent, di.discount_percent
         FROM BookingDecorations bd
         JOIN DecorationItems di ON di.decoration_id = bd.decoration_id
         JOIN Bookings b ON b.booking_id = bd.booking_id
         LEFT JOIN DecorationPackages dp ON dp.package_id = bd.package_id
         WHERE bd.booking_id = @bookingId AND b.company_id = @companyId`,
        { bookingId, companyId }
    );
};

/**
 * Reserved vs. available for every active decoration item on a given date —
 * same shape as resource.repository.js's getInventorySnapshot, powers the
 * Decorations catalog page's KPI strip and "Reserved" column.
 */
const getInventorySnapshot = async (companyId, eventDate) => {
    return executeQuery(
        `SELECT di.decoration_id, di.decoration_name, dc.category_name, di.quantity_available,
                ISNULL(SUM(bd.quantity_allocated), 0) AS reserved,
                di.quantity_available - ISNULL(SUM(bd.quantity_allocated), 0) AS available,
                CASE WHEN di.quantity_available - ISNULL(SUM(bd.quantity_allocated), 0) <= 0 THEN 1 ELSE 0 END AS is_shortage
         FROM DecorationItems di
         LEFT JOIN DecorationCategories dc ON dc.category_id = di.category_id
         LEFT JOIN BookingDecorations bd ON bd.decoration_id = di.decoration_id
             AND bd.booking_id IN (
                 SELECT booking_id FROM Bookings
                 WHERE company_id = @companyId AND event_date = @eventDate AND status NOT IN ('cancelled', 'draft')
             )
         WHERE di.company_id = @companyId AND di.is_active = 1
         GROUP BY di.decoration_id, di.decoration_name, dc.category_name, di.quantity_available
         ORDER BY is_shortage DESC, di.decoration_name`,
        { companyId, eventDate: new Date(eventDate) }
    );
};

module.exports = {
    listCategories, createCategory,
    listItems, findItemById, nextItemCode, createItem, updateItem,
    listPackages, findPackageById, createPackage, updatePackage,
    getPackageItems, addPackageItem, removePackageItem,
    allocateInTx, reallocateForBooking, getAllocationsForBooking, getInventorySnapshot,
};
