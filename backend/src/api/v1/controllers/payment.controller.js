/**
 * Payment Controller
 */
'use strict';

const svc      = require('../../../services/payment.service');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id });

const getAll      = async (req, res) => { const { rows, meta } = await svc.getAll(req.query, actor(req)); return response.success(res, { payments: rows, meta, stats: {} }); };
const getPending  = async (req, res) => response.success(res, { pending: await svc.getPending(req.query, actor(req)) });
const getById     = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const getByBooking = async (req, res) => response.success(res, await svc.getByBooking(parseInt(req.params.bookingId, 10), req.companyId));
const create      = async (req, res) => response.created(res, await svc.create(req.body, actor(req)), 'Payment recorded');
const refund      = async (req, res) => response.success(res, await svc.refund(parseInt(req.params.id, 10), req.body, actor(req)), 'Refund processed');

module.exports = { getAll, getPending, getById, getByBooking, create, refund };
