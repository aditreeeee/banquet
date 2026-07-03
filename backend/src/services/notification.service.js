/**
 * Notification Service — Email, SMS, WhatsApp abstraction layer
 * Concrete providers (Nodemailer, MSG91, etc.) are injected via config.
 * New providers can be added without changing call-sites.
 */

'use strict';

const nodemailer = require('nodemailer');
const logger     = require('../utils/logger');

// ─── Transporter (lazy-initialized) ──────────────────────────────────────────

let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;

    transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
        port:   parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    return transporter;
};

// ─── Email Templates ──────────────────────────────────────────────────────────

const buildPasswordResetHtml = ({ firstName, resetUrl }) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:auto;padding:24px">
  <h2 style="color:#3d547f">Password Reset Request</h2>
  <p>Hi ${firstName || 'there'},</p>
  <p>We received a request to reset your BanquetPro password. Click the button below to choose a new password.
     This link expires in <strong>1 hour</strong>.</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${resetUrl}"
       style="background:#C5A059;color:#fff;padding:12px 28px;border-radius:6px;
              text-decoration:none;font-weight:600;display:inline-block">
      Reset Password
    </a>
  </p>
  <p>If you did not request this, you can safely ignore this email — your password won't change.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">
    BanquetPro &bull; If the button doesn't work, paste this URL into your browser:<br>
    <a href="${resetUrl}" style="color:#3d547f">${resetUrl}</a>
  </p>
</body>
</html>`;

const buildBookingConfirmationHtml = ({ firstName, booking }) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:auto;padding:24px">
  <h2 style="color:#3d547f">Booking Confirmed</h2>
  <p>Hi ${firstName || 'there'},</p>
  <p>Your booking <strong>#${booking.booking_ref}</strong> has been confirmed.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Event</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong>${booking.event_name || '-'}</strong></td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Date</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${booking.event_date || '-'}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Hall</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${booking.hall_name || '-'}</td></tr>
    <tr><td style="padding:8px;color:#888">Amount</td>
        <td style="padding:8px"><strong>₹${booking.total_amount?.toLocaleString() || '-'}</strong></td></tr>
  </table>
  <p style="font-size:12px;color:#888">BanquetPro — Your Premium Event Partner</p>
</body>
</html>`;

// ─── Send Helpers ─────────────────────────────────────────────────────────────

/**
 * Send an email via SMTP
 * @param {Object} options - { to, subject, html, text }
 */
const sendEmail = async ({ to, subject, html, text }) => {
    if (process.env.NODE_ENV === 'test') return; // suppress in test

    try {
        const info = await getTransporter().sendMail({
            from:    `"${process.env.SMTP_FROM_NAME || 'BanquetPro'}" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
            text: text || html.replace(/<[^>]+>/g, ''), // strip HTML for plain-text fallback
        });
        logger.info('Email sent', { to, subject, messageId: info.messageId });
    } catch (err) {
        logger.error('Email send failed', { to, subject, error: err.message });
        throw err; // re-throw so callers can decide to fail or swallow
    }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send password reset email
 * @param {Object} opts - { to, firstName, token }
 */
const sendPasswordResetEmail = async ({ to, firstName, token }) => {
    const baseUrl  = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await sendEmail({
        to,
        subject: 'Reset your BanquetPro password',
        html:    buildPasswordResetHtml({ firstName, resetUrl }),
    });
};

/**
 * Send booking confirmation email
 * @param {Object} opts - { to, firstName, booking }
 */
const sendBookingConfirmationEmail = async ({ to, firstName, booking }) => {
    await sendEmail({
        to,
        subject: `Booking Confirmed — #${booking.booking_ref}`,
        html:    buildBookingConfirmationHtml({ firstName, booking }),
    });
};

/**
 * Send a generic notification email (fallback / custom)
 */
const sendGenericEmail = async ({ to, subject, html }) => {
    await sendEmail({ to, subject, html });
};

/**
 * Placeholder for SMS (MSG91 or other provider) — wire up in next phase
 */
const sendSms = async ({ to, message }) => {
    logger.info('SMS stub — not yet wired', { to, message: message?.slice(0, 20) });
};

/**
 * Placeholder for WhatsApp Business API
 */
const sendWhatsApp = async ({ to, message }) => {
    logger.info('WhatsApp stub — not yet wired', { to, message: message?.slice(0, 20) });
};

module.exports = {
    sendEmail,
    sendPasswordResetEmail,
    sendBookingConfirmationEmail,
    sendGenericEmail,
    sendSms,
    sendWhatsApp,
};
