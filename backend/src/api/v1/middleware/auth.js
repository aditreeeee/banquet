/**
 * Authentication & Authorization Middleware
 * JWT verification + RBAC permission checks
 */

'use strict';

const jwt  = require('jsonwebtoken');
const NodeCache = require('node-cache');
const { executeQuery } = require('../../../config/database');
const { AuthError, ForbiddenError } = require('./errorHandler');
const logger = require('../../../utils/logger');
const settingsService = require('../../../services/settings.service');

// Cache permissions per role (TTL 5 min — reduces DB calls)
const permissionCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// ─── Verify JWT Access Token ──────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
    // TEMPORARY: auth bypass for local development only. Requires DISABLE_AUTH=true
    // AND non-production NODE_ENV, so it can never silently activate in prod.
    if (process.env.DISABLE_AUTH === 'true' && process.env.NODE_ENV !== 'production') {
        logger.warn('AUTH BYPASS ACTIVE — DISABLE_AUTH=true. Do not use in production.');
        req.user = {
            user_id: 0,
            email: 'dev-bypass@local',
            first_name: 'Dev',
            last_name: 'Bypass',
            company_id: 1,
            branch_id: null,
            is_active: 1,
            role_id: 0,
            role_slug: 'super_admin',
            roles: ['super_admin'],
            roleIds: [0],
            permissions: [],
            isSuperAdmin: true,
        };
        return next();
    }

    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            throw new AuthError('Authorization header missing or invalid');
        }

        const token = authHeader.slice(7);

        // JWT errors (expired/invalid signature) propagate to the outer
        // catch below, which the global error handler maps to 401.
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

        // Absolute Session Lifetime — enforced here (not just at /auth/refresh)
        // so a still-valid access token issued before the session's hard cap
        // can't keep being used for regular API calls after that cap passes;
        // the client's next 401 correctly forces a real re-login instead of a
        // silent refresh (refreshTokens() applies the same check and revokes
        // the token, so refresh would fail here too — this just fails fast
        // without the extra round trip for every request in between).
        if (decoded.sessionStartedAt) {
            const policy = await settingsService.getSessionPolicy();
            const sessionAgeMs = Date.now() - decoded.sessionStartedAt;
            if (sessionAgeMs > policy.absoluteSessionHours * 60 * 60 * 1000) {
                throw new AuthError('Session expired — please sign in again');
            }
        }

        // Load user (lightweight query)
        const result = await executeQuery(
            `SELECT
                u.user_id, u.email, u.first_name, u.last_name,
                u.company_id, u.branch_id, u.is_active, u.role_id
             FROM Users u
             WHERE u.user_id = @userId AND u.is_active = 1`,
            { userId: decoded.userId }
        );

        if (!result.length) {
            throw new AuthError('User account not found or deactivated');
        }

        const user = result[0];

        // Load all roles assigned to this user (multi-role support via UserRoles).
        // A user's effective permissions are the union of every assigned role's grants.
        const roleRows = await executeQuery(
            `SELECT r.role_id, r.role_slug
             FROM UserRoles ur
             INNER JOIN Roles r ON r.role_id = ur.role_id
             WHERE ur.user_id = @userId AND r.is_active = 1`,
            { userId: user.user_id }
        );

        if (!roleRows.length) {
            throw new AuthError('User account has no roles assigned');
        }

        const roleIds   = roleRows.map(r => r.role_id).sort((a, b) => a - b);
        const roleSlugs = roleRows.map(r => r.role_slug);

        // Load permissions (from cache or DB) — union across all assigned roles
        const cacheKey = `perms_${roleIds.join('-')}`;
        let permissions = permissionCache.get(cacheKey);

        if (!permissions) {
            const permResult = await executeQuery(
                `SELECT DISTINCT p.permission_key
                 FROM RolePermissions rp
                 INNER JOIN Permissions p ON p.permission_id = rp.permission_id
                 WHERE rp.role_id IN (${roleIds.join(',')})`
            );

            permissions = permResult.map(r => r.permission_key);
            permissionCache.set(cacheKey, permissions);
        }

        // Attach user to request. `role_slug` (primary/default role, from Users.role_id)
        // is kept for display purposes only — authorization always uses `roles`/`permissions`.
        req.user = {
            ...user,
            role_slug: roleRows.find(r => r.role_id === user.role_id)?.role_slug || roleSlugs[0],
            roles: roleSlugs,
            roleIds,
            permissions,
            isSuperAdmin: roleSlugs.includes('super_admin'),
        };

        next();
    } catch (err) {
        next(err);
    }
};

// ─── Require Permission ───────────────────────────────────────────────────────
/**
 * @param  {...string} permissionKeys - e.g. 'bookings:create', 'reports:export'
 * @returns Express middleware
 */
const requirePermission = (...permissionKeys) => (req, res, next) => {
    if (!req.user) return next(new AuthError());

    // Super admin bypasses all permission checks
    if (req.user.isSuperAdmin) return next();

    const hasPermission = permissionKeys.every(key => req.user.permissions.includes(key));

    if (!hasPermission) {
        logger.warn('Permission denied', {
            userId:     req.user.user_id,
            required:   permissionKeys,
            path:       req.path,
            requestId:  req.requestId,
        });
        return next(new ForbiddenError(`Required permission: ${permissionKeys.join(', ')}`));
    }

    next();
};

