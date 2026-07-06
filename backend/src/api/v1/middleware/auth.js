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

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        } catch (err) {
            throw err; // Let global handler map JWT errors to 401
        }

        // Load user with role (lightweight query)
        const result = await executeQuery(
            `SELECT
                u.user_id, u.email, u.first_name, u.last_name,
                u.company_id, u.branch_id, u.is_active,
                u.role_id, r.role_slug
             FROM Users u
             INNER JOIN Roles r ON r.role_id = u.role_id
             WHERE u.user_id = @userId AND u.is_active = 1`,
            { userId: decoded.userId }
        );

        if (!result.length) {
            throw new AuthError('User account not found or deactivated');
        }

        const user = result[0];

        // Load permissions (from cache or DB)
        const cacheKey = `perms_${user.role_id}`;
        let permissions = permissionCache.get(cacheKey);

        if (!permissions) {
            const permResult = await executeQuery(
                `SELECT p.permission_key
                 FROM RolePermissions rp
                 INNER JOIN Permissions p ON p.permission_id = rp.permission_id
                 WHERE rp.role_id = @roleId`,
                { roleId: user.role_id }
            );

            permissions = permResult.map(r => r.permission_key);
            permissionCache.set(cacheKey, permissions);
        }

        // Attach user to request
        req.user = {
            ...user,
            permissions,
            isSuperAdmin: user.role_slug === 'super_admin',
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
    if (!roleSlugs.includes(req.user.role_slug)) return next(new ForbiddenError());
    next();
};

// ─── Scope to Company (auto-inject company_id into query param) ───────────────
const scopeToCompany = (req, res, next) => {
    if (!req.user) return next(new AuthError());

    if (req.user.isSuperAdmin) {
        // Super admin can switch company via ?company_id= (query) or body field.
        // Falls back to company_id=1 so writes never fail with null.
        const override = req.query.company_id || req.body?.company_id;
        req.companyId = override ? parseInt(override, 10) : 1;
    } else {
        if (!req.user.company_id) {
            return next(new AuthError('User account has no company assigned. Contact your administrator.'));
        }
        req.companyId = req.user.company_id;
    }

    next();
};

// ─── Invalidate Permission Cache (call when role permissions change) ──────────
const invalidatePermissionCache = (roleId) => {
    permissionCache.del(`perms_${roleId}`);
};

module.exports = {
    authenticate,
    requirePermission,
    requireAnyPermission,
    requireRole,
    scopeToCompany,
    invalidatePermissionCache,
};
