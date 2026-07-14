/**
 * Coupon Repository — Coupons table + CouponUsage redemption history.
 */
'use strict';

const { executeQuery, withTransaction } = require('../config/database');

const COUPON_SELECT = `
    SELECT coupon_id, company_id, coupon_code, coupon_name, description,
           discount_type, discount_value, max_discount_amount, min_booking_amount,
           usage_limit, usage_per_user, used_count, valid_from, valid_to,
           applicable_halls, applicable_events, applicable_packages,
           applicable_branches, applicable_properties,
           is_active, created_at, created_by
    FROM Coupons`;

const list = async (companyId, { activeOnly } = {}) => {
    const where = activeOnly
        ? `WHERE company_id = @companyId AND is_active = 1`
        : `WHERE company_id = @companyId`;
    return executeQuery(
        `${COUPON_SELECT} ${where} ORDER BY created_at DESC`,
        { companyId }
    );
};

const findByCode = async (companyId, couponCode) => {
    const rows = await executeQuery(
        `${COUPON_SELECT} WHERE company_id = @companyId AND coupon_code = @couponCode`,
        { companyId, couponCode }
    );
    return rows[0] || null;
};

const findById = async (couponId, companyId) => {
    const rows = await executeQuery(
        `${COUPON_SELECT} WHERE coupon_id = @couponId AND company_id = @companyId`,
        { couponId, companyId }
    );
    return rows[0] || null;
};

const FIELD_MAP = {
    couponCode: 'coupon_code', couponName: 'coupon_name', description: 'description',
    discountType: 'discount_type', discountValue: 'discount_value',
    maxDiscountAmount: 'max_discount_amount', minBookingAmount: 'min_booking_amount',
    usageLimit: 'usage_limit', usagePerUser: 'usage_per_user',
    validFrom: 'valid_from', validTo: 'valid_to',
    applicableHalls: 'applicable_halls', applicableEvents: 'applicable_events',
    applicablePackages: 'applicable_packages', applicableBranches: 'applicable_branches',
    applicableProperties: 'applicable_properties',
    isActive: 'is_active',
};

const create = async (companyId, data, createdBy) => {
    const result = await executeQuery(
        `INSERT INTO Coupons (
            company_id, coupon_code, coupon_name, description, discount_type, discount_value,
            max_discount_amount, min_booking_amount, usage_limit, usage_per_user,
            valid_from, valid_to, applicable_halls, applicable_events,
            applicable_packages, applicable_branches, applicable_properties,
            is_active, created_by
        )
        OUTPUT INSERTED.coupon_id AS id
        VALUES (
            @companyId, @couponCode, @couponName, @description, @discountType, @discountValue,
            @maxDiscountAmount, @minBookingAmount, @usageLimit, @usagePerUser,
            @validFrom, @validTo, @applicableHalls, @applicableEvents,
            @applicablePackages, @applicableBranches, @applicableProperties,
            1, @createdBy
        )`,
        {
            companyId,
            couponCode:        data.couponCode,
            couponName:        data.couponName,
            description:       data.description || null,
            discountType:      data.discountType,
            discountValue:     data.discountValue,
            maxDiscountAmount: data.maxDiscountAmount ?? null,
            minBookingAmount:  data.minBookingAmount || 0,
            usageLimit:        data.usageLimit ?? null,
            usagePerUser:      data.usagePerUser || 1,
            validFrom:         data.validFrom,
            validTo:           data.validTo,
            applicableHalls:      data.applicableHalls || null,
            applicableEvents:     data.applicableEvents || null,
            applicablePackages:   data.applicablePackages || null,
            applicableBranches:   data.applicableBranches || null,
            applicableProperties: data.applicableProperties || null,
            createdBy,
        }
    );
    return findById(result[0].id, companyId);
};

const update = async (couponId, companyId, data) => {
    const fields = [];
    const params = { couponId, companyId };
    for (const [key, column] of Object.entries(FIELD_MAP)) {
        if (data[key] !== undefined) {
            fields.push(`${column} = @${key}`);
            params[key] = data[key];
        }
    }
    if (!fields.length) return findById(couponId, companyId);
    await executeQuery(
        `UPDATE Coupons SET ${fields.join(', ')} WHERE coupon_id = @couponId AND company_id = @companyId`,
        params
    );
    return findById(couponId, companyId);
};

const setActive = async (couponId, companyId, isActive) => {
    await executeQuery(
        `UPDATE Coupons SET is_active = @isActive WHERE coupon_id = @couponId AND company_id = @companyId`,
        { couponId, companyId, isActive }
    );
    return findById(couponId, companyId);
};

/** Blocked (like every other catalog delete in this codebase) if any booking still references it. */
const remove = async (couponId, companyId) => {
    const inUse = await executeQuery(
        `SELECT COUNT(*) AS cnt FROM Bookings WHERE coupon_id = @couponId AND company_id = @companyId`,
        { couponId, companyId }
    );
    if (inUse[0].cnt > 0) {
        const { ConflictError } = require('../api/v1/middleware/errorHandler');
        throw new ConflictError('This coupon has already been redeemed on a booking and cannot be deleted — deactivate it instead');
    }
    await executeQuery(
        `DELETE FROM Coupons WHERE coupon_id = @couponId AND company_id = @companyId`,
        { couponId, companyId }
    );
};

/**
 * Clone a coupon as a new draft — fresh code (caller supplies one, since the
 * unique constraint is per-company), zeroed usage, inactive until the admin
 * reviews and activates it explicitly (never auto-active, unlike create()).
 */
