/**
 * Coupon Service — coupon CRUD + booking-time validation/discount calculation.
 */
'use strict';

const couponRepo = require('../repositories/coupon.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const list = (companyId, opts) => couponRepo.list(companyId, opts);

const getById = async (couponId, companyId) => {
    const coupon = await couponRepo.findById(couponId, companyId);
    if (!coupon) throw new NotFoundError('Coupon');
    return coupon;
};

const create = async (companyId, data, createdBy) => {
    if (!data.couponCode || !data.couponCode.trim()) throw new ValidationError('couponCode is required');
    if (!data.couponName || !data.couponName.trim()) throw new ValidationError('couponName is required');
    if (!['percentage', 'flat'].includes(data.discountType)) throw new ValidationError('discountType must be "percentage" or "flat"');
    if (!(data.discountValue > 0)) throw new ValidationError('discountValue must be greater than 0');
    if (!data.validFrom || !data.validTo) throw new ValidationError('validFrom and validTo are required');
    if (new Date(data.validTo) <= new Date(data.validFrom)) throw new ValidationError('validTo must be after validFrom');

    const existing = await couponRepo.findByCode(companyId, data.couponCode.trim().toUpperCase());
    if (existing) throw new ValidationError(`Coupon code "${data.couponCode}" already exists`);

    return couponRepo.create(companyId, { ...data, couponCode: data.couponCode.trim().toUpperCase() }, createdBy);
};

const update = async (couponId, companyId, data) => {
    await getById(couponId, companyId);
    if (data.discountType && !['percentage', 'flat'].includes(data.discountType)) {
        throw new ValidationError('discountType must be "percentage" or "flat"');
    }
    return couponRepo.update(couponId, companyId, data);
};

/**
 * Validates a coupon against the current booking subtotal and returns the
 * computed discount amount. Does not increment used_count — that only
 * happens when the booking is actually finalized (sp_booking_engine.sql).
 */
const validate = async (companyId, couponCode, subtotal) => {
    if (!couponCode) throw new ValidationError('couponCode is required');

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
        discountAmount: Math.round(discountAmount * 100) / 100,
    };
};

module.exports = { list, getById, create, update, validate };
