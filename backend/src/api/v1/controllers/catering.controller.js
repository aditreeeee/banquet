/**
 * Catering Controller
 */
'use strict';

const cateringService = require('../../../services/catering.service');
const response = require('../../../utils/response');
const { resolveCompanyScope } = require('../../../utils/branchScope');

// A Super Admin not currently impersonating a tenant sees every tenant's
// catering packages here too — same resolveCompanyScope fix applied to
// bookingPackage.controller.js.
const listPackages = async (req, res) => {
    const companyId = resolveCompanyScope({ companyId: req.companyId, roleSlug: req.user.role_slug, isImpersonating: req.isImpersonating });
    const packages = await cateringService.listPackages(companyId);
    return response.success(res, packages);
};

const getPackage = async (req, res) => {
    const pkg = await cateringService.getPackage(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, pkg);
};

const createPackage = async (req, res) => {
    const { packageName, packageType, description, pricePerPlate, minPlates } = req.body;
    const pkg = await cateringService.createPackage(
        { packageName, packageType, description, pricePerPlate, minPlates },
        req.companyId, req.user.user_id
    );
    return response.created(res, pkg, 'Catering package created');
};

const getPricing = async (req, res) => {
    const pricing = await cateringService.getPackagePricing(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, pricing);
};

const calculateBill = async (req, res) => {
    const guestCount = parseInt(req.query.guest_count, 10) || 0;
    const bill = await cateringService.calculateBillForGuests(parseInt(req.params.id, 10), req.companyId, guestCount);
    return response.success(res, bill);
};

const addItem = async (req, res) => {
    const items = await cateringService.addItemToPackage(
        parseInt(req.params.id, 10), req.companyId,
        { itemId: parseInt(req.body.itemId, 10), quantityPerPlate: req.body.quantityPerPlate }
    );
    return response.created(res, items, 'Menu item added to package');
};

const removeItem = async (req, res) => {
    const items = await cateringService.removeItemFromPackage(
        parseInt(req.params.id, 10), req.companyId, parseInt(req.params.itemId, 10)
    );
    return response.success(res, items, 'Menu item removed from package');
};

const syncPrice = async (req, res) => {
    const pkg = await cateringService.syncPackagePriceFromMenu(parseInt(req.params.id, 10), req.companyId);
    return response.success(res, pkg, 'Package price recalculated from Master Menu');
};

const deletePackage = async (req, res) => {
    await cateringService.deletePackage(parseInt(req.params.id, 10), req.companyId, req.user.user_id);
    return response.success(res, null, 'Catering package deleted');
};

module.exports = { listPackages, getPackage, createPackage, getPricing, calculateBill, addItem, removeItem, syncPrice, deletePackage };
