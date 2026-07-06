/**
 * Marketing Automation Service
 * "If an inquiry never converts, let sales staff send a promotional
 * flyer/discount/festival offer/package pitch to the lead or customer,
 * with every send stored as communication history."
 */

'use strict';

const marketingRepo = require('../repositories/marketing.repository');
const leadRepo = require('../repositories/lead.repository');
const customerRepo = require('../repositories/customer.repository');
const notif = require('../services/notification.service');
const auditLogRepo = require('../repositories/auditLog.repository');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError } = require('../api/v1/middleware/errorHandler');

const CAMPAIGN_TYPES = {
    flyer:                { label: 'Promotional Flyer',   defaultSubject: 'Something special for your next event' },
    discount:             { label: 'Discount Offer',      defaultSubject: 'A special discount, just for you' },
    festival_offer:       { label: 'Festival Offer',      defaultSubject: 'Festival season offer inside 🎉' },
    wedding_package:      { label: 'Wedding Package',      defaultSubject: 'Our best wedding packages this season' },
    anniversary_package:  { label: 'Anniversary Package',  defaultSubject: 'Celebrate your anniversary with us' },
    birthday_package:     { label: 'Birthday Package',     defaultSubject: 'Make this birthday unforgettable' },
};

const send = async ({ leadId, customerId, campaignType, subject, message }, actor) => {
    if (!leadId && !customerId) throw new ValidationError('leadId or customerId is required');
    if (!CAMPAIGN_TYPES[campaignType]) {
        throw new ValidationError(`campaignType must be one of: ${Object.keys(CAMPAIGN_TYPES).join(', ')}`);
    }

    let recipientEmail = null;
    let recipientName = null;

    if (leadId) {
        const lead = await leadRepo.findById(leadId, actor.companyId);
        if (!lead) throw new NotFoundError('Lead');
        recipientEmail = lead.contact_email;
        recipientName = lead.contact_name;
    } else {
        const customer = await customerRepo.findById(customerId, actor.companyId);
        if (!customer) throw new NotFoundError('Customer');
        recipientEmail = customer.email;
        recipientName = `${customer.first_name} ${customer.last_name || ''}`.trim();
    }

    const finalSubject = subject || CAMPAIGN_TYPES[campaignType].defaultSubject;
    let deliveryStatus = 'sent';

    if (recipientEmail) {
        try {
            await notif.sendGenericEmail({
                to: recipientEmail,
                subject: finalSubject,
                html: `<p>Hi ${recipientName || 'there'},</p><p>${message}</p>`,
            });
        } catch (err) {
            deliveryStatus = 'failed';
            logger.warn('Marketing email send failed', { error: err.message, leadId, customerId });
        }
    } else {
        deliveryStatus = 'failed';
    }

    const commId = await marketingRepo.create({
        companyId: actor.companyId,
        leadId, customerId,
        campaignType,
        subject: finalSubject,
        message,
        sentToEmail: recipientEmail,
        deliveryStatus,
        sentBy: actor.userId,
    });

    await auditLogRepo.log({
        companyId: actor.companyId,
        userId: actor.userId,
        action: 'marketing.sent',
        entityType: leadId ? 'lead' : 'customer',
        entityId: leadId || customerId,
        description: `Sent "${CAMPAIGN_TYPES[campaignType].label}" to ${recipientName || 'recipient'} (${deliveryStatus})`,
        newValues: { campaignType, deliveryStatus },
    });

    return { comm_id: commId, delivery_status: deliveryStatus, sent_to_email: recipientEmail };
};

const getHistory = async ({ leadId, customerId }, actor) => {
    if (leadId) return marketingRepo.findForLead(leadId, actor.companyId);
    if (customerId) return marketingRepo.findForCustomer(customerId, actor.companyId);
    throw new ValidationError('leadId or customerId is required');
};

module.exports = { send, getHistory, CAMPAIGN_TYPES };
