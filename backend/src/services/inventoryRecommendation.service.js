/**
 * Inventory Recommendation Service — suggests default resource quantities for
 * a booking based on guest count, derived from the existing Resources +
 * per-date availability snapshot. Recommendations are a starting point only;
 * the caller (booking creation) sends the final, possibly-edited quantities
 * through the existing resourceRepo.allocateInTx path, which is the sole
 * place overallocation is actually enforced.
 */

'use strict';

const resourceRepo = require('../repositories/resource.repository');

// Configurable ratios — tune here rather than scattering magic numbers in the UI.
const CHAIR_BUFFER_PCT = 0.10;   // 10% spare chairs beyond guest count
const GUESTS_PER_TABLE = 10;     // one round table per N guests

const isChair = r => /chair/i.test(r.resource_name);
const isTable = r => /table/i.test(r.resource_name) && !/cocktail/i.test(r.resource_name);

/**
 * @param {Object} params - { companyId, guestCount, eventDate }
 * @returns {Promise<Array>} one row per recommended resource:
 *   { resource_id, resource_name, category, unit_price, recommended_quantity, available, is_shortage }
 */
const recommendForBooking = async ({ companyId, guestCount, eventDate }) => {
    const snapshot = await resourceRepo.getInventorySnapshot(companyId, eventDate);
    const guests = Math.max(0, parseInt(guestCount, 10) || 0);
    const recommendations = [];

    // Chairs: guest count + buffer, one recommendation per matching resource (usually just one).
    snapshot.filter(isChair).forEach(r => {
        const qty = Math.ceil(guests * (1 + CHAIR_BUFFER_PCT));
        if (qty > 0) recommendations.push(buildRow(r, qty));
    });

    // Tables: guests / ratio, rounded up.
    snapshot.filter(isTable).forEach(r => {
        const qty = Math.ceil(guests / GUESTS_PER_TABLE);
        if (qty > 0) recommendations.push(buildRow(r, qty));
    });

    // Everything else: one representative item per remaining category as a sensible
    // default "set" (e.g. one sound system, one lighting set) — skip the catch-all
    // 'custom' category since it has no consistent per-guest meaning.
    const handledIds = new Set(recommendations.map(r => r.resource_id));
    const seenCategories = new Set();
    snapshot
        .filter(r => !handledIds.has(r.resource_id) && r.category !== 'custom' && r.category !== 'furniture')
        .forEach(r => {
            if (seenCategories.has(r.category)) return;
            seenCategories.add(r.category);
            if (r.available > 0) recommendations.push(buildRow(r, 1));
        });

    return recommendations;
};

const buildRow = (r, qty) => ({
    resource_id: r.resource_id,
    resource_name: r.resource_name,
    category: r.category,
    recommended_quantity: qty,
    available: r.available,
    is_shortage: qty > r.available,
});

module.exports = { recommendForBooking };
