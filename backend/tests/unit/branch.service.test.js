'use strict';

jest.mock('../../src/repositories/branch.repository');
jest.mock('../../src/repositories/company.repository');
jest.mock('../../src/repositories/auditLog.repository');

const branchRepo   = require('../../src/repositories/branch.repository');
const companyRepo  = require('../../src/repositories/company.repository');
const auditLogRepo = require('../../src/repositories/auditLog.repository');
const branchService = require('../../src/services/branch.service');
const { NotFoundError, ValidationError } = require('../../src/api/v1/middleware/errorHandler');

const actor = { userId: 1 };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('branch.service — create', () => {
    it('rejects a missing branchName', async () => {
        await expect(branchService.create(1, { address: '1 Main St' }, actor))
            .rejects.toBeInstanceOf(ValidationError);
        expect(companyRepo.existsAndActive).not.toHaveBeenCalled();
    });

    it('rejects a missing address', async () => {
        await expect(branchService.create(1, { branchName: 'North Wing' }, actor))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an over-length branchName', async () => {
        await expect(branchService.create(1, { branchName: 'X'.repeat(201), address: 'Addr' }, actor))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects when the target company does not exist or is inactive', async () => {
        companyRepo.existsAndActive.mockResolvedValue(false);
        await expect(branchService.create(1, { branchName: 'North Wing', address: 'Addr' }, actor))
            .rejects.toBeInstanceOf(ValidationError);
        expect(branchRepo.create).not.toHaveBeenCalled();
    });

    it('creates the branch, auto-generates branchCode, and logs an audit entry', async () => {
        companyRepo.existsAndActive.mockResolvedValue(true);
        branchRepo.create.mockResolvedValue(42);
        branchRepo.findById.mockResolvedValue({ branch_id: 42, branch_name: 'North Wing', address_line1: 'Addr' });

        const result = await branchService.create(1, { branchName: 'North Wing!', address: 'Addr' }, actor);

        expect(branchRepo.create).toHaveBeenCalledWith(1, expect.objectContaining({
            branchName: 'North Wing!',
            branchCode: 'NORTH-WING-',
            address: 'Addr',
        }));
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 1,
            action: 'branch.created',
            entityType: 'branch',
            entityId: 42,
        }));
        expect(result).toEqual(expect.objectContaining({ branch_id: 42 }));
    });

    it('uses an explicitly supplied branchCode instead of auto-generating one', async () => {
        companyRepo.existsAndActive.mockResolvedValue(true);
        branchRepo.create.mockResolvedValue(7);
        branchRepo.findById.mockResolvedValue({ branch_id: 7 });

        await branchService.create(1, { branchName: 'East Wing', branchCode: 'EW-01', address: 'Addr' }, actor);

        expect(branchRepo.create).toHaveBeenCalledWith(1, expect.objectContaining({ branchCode: 'EW-01' }));
    });
});

describe('branch.service — update', () => {
    it('404s when the branch does not exist under the given company', async () => {
        branchRepo.findById.mockResolvedValue(null);
        await expect(branchService.update(99, 1, { branchName: 'New Name' }, actor))
            .rejects.toBeInstanceOf(NotFoundError);
        expect(branchRepo.update).not.toHaveBeenCalled();
    });

    /**
     * Regression test for the silent-no-op bug: a Super Admin write request
     * that resolves to the wrong company_id (e.g. the scopeToCompany
     * default of 1) must 404, not report success while updating zero rows.
     */
    it('404s when findById matches but the underlying UPDATE matches zero rows', async () => {
        branchRepo.findById.mockResolvedValue({ branch_id: 5, branch_name: 'Main Branch' });
        branchRepo.update.mockResolvedValue(null);

        await expect(branchService.update(5, 6, { branchName: 'Renamed' }, actor))
            .rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects an over-length address', async () => {
        await expect(branchService.update(5, 1, { address: 'X'.repeat(501) }, actor))
            .rejects.toBeInstanceOf(ValidationError);
        expect(branchRepo.findById).not.toHaveBeenCalled();
    });

    it('updates the branch and logs an audit entry with old and new values', async () => {
        branchRepo.findById
            .mockResolvedValueOnce({ branch_id: 5, branch_name: 'Main Branch', address_line1: 'Old Addr', phone: null, is_active: true })
            .mockResolvedValueOnce({ branch_id: 5, branch_name: 'Main Branch Renamed' });
        branchRepo.update.mockResolvedValue({ branchId: 5 });

        const result = await branchService.update(5, 6, { branchName: 'Main Branch Renamed' }, actor);

        expect(branchRepo.update).toHaveBeenCalledWith(5, 6, { branchName: 'Main Branch Renamed' });
        expect(auditLogRepo.log).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 6,
            action: 'branch.updated',
            entityId: 5,
            oldValues: expect.objectContaining({ branch_name: 'Main Branch' }),
        }));
        expect(result).toEqual(expect.objectContaining({ branch_name: 'Main Branch Renamed' }));
    });
});
