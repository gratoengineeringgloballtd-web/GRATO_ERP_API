// ═══════════════════════════════════════════════════════════════════════════
// FILE: services/documentSigningEmailService.js
//
// Mirrors the style of your existing emailService (sendActionItemEmail) and
// sharepointEmailService. Each function sends ONE email and returns a
// promise; callers .catch() at the call site so a failed email never blocks
// the signing workflow itself.
// ═══════════════════════════════════════════════════════════════════════════

const nodemailer = require('nodemailer');

// Reuse the same transporter pattern your other email services likely use.
// Adjust to match your actual transporter config/import if you have a shared
// one already (e.g. require('../config/mailer')).
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const FROM_ADDRESS = process.env.EMAIL_FROM || 'no-reply@gratoglobal.com';

const wrapEmailHtml = (bodyHtml) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: #1890ff; padding: 16px 24px; border-radius: 8px 8px 0 0;">
      <h2 style="color: white; margin: 0;">GRATO ENGINEERING GLOBAL LTD</h2>
    </div>
    <div style="padding: 24px; border: 1px solid #eee; border-top: none; border-radius: 0 0 8px 8px;">
      ${bodyHtml}
    </div>
    <p style="color: #999; font-size: 11px; text-align: center; margin-top: 16px;">
      This is an automated message from the GRATO E-Signature Portal.
    </p>
  </div>
`;

/**
 * Sent to a signer when it becomes their turn to sign (no-login link).
 */
const sendSigningRequest = async (signer, document, isReminder = false) => {
  const signUrl = `${FRONTEND_URL}/sign/${document._id}/${signer.accessToken}`;
  const subject = isReminder
    ? `Reminder: Signature needed — "${document.title}"`
    : `Signature requested — "${document.title}"`;

  const html = wrapEmailHtml(`
    <p>Hello ${signer.name},</p>
    <p>${isReminder ? 'This is a reminder that your' : 'Your'} signature is needed on the document
       <strong>"${document.title}"</strong>, submitted by ${document.initiator?.fullName || 'a colleague'}.</p>
    <p>This document is at signing level ${signer.level} of ${document.signers.length}.
       ${signer.level > 1 ? 'All prior signers have already completed their part.' : ''}</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${signUrl}" style="background: #1890ff; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        Review &amp; Sign Document
      </a>
    </p>
    <p style="color: #888; font-size: 12px;">This link is unique to you and does not require a login. Do not forward this email.</p>
  `);

  return transporter.sendMail({ from: FROM_ADDRESS, to: signer.email, subject, html });
};

/**
 * Sent to the initiator when the document is rejected by any signer.
 */
const sendRejectionNotice = async (initiatorEmail, initiatorName, document, rejectedBySigner, reason) => {
  const subject = `Document rejected — "${document.title}"`;
  const html = wrapEmailHtml(`
    <p>Hello ${initiatorName},</p>
    <p><strong>${rejectedBySigner.name}</strong> (${rejectedBySigner.role || 'signer'}) has declined to sign
       <strong>"${document.title}"</strong> at level ${rejectedBySigner.level}.</p>
    <p><strong>Reason given:</strong></p>
    <blockquote style="border-left: 3px solid #f5222d; padding-left: 12px; color: #555;">${reason || 'No reason provided.'}</blockquote>
    <p>The signing chain has been cancelled. You may make corrections and resubmit as a new document.</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${FRONTEND_URL}/documents/sign/${document._id}" style="background: #f5222d; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        View Document
      </a>
    </p>
  `);
  return transporter.sendMail({ from: FROM_ADDRESS, to: initiatorEmail, subject, html });
};

/**
 * Sent to the initiator (and optionally all signers) when the document is
 * fully signed.
 */
const sendCompletionNotice = async (recipientEmail, recipientName, document) => {
  const subject = `Fully signed — "${document.title}"`;
  const html = wrapEmailHtml(`
    <p>Hello ${recipientName},</p>
    <p><strong>"${document.title}"</strong> has been signed by all ${document.signers.length} required signer(s)
       and is now complete.</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${FRONTEND_URL}/documents/sign/${document._id}" style="background: #52c41a; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        Download Signed Document
      </a>
    </p>
  `);
  return transporter.sendMail({ from: FROM_ADDRESS, to: recipientEmail, subject, html });
};

/**
 * Sent to the initiator each time a level completes, so they can track
 * progress without checking the portal.
 */
const sendProgressUpdate = async (initiatorEmail, initiatorName, document, justSignedBy) => {
  const subject = `Signed by ${justSignedBy.name} — "${document.title}"`;
  const remaining = document.signers.filter(s => s.status === 'pending').length;
  const html = wrapEmailHtml(`
    <p>Hello ${initiatorName},</p>
    <p><strong>${justSignedBy.name}</strong> has signed <strong>"${document.title}"</strong>
       (level ${justSignedBy.level} of ${document.signers.length}).</p>
    <p>${remaining > 0 ? `${remaining} signer(s) remaining.` : 'This was the final signature — the document is now complete.'}</p>
  `);
  return transporter.sendMail({ from: FROM_ADDRESS, to: initiatorEmail, subject, html });
};

/**
 * Sent to admin/IT/CEO when an override (force-sign or reassignment) occurs,
 * for transparency.
 */
const sendOverrideNotice = async (initiatorEmail, initiatorName, document, overrideAction, performedBy) => {
  const subject = `Admin action taken — "${document.title}"`;
  const html = wrapEmailHtml(`
    <p>Hello ${initiatorName},</p>
    <p><strong>${performedBy.fullName}</strong> (${performedBy.role}) performed an administrative action
       on <strong>"${document.title}"</strong>: <strong>${overrideAction}</strong>.</p>
  `);
  return transporter.sendMail({ from: FROM_ADDRESS, to: initiatorEmail, subject, html });
};

module.exports = {
  sendSigningRequest,
  sendRejectionNotice,
  sendCompletionNotice,
  sendProgressUpdate,
  sendOverrideNotice
};