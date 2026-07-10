/**
 * Booking Catering Service — per-booking multi-session catering plans.
 * Reuses catering.repository.js's Master Menu item data when a session item
 * references one (price/tax snapshotted at add-time — see the migration
 * comment in database/migrations/009_booking_catering_sessions.sql for why).
 */
'use strict';

const bookingCateringRepo = require('../repositories/bookingCatering.repository');
const cateringRepo  = require('../repositories/catering.repository');
const bookingRepo   = require('../repositories/booking.repository');
const bookingService = require('./booking.service');
const menuItemRepo  = require('../repositories/menuItem.repository');
const settingsService = require('../services/settings.service');
const auditLogRepo = require('../repositories/auditLog.repository');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const SESSION_TYPES = [
    'welcome_drinks', 'morning_tea', 'breakfast', 'lunch', 'evening_snacks',
    'high_tea', 'dinner', 'midnight_refreshments',
];

// event_time_start/end come back from the mssql driver as native JS Date
// objects on a 1970-01-01 epoch (already-JSON-serialized HTTP responses see
// ISO strings instead, since res.json() always renders Dates in UTC — but
// this runs on the raw repository row, before that serialization happens).
// String(dateObject) formats in the *server's local timezone*, not UTC —
// on this server (IST, UTC+5:30) that silently shifted every window by
// 5.5 hours. Always go through toISOString() for a real Date first.
const clockTime = (t) => {
    if (!t) return null;
    const iso = t instanceof Date ? t.toISOString() : String(t);
    const m = iso.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
};

// Handles overnight bookings (endTime < startTime, e.g. 20:00-02:00) by
// treating the window as wrapping past midnight instead of a plain range —
// the UI-side validation in create.html/detail.html uses the same logic.
const isWithinEventWindow = (servingTime, startTime, endTime) => {
    if (!servingTime || !startTime || !endTime) return true; // nothing to validate against
    return startTime <= endTime
        ? servingTime >= startTime && servingTime <= endTime
        : servingTime >= startTime || servingTime <= endTime;
};

const validateServingTime = (servingTime, booking) => {
    if (!servingTime) return;
    const startTime = clockTime(booking.event_time_start);
    const endTime = clockTime(booking.event_time_end);
    if (!isWithinEventWindow(servingTime, startTime, endTime)) {
        throw new ValidationError(`Serving time must be within the event's ${startTime} – ${endTime} window`);
    }
};

const getBooking = async (bookingId, companyId) => {
    const booking = await bookingRepo.findById(bookingId, companyId);
    if (!booking) throw new NotFoundError('Booking');
    return booking;
};

const listSessions = async (bookingId, companyId) => {
    await getBooking(bookingId, companyId);
    const sessions = await bookingCateringRepo.listSessionsForBooking(bookingId, companyId);
    return Promise.all(sessions.map(async s => ({
        ...s,
        items: await bookingCateringRepo.listItemsForSession(s.session_id),
    })));
};

/**
 * Warn (default) or block when a session's ordered plates fall short of the
 * expected guest count — configurable via Settings (catering.min_plate_policy).
 * Returns a warning string (or null) rather than always throwing, so 'warn'
 * mode can still save while surfacing the shortfall to the caller.
 */
const validatePlateCount = async ({ session, items, booking, companyId, override }) => {
    const policy = await settingsService.getCateringPolicy(companyId);
    if (policy === 'off' || override) return null;

    const expectedGuests = session.guest_count != null ? session.guest_count : (booking.guest_count || 0);
    if (!expectedGuests) return null;

    const totalPlates = items.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0);
    if (totalPlates >= expectedGuests) return null;

    const shortfall = `Ordered plates (${totalPlates}) are below the expected guest count (${expectedGuests}) for this session.`;
    if (policy === 'block') {
        throw new ValidationError(`${shortfall} Pass override:true to save anyway (if your role permits), or adjust quantities.`);
    }
    return shortfall; // 'warn' — caller surfaces this as a non-blocking warning
};

const addSession = async (bookingId, data, actor) => {
    const booking = await getBooking(bookingId, actor.companyId);
    if (['cancelled', 'completed', 'archived'].includes(booking.status)) {
        throw new ValidationError(`Cannot add a catering session to a ${booking.status} booking`);
    }
    const sessionType = data.sessionType || data.session_type;
    if (!SESSION_TYPES.includes(sessionType)) {
        throw new ValidationError(`sessionType must be one of: ${SESSION_TYPES.join(', ')}`);
    }
    const servingTime = data.servingTime || data.serving_time;
    validateServingTime(servingTime, booking);
    const session = await bookingCateringRepo.createSession(bookingId, actor.companyId, {
        sessionType,
        servingTime,
        guestCount:  data.guestCount  ?? data.guest_count,
        notes:       data.notes,
    });

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'booking.catering_session_added', entityType: 'booking', entityId: bookingId,
        description: `Catering session "${sessionType}" added to booking ${booking.booking_ref}`,
        newValues: { session_type: sessionType },
    });

    return { ...session, items: [] };
};

const updateSession = async (bookingId, sessionId, data, actor) => {
    const booking = await getBooking(bookingId, actor.companyId);
    const existing = await bookingCateringRepo.findSessionById(sessionId, actor.companyId);
    if (!existing || existing.booking_id != bookingId) throw new NotFoundError('Catering session');

    const sessionType = data.sessionType || data.session_type;
    if (sessionType && !SESSION_TYPES.includes(sessionType)) {
        throw new ValidationError(`sessionType must be one of: ${SESSION_TYPES.join(', ')}`);
    }
    const servingTime = data.servingTime || data.serving_time;
    validateServingTime(servingTime, booking);

    const updated = await bookingCateringRepo.updateSession(sessionId, actor.companyId, {
        sessionType,
        servingTime,
        guestCount:  data.guestCount  ?? data.guest_count,
        notes:       data.notes,
    });

    const items = await bookingCateringRepo.listItemsForSession(sessionId);
    const warning = await validatePlateCount({ session: updated, items, booking, companyId: actor.companyId, override: data.override });
    return { ...updated, items, warning };
};

