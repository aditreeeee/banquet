/**
 * Quotation Controller
 */
'use strict';

const svc        = require('../../../services/quotation.service');
const companyRepo = require('../../../repositories/company.repository');
const { generateQuotationPDF } = require('../../../utils/quotationPdf');
const response = require('../../../utils/response');
const actor    = (req) => ({ companyId: req.companyId, branchId: req.user.branch_id, userId: req.user.user_id });

const getAll  = async (req, res) => { const { rows, meta } = await svc.list(req.query, actor(req)); return response.success(res, { quotations: rows, meta }); };
const getById = async (req, res) => response.success(res, await svc.getById(parseInt(req.params.id, 10), req.companyId));
const create  = async (req, res) => response.created(res, await svc.create(req.body, actor(req)));
const update  = async (req, res) => response.success(res, await svc.update(parseInt(req.params.id, 10), req.body, actor(req)), 'Quotation updated');
const addItem = async (req, res) => response.created(res, await svc.addItem(parseInt(req.params.id, 10), req.body, actor(req)));
const removeItem = async (req, res) => response.success(res, await svc.removeItem(parseInt(req.params.id, 10), parseInt(req.params.itemRowId, 10), actor(req)), 'Item removed');
const revise  = async (req, res) => response.created(res, await svc.revise(parseInt(req.params.id, 10), actor(req)));
const send      = async (req, res) => response.success(res, await svc.updateStatus(parseInt(req.params.id, 10), 'sent', actor(req)), 'Quotation sent');
const reject    = async (req, res) => response.success(res, await svc.updateStatus(parseInt(req.params.id, 10), 'rejected', actor(req)), 'Quotation rejected');
const expire    = async (req, res) => response.success(res, await svc.updateStatus(parseInt(req.params.id, 10), 'expired', actor(req)), 'Quotation expired');
const accept    = async (req, res) => response.success(res, await svc.updateStatus(parseInt(req.params.id, 10), 'accepted', actor(req)), 'Quotation accepted');
const convert   = async (req, res) => response.created(res, await svc.convertToBooking(parseInt(req.params.id, 10), req.body, actor(req)));

// The PDF must show the issuing tenant's own Company/Property details, never
// generic platform branding — generateQuotationPDF already accepts a
// `company` object for exactly this, it just needs to actually be fetched
// and passed (previously called with `{}`, so it silently fell back to the
// hardcoded 'BanquetPro' literal on every single quotation, regardless of
// which company issued it).
const downloadPDF = async (req, res) => {
    const quotation = await svc.getById(parseInt(req.params.id, 10), req.companyId);
    const companyRow = quotation.company_id ? await companyRepo.findById(quotation.company_id) : null;
    const company = companyRow ? {
        company_name: companyRow.company_name,
        address: [companyRow.address_line1, companyRow.address_line2].filter(Boolean).join(', '),
        phone: companyRow.phone,
        email: companyRow.email,
    } : {};
    const buffer = await generateQuotationPDF(quotation, quotation.items, company);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotation_number}.pdf"`);
    return res.send(buffer);
};

module.exports = {
    getAll, getById, create, update, addItem, removeItem, revise,
    send, reject, expire, accept, convert, downloadPDF,
};
