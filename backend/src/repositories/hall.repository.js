/**
 * Hall Repository
 */
'use strict';

const { executeQuery } = require('../config/database');

const BASE_SELECT = `
    SELECT h.hall_id, h.banquet_id, h.hall_name, h.description,
           h.capacity, h.floor_number, h.area_sqft,
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
         WHERE h.hall_id = :id
           AND (:companyId IS NULL OR h.company_id = :companyId)`,
        { id: hallId, companyId: companyId || null }
    );
    return rows[0] || null;
};

const findAll = async ({ companyId, branchId, banquetId, minCapacity, maxCapacity, search, isActive, offset, limit, sortBy, sortDir }) => {
    const where = [
        'h.company_id = :companyId',
        '(:branchId  IS NULL OR h.branch_id  = :branchId)',
        '(:banquetId IS NULL OR h.banquet_id = :banquetId)',
        '(:minCap    IS NULL OR h.capacity   >= :minCap)',
        '(:maxCap    IS NULL OR h.capacity   <= :maxCap)',
        '(:isActive  IS NULL OR h.is_active  = :isActive)',
        `(:search    IS NULL OR h.hall_name LIKE CONCAT('%', :search, '%'))`,
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
            `${BASE_SELECT} WHERE ${where} ORDER BY ${col} ${dir} LIMIT :limit OFFSET :offset`,
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
         VALUES
            (:companyId, :branchId, :banquetId, :name, :code, :desc, :capacity, :floor,
             :area, :basePrice, :surcharge, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
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
    return findById(result.insertId, data.companyId);
};

const update = async (hallId, companyId, data) => {
    await executeQuery(
        `UPDATE Halls
         SET hall_name             = IFNULL(:name,      hall_name),
             description           = IFNULL(:desc,      description),
             capacity              = IFNULL(:capacity,  capacity),
             floor_number          = IFNULL(:floor,     floor_number),
             area_sqft             = IFNULL(:area,      area_sqft),
             base_price            = IFNULL(:basePrice, base_price),
             weekend_surcharge_pct = IFNULL(:surcharge, weekend_surcharge_pct),
             updated_at            = UTC_TIMESTAMP()
         WHERE hall_id = :id AND company_id = :companyId`,
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
        `UPDATE Halls SET is_active = :isActive, updated_at = UTC_TIMESTAMP()
         WHERE hall_id = :id AND company_id = :companyId`,
        { id: hallId, companyId, isActive }
    );
};

const getBlockedDates = async (hallId, fromDate, toDate) => {
    return executeQuery(
        `SELECT block_id, blocked_date, start_time, end_time, reason, blocked_by, created_at
         FROM HallBlockedDates
         WHERE hall_id = :hallId
           AND blocked_date BETWEEN :fromDate AND :toDate
         ORDER BY blocked_date`,
        { hallId, fromDate, toDate }
    );
};

const blockDate = async ({ hallId, blockedDate, startTime, endTime, reason, blockedBy }) => {
    const result = await executeQuery(
        `INSERT INTO HallBlockedDates (hall_id, blocked_date, start_time, end_time, reason, blocked_by, created_at)
         VALUES (:hallId, :blockedDate, :startTime, :endTime, :reason, :blockedBy, UTC_TIMESTAMP())`,
        {
            hallId,
            blockedDate,
            startTime:  startTime  || '00:00:00',
            endTime:    endTime    || '23:59:59',
            reason:     reason     || null,
            blockedBy:  blockedBy  || null,
        }
    );
    return { block_id: result.insertId };
};

const unblockDate = async (blockId, hallId) => {
    await executeQuery(
        `DELETE FROM HallBlockedDates WHERE block_id = :blockId AND hall_id = :hallId`,
        { blockId, hallId }
    );
};

module.exports = { findById, findAll, create, update, toggleActive, getBlockedDates, blockDate, unblockDate };
