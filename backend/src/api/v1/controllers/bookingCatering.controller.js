/**
 * Booking Catering Controller — per-booking multi-session catering plans.
 */
'use strict';

const svc      = require('../../../services/bookingCatering.service');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id });

const listSessions  = async (req, res) => response.success(res, await svc.listSessions(parseInt(req.params.bookingId, 10), req.companyId));
const addSession    = async (req, res) => response.created(res, await svc.addSession(parseInt(req.params.bookingId, 10), req.body, actor(req)));
const updateSession = async (req, res) => response.success(res, await svc.updateSession(parseInt(req.params.bookingId, 10), parseInt(req.params.sessionId, 10), req.body, actor(req)), 'Session updated');
const removeSession = async (req, res) => { await svc.removeSession(parseInt(req.params.bookingId, 10), parseInt(req.params.sessionId, 10), actor(req)); return response.success(res, null, 'Session removed'); };
const addItem       = async (req, res) => response.created(res, await svc.addItem(parseInt(req.params.bookingId, 10), parseInt(req.params.sessionId, 10), req.body, actor(req)));
const removeItem    = async (req, res) => response.success(res, await svc.removeItem(parseInt(req.params.bookingId, 10), parseInt(req.params.sessionId, 10), parseInt(req.params.itemRowId, 10), actor(req)), 'Item removed');
const applyPackage  = async (req, res) => response.success(res, await svc.applyPackage(parseInt(req.params.bookingId, 10), parseInt(req.params.sessionId, 10), req.body.packageId, actor(req)), 'Package applied');

module.exports = { listSessions, addSession, updateSession, removeSession, addItem, removeItem, applyPackage };
