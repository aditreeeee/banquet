/**
 * Hall Repository
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT h.hall_id, h.banquet_id, h.hall_name, h.description,
           h.hall_type, h.capacity, h.capacity_seated, h.capacity_standing,
           h.has_ac, h.has_stage,
           h.floor_number, h.area_sqft,
           h.base_price, h.weekend_surcharge_pct,
           h.is_active, h.created_at,
           h.company_id, COALESCE(h.branch_id, b.branch_id) AS branch_id,
           b.banquet_name, b.city,
           (SELECT COUNT(*) FROM HallAmenities ha WHERE ha.hall_id = h.hall_id) AS amenities_count
    FROM Halls h
    JOIN Banquets b ON b.banquet_id = h.banquet_id
`;

const findById = async (hallId, companyId = null) => {
    const rows = await executeQuery(
        `${BASE_SELECT}
         WHERE h.hall_id = @id
           AND (@companyId IS NULL OR h.company_id = @companyId)`,
        { id: hallId, companyId: companyId || null }
    );
    return rows[0] || null;
};

const findAll = async ({ companyId, branchId, banquetId, minCapacity, maxCapacity, search, isActive, offset, limit, sortBy, sortDir }) => {
    const where = [
        'h.company_id = @companyId',
        '(@branchId  IS NULL OR h.branch_id  = @branchId)',
        '(@banquetId IS NULL OR h.banquet_id = @banquetId)',
        '(@minCap    IS NULL OR h.capacity   >= @minCap)',
        '(@maxCap    IS NULL OR h.capacity   <= @maxCap)',
        '(@isActive  IS NULL OR h.is_active  = @isActive)',
        `(@search    IS NULL OR h.hall_name LIKE CONCAT('%', @search, '%'))`,
    ].join(' AND ');

    const col = ['hall_name', 'capacity', 'base_price', 'created_at'].includes(sortBy)
        ? `h.${sortBy}` : 'h.hall_name';
    const dir = sortDir === 'DESC' ? 'DESC' : 'ASC';

    const params = {
        companyId,
        branchId:  branchId  || null,
        banquetId: banquetId || null,
        minCap:    minCapacity || null,
        maxCap:    maxCapacity || null,
        isActive:  isActive != null ? isActive : null,
        search:    search    || null,
    };

    const [rows, countRows] = await Promise.all([
        executeQuery(
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
            { ...params, limit, offset }
        ),
        executeQuery(
            `SELECT COUNT(*) AS total FROM Halls h WHERE ${where}`,
            params
        ),
    ]);

    return { rows, total: countRows[0].total };
};

const generateHallCode = (name) =>
    (name || 'HALL').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6) + '-' + Date.now().toString(36).toUpperCase().slice(-4);

const create = async (data) => {
    const result = await executeQuery(
        `INSERT INTO Halls
            (company_id, branch_id, banquet_id, hall_name, hall_code, description, capacity, floor_number,
             area_sqft, base_price, weekend_surcharge_pct, is_active, created_at, updated_at)
         OUTPUT INSERTED.hall_id AS id
         VALUES
            (@companyId, @branchId, @banquetId, @name, @code, @desc, @capacity, @floor,
             @area, @basePrice, @surcharge, 1, GETUTCDATE(), GETUTCDATE())`,
        {
            companyId: data.companyId,
            branchId:  data.branchId  || null,
            banquetId: data.banquetId,
            name:      data.hallName,
            code:      data.hallCode || generateHallCode(data.hallName),
            desc:      data.description || null,
            capacity:  data.capacity    || 0,
            floor:     data.floorNumber || null,
            area:      data.areaSqft    || null,
            basePrice: data.basePrice   || 0,
            surcharge: data.weekendSurchargePct || 0,
        }
    );
    return findById(result[0].id, data.companyId);
};

const update = async (hallId, companyId, data) => {
    await executeQuery(
        `UPDATE Halls
         SET hall_name             = ISNULL(@name,      hall_name),
             description           = ISNULL(@desc,      description),
             capacity              = ISNULL(@capacity,  capacity),
             floor_number          = ISNULL(@floor,     floor_number),
             area_sqft             = ISNULL(@area,      area_sqft),
             base_price            = ISNULL(@basePrice, base_price),
             weekend_surcharge_pct = ISNULL(@surcharge, weekend_surcharge_pct),
             updated_at            = GETUTCDATE()
         WHERE hall_id = @id AND company_id = @companyId`,
        {
            id:        hallId,
            companyId,
            name:      data.hallName  || null,
            desc:      data.description || null,
            capacity:  data.capacity  || null,
            floor:     data.floorNumber || null,
            area:      data.areaSqft  || null,
            basePrice: data.basePrice  || null,
            surcharge: data.weekendSurchargePct || null,
        }
    );
    return findById(hallId, companyId);
};

const toggleActive = async (hallId, companyId, isActive) => {
    await executeQuery(
        `UPDATE Halls SET is_active = @isActive, updated_at = GETUTCDATE()
         WHERE hall_id = @id AND company_id = @companyId`,
        { id: hallId, companyId, isActive }
    );
};

const getBlockedDates = async (hallId, fromDate, toDate, companyId = null) => {
    return executeQuery(
        `SELECT block_id, blocked_date, start_time, end_time, block_type, reason, blocked_by, created_at
         FROM HallBlockedDates
         WHERE hall_id = @hallId
           AND (@companyId IS NULL OR company_id = @companyId)
           AND blocked_date BETWEEN @fromDate AND @toDate
         ORDER BY blocked_date`,
        { hallId, fromDate, toDate, companyId: companyId || null }
    );
};

/**
 * Owner override — block a hall for maintenance, VIP holds, emergency
 * closures, or blackout dates. block_type='vip_hold' is informational only
 * (does not prevent normal bookings); all other types are hard blocks
 * enforced by the booking constraint engine (see booking.repository.js create()).
 */
const blockDate = async ({ hallId, companyId, blockedDate, startTime, endTime, blockType, reason, blockedBy }) => {
    const result = await executeQuery(
        `INSERT INTO HallBlockedDates (hall_id, company_id, blocked_date, start_time, end_time, block_type, reason, blocked_by, created_at)
         OUTPUT INSERTED.block_id AS id
         VALUES (@hallId, @companyId, @blockedDate, @startTime, @endTime, @blockType, @reason, @blockedBy, GETUTCDATE())`,
        {
            hallId,
            companyId,
            blockedDate,
            startTime:  startTime  || '00:00:00',
            endTime:    endTime    || '23:59:59',
            blockType:  blockType  || 'maintenance',
            reason:     reason     || null,
            blockedBy:  blockedBy  || null,
        }
    );
    return { block_id: result[0].id };
};

const unblockDate = async (blockId, hallId, companyId = null) => {
    await executeQuery(
        `DELETE FROM HallBlockedDates
         WHERE block_id = @blockId AND hall_id = @hallId
           AND (@companyId IS NULL OR company_id = @companyId)`,
        { blockId, hallId, companyId: companyId || null }
    );
};

module.exports = { findById, findAll, create, update, toggleActive, getBlockedDates, blockDate, unblockDate };