const clone = async (couponId, companyId, newCouponCode, createdBy) => {
    const source = await findById(couponId, companyId);
    if (!source) return null;
    const result = await executeQuery(
        `INSERT INTO Coupons (
            company_id, coupon_code, coupon_name, description, discount_type, discount_value,
            max_discount_amount, min_booking_amount, usage_limit, usage_per_user,
            valid_from, valid_to, applicable_halls, applicable_events,
            applicable_packages, applicable_branches, applicable_properties,
            is_active, created_by
        )
        OUTPUT INSERTED.coupon_id AS id
        VALUES (
            @companyId, @couponCode, @couponName, @description, @discountType, @discountValue,
            @maxDiscountAmount, @minBookingAmount, @usageLimit, @usagePerUser,
            @validFrom, @validTo, @applicableHalls, @applicableEvents,
            @applicablePackages, @applicableBranches, @applicableProperties,
            0, @createdBy
        )`,
        {
            companyId,
            couponCode: newCouponCode,
            couponName: `${source.coupon_name} (Copy)`,
            description: source.description,
            discountType: source.discount_type,
            discountValue: source.discount_value,
            maxDiscountAmount: source.max_discount_amount,
            minBookingAmount: source.min_booking_amount,
            usageLimit: source.usage_limit,
            usagePerUser: source.usage_per_user,
            validFrom: source.valid_from,
            validTo: source.valid_to,
            applicableHalls: source.applicable_halls,
            applicableEvents: source.applicable_events,
            applicablePackages: source.applicable_packages,
            applicableBranches: source.applicable_branches,
            applicableProperties: source.applicable_properties,
            createdBy,
        }
    );
    return findById(result[0].id, companyId);
};

/** How many times this customer has already redeemed this coupon — enforces usage_per_user. */
const countCustomerUsage = async (couponId, customerId) => {
    if (!customerId) return 0;
    const rows = await executeQuery(
        `SELECT COUNT(*) AS cnt FROM CouponUsage WHERE coupon_id = @couponId AND customer_id = @customerId`,
        { couponId, customerId }
    );
    return rows[0].cnt;
};

/**
 * Redeem a coupon against a booking — locks the coupon row, re-checks the
 * usage_limit under the lock (closing the same TOCTOU race every other
 * availability/allocation check in this codebase guards against), records
 * the CouponUsage row, and increments used_count, all in one transaction.
 * UQ_cu_booking makes this idempotent per booking — a retried request is a
 * silent no-op rather than a double-redemption.
 */
const recordUsage = async ({ couponId, companyId, bookingId, customerId, discountAmount }) => {
    return withTransaction(async (tx) => {
        const existing = await tx.execute(
            `SELECT usage_id FROM CouponUsage WHERE booking_id = @bookingId`,
            { bookingId }
        );
        if (existing[0]) return existing[0].usage_id;

        const coupon = await tx.execute(
            `SELECT coupon_id, usage_limit, used_count FROM Coupons WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
             WHERE coupon_id = @couponId AND company_id = @companyId`,
            { couponId, companyId }
        );
        if (!coupon[0]) {
            const { NotFoundError } = require('../api/v1/middleware/errorHandler');
            throw new NotFoundError('Coupon');
        }
        if (coupon[0].usage_limit != null && coupon[0].used_count >= coupon[0].usage_limit) {
            const { ConflictError } = require('../api/v1/middleware/errorHandler');
            throw new ConflictError('This coupon has reached its usage limit');
        }

        const result = await tx.execute(
            `INSERT INTO CouponUsage (coupon_id, company_id, booking_id, customer_id, discount_amount, used_at)
             OUTPUT INSERTED.usage_id AS id
             VALUES (@couponId, @companyId, @bookingId, @customerId, @discountAmount, SYSUTCDATETIME())`,
            { couponId, companyId, bookingId, customerId: customerId || null, discountAmount }
        );
        await tx.execute(
            `UPDATE Coupons SET used_count = used_count + 1 WHERE coupon_id = @couponId`,
            { couponId }
        );
        return result[0].id;
    });
};

/** Release a redemption (e.g. booking cancelled) — frees the usage slot back up. */
const releaseUsage = async (bookingId) => {
    const rows = await executeQuery(
        `SELECT usage_id, coupon_id FROM CouponUsage WHERE booking_id = @bookingId`,
        { bookingId }
    );
    if (!rows[0]) return;
    await executeQuery(`DELETE FROM CouponUsage WHERE usage_id = @id`, { id: rows[0].usage_id });
    await executeQuery(
        `UPDATE Coupons SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE coupon_id = @couponId`,
        { couponId: rows[0].coupon_id }
    );
};

const getUsageHistory = async (couponId, companyId) => {
    return executeQuery(
        `SELECT cu.usage_id, cu.booking_id, b.booking_ref, b.event_name,
                CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                cu.discount_amount, cu.used_at
         FROM CouponUsage cu
         JOIN Bookings b ON b.booking_id = cu.booking_id
         LEFT JOIN Customers c ON c.customer_id = cu.customer_id
         WHERE cu.coupon_id = @couponId AND cu.company_id = @companyId
         ORDER BY cu.used_at DESC`,
        { couponId, companyId }
    );
};

module.exports = {
    list, findByCode, findById, create, update, setActive, remove, clone,
    countCustomerUsage, recordUsage, releaseUsage, getUsageHistory,
};