const removeSession = async (bookingId, sessionId, actor) => {
    const booking = await getBooking(bookingId, actor.companyId);
    const existing = await bookingCateringRepo.findSessionById(sessionId, actor.companyId);
    if (!existing || existing.booking_id != bookingId) throw new NotFoundError('Catering session');

    await bookingCateringRepo.removeSession(sessionId, actor.companyId);
    // The session's items go with it — keep the booking's stored total in sync.
    await bookingService.recalculateBookingTotal(bookingId, actor.companyId);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'booking.catering_session_removed', entityType: 'booking', entityId: bookingId,
        description: `Catering session "${existing.session_type}" removed from booking ${booking.booking_ref}`,
    });
};

/**
 * Add an item to a session — either referencing a Master Menu item (price/tax
 * snapshotted from it) or a fully custom line (name/price/tax supplied
 * directly), for one-off items that don't belong in the shared Master Menu.
 */
const addItem = async (bookingId, sessionId, data, actor) => {
    const booking = await getBooking(bookingId, actor.companyId);
    const session = await bookingCateringRepo.findSessionById(sessionId, actor.companyId);
    if (!session || session.booking_id != bookingId) throw new NotFoundError('Catering session');

    let itemName = data.itemName || data.item_name;
    let unitPrice = data.unitPrice ?? data.unit_price;
    let taxPercent = data.taxPercent ?? data.tax_percent;
    const itemId = data.itemId ?? data.item_id ?? null;

    if (itemId) {
        const menuItem = await menuItemRepo.findById(itemId, actor.companyId);
        if (!menuItem) throw new NotFoundError('Menu item');
        itemName   = menuItem.item_name;
        unitPrice  = menuItem.base_price;
        taxPercent = menuItem.tax_percent;
    } else if (!itemName) {
        throw new ValidationError('itemName is required for a custom catering line item');
    }

    await bookingCateringRepo.addItem(sessionId, {
        itemId, itemName, quantity: data.quantity, unitPrice, taxPercent,
    });

    const items = await bookingCateringRepo.listItemsForSession(sessionId);
    const warning = await validatePlateCount({ session, items, booking, companyId: actor.companyId, override: data.override });
    await bookingService.recalculateBookingTotal(bookingId, actor.companyId);
    return { items, warning };
};

/**
 * Apply a Catering Package to a session — bulk-adds every Master Menu item
 * the package references, at quantity_per_plate × the session's (or
 * booking's) guest count. This is what makes Catering Packages "reusable
 * templates" for a session rather than a parallel, disconnected pricing
 * system: every line ends up as a normal BookingCateringItem, snapshotted
 * from MenuItems exactly like a manually-added item would be.
 */
const applyPackage = async (bookingId, sessionId, packageId, actor) => {
    const booking = await getBooking(bookingId, actor.companyId);
    const session = await bookingCateringRepo.findSessionById(sessionId, actor.companyId);
    if (!session || session.booking_id != bookingId) throw new NotFoundError('Catering session');

    const pkg = await cateringRepo.findPackageById(packageId, actor.companyId);
    if (!pkg) throw new NotFoundError('Catering package');
    if (!pkg.is_active) throw new ValidationError('This catering package is no longer available');

    const packageItems = await cateringRepo.getPackageItems(packageId);
    if (!packageItems.length) throw new ValidationError('This catering package has no Master Menu items configured');

    const guestCount = session.guest_count != null ? session.guest_count : (booking.guest_count || 0);
    for (const pi of packageItems) {
        await bookingCateringRepo.addItem(sessionId, {
            itemId:     pi.item_id,
            itemName:   pi.item_name,
            quantity:   Number((pi.quantity_per_plate * guestCount).toFixed(2)) || pi.quantity_per_plate,
            unitPrice:  pi.base_price,
            taxPercent: pi.tax_percent,
        });
    }

    const items = await bookingCateringRepo.listItemsForSession(sessionId);
    const warning = await validatePlateCount({ session, items, booking, companyId: actor.companyId });
    await bookingService.recalculateBookingTotal(bookingId, actor.companyId);

    await auditLogRepo.log({
        companyId: actor.companyId, userId: actor.userId,
        action: 'booking.catering_package_applied', entityType: 'booking', entityId: bookingId,
        description: `Catering package "${pkg.package_name}" applied to session ${sessionId} on booking ${booking.booking_ref}`,
        newValues: { package_id: packageId, guest_count: guestCount },
    });

    return { items, warning };
};

const removeItem = async (bookingId, sessionId, itemRowId, actor) => {
    const session = await bookingCateringRepo.findSessionById(sessionId, actor.companyId);
    if (!session || session.booking_id != bookingId) throw new NotFoundError('Catering session');
    await bookingCateringRepo.removeItem(itemRowId, sessionId);
    await bookingService.recalculateBookingTotal(bookingId, actor.companyId);
    return bookingCateringRepo.listItemsForSession(sessionId);
};

module.exports = { SESSION_TYPES, listSessions, addSession, updateSession, removeSession, addItem, removeItem, applyPackage };
