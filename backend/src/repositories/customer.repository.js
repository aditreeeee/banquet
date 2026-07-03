/**
 * Customer Repository
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT c.customer_id, c.first_name, c.last_name, c.email, c.phone,
           c.alternate_phone, c.address, c.city, c.state, c.notes,
           c.is_active, c.company_id, c.branch_id, c.created_at,
           (SELECT COUNT(*) FROM Bookings b WHERE b.customer_id = c.customer_id AND b.status NOT IN ('draft','cancelled')) AS booking_count,
           IFNULL((SELECT SUM(total_amount) FROM Bookings b WHERE b.customer_id = c.customer_id AND b.status NOT IN ('draft','cancelled')), 0) AS lifetime_value
    FROM Customers c
`;

const findById = async (customerId, companyId = null) => {
    const rows = await executeQuery(
        `${BASE_SELECT}
         WHERE c.customer_id = :id
           AND (:companyId IS NULL OR c.company_id = :companyId)`,
        { id: customerId, companyId: companyId || null }
    );
    return rows[0] || null;
};

const findByEmail = async (email, companyId) => {
    const rows = await executeQuery(
        `SELECT customer_id FROM Customers WHERE email = :email AND company_id = :companyId`,
        { email, companyId }
    );
    return rows[0] || null;
};

const findAll = async ({ companyId, branchId, search, isActive, offset, limit, sortBy, sortDir }) => {
    const where = [
        'c.company_id = :companyId',
        '(:branchId IS NULL OR c.branch_id = :branchId)',
        '(:isActive IS NULL OR c.is_active = :isActive)',
        `(:search IS NULL OR CONCAT(c.first_name, ' ', c.last_name) LIKE CONCAT('%', :search, '%')
          OR c.email LIKE CONCAT('%', :search, '%') OR c.phone LIKE CONCAT('%', :search, '%'))`,
    ].join(' AND ');

    const col = ['first_name', 'created_at'].includes(sortBy) ? `c.${sortBy}` : 'c.first_name';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId: branchId || null,
        isActive: isActive != null ? isActive : null,
        search:   search   || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} LIMIT :limit OFFSET :offset`,
            { ...params, limit, offset }
        ),
        executeQuery(`SELECT COUNT(*) AS total FROM Customers c WHERE ${where}`, params),
    ]);

    return { rows, total: countRows[0].total };
};

const create = async (data) => {
    const result = await executeQuery(
        `INSERT INTO Customers
            (company_id, branch_id, first_name, last_name, email, phone, alternate_phone, address, city, state, notes, source, is_active, created_at, updated_at)
         VALUES
            (:companyId, :branchId, :firstName, :lastName, :email, :phone, :altPhone, :address, :city, :state, :notes, :source, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
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
    return findById(result.insertId, data.companyId);
};

const update = async (customerId, companyId, data) => {
    await executeQuery(
        `UPDATE Customers
         SET first_name      = IFNULL(:firstName, first_name),
             last_name       = IFNULL(:lastName,  last_name),
             email           = IFNULL(:email,     email),
             phone           = IFNULL(:phone,     phone),
             alternate_phone = IFNULL(:altPhone,  alternate_phone),
             address         = IFNULL(:address,   address),
             city            = IFNULL(:city,      city),
             state           = IFNULL(:state,     state),
             notes           = IFNULL(:notes,     notes),
             updated_at      = UTC_TIMESTAMP()
         WHERE customer_id = :id AND company_id = :companyId`,
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
        }
    );
    return findById(customerId, companyId);
};

const getBookingHistory = async (customerId, companyId, { offset, limit }) => {
    const rows = await executeQuery(
        `SELECT b.booking_id, b.booking_ref, b.event_date, b.event_name,
                b.status, b.total_amount, h.hall_name
         FROM Bookings b
         JOIN Halls h ON h.hall_id = b.hall_id
         WHERE b.customer_id = :customerId AND b.company_id = :companyId
         ORDER BY b.event_date DESC
         LIMIT :limit OFFSET :offset`,
        { customerId, companyId, limit, offset }
    );
    return rows;
};

module.exports = { findById, findByEmail, findAll, create, update, getBookingHistory };
