/**
 * Banquet Repository
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT b.banquet_id, b.banquet_name, b.description, b.address_line1 AS address, b.city, b.state,
           b.pincode, b.gst_number, b.phone, b.email, b.cover_image_url AS image_url,
           b.total_capacity, b.average_rating AS avg_rating, b.total_reviews,
           b.is_active, b.created_at, b.property_token,
           b.company_id, b.branch_id,
           br.branch_name,
           co.company_name,
           (SELECT COUNT(*) FROM Halls h WHERE h.banquet_id = b.banquet_id AND h.is_active = 1 AND h.deleted_at IS NULL) AS total_halls,
           (SELECT COUNT(*) FROM Bookings bk JOIN Halls h2 ON h2.hall_id = bk.hall_id
              WHERE h2.banquet_id = b.banquet_id AND bk.status NOT IN ('cancelled','draft')) AS total_bookings,
           (SELECT ISNULL(SUM(bk.total_amount), 0) FROM Bookings bk JOIN Halls h2 ON h2.hall_id = bk.hall_id
              WHERE h2.banquet_id = b.banquet_id AND bk.status NOT IN ('cancelled','draft')) AS total_revenue
    FROM Banquets b
    LEFT JOIN Branches br ON br.branch_id = b.branch_id
    LEFT JOIN Companies co ON co.company_id = b.company_id
`;

const findById = async (banquetId, companyId) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE b.banquet_id = @id AND (@companyId IS NULL OR b.company_id = @companyId) AND b.deleted_at IS NULL`,
        { id: banquetId, companyId: companyId || null }
    );
    return rows[0] || null;
};

const findAll = async ({ companyId, branchId, search, isActive, offset, limit, sortBy, sortDir }) => {
    const where = [
        '(@companyId IS NULL OR b.company_id = @companyId)',
        'b.deleted_at IS NULL',
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

/**
 * Count non-deleted halls still under this banquet — a banquet with any
 * remaining hall can't be deleted; halls must be deleted/reassigned first.
 */
const countActiveHalls = async (banquetId, companyId) => {
    const rows = await executeQuery(
        `SELECT COUNT(*) AS cnt FROM Halls
         WHERE banquet_id = @banquetId AND company_id = @companyId AND deleted_at IS NULL`,
        { banquetId, companyId }
    );
    return rows[0].cnt;
};

const softDelete = async (banquetId, companyId) => {
    await executeQuery(
        `UPDATE Banquets SET deleted_at = GETUTCDATE(), updated_at = GETUTCDATE()
         WHERE banquet_id = @id AND company_id = @companyId AND deleted_at IS NULL`,
        { id: banquetId, companyId }
    );
};

/**
 * Resolve a Banquet by its public property_token — the only identifier
 * future public-facing URLs/QR codes/integrations should use, never the raw
 * banquet_id. Also rejects inactive/soft-deleted properties so a deactivated
 * venue's old QR codes/links stop resolving instead of silently 404ing deep
 * inside a caller.
 */
const findByToken = async (token) => {
    const rows = await executeQuery(
        `${BASE_SELECT} WHERE b.property_token = @token AND b.deleted_at IS NULL`,
        { token }
    );
    return rows[0] || null;
};

const getToken = async (banquetId, companyId) => {
    const rows = await executeQuery(
        `SELECT property_token, is_active FROM Banquets
         WHERE banquet_id = @id AND (@companyId IS NULL OR company_id = @companyId) AND deleted_at IS NULL`,
        { id: banquetId, companyId: companyId || null }
    );
    return rows[0] || null;
};

const regenerateToken = async (banquetId, companyId) => {
    const rows = await executeQuery(
        `UPDATE Banquets SET property_token = NEWID(), updated_at = GETUTCDATE()
         OUTPUT INSERTED.property_token
         WHERE banquet_id = @id AND (@companyId IS NULL OR company_id = @companyId) AND deleted_at IS NULL`,
        { id: banquetId, companyId: companyId || null }
    );
    return rows[0]?.property_token || null;
};

module.exports = {
    findById, findAll, create, update, toggleActive, countActiveHalls, softDelete,
    findByToken, getToken, regenerateToken,
};
