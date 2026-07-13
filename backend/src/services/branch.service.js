/**
 * Branch Service
 */
'use strict';

const branchRepo   = require('../repositories/branch.repository');
const companyRepo  = require('../repositories/company.repository');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const NAME_MAX_LENGTH    = 200;
const ADDRESS_MAX_LENGTH = 500;
const PHONE_MAX_LENGTH   = 20;

const generateBranchCode = (branchName) =>
    branchName.trim().slice(0, 15).toUpperCase().replace(/[^A-Z0-9]/g, '-');

const validateFields = ({ branchName, address, phone }) => {
    const errors = [];
    if (branchName != null && branchName.length > NAME_MAX_LENGTH) {
        errors.push({ field: 'branchName', message: `Must be ${NAME_MAX_LENGTH} characters or fewer` });
    }
    if (address != null && address.length > ADDRESS_MAX_LENGTH) {
        errors.push({ field: 'address', message: `Must be ${ADDRESS_MAX_LENGTH} characters or fewer` });
    }
    if (phone && phone.length > PHONE_MAX_LENGTH) {
        errors.push({ field: 'phone', message: `Must be ${PHONE_MAX_LENGTH} characters or fewer` });
    }
    if (errors.length) throw new ValidationError('Invalid branch details', errors);
};

/**
 * @param {number} companyId - the tenant to create the branch under. Always
 *   validated here rather than trusted from req.companyId alone: a Super
 *   Admin's write-scope defaults to company_id=1 unless overridden, and a
 *   bad or stale override must fail loudly, not create an orphaned branch
 *   under a deleted/inactive/nonexistent tenant.
 */
const create = async (companyId, data, actor) => {
    const { branchName, branchCode, address, phone } = data;
    if (!branchName) throw new ValidationError('branchName required', [{ field: 'branchName', message: 'Required' }]);
    if (!address) throw new ValidationError('address required', [{ field: 'address', message: 'Required' }]);
    validateFields({ branchName, address, phone });

    const companyOk = await companyRepo.existsAndActive(companyId);
    if (!companyOk) {
        throw new ValidationError('Selected Company/Property does not exist or is inactive', [
            { field: 'companyId', message: 'Choose an active, existing Company/Property' },
        ]);
    }

    const code = branchCode || generateBranchCode(branchName);
    const branchId = await branchRepo.create(companyId, { branchName, branchCode: code, address, phone });

    await auditLogRepo.log({
        companyId,
        userId: actor.userId,
        action: 'branch.created',
        entityType: 'branch',
        entityId: branchId,
        description: `Branch "${branchName}" created under company_id=${companyId}`,
        oldValues: null,
        newValues: { branch_name: branchName, address_line1: address, phone: phone || null },
    });

    return branchRepo.findById(branchId, companyId);
};

/**
 * @param {number} companyId - the tenant the branch is expected to belong
 *   to. Same trust boundary as create(): must be validated, and the update
 *   itself is scoped by both branch_id AND company_id so a wrong/stale
 *   company_id 404s instead of silently updating zero rows (the bug this
 *   replaced — see branch.routes.js history).
 */
const update = async (branchId, companyId, data, actor) => {
    validateFields(data);

    const existing = await branchRepo.findById(branchId, companyId);
    if (!existing) throw new NotFoundError('Branch');

    const updated = await branchRepo.update(branchId, companyId, data);
    if (!updated) throw new NotFoundError('Branch');

    await auditLogRepo.log({
        companyId,
        userId: actor.userId,
        action: 'branch.updated',
        entityType: 'branch',
        entityId: branchId,
        description: `Branch "${existing.branch_name}" updated`,
        oldValues: { branch_name: existing.branch_name, address_line1: existing.address_line1, phone: existing.phone, is_active: existing.is_active },
        newValues: data,
    });

    return branchRepo.findById(branchId, companyId);
};

module.exports = { create, update };
