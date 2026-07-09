/**
 * Report Controller
 */
'use strict';

const svc      = require('../../../services/report.service');
const response = require('../../../utils/response');
const { sendExport } = require('../../../utils/exporter');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id, roleSlug: req.user.role_slug });

const REVENUE_COLUMNS  = [
    { key: 'period_label',     label: 'Period' },
    { key: 'booking_count',    label: 'Bookings' },
    { key: 'total_revenue',    label: 'Total Revenue' },
    { key: 'amount_collected', label: 'Collected' },
    { key: 'pending_amount',   label: 'Pending' },
    { key: 'cancellations',    label: 'Cancellations' },
];

const BOOKING_COLUMNS  = [
    { key: 'booking_ref',   label: 'Booking Ref' },
    { key: 'event_date',    label: 'Event Date' },
    { key: 'event_name',    label: 'Event' },
    { key: 'hall_name',     label: 'Hall' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'status',        label: 'Status' },
    { key: 'guest_count',   label: 'Guests' },
    { key: 'total_amount',  label: 'Total Amount' },
    { key: 'amount_paid',   label: 'Paid' },
    { key: 'balance_due',   label: 'Balance Due' },
];

const OCCUPANCY_COLUMNS = [
    { key: 'hall_name',      label: 'Hall' },
    { key: 'banquet_name',   label: 'Banquet' },
    { key: 'capacity',       label: 'Capacity' },
    { key: 'total_bookings', label: 'Bookings' },
    { key: 'total_revenue',  label: 'Revenue' },
    { key: 'cancellations',  label: 'Cancellations' },
    { key: 'occupancy_pct',  label: 'Occupancy %' },
];

const PAYMENT_COLUMNS = [
    { key: 'payment_method',    label: 'Method' },
    { key: 'payment_type',      label: 'Type' },
    { key: 'transaction_count', label: 'Transactions' },
    { key: 'total_amount',      label: 'Total Amount' },
];

const getRevenue = async (req, res) => {
    const data = await svc.getRevenueReport(req.query, actor(req));
    if (req.query.format) {
        const sent = await sendExport(res, req.query.format, {
            title: 'Revenue Report', columns: REVENUE_COLUMNS, rows: data.series, filename: 'revenue-report',
        });
        if (sent) return;
    }
    return response.success(res, data);
};

const getBookings = async (req, res) => {
    if (req.query.format) {
        // Export the full matching set, not just one page.
        const { rows } = await svc.getBookingReport({ ...req.query, page: 1, limit: 10000 }, actor(req));
        const formattedRows = rows.map(r => ({ ...r, event_date: new Date(r.event_date).toISOString().slice(0, 10) }));
        const sent = await sendExport(res, req.query.format, {
            title: 'Bookings Report', columns: BOOKING_COLUMNS, rows: formattedRows, filename: 'bookings-report',
        });
        if (sent) return;
    }
    const { rows, meta } = await svc.getBookingReport(req.query, actor(req));
    return response.paginated(res, rows, meta);
};

const getOccupancy = async (req, res) => {
    const data = await svc.getOccupancyReport(req.query, actor(req));
    if (req.query.format) {
        const sent = await sendExport(res, req.query.format, {
            title: 'Occupancy Report', columns: OCCUPANCY_COLUMNS, rows: data.by_hall, filename: 'occupancy-report',
        });
        if (sent) return;
    }
    return response.success(res, data);
};

const getPayments = async (req, res) => {
    const data = await svc.getPaymentReport(req.query, actor(req));
    if (req.query.format) {
        const sent = await sendExport(res, req.query.format, {
            title: 'Payments Report', columns: PAYMENT_COLUMNS, rows: data.payments, filename: 'payments-report',
        });
        if (sent) return;
    }
    return response.success(res, data);
};

const getOwnerAnalytics = async (req, res) => response.success(res, await svc.getOwnerAnalytics(req.query, actor(req)));

module.exports = { getRevenue, getBookings, getOccupancy, getPayments, getOwnerAnalytics };
