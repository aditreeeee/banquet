/**
 * Resource Repository — shared inventory (chairs, projectors, etc.) and
 * per-booking allocations against it. Allocation checks use UPDLOCK/HOLDLOCK
 * inside a transaction to prevent over-allocation under concurrent writes,
 * the same pattern used for hall double-booking prevention.
 */

'use strict';

const { executeQuery } = require('../config/database');

// ─── CRUD ─────────────────────────────────────────────────────────────────────

const list = async (companyId) => {
    return executeQuery(
        `SELECT resource_id, resource_name, resource_type, category, supplier,
                unit_price, cost_price, quantity_available, is_active
         FROM Resources WHERE company_id = @companyId AND is_active = 1 ORDER BY category, resource_name`,
        { companyId }
    );
};

const findById = async (resourceId, companyId) => {
    const rows = await executeQuery(
        `SELECT resource_id, company_id, resource_name, resource_type, category, supplier,
                unit_price, cost_price, quantity_available, is_active
         FROM Resources WHERE resource_id = @resourceId AND company_id = @companyId`,
        { resourceId, companyId }
    );
    return rows[0] || null;
};

const create = async ({ companyId, resourceName, resourceType, category, supplier, unitPrice, costPrice, quantityAvailable }) => {
    const result = await executeQuery(
        `INSERT INTO Resources (company_id, resource_name, resource_type, category, supplier, unit_price, cost_price, quantity_available, is_active, created_at, updated_at)
         OUTPUT INSERTED.resource_id AS id
         VALUES (@companyId, @name, @type, @category, @supplier, @price, @cost, @qty, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        {
            companyId,
            name: resourceName,
            type: resourceType || null,
            category: category || 'custom',
            supplier: supplier || null,
            price: unitPrice || 0,
            cost: costPrice || 0,
            qty: quantityAvailable || 0,
        }
    );
    return findById(result[0].id, companyId);
};

const update = async (resourceId, companyId, { resourceName, category, supplier, unitPrice, costPrice, quantityAvailable, isActive }) => {
    await executeQuery(
        `UPDATE Resources
         SET resource_name      = ISNULL(@name,     resource_name),
             category           = ISNULL(@category, category),
             supplier           = ISNULL(@supplier, supplier),
             unit_price         = ISNULL(@price,    unit_price),
             cost_price         = ISNULL(@cost,     cost_price),
             quantity_available = ISNULL(@qty,      quantity_available),
             is_active          = ISNULL(@isActive, is_active),
             updated_at         = SYSUTCDATETIME()
         WHERE resource_id = @resourceId AND company_id = @companyId`,
        {
            resourceId,
            companyId,
            name:     resourceName      || null,
            category: category          || null,
            supplier: supplier          || null,
            price:    unitPrice         || null,
            cost:     costPrice         || null,
            qty:      quantityAvailable || null,
            isActive: isActive != null ? isActive : null,
        }
    );
    return findById(resourceId, companyId);
};

// ─── Allocation ───────────────────────────────────────────────────────────────

/**
 * Sum of quantity already allocated for a resource on a given event date,
 * across all non-cancelled/non-draft bookings (excludeBookingId for reschedule/edit checks).
 * Must be called inside a transaction — UPDLOCK/HOLDLOCK serializes concurrent
 * allocation checks against the same resource/date.
 */
const getAllocatedInTx = async (tx, { resourceId, eventDate, excludeBookingId }) => {
    const rows = await tx.execute(
        `SELECT ISNULL(SUM(br.quantity_allocated), 0) AS allocated
         FROM BookingResources br WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
         JOIN Bookings b ON b.booking_id = br.booking_id
         WHERE br.resource_id = @resourceId
           AND b.event_date = @eventDate
           AND b.status NOT IN ('cancelled', 'draft')
           AND (@excludeId IS NULL OR br.booking_id <> @excludeId)`,
        {
            resourceId,
            eventDate: new Date(eventDate),
            excludeId: excludeBookingId || null,
        }
    );
    return rows[0].allocated;
};

/**
 * Allocate a set of resources to a booking, inside the given transaction.
 * Throws ConflictError if any resource would be over-allocated.
 * @param {object} tx - transaction handle from withTransaction()
 * @param {number} bookingId
 * @param {number} companyId
 * @param {Array<{resourceId:number, quantity:number}>} resources
 * @param {string|Date} eventDate
 */
const allocateInTx = async (tx, { bookingId, companyId, resources, eventDate }) => {
    const { ConflictError, NotFoundError } = require('../api/v1/middleware/errorHandler');

    const requested = resources.filter(r => r.quantity && r.quantity > 0);
    if (!requested.length) return;
    const resourceIds = requested.map(r => r.resourceId);

    // Two batched queries instead of two-per-resource — same UPDLOCK/HOLDLOCK
    // serialization as before, just fetched for every requested resource at once.
    const resourceRows = await tx.execute(
        `SELECT resource_id, resource_name, quantity_available
         FROM Resources WHERE resource_id IN (${resourceIds.map((_, i) => `@r${i}`).join(',')}) AND company_id = @companyId AND is_active = 1`,
        resourceIds.reduce((p, id, i) => ({ ...p, [`r${i}`]: id }), { companyId })
    );
    const resourceById = new Map(resourceRows.map(r => [r.resource_id, r]));

    const allocatedRows = await tx.execute(
        `SELECT br.resource_id, ISNULL(SUM(br.quantity_allocated), 0) AS allocated
         FROM BookingResources br WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
         JOIN Bookings b ON b.booking_id = br.booking_id
         WHERE br.resource_id IN (${resourceIds.map((_, i) => `@r${i}`).join(',')})
           AND b.event_date = @eventDate
           AND b.status NOT IN ('cancelled', 'draft')
         GROUP BY br.resource_id`,
        resourceIds.reduce((p, id, i) => ({ ...p, [`r${i}`]: id }), { eventDate: new Date(eventDate) })
    );
    const allocatedById = new Map(allocatedRows.map(r => [r.resource_id, r.allocated]));

    for (const { resourceId, quantity } of requested) {
        const resource = resourceById.get(resourceId);
        if (!resource) throw new NotFoundError(`Resource ${resourceId}`);

        const allocated = allocatedById.get(resourceId) || 0;
        if (allocated + quantity > resource.quantity_available) {
            throw new ConflictError(
                `Not enough "${resource.resource_name}" available on this date (requested ${quantity}, available ${resource.quantity_available - allocated})`
            );
        }

        await tx.execute(
            `INSERT INTO BookingResources (booking_id, resource_id, quantity_allocated, created_at)
             VALUES (@bookingId, @resourceId, @quantity, SYSUTCDATETIME())`,
            { bookingId, resourceId, quantity }
        );
    }
};

/**
 * Public (non-locked) availability check for UI — "warn owner before shortage".
 */
const getAvailability = async ({ resourceId, eventDate, companyId }) => {
    const resource = await findById(resourceId, companyId);
    if (!resource) return null;

    const rows = await executeQuery(
        `SELECT ISNULL(SUM(br.quantity_allocated), 0) AS allocated
         FROM BookingResources br
         JOIN Bookings b ON b.booking_id = br.booking_id
         WHERE br.resource_id = @resourceId
           AND b.event_date = @eventDate
           AND b.status NOT IN ('cancelled', 'draft')`,
        { resourceId, eventDate: new Date(eventDate) }
    );
    const allocated = rows[0].allocated;

    return {
        resource_id: resource.resource_id,
        resource_name: resource.resource_name,
        quantity_available: resource.quantity_available,
        allocated,
        remaining: resource.quantity_available - allocated,
    };
};

const getAllocationsForBooking = async (bookingId, companyId) => {
    return executeQuery(
        `SELECT br.allocation_id, br.resource_id, r.resource_name, r.resource_type,
                br.quantity_allocated, r.unit_price
         FROM BookingResources br
         JOIN Resources r ON r.resource_id = br.resource_id
         JOIN Bookings b  ON b.booking_id  = br.booking_id
         WHERE br.booking_id = @bookingId AND b.company_id = @companyId`,
        { bookingId, companyId }
    );
};

/**
 * Reserved vs. available for every active resource on a given date, with a
 * shortage flag when nothing remains — used by the Command Center to surface
 * inventory alerts without an N+1 loop over individual resources.
 */
const getInventorySnapshot = async (companyId, eventDate) => {
    return executeQuery(
        `SELECT r.resource_id, r.resource_name, r.category, r.quantity_available,
                ISNULL(SUM(br.quantity_allocated), 0) AS reserved,
                r.quantity_available - ISNULL(SUM(br.quantity_allocated), 0) AS available,
                CASE WHEN r.quantity_available - ISNULL(SUM(br.quantity_allocated), 0) <= 0 THEN 1 ELSE 0 END AS is_shortage
         FROM Resources r
         LEFT JOIN BookingResources br ON br.resource_id = r.resource_id
             AND br.booking_id IN (
                 SELECT booking_id FROM Bookings
                 WHERE company_id = @companyId AND event_date = @eventDate AND status NOT IN ('cancelled', 'draft')
             )
         WHERE r.company_id = @companyId AND r.is_active = 1
         GROUP BY r.resource_id, r.resource_name, r.category, r.quantity_available
         ORDER BY is_shortage DESC, r.category, r.resource_name`,
        { companyId, eventDate: new Date(eventDate) }
    );
};

module.exports = {
    list,
    findById,
    create,
    update,
    allocateInTx,
    getAllocatedInTx,
    getAvailability,
    getAllocationsForBooking,
    getInventorySnapshot,
};
