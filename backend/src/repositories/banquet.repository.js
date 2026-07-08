/**
 * Banquet Repository
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT b.banquet_id, b.banquet_name, b.description, b.address_line1 AS address, b.city, b.state,
           b.pincode, b.gst_number, b.phone, b.email, b.cover_image_url AS image_url,
           b.total_capacity, b.average_rating AS avg_rating, b.total_reviews, b.total_bookings,
           b.is_active, b.created_at,
           b.company_id, b.branch_id,
           br.branch_name,
           (SELECT COUNT(*) FROM Halls h WHERE h.banquet_id = b.banquet_id AND h.is_active = 1) AS total_halls
    FROM Banquets b
    LEFT JOIN Branches br ON br.branch_id = b.branch_id
`;

const findById = async (banquetId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE b.banquet_id = @id AND b.company_id = @companyId`,
        { id: banquetId, companyId }
    );
    return rows[0] || null;
};

const findAll = async ({ companyId, branchId, search, isActive, offset, limit, sortBy, sortDir }) => {
    const where = [
        'b.company_id = @companyId',
        '(@branchId IS NULL OR b.branch_id = @branchId)',
        '(@isActive IS NULL OR b.is_active = @isActive)',
        `(@search IS NULL OR b.banquet_name LIKE CONCAT('%', @search, '%') OR b.city LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const col = ['banquet_name', 'city', 'created_at'].includes(sortBy) ? `b.${sortBy}` : 'b.banquet_name';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId: branchId || null,
        isActive: isActive != null ? isActive : null,
        search:   search   || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total FROM Banquets b WHERE ${where}`,
            params
        ),
    ]);

    return { rows, total: countRows[0].total };
};

const slugify = (name) =>
    (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 200) + '-' + Date.now().toString(36);

const create = async (data) => {
    const result = await executeQuery(
        `INSERT INTO Banquets (company_id, branch_id, banquet_name, banquet_slug, description,
             address_line1, city, state, pincode, gst_number, phone, email, cover_image_url,
             total_capacity, is_active, created_at, updated_at)
         OUTPUT INSERTED.banquet_id AS id
         VALUES (@companyId, @branchId, @name, @slug, @desc,
             @address, @city, @state, @pincode, @gstNumber, @phone, @email, @imageUrl,
             @totalCapacity, @isActive, GETUTCDATE(), GETUTCDATE())`,
        {
            companyId: data.companyId,
            branchId:  data.branchId  || null,
            name:      data.banquetName,
            slug:      slugify(data.banquetName),
            desc:      data.description || null,
            address:   data.address   || null,
            city:      data.city      || null,
            state:     data.state     || null,
            pincode:   data.pincode   || null,
            gstNumber: data.gstNumber || null,
            phone:     data.phone     || null,
            email:     data.email     || null,
            imageUrl:  data.imageUrl  || null,
            totalCapacity: data.totalCapacity || 0,
            isActive:  data.isActive != null ? !!data.isActive : true,
        }
    );
    return findById(result[0].id, data.companyId);
};

const update = async (banquetId, companyId, data) => {
    await executeQuery(
        `UPDATE Banquets
         SET banquet_name    = ISNULL(@name,      banquet_name),
             description     = ISNULL(@desc,      description),
             address_line1   = ISNULL(@address,   address_line1),
             city            = ISNULL(@city,      city),
             state           = ISNULL(@state,     state),
             pincode         = ISNULL(@pincode,   pincode),
             gst_number      = ISNULL(@gstNumber,  gst_number),
             phone           = ISNULL(@phone,     phone),
             email           = ISNULL(@email,     email),
             cover_image_url = ISNULL(@imageUrl,  cover_image_url),
             total_capacity  = ISNULL(@totalCapacity, total_capacity),
             is_active       = ISNULL(@isActive,  is_active),
             updated_at      = GETUTCDATE()
         WHERE banquet_id = @id AND company_id = @companyId`,
        {
            id:        banquetId,
            companyId,
            name:      data.banquetName  || null,
            desc:      data.description  || null,
            address:   data.address      || null,
            city:      data.city         || null,
            state:     data.state        || null,
            pincode:   data.pincode      || null,
            gstNumber: data.gstNumber    || null,
            phone:     data.phone        || null,
            email:     data.email        || null,
            imageUrl:  data.imageUrl     || null,
            totalCapacity: data.totalCapacity || null,
            isActive:  data.isActive != null ? !!data.isActive : null,
        }
    );
    return findById(banquetId, companyId);
};

const toggleActive = async (banquetId, companyId, isActive) => {
    await executeQuery(
        `UPDATE Banquets SET is_active = @isActive, updated_at = GETUTCDATE()
         WHERE banquet_id = @id AND company_id = @companyId`,
        { id: banquetId, companyId, isActive }
    );
};

module.exports = { findById, findAll, create, update, toggleActive };
