/**
 * Coupon Service — coupon CRUD + booking-time eligibility validation,
 * discount calculation, and redemption (Promotion & Coupon Management).
 */
'use strict';

const couponRepo = require('../repositories/coupon.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError, ConflictError } = require('../api/v1/middleware/errorHandler');

// Coupons.applicable_* columns are JSON-array strings on the DB side, but
// the API accepts/returns real JS arrays — this is the one seam that
// converts between the two, so callers never have to think about it.
const ARRAY_FIELDS = ['applicableHalls', 'applicableEvents', 'applicablePackages', 'applicableBranches', 'applicableProperties'];
const stringifyArrayFields = (data) => {
    const out = { ...data };
    for (const key of ARRAY_FIELDS) {
        if (out[key] !== undefined) {
            out[key] = Array.isArray(out[key]) && out[key].length ? JSON.stringify(out[key]) : null;
        }
    }
    return out;
};
const parseArrayFields = (row) => {
    if (!row) return row;
    const out = { ...row };
    const dbColumns = { applicableHalls: 'applicable_halls', applicableEvents: 'applicable_events', applicablePackages: 'applicable_packages', applicableBranches: 'applicable_branches', applicableProperties: 'applicable_properties' };
    for (const [camel, snake] of Object.entries(dbColumns)) {
        if (out[snake] !== undefined) {
            try { out[snake] = out[snake] ? JSON.parse(out[snake]) : null; } catch { out[snake] = null; }
        }
    }
    return out;
};

const list = async (companyId, opts) => (await couponRepo.list(companyId, opts)).map(parseArrayFields);

const getById = async (couponId, companyId) => {
    const coupon = await couponRepo.findById(couponId, companyId);
    if (!coupon) throw new NotFoundError('Coupon');
    return parseArrayFields(coupon);
};

const getUsageHistory = async (couponId, companyId) => {
    await getById(couponId, companyId);
    return couponRepo.getUsageHistory(couponId, companyId);
};

const create = async (companyId, data, createdBy) => {
    if (!data.couponCode || !data.couponCode.trim()) throw new ValidationError('couponCode is required');
    if (!data.couponName || !data.couponName.trim()) throw new ValidationError('couponName is required');
    if (!['percentage', 'flat'].includes(data.discountType)) throw new ValidationError('discountType must be "percentage" or "flat"');
    if (!(data.discountValue > 0)) throw new ValidationError('discountValue must be greater than 0');
    if (data.discountType === 'percentage' && data.discountValue > 100) throw new ValidationError('A percentage discount cannot exceed 100');
    if (!data.validFrom || !data.validTo) throw new ValidationError('validFrom and validTo are required');
    if (new Date(data.validTo) <= new Date(data.validFrom)) throw new ValidationError('validTo must be after validFrom');

    const existing = await couponRepo.findByCode(companyId, data.couponCode.trim().toUpperCase());
    if (existing) throw new ValidationError(`Coupon code "${data.couponCode}" already exists`);

    const coupon = await couponRepo.create(companyId, stringifyArrayFields({ ...data, couponCode: data.couponCode.trim().toUpperCase() }), createdBy);

    await auditLogRepo.log({
        companyId, userId: createdBy,
        action: 'coupon.created', entityType: 'coupon', entityId: coupon.coupon_id,
        description: `Coupon "${coupon.coupon_code}" created`,
        newValues: data,
    });

    return parseArrayFields(coupon);
};

const update = async (couponId, companyId, data, userId) => {
    const existing = await getById(couponId, companyId);
    if (data.discountType && !['percentage', 'flat'].includes(data.discountType)) {
        throw new ValidationError('discountType must be "percentage" or "flat"');
    }
    const updated = await couponRepo.update(couponId, companyId, stringifyArrayFields(data));

    await auditLogRepo.log({
        companyId, userId,
        action: 'coupon.updated', entityType: 'coupon', entityId: couponId,
        description: `Coupon "${existing.coupon_code}" updated`,
        oldValues: existing, newValues: data,
    });

    return parseArrayFields(updated);
};

const setActive = async (couponId, companyId, isActive, userId) => {
    const existing = await getById(couponId, companyId);
    const updated = await couponRepo.setActive(couponId, companyId, isActive);
    await auditLogRepo.log({
        companyId, userId,
        action: isActive ? 'coupon.activated' : 'coupon.deactivated',
        entityType: 'coupon', entityId: couponId,
        description: `Coupon "${existing.coupon_code}" ${isActive ? 'activated' : 'deactivated'}`,
    });
    return parseArrayFields(updated);
};

const remove = async (couponId, companyId, userId) => {
    const existing = await getById(couponId, companyId);
    await couponRepo.remove(couponId, companyId);
    await auditLogRepo.log({
        companyId, userId,
        action: 'coupon.deleted', entityType: 'coupon', entityId: couponId,
        description: `Coupon "${existing.coupon_code}" deleted`,
        oldValues: existing,
    });
};

const clone = async (couponId, companyId, newCouponCode, userId) => {
    if (!newCouponCode || !newCouponCode.trim()) throw new ValidationError('newCouponCode is required');
    const code = newCouponCode.trim().toUpperCase();
    const existing = await couponRepo.findByCode(companyId, code);
    if (existing) throw new ValidationError(`Coupon code "${code}" already exists`);

    const source = await getById(couponId, companyId);
    const cloned = await couponRepo.clone(couponId, companyId, code, userId);

    await auditLogRepo.log({
        companyId, userId,
        action: 'coupon.cloned', entityType: 'coupon', entityId: cloned.coupon_id,
        description: `Coupon "${source.coupon_code}" cloned as "${code}"`,
        newValues: { sourceCouponId: couponId, newCouponCode: code },
    });

    return parseArrayFields(cloned);
};

/** JSON array column -> Set of ids, or null meaning "no restriction". */
const parseIdSet = (json) => {
    if (!json) return null;
    try {
        const arr = JSON.parse(json);
        return Array.isArray(arr) && arr.length ? new Set(arr.map(Number)) : null;
    } catch { return null; }
};

/**
 * Validates a coupon against the current booking context and returns the
 * computed discount amount. Does not redeem/increment usage — that only
 * happens via apply() once the booking actually exists (see
 * booking.service.js:create), so a validated-but-abandoned booking never
 * consumes a customer's usage_per_user allowance or the coupon's global
 * usage_limit.
 */
const validate = async (companyId, couponCode, context = {}) => {
    if (!couponCode) throw new ValidationError('couponCode is required');
    const { subtotal, eventType, hallId, packageId, branchId, propertyId, customerId } = context;

    const coupon = await couponRepo.findByCode(companyId, couponCode.trim().toUpperCase());
    if (!coupon) throw new ValidationError('Invalid or expired coupon');

    const now = new Date();
    if (!coupon.is_active) throw new ValidationError('This coupon is no longer active');
    if (now < new Date(coupon.valid_from) || now > new Date(coupon.valid_to)) {
        throw new ValidationError('This coupon has expired or is not yet valid');
    }
    if (coupon.usage_limit != null && coupon.used_count >= coupon.usage_limit) {
        throw new ValidationError('This coupon has reached its usage limit');
    }
    const subtotalAmount = parseFloat(subtotal) || 0;
    if (subtotalAmount < parseFloat(coupon.min_booking_amount || 0)) {
        throw new ValidationError(`This coupon requires a minimum booking amount of ${coupon.min_booking_amount}`);
    }

    // Scoping — event type / hall / package / branch / property. Each
    // restriction is independent: a coupon with applicable_events set but
    // applicable_halls empty only restricts by event type, etc. An empty/
    // null column always means "no restriction on this dimension" — kept
    // consistent with how applicable_halls/applicable_events already
    // behaved before this had any enforcement at all.
    const events = coupon.applicable_events ? (() => { try { return JSON.parse(coupon.applicable_events); } catch { return null; } })() : null;
    if (Array.isArray(events) && events.length && eventType && !events.includes(eventType)) {
        throw new ValidationError(`This coupon is not valid for "${eventType}" events`);
    }
    const halls = parseIdSet(coupon.applicable_halls);
    if (halls && hallId && !halls.has(Number(hallId))) {
        throw new ValidationError('This coupon is not valid for the selected hall');
    }
    const packages = parseIdSet(coupon.applicable_packages);
    if (packages && !(packageId && packages.has(Number(packageId)))) {
        throw new ValidationError('This coupon only applies to specific booking packages');
    }
    const branches = parseIdSet(coupon.applicable_branches);
    if (branches && branchId && !branches.has(Number(branchId))) {
        throw new ValidationError('This coupon is not valid for the selected branch');
    }
    const properties = parseIdSet(coupon.applicable_properties);
    if (properties && propertyId && !properties.has(Number(propertyId))) {
        throw new ValidationError('This coupon is not valid for the selected property');
    }

    // Per-customer usage limit — counted from actual redemption history
    // (CouponUsage), not a client-trusted flag, so it can't be bypassed by
    // retrying with a fresh session.
    if (customerId) {
        const priorUses = await couponRepo.countCustomerUsage(coupon.coupon_id, customerId);
        if (priorUses >= (coupon.usage_per_user || 1)) {
            throw new ValidationError('You have already used this coupon the maximum number of times');
        }
    }

    let discountAmount = coupon.discount_type === 'percentage'
        ? subtotalAmount * (parseFloat(coupon.discount_value) / 100)
        : parseFloat(coupon.discount_value);

    if (coupon.max_discount_amount != null) {
        discountAmount = Math.min(discountAmount, parseFloat(coupon.max_discount_amount));
    }
    discountAmount = Math.min(discountAmount, subtotalAmount);

    return {
        couponId: coupon.coupon_id,
        couponCode: coupon.coupon_code,
        couponName: coupon.coupon_name,
        discountType: coupon.discount_type,
        discountValue: parseFloat(coupon.discount_value),
        originalAmount: subtotalAmount,
        discountAmount: Math.round(discountAmount * 100) / 100,
        finalAmount: Math.round((subtotalAmount - discountAmount) * 100) / 100,
    };
};

/**
 * Re-validates (never trusts a client-supplied discount figure) and
 * redeems a coupon against a real, already-created booking — the actual
 * usage-recording step. Called from booking.service.js:create right after
 * the booking row exists, inside the same logical operation but as its own
 * transaction (coupon redemption failing shouldn't roll back an otherwise
 * successful booking — it's surfaced as a warning, matching this
 * codebase's existing non-blocking-side-effect pattern for notifications/
 * email).
 */
const apply = async (companyId, { couponCode, bookingId, subtotal, eventType, hallId, packageId, branchId, propertyId, customerId }, actor) => {
    const result = await validate(companyId, couponCode, { subtotal, eventType, hallId, packageId, branchId, propertyId, customerId });
    await couponRepo.recordUsage({
        couponId: result.couponId, companyId, bookingId, customerId, discountAmount: result.discountAmount,
    });
    await auditLogRepo.log({
        companyId, userId: actor?.userId,
        action: 'coupon.applied', entityType: 'booking', entityId: bookingId,
        description: `Coupon "${result.couponCode}" applied to booking — discount ${result.discountAmount}`,
        newValues: { couponId: result.couponId, couponCode: result.couponCode, discountAmount: result.discountAmount },
    });
    return result;
};

/** Releases a redemption when its booking is cancelled — frees the usage slot. */
const release = async (bookingId) => couponRepo.releaseUsage(bookingId);

module.exports = { list, getById, getUsageHistory, create, update, setActive, remove, clone, validate, apply, release };
