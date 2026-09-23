/**
 * emailNotificationService.js
 * Sends alert and digest emails via Nodemailer.
 * Configure SMTP via environment variables.
 */
const nodemailer = require('nodemailer');
const DieselAlert = require('../models/DieselAlert');
const logger      = require('../utils/logger');

// Email recipients by role (configure in env or DB later)
const ROLE_EMAILS = {
  data_collector: process.env.EMAIL_DATA_COLLECTOR || '',
  diesel_manager: process.env.EMAIL_DIESEL_MANAGER || '',
  admin:          process.env.EMAIL_ADMIN           || '',
};

// Which alert types go to which roles
const ALERT_RECIPIENTS = {
  LOW_FUEL:                ['diesel_manager', 'admin'],
  ZERO_GRID_24H:           ['diesel_manager', 'admin'],
  CONSUMPTION_OVER_CCPH:   ['diesel_manager'],
  REFUEL_MISMATCH_CMS:     ['diesel_manager', 'data_collector'],
  REFUEL_MISMATCH_TOMCARD: ['diesel_manager', 'admin'],
  MISSING_GRATO:           ['data_collector', 'diesel_manager'],
  MISSING_CMS:             ['data_collector', 'admin'],
  THEFT_SUSPECTED:         ['diesel_manager', 'admin'],
  IMPORT_ERROR:            ['admin'],
};

const SEVERITY_COLORS = {
  critical: '#dc2626',
  high:     '#d97706',
  medium:   '#2563eb',
  low:      '#6b7280',
  info:     '#059669',
};

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

function emailHtml(alert) {
  const color = SEVERITY_COLORS[alert.severity] || '#6b7280';
  const data  = alert.data || {};
  const rows  = Object.entries(data)
    .filter(([k]) => !['site_id'].includes(k))
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;">${k.replace(/_/g,' ')}</td><td style="padding:6px 12px;font-size:13px;font-weight:600;">${typeof v === 'number' ? v.toLocaleString() : v}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:${color};padding:20px 24px;">
    <p style="color:rgba(255,255,255,0.8);font-size:11px;margin:0 0 4px;">IHS DIESEL MANAGEMENT SYSTEM</p>
    <h2 style="color:#fff;margin:0;font-size:18px;">${alert.title}</h2>
  </div>
  <div style="padding:20px 24px;">
    <p style="color:#374151;font-size:14px;line-height:1.6;">${alert.message}</p>
    ${rows ? `<table style="width:100%;border-collapse:collapse;margin-top:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">${rows}</table>` : ''}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px;">Cycle: ${alert.cycle_key || '—'} &nbsp;|&nbsp; ${new Date().toLocaleString()}</p>
    <p style="color:#9ca3af;font-size:11px;">This is an automated alert from the IHS Diesel Management System.</p>
  </div>
</div></body></html>`;
}

async function sendAlertEmails(emailQueue) {
  if (!process.env.SMTP_USER) {
    logger.warn('[Email] SMTP_USER not configured — skipping email send');
    return;
  }
  const transport = createTransport();

  for (const { alert } of emailQueue) {
    const roles    = ALERT_RECIPIENTS[alert.alert_type] || ['admin'];
    const toEmails = [...new Set(roles.map(r => ROLE_EMAILS[r]).filter(Boolean))];
    if (!toEmails.length) continue;

    try {
      await transport.sendMail({
        from:    `"IHS Diesel System" <${process.env.SMTP_USER}>`,
        to:      toEmails.join(', '),
        subject: `[${alert.severity?.toUpperCase()}] ${alert.title}`,
        html:    emailHtml(alert),
      });

      await DieselAlert.findByIdAndUpdate(alert._id, {
        email_sent:       true,
        email_sent_at:    new Date(),
        email_recipients: toEmails,
      });

      logger.info(`[Email] Sent alert ${alert.alert_type} to ${toEmails.join(', ')}`);
    } catch (err) {
      logger.error(`[Email] Failed to send ${alert.alert_type}: ${err.message}`);
    }
  }
}

async function sendSystemAlert(alert) {
  return sendAlertEmails([{ alert }]);
}

/**
 * Send daily digest: one email per morning with all open alerts grouped by cluster.
 * Called by a scheduler (e.g. node-cron at 07:00 daily).
 */
async function sendDailyDigest() {
  if (!process.env.SMTP_USER) return;

  const openAlerts = await DieselAlert.find({ status: { $in: ['open', 'acknowledged'] } })
    .sort({ severity: 1, cluster: 1 })
    .lean();

  if (!openAlerts.length) return;

  const byCluster = {};
  for (const a of openAlerts) {
    const c = a.cluster || 'Unassigned';
    if (!byCluster[c]) byCluster[c] = [];
    byCluster[c].push(a);
  }

  const rows = Object.entries(byCluster).map(([cluster, alerts]) => {
    const alertRows = alerts.map(a =>
      `<tr><td style="padding:5px 8px;font-size:12px;">${a.site_id || '—'}</td>
       <td style="padding:5px 8px;font-size:12px;color:${SEVERITY_COLORS[a.severity]};">${a.severity}</td>
       <td style="padding:5px 8px;font-size:12px;">${a.alert_type.replace(/_/g,' ')}</td>
       <td style="padding:5px 8px;font-size:12px;color:#6b7280;">${a.message.slice(0, 80)}…</td></tr>`
    ).join('');
    return `<h3 style="margin:16px 0 8px;font-size:14px;color:#374151;">${cluster} (${alerts.length})</h3>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
<tr style="background:#f3f4f6;"><th style="padding:6px 8px;text-align:left;font-size:11px;">Site</th><th style="padding:6px 8px;text-align:left;font-size:11px;">Severity</th><th style="padding:6px 8px;text-align:left;font-size:11px;">Type</th><th style="padding:6px 8px;text-align:left;font-size:11px;">Message</th></tr>
${alertRows}</table>`;
  }).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:20px;">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;">
<div style="background:#1a1a2e;padding:20px 24px;"><h2 style="color:#fff;margin:0;">Daily Diesel Alert Digest</h2>
<p style="color:#aaa;margin:4px 0 0;font-size:13px;">${openAlerts.length} open alerts · ${new Date().toLocaleDateString()}</p></div>
<div style="padding:20px 24px;">${rows}
<p style="color:#9ca3af;font-size:11px;margin-top:20px;">Login to the IHS Diesel Management System to manage these alerts.</p>
</div></div></body></html>`;

  const allEmails = [...new Set(Object.values(ROLE_EMAILS).filter(Boolean))];
  if (!allEmails.length) return;

  try {
    const transport = createTransport();
    await transport.sendMail({
      from:    `"IHS Diesel System" <${process.env.SMTP_USER}>`,
      to:      allEmails.join(', '),
      subject: `IHS Diesel Daily Digest — ${openAlerts.length} open alerts`,
      html,
    });
    logger.info(`[Email] Daily digest sent to ${allEmails.join(', ')}`);
  } catch (err) {
    logger.error(`[Email] Daily digest failed: ${err.message}`);
  }
}

module.exports = { sendAlertEmails, sendSystemAlert, sendDailyDigest };