/**
 * Branch scope resolution — shared by every service that lists/filters
 * banquet-hall-tenant data (banquets, halls, customers, payments, reports,
 * users).
 *
 * Only `branch_manager` is a genuinely single-branch-scoped role. Every
 * other role (business_owner, company_admin, sales_manager, finance_manager,
 * operations_manager, booking_executive, staff, receptionist) manages the
 * whole tenant across all of its branches — their own personal `branch_id`
 * (assigned to their Users row for staff-scheduling/contact purposes) must
 * NOT silently restrict what banquets/halls/customers/bookings they can see.
 * Before this fix, `actor.branchId || query.branch_id` applied to every
 * role, so e.g. a Business Owner whose own branch_id didn't match a hall's
 * branch_id (or the hall had no branch_id at all) would see that hall
 * disappear from every list — this was the root cause of a business owner's
 * own halls being invisible in halls/index.html.
 *
 * Any role may still explicitly drill down to one branch via ?branch_id=.
 */
'use strict';

const { USER_ROLES } = require('../constants');

const resolveBranchScope = (actor, query = {}) => {
    if (actor.roleSlug === USER_ROLES.BRANCH_MANAGER) {
        return actor.branchId || (query.branch_id ? parseInt(query.branch_id, 10) : null);
    }
    return query.branch_id ? parseInt(query.branch_id, 10) : null;
};

/**
 * Company/tenant scope resolution for cross-tenant list views. Super Admin
 * browsing Halls/Banquets (etc.) with no tenant explicitly selected
 * (X-Impersonate-Company-Id / ?company_id=) should see every tenant's data,
 * not silently fall back to company_id=1 the way write operations correctly
 * do (scopeToCompany's default keeps writes from ever hitting a null FK).
 * Every other role stays hard-scoped to their own company_id, unchanged.
 */
const resolveCompanyScope = (actor) => {
    if (actor.roleSlug === USER_ROLES.SUPER_ADMIN && !actor.isImpersonating) return null;
    return actor.companyId;
};

module.exports = { resolveBranchScope, resolveCompanyScope };
