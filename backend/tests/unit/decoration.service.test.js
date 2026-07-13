'use strict';

jest.mock('../../src/repositories/decoration.repository');

const decorationRepo = require('../../src/repositories/decoration.repository');
const decorationService = require('../../src/services/decoration.service');
const { NotFoundError, ValidationError } = require('../../src/api/v1/middleware/errorHandler');

beforeEach(() => {
    jest.clearAllMocks();
});

describe('decoration.service — items', () => {
    it('rejects creating an item with no decorationName', async () => {
        await expect(decorationService.createItem(1, {}, 9)).rejects.toBeInstanceOf(ValidationError);
        expect(decorationRepo.createItem).not.toHaveBeenCalled();
    });

    it('rejects a negative quantityAvailable', async () => {
        await expect(decorationService.createItem(1, { decorationName: 'Floral Arch', quantityAvailable: -1 }, 9))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it('auto-generates a decoration code when none is supplied', async () => {
        decorationRepo.nextItemCode.mockResolvedValue('DEC-0007');
        decorationRepo.createItem.mockResolvedValue({ decoration_id: 7 });

        await decorationService.createItem(1, { decorationName: 'Floral Arch' }, 9);

        expect(decorationRepo.createItem).toHaveBeenCalledWith(1, expect.objectContaining({ decorationCode: 'DEC-0007' }), 9);
    });

    it('404s updating a decoration item that does not exist', async () => {
        decorationRepo.findItemById.mockResolvedValue(null);
        await expect(decorationService.updateItem(99, 1, { decorationName: 'X' })).rejects.toBeInstanceOf(NotFoundError);
        expect(decorationRepo.updateItem).not.toHaveBeenCalled();
    });
});

describe('decoration.service — packages', () => {
    it('rejects creating a package with no packageName', async () => {
        await expect(decorationService.createPackage(1, {}, 9)).rejects.toBeInstanceOf(ValidationError);
    });

    it('404s getting a package that does not exist', async () => {
        decorationRepo.findPackageById.mockResolvedValue(null);
        await expect(decorationService.getPackageById(5, 1)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('computes package pricing live from linked items when no flat_price is set', async () => {
        decorationRepo.findPackageById.mockResolvedValue({ package_id: 1, flat_price: null });
        decorationRepo.getPackageItems.mockResolvedValue([
            { decoration_id: 1, quantity: 2, rental_price: 1000, installation_cost: 200, removal_cost: 100, tax_percent: 10, discount_percent: 0 },
        ]);
        // (2*1000 + 200 + 100) * 1.10 = 2530
        const result = await decorationService.getPackagePricing(1, 1);
        expect(result.totalPrice).toBe(2530);
        expect(result.computedPrice).toBe(2530);
    });

    it('uses the admin-set flat_price override instead of the computed total when present', async () => {
        decorationRepo.findPackageById.mockResolvedValue({ package_id: 1, flat_price: 9999 });
        decorationRepo.getPackageItems.mockResolvedValue([
            { decoration_id: 1, quantity: 1, rental_price: 100, installation_cost: 0, removal_cost: 0, tax_percent: 0, discount_percent: 0 },
        ]);
        const result = await decorationService.getPackagePricing(1, 1);
        expect(result.totalPrice).toBe(9999);
        expect(result.computedPrice).toBe(100);
    });

    it('404s adding an item to a package that does not exist', async () => {
        decorationRepo.findPackageById.mockResolvedValue(null);
        await expect(decorationService.addItemToPackage(99, 1, 1, 2)).rejects.toBeInstanceOf(NotFoundError);
        expect(decorationRepo.addPackageItem).not.toHaveBeenCalled();
    });

    it('404s adding a decoration item that does not exist to a valid package', async () => {
        decorationRepo.findPackageById.mockResolvedValue({ package_id: 1 });
        decorationRepo.findItemById.mockResolvedValue(null);
        await expect(decorationService.addItemToPackage(1, 1, 99, 2)).rejects.toBeInstanceOf(NotFoundError);
        expect(decorationRepo.addPackageItem).not.toHaveBeenCalled();
    });

    it('soft-deletes a package via isActive:false', async () => {
        decorationRepo.updatePackage.mockResolvedValue({ package_id: 1, is_active: false });
        await decorationService.deletePackage(1, 1);
        expect(decorationRepo.updatePackage).toHaveBeenCalledWith(1, 1, { isActive: false });
    });
});
