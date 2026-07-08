/**
 * Marketing Repository — communication history for promotional campaigns
 * sent to leads/customers that haven't converted.
 */

'use strict';

const { executeQuery } = require('../config/database');

const create = async ({ companyId, leadId, customerId, campaignType, subject, message, sentToEmail, sentToPhone, deliveryStatus, sentBy, attachmentUrl, attachmentName, websiteUrl, socialLinks }) => {
    const result = await executeQuery(
        `INSERT INTO MarketingCommunications (
            company_id, lead_id, customer_id, campaign_type, channel, subject, message,
            sent_to_email, sent_to_phone, delivery_status, sent_by,
            attachment_url, attachment_name, website_url, social_links, created_at
        )
        OUTPUT INSERTED.comm_id AS id
        VALUES (
            @companyId, @leadId, @customerId, @campaignType, 'email', @subject, @message,
            @sentToEmail, @sentToPhone, @deliveryStatus, @sentBy,
            @attachmentUrl, @attachmentName, @websiteUrl, @socialLinks, SYSUTCDATETIME()
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
            attachmentUrl:  attachmentUrl  || null,
            attachmentName: attachmentName || null,
            websiteUrl:     websiteUrl     || null,
            socialLinks:    Array.isArray(socialLinks) && socialLinks.length ? JSON.stringify(socialLinks) : null,
        }
    );
    return result[0].id;
};

const SELECT_FIELDS = `comm_id, campaign_type, channel, subject, message, sent_to_email, delivery_status,
    attachment_url, attachment_name, website_url, social_links, created_at`;

const parseRow = (row) => {
    if (row && typeof row.social_links === 'string') {
        try { row.social_links = JSON.parse(row.social_links); } catch { row.social_links = []; }
    }
    return row;
};

const findForLead = async (leadId, companyId) => {
    const rows = await executeQuery(
        `SELECT ${SELECT_FIELDS}
         FROM MarketingCommunications
         WHERE lead_id = @leadId AND company_id = @companyId
         ORDER BY created_at DESC`,
        { leadId, companyId }
    );
    return rows.map(parseRow);
};

const findForCustomer = async (customerId, companyId) => {
    const rows = await executeQuery(
        `SELECT ${SELECT_FIELDS}
         FROM MarketingCommunications
         WHERE customer_id = @customerId AND company_id = @companyId
         ORDER BY created_at DESC`,
        { customerId, companyId }
    );
    return rows.map(parseRow);
};

module.exports = { create, findForLead, findForCustomer };
