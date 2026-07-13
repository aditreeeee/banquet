/**
 * Coupon Repository — coupons table access.
 */
'use strict';

const { executeQuery } = require('../config/database');

const COUPON_SELECT = `
    SELECT coupon_id, company_id, coupon_code, coupon_name, description,
           discount_type, discount_value, max_discount_amount, min_booking_amount,
           usage_limit, usage_per_user, used_count, valid_from, valid_to,
           applicable_halls, applicable_events, is_active, created_at, created_by
    FROM coupons`;

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

const create = async (companyId, data, createdBy) => {
    const result = await executeQuery(
        `INSERT INTO coupons (
            company_id, coupon_code, coupon_name, description, discount_type, discount_value,
            max_discount_amount, min_booking_amount, usage_limit, usage_per_user,
            valid_from, valid_to, applicable_halls, applicable_events, is_active, created_by
        )
        OUTPUT INSERTED.coupon_id AS id
        VALUES (
            @companyId, @couponCode, @couponName, @description, @discountType, @discountValue,
            @maxDiscountAmount, @minBookingAmount, @usageLimit, @usagePerUser,
            @validFrom, @validTo, @applicableHalls, @applicableEvents, 1, @createdBy
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
            applicableHalls:   data.applicableHalls || null,
            applicableEvents:  data.applicableEvents || null,
            createdBy,
        }
    );
    return findById(result[0].id, companyId);
};

const update = async (couponId, companyId, data) => {
    const fields = [];
    const params = { couponId, companyId };
    const map = {
        couponName: 'coupon_name', description: 'description', discountType: 'discount_type',
        discountValue: 'discount_value', maxDiscountAmount: 'max_discount_amount',
        minBookingAmount: 'min_booking_amount', usageLimit: 'usage_limit',
        usagePerUser: 'usage_per_user', validFrom: 'valid_from', validTo: 'valid_to',
        applicableHalls: 'applicable_halls', applicableEvents: 'applicable_events',
        isActive: 'is_active',
    };
    for (const [key, column] of Object.entries(map)) {
        if (data[key] !== undefined) {
            fields.push(`${column} = @${key}`);
            params[key] = data[key];
        }
    }
    if (!fields.length) return findById(couponId, companyId);
    await executeQuery(
        `UPDATE coupons SET ${fields.join(', ')} WHERE coupon_id = @couponId AND company_id = @companyId`,
        params
    );
    return findById(couponId, companyId);
};

module.exports = { list, findByCode, findById, create, update };