// ─── Require Any Permission ───────────────────────────────────────────────────
const requireAnyPermission = (...permissionKeys) => (req, res, next) => {
    if (!req.user) return next(new AuthError());
    if (req.user.isSuperAdmin) return next();

    const hasAny = permissionKeys.some(key => req.user.permissions.includes(key));
    if (!hasAny) return next(new ForbiddenError());
    next();
};

// ─── Require Role ─────────────────────────────────────────────────────────────
const requireRole = (...roleSlugs) => (req, res, next) => {
    if (!req.user) return next(new AuthError());
    if (req.user.isSuperAdmin) return next();
    if (!roleSlugs.some(slug => req.user.roles.includes(slug))) return next(new ForbiddenError());
    next();
};

// ─── Scope-based access (branch / hall) ───────────────────────────────────────
// Foundation for future multi-location deployments. A role's grant of a given
// permission is tenant-wide by default; RolePermissionScopes optionally
// restricts specific role+permission combos to a set of branches/halls. When
// no scope rows exist for a role+permission, access remains unrestricted
// (current behavior) — this is purely additive.
const scopeCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const getPermissionScopes = async (roleIds, permissionKey) => {
    const cacheKey = `scope_${roleIds.join('-')}_${permissionKey}`;
    let rows = scopeCache.get(cacheKey);
    if (rows) return rows;

    rows = await executeQuery(
        `SELECT rps.branch_id, rps.hall_id
         FROM RolePermissionScopes rps
         INNER JOIN Permissions p ON p.permission_id = rps.permission_id
         WHERE rps.role_id IN (${roleIds.join(',')}) AND p.permission_key = @permissionKey`,
        { permissionKey }
    );
    scopeCache.set(cacheKey, rows);
    return rows;
};

/**
 * Restrict a permission to specific branches/halls, if the role(s) granting
 * it have scope rows defined. `resolveScope(req)` returns { branchId, hallId }
 * for the entity being accessed (e.g. looked up from the route's :id).
 * @param {string} permissionKey
 * @param {(req) => Promise<{branchId?: number, hallId?: number}>} resolveScope
 */
const requireScope = (permissionKey, resolveScope) => async (req, res, next) => {
    if (!req.user) return next(new AuthError());
    if (req.user.isSuperAdmin) return next();

    try {
        const scopeRows = await getPermissionScopes(req.user.roleIds, permissionKey);
        if (!scopeRows.length) return next(); // unrestricted — no scope configured

        const { branchId, hallId } = await resolveScope(req);
        const allowed = scopeRows.some(r =>
            (r.branch_id == null || r.branch_id === branchId) &&
            (r.hall_id == null || r.hall_id === hallId)
        );

        if (!allowed) {
            logger.warn('Scope denied', { userId: req.user.user_id, permissionKey, branchId, hallId, path: req.path });
            return next(new ForbiddenError('You do not have access to this branch/hall'));
        }
        next();
    } catch (err) {
        next(err);
    }
};

// ─── Scope to Company (auto-inject company_id into query param) ───────────────
const scopeToCompany = (req, res, next) => {
    if (!req.user) return next(new AuthError());

    if (req.user.isSuperAdmin) {
        // Super admin can switch company via ?company_id= (query), a body
        // field, or the X-Impersonate-Company-Id header — the header is what
        // the frontend's persistent "view as tenant" mode uses (see api.js),
        // so every existing tenant-scoped endpoint works unmodified once a
        // super admin starts impersonating, without appending a query param
        // to every single call. Falls back to company_id=1 so writes never
        // fail with null when no tenant context is selected at all.
        //
        // Reads that should show every tenant when NOT impersonating (Halls,
        // Bookings, etc.) don't rely on this default — they call
        // resolveCompanyScope(actor) instead (see utils/branchScope.js),
        // which checks req.isImpersonating below and resolves to null
        // ("every tenant") independently of the company_id=1 fallback here.
        const override = req.query.company_id || req.body?.company_id || req.headers['x-impersonate-company-id'];
        req.companyId = override ? parseInt(override, 10) : 1;
        req.isImpersonating = !!override;
    } else {
        if (!req.user.company_id) {
            return next(new AuthError('User account has no company assigned. Contact your administrator.'));
        }
        req.companyId = req.user.company_id;
    }

    next();
};

// ─── Invalidate Permission Cache (call when role permissions or user-role
// assignments change) ──────────────────────────────────────────────────────
// Cache keys are the sorted, joined role_ids of a user's assigned-role set
// (e.g. "perms_2-5"), since permissions are now a union across roles. A single
// role_id can appear in many different users' composite keys, so we clear any
// cache entry whose key contains it rather than trying to reconstruct the key.
const invalidatePermissionCache = (roleId) => {
    const needle = String(roleId);
    permissionCache.keys().forEach((key) => {
        const ids = key.replace('perms_', '').split('-');
        if (ids.includes(needle)) permissionCache.del(key);
    });
};

module.exports = {
    authenticate,
    requirePermission,
    requireAnyPermission,
    requireRole,
    requireScope,
    scopeToCompany,
    invalidatePermissionCache,
};
