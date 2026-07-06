/**
 * Audit Log Routes — /api/v1/audit-logs
 * Read-only access to the immutable audit trail
 */
'use strict';

const { Router }            = require('express');
const { requirePermission } = require('../middleware/auth');
const { executeQuery }      = require('../../../config/database');
const response              = require('../../../utils/response');
const { PERMISSIONS }       = require('../../../constants');

const router = Router();

router.get('/', requirePermission(PERMISSIONS.AUDIT_LOGS_READ), async (req, res) => {
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = (page - 1) * limit;

    const { entity_type, action, user_id, from_date, to_date } = req.query;

    const where = [
        'al.company_id = @companyId',
        '(@entityType IS NULL OR al.entity_type = @entityType)',
        '(@action     IS NULL OR al.action      = @action)',
        '(@userId     IS NULL OR al.user_id     = @userId)',
        '(@fromDate   IS NULL OR CAST(al.created_at AS DATE) >= @fromDate)',
        '(@toDate     IS NULL OR CAST(al.created_at AS DATE) <= @toDate)',
    ].join(' AND ');

    const params = {
        companyId:  req.companyId,
        entityType: entity_type || null,
        action:     action      || null,
        userId:     user_id ? parseInt(user_id, 10) : null,
        fromDate:   from_date || null,
        toDate:     to_date   || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `SELECT al.log_id, al.action, al.entity_type, al.entity_id,
                    al.description, al.old_values, al.new_values,
                    al.ip_address, al.user_agent, al.created_at,
                    CASE WHEN al.user_id IS NULL THEN 'System' ELSE CONCAT(u.first_name, ' ', u.last_name) END AS user_name,
                    u.email AS user_email
             FROM AuditLogs al
             LEFT JOIN Users u ON u.user_id = al.user_id
             WHERE ${where}
             ORDER BY al.created_at DESC
             OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total FROM AuditLogs al WHERE ${where}`,
            params
        ),
    ]);

    return response.success(res, {
        data:  rows,
        total: countRows[0].total,
        page,
        limit,
    }, 'Audit logs retrieved');
});

module.exports = router;
