/**
 * Marketing Repository — communication history for promotional campaigns
 * sent to leads/customers that haven't converted.
 */

'use strict';

const { executeQuery } = require('../config/database');

const create = async ({ companyId, leadId, customerId, campaignType, subject, message, sentToEmail, sentToPhone, deliveryStatus, sentBy }) => {
    const result = await executeQuery(
        `INSERT INTO MarketingCommunications (
            company_id, lead_id, customer_id, campaign_type, channel, subject, message,
            sent_to_email, sent_to_phone, delivery_status, sent_by, created_at
        )
        OUTPUT INSERTED.comm_id AS id
        VALUES (
            @companyId, @leadId, @customerId, @campaignType, 'email', @subject, @message,
            @sentToEmail, @sentToPhone, @deliveryStatus, @sentBy, SYSUTCDATETIME()
        )`,
        {
            companyId,
            leadId: leadId || null,
            customerId: customerId || null,
            campaignType,
            subject: subject || null,
            message,
            sentToEmail: sentToEmail || null,
            sentToPhone: sentToPhone || null,
            deliveryStatus,
            sentBy,
        }
    );
    return result[0].id;
};

const findForLead = async (leadId, companyId) => {
    return executeQuery(
        `SELECT comm_id, campaign_type, channel, subject, message, sent_to_email, delivery_status, created_at
         FROM MarketingCommunications
         WHERE lead_id = @leadId AND company_id = @companyId
         ORDER BY created_at DESC`,
        { leadId, companyId }
    );
};

const findForCustomer = async (customerId, companyId) => {
    return executeQuery(
        `SELECT comm_id, campaign_type, channel, subject, message, sent_to_email, delivery_status, created_at
         FROM MarketingCommunications
         WHERE customer_id = @customerId AND company_id = @companyId
         ORDER BY created_at DESC`,
        { customerId, companyId }
    );
};

module.exports = { create, findForLead, findForCustomer };
