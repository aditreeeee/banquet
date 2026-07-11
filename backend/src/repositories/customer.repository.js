/**
 * Customer Repository
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT c.customer_id, c.first_name, c.last_name, c.email, c.phone,
           c.alternate_phone, c.address, c.city, c.state, c.notes, c.source,
           c.is_active, c.company_id, c.branch_id, c.created_at,
           (SELECT COUNT(*) FROM Bookings b WHERE b.customer_id = c.customer_id AND b.status NOT IN ('draft','cancelled')) AS total_bookings,
           ISNULL((SELECT SUM(total_amount) FROM Bookings b WHERE b.customer_id = c.customer_id AND b.status NOT IN ('draft','cancelled')), 0) AS total_spend,
           ISNULL((SELECT AVG(total_amount) FROM Bookings b WHERE b.customer_id = c.customer_id AND b.status NOT IN ('draft','cancelled')), 0) AS avg_booking_value,
           (SELECT AVG(CAST(r.rating AS DECIMAL(3,2))) FROM Reviews r WHERE r.customer_id = c.customer_id) AS avg_rating
    FROM Customers c
`;

const findById = async (customerId, companyId = null) => {
    const rows = await executeQuery(
        `${BASE_SELECT}
         WHERE c.customer_id = @id
           AND (@companyId IS NULL OR c.company_id = @companyId)`,
        { id: customerId, companyId: companyId || null }
    );
    return rows[0] || null;
};

const findByEmail = async (email, companyId) => {
    const rows = await executeQuery(
        `SELECT customer_id FROM Customers WHERE email = @email AND company_id = @companyId`,
        { email, companyId }
    );
    return rows[0] || null;
};

const SORT_COLUMN_MAP = {
    first_name:     'c.first_name',
    created_at:     'c.created_at',
    total_bookings: 'total_bookings',
    total_spend:    'total_spend',
};

const findAll = async ({ companyId, branchId, search, isActive, source, offset, limit, sortBy, sortDir }) => {
    const where = [
        // NULL companyId means "every tenant" — see resolveCompanyScope in
        // utils/branchScope.js (Super Admin, not impersonating).
        '(@companyId IS NULL OR c.company_id = @companyId)',
        '(@branchId IS NULL OR c.branch_id = @branchId)',
        '(@isActive IS NULL OR c.is_active = @isActive)',
        '(@source IS NULL OR c.source = @source)',
        `(@search IS NULL OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', @search, '%')
          OR c.email LIKE CONCAT('%', @search, '%') OR c.phone LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const col = SORT_COLUMN_MAP[sortBy] || 'c.created_at';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId: branchId || null,
        isActive: isActive != null ? isActive : null,
        source:   source   || null,
        search:   search   || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(`SELECT COUNT(*) AS total FROM Customers c WHERE ${where}`, params),
    ]);

    return { rows, total: countRows[0].total };
};

/** Real dashboard stats for the customer index page's stat strip. */
const getStats = async ({ companyId, branchId }) => {
    const rows = await executeQuery(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN c.created_at >= DATEADD(DAY, -DAY(GETUTCDATE()) + 1, CAST(GETUTCDATE() AS DATE)) THEN 1 ELSE 0 END) AS new_this_month,
            (SELECT AVG(x.spend) FROM (
                SELECT ISNULL(SUM(b.total_amount), 0) AS spend
                FROM Customers c2
                LEFT JOIN Bookings b ON b.customer_id = c2.customer_id AND b.status NOT IN ('draft','cancelled')
                WHERE (@companyId IS NULL OR c2.company_id = @companyId) AND (@branchId IS NULL OR c2.branch_id = @branchId)
                GROUP BY c2.customer_id
            ) x) AS avg_spend,
            (SELECT COUNT(*) FROM (
                SELECT b.customer_id, COUNT(*) AS booking_count
                FROM Customers c3
                JOIN Bookings b ON b.customer_id = c3.customer_id AND b.status NOT IN ('draft','cancelled')
                WHERE (@companyId IS NULL OR c3.company_id = @companyId) AND (@branchId IS NULL OR c3.branch_id = @branchId)
                GROUP BY b.customer_id
                HAVING COUNT(*) > 1
            ) y) AS repeat_customers
         FROM Customers c
         WHERE (@companyId IS NULL OR c.company_id = @companyId) AND (@branchId IS NULL OR c.branch_id = @branchId)`,
        { companyId, branchId: branchId || null }
    );
    const s = rows[0] || {};
    return {
        total: s.total || 0,
        new_this_month: s.new_this_month || 0,
        avg_spend: Math.round(s.avg_spend || 0),
        repeat_customers: s.repeat_customers || 0,
    };
};

const create = async (data) => {
    const result = await executeQuery(
        `INSERT INTO Customers
            (company_id, branch_id, first_name, last_name, email, phone, alternate_phone, address, city, state, notes, source, is_active, created_at, updated_at)
         OUTPUT INSERTED.customer_id AS id
         VALUES
            (@companyId, @branchId, @firstName, @lastName, @email, @phone, @altPhone, @address, @city, @state, @notes, @source, 1, GETUTCDATE(), GETUTCDATE())`,
        {
            companyId: data.companyId,
            branchId:  data.branchId  || null,
            firstName: data.firstName,
            lastName:  data.lastName  || null,
            email:     data.email     || null,
            phone:     data.phone,
            altPhone:  data.alternatePhone || null,
            address:   data.address   || null,
            city:      data.city      || null,
            state:     data.state     || null,
            notes:     data.notes     || null,
            source:    data.source    || 'walkin',
        }
    );
    return findById(result[0].id, data.companyId);
};

const update = async (customerId, companyId, data) => {
    await executeQuery(
        `UPDATE Customers
         SET first_name      = ISNULL(@firstName, first_name),
             last_name       = ISNULL(@lastName,  last_name),
             email           = ISNULL(@email,     email),
             phone           = ISNULL(@phone,     phone),
             alternate_phone = ISNULL(@altPhone,  alternate_phone),
             address         = ISNULL(@address,   address),
             city            = ISNULL(@city,      city),
             state           = ISNULL(@state,     state),
             notes           = ISNULL(@notes,     notes),
             source          = ISNULL(@source,    source),
             is_active       = ISNULL(@isActive,  is_active),
             updated_at      = GETUTCDATE()
         WHERE customer_id = @id AND company_id = @companyId`,
        {
            id:        customerId,
            companyId,
            firstName: data.firstName      || null,
            lastName:  data.lastName       || null,
            email:     data.email          || null,
            phone:     data.phone          || null,
            altPhone:  data.alternatePhone || null,
            address:   data.address        || null,
            city:      data.city           || null,
            state:     data.state          || null,
            notes:     data.notes          || null,
            source:    data.source         || null,
            isActive:  data.isActive != null ? data.isActive : null,
        }
    );
    return findById(customerId, companyId);
};

const getBookingHistory = async (customerId, companyId, { offset, limit }) => {
    const rows = await executeQuery(
        `SELECT b.booking_id, b.booking_ref, b.event_date, b.event_end_date, b.event_name,
                b.event_time_start, b.event_time_end,
                b.status, b.total_amount, b.amount_paid, b.updated_at, h.hall_name
         FROM Bookings b
         JOIN Halls h ON h.hall_id = b.hall_id
         WHERE b.customer_id = @customerId AND b.company_id = @companyId
         ORDER BY b.event_date DESC
         OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
        { customerId, companyId, limit, offset }
    );
    return rows;
};

module.exports = { findById, findByEmail, findAll, create, update, getBookingHistory, getStats };

