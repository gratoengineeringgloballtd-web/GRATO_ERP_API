const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// Reuse existing transporter from emailService.js
let _transporter = null;
const getTransporter = () => {
  if (!_transporter) {
    const config = {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 60000
    };
    _transporter = nodemailer.createTransport(config);
  }
  return _transporter;
};


/**
 * Public URLs used inside emails.
 * CLIENT_URL may contain several comma-separated values; the first is the frontend.
 * Tracking pixel, click tracking and attachment links must hit the BACKEND (BACKEND_URL),
 * not the frontend.
 */
const stripSlash = (u) => String(u || '').trim().replace(/\/+$/, '');
const getClientUrl = () => {
  const first = String(process.env.CLIENT_URL || '').split(',')[0];
  return stripSlash(first) || 'http://localhost:3000';
};
let _warnedBackendUrl = false;
const getBackendUrl = () => {
  const url = stripSlash(process.env.BACKEND_URL || process.env.API_URL || '');
  if (!url) return getClientUrl();
  if (!_warnedBackendUrl && /localhost|127\.0\.0\.1/.test(url) && process.env.NODE_ENV === 'production') {
    _warnedBackendUrl = true;
    console.warn('⚠️ BACKEND_URL points to localhost in production - email open/click tracking and attachment links will not work for recipients.');
  }
  return url;
};

const QUOTA_RE = /quota|rate limit|too many (messages|emails|recipients)|5\.4\.5|daily user sending|exceeded/i;
const isQuotaError = (e) => QUOTA_RE.test(`${e && e.message || ''} ${e && e.response || ''}`);
const isFatalAuthError = (e) => e && (e.code === 'EAUTH' || e.responseCode === 535);
const isPermanentError = (e) => e && e.responseCode >= 500 && e.responseCode < 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send communication email with tracking
 */
const sendCommunicationEmail = async (options, communicationId, retries = 3) => {
  const backendUrl = getBackendUrl();

  // Generate tracking pixel for email opens
  const trackingPixel = `<img src="${backendUrl}/api/communications/${communicationId}/track-open?user=${options.userId}" width="1" height="1" style="display:none;" alt="" />`;

  // Add tracking to links in HTML
  let contentWithTracking = options.html || '';
  if (contentWithTracking) {
    contentWithTracking = contentWithTracking.replace(
      /<a\s+href="([^"]+)"/gi,
      (match, url) => {
        // Don't track if it's already a tracking link or an attachment download link
        if (url.includes('track-click') || url.includes('/attachment/')) return match;
        const encodedUrl = encodeURIComponent(url);
        return `<a href="${backendUrl}/api/communications/${communicationId}/track-click?url=${encodedUrl}&user=${options.userId}" target="_blank"`;
      }
    );
  }

  // Prepare attachments with logo (copy so the caller's array is never mutated)
  const logoPath = path.join(__dirname, '../public/images/company-logo.jpg');
  const attachments = [...(options.attachments || [])];
  if (fs.existsSync(logoPath)) {
    attachments.unshift({
      filename: 'company-logo.jpg',
      path: logoPath,
      cid: 'company-logo'
    });
  }

  const mailOptions = {
    from: options.from || process.env.SMTP_FROM || `"Internal Communications" <${process.env.SMTP_USER}>`,
    to: options.to,
    subject: options.subject,
    html: contentWithTracking + trackingPixel,
    text: options.text,
    attachments: attachments,
    headers: {
      'X-Communication-ID': String(communicationId),
      'X-Priority': options.priority === 'urgent' ? '1' : options.priority === 'important' ? '2' : '3',
      'Importance': options.priority === 'urgent' ? 'high' : options.priority === 'important' ? 'high' : 'normal'
    }
  };

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await getTransporter().sendMail(mailOptions);
      const rejected = info.rejected || [];
      if (rejected.length > 0 && (info.accepted || []).length === 0) {
        return { success: false, attempts: attempt, error: `Recipient rejected by mail server: ${rejected.join(', ')}`, code: 'EREJECTED' };
      }
      return {
        success: true,
        attempts: attempt,
        messageId: info.messageId,
        accepted: info.accepted,
        response: info.response
      };
    } catch (error) {
      lastError = error;
      console.error(`❌ Email attempt ${attempt}/${retries} to ${options.to} failed: ${error.message}`);

      const quota = isQuotaError(error);
      const authFatal = isFatalAuthError(error);
      // Do not retry permanent failures (bad mailbox, quota exceeded, bad credentials)
      if (quota || authFatal || isPermanentError(error) || attempt === retries) {
        return {
          success: false,
          attempts: attempt,
          error: error.message,
          code: error.code,
          responseCode: error.responseCode,
          quota,
          fatal: quota || authFatal
        };
      }

      await sleep(Math.min(3000 * Math.pow(2, attempt - 1), 30000));
    }
  }
  return { success: false, attempts: retries, error: lastError ? lastError.message : 'Unknown error' };
};

/**
 * Generate professional email HTML template - OUTLOOK COMPATIBLE - RESPONSIVE
 */
const generateCommunicationTemplate = (communication, recipient) => {
  const priorityStyles = {
    urgent: { bg: '#fff1f0', border: '#ff4d4f', icon: '🚨', badge: 'URGENT' },
    important: { bg: '#fff7e6', border: '#fa8c16', icon: '⚠️', badge: 'IMPORTANT' },
    normal: { bg: '#f0f8ff', border: '#1890ff', icon: 'ℹ️', badge: 'INFO' }
  };
  
  const typeIcons = {
    announcement: '📢',
    policy: '📋',
    emergency: '🚨',
    newsletter: '📰',
    general: 'ℹ️',
    training: '🎓',
    event: '📅'
  };
  
  const style = priorityStyles[communication.priority] || priorityStyles.normal;
  const icon = typeIcons[communication.messageType] || '📧';
  
  const backendUrl = getBackendUrl();
  
  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${communication.title}</title>
  <style type="text/css">
    @media only screen and (max-width: 600px) {
      .email-container {
        max-width: calc(100% - 40px) !important;
      }
      .outer-padding {
        padding: 20px !important;
      }
    }
    /* Reduce paragraph spacing */
    p {
      margin: 0 0 8px 0 !important;
      padding: 0 !important;
    }
    p:last-child {
      margin-bottom: 0 !important;
    }
    /* Remove extra spacing for empty paragraphs with just <br> */
    p br:only-child {
      line-height: 0.5 !important;
    }
  </style>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" class="outer-padding" style="padding: 60px 60px;">
        <!--[if mso]>
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
        <td>
        <![endif]-->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-container" style="max-width: 100%; background-color: #ffffff; border-radius: 8px;">
        <!--[if mso]>
        </td>
        </tr>
        </table>
        <![endif]-->
          
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 30px; background-color: #dc3545; border-radius: 8px 8px 0 0;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">
                      ${icon} Internal Communications
                    </h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Priority Badge -->
          ${communication.priority !== 'normal' ? `
          <tr>
            <td style="padding: 15px 30px; background-color: ${style.bg}; border-left: 4px solid ${style.border};">
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: ${style.border}; color: #ffffff; padding: 6px 12px; border-radius: 4px; font-weight: bold; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
                    ${style.icon} ${style.badge}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}
          
          <!-- Title and Greeting -->
          <tr>
            <td style="padding: 30px 30px 20px 30px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <h2 style="color: #333333; margin: 0; font-size: 22px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">
                      ${communication.title}
                    </h2>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="color: #555555; line-height: 1.6; font-size: 15px; font-family: Arial, Helvetica, sans-serif;">
                    <div style="color: #555555; line-height: 1.6; font-size: 15px; font-family: Arial, Helvetica, sans-serif;">
                      ${communication.content}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Attachments -->
          ${communication.attachments && communication.attachments.length > 0 ? `
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9f9f9; border: 1px solid #eeeeee; border-radius: 4px;">
                <tr>
                  <td style="padding: 15px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td>
                          <h3 style="color: #333333; margin: 0 0 10px 0; font-size: 16px; font-family: Arial, Helvetica, sans-serif;">
                            📎 Attachments (${communication.attachments.length})
                          </h3>
                        </td>
                      </tr>
                      ${communication.attachments.map((att, index) => `
                      <tr>
                        <td style="padding: ${index > 0 ? '8px' : '0'} 0; border-top: ${index > 0 ? '1px solid #eeeeee' : 'none'};">
                          <table border="0" cellpadding="0" cellspacing="0" width="100%">
                            <tr>
                              <td>
                                <a href="${backendUrl}/api/communications/${communication._id}/attachment/${att._id}" style="color: #1890ff; text-decoration: none; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">
                                  📄 ${att.originalName || att.filename}
                                </a>
                                <span style="color: #999999; font-size: 12px; margin-left: 10px; font-family: Arial, Helvetica, sans-serif;">
                                  (${(att.size / 1024).toFixed(1)} KB)
                                </span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      `).join('')}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 30px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #eeeeee; padding-top: 20px;"></td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Metadata with Logo -->
          <tr>
            <td style="padding: 20px 30px; background-color: #f9f9f9;">
              <table border="0" cellpadding="5" cellspacing="0" width="100%">
                <tr>
                  <td width="35%" style="color: #666666; font-size: 12px; font-family: Arial, Helvetica, sans-serif; vertical-align: top;">
                    <strong>From:</strong> ${communication.sender?.fullName || 'Internal Communications'}
                  </td>
                  <td width="30%" align="center" rowspan="2" style="vertical-align: middle;">
                    <img src="cid:company-logo" alt="Grato Logo" style="display: block; width: 80px; height: 60px; margin: 0 auto;" />
                  </td>
                  <td width="35%" align="right" style="color: #666666; font-size: 12px; font-family: Arial, Helvetica, sans-serif; vertical-align: top;">
                    <strong>Sent:</strong> ${new Date(communication.sentAt || Date.now()).toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td style="color: #666666; font-size: 12px; font-family: Arial, Helvetica, sans-serif; vertical-align: bottom;">
                    <strong>Type:</strong> ${communication.messageType}
                  </td>
                  <td align="right" style="color: #666666; font-size: 12px; font-family: Arial, Helvetica, sans-serif; vertical-align: bottom;">
                    <strong>ID:</strong> COM-${communication._id.toString().slice(-6).toUpperCase()}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 20px 30px; background-color: #f0f0f0; border-radius: 0 0 8px 8px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <p style="color: #888888; font-size: 12px; margin: 0 0 10px 0; font-family: Arial, Helvetica, sans-serif;">
                      This is an official company communication. Please do not reply to this email.
                    </p>
                    <p style="color: #999999; font-size: 11px; margin: 0; font-family: Arial, Helvetica, sans-serif;">
                      © ${new Date().getFullYear()} Grato. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

/**
 * Generate plain text version
 */
const generatePlainText = (communication, recipient) => {
  const stripHtml = (html) => {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  };
  
  const typeLabels = {
    announcement: 'ANNOUNCEMENT',
    policy: 'POLICY UPDATE',
    emergency: 'EMERGENCY ALERT',
    newsletter: 'NEWSLETTER',
    general: 'GENERAL MESSAGE',
    training: 'TRAINING',
    event: 'EVENT'
  };
  
  let text = `
====================================================
GRATO - INTERNAL COMMUNICATIONS
${typeLabels[communication.messageType] || 'COMPANY COMMUNICATION'}
====================================================

${communication.title}

${stripHtml(communication.content)}

`;

  if (communication.attachments && communication.attachments.length > 0) {
    text += `\n\nATTACHMENTS (${communication.attachments.length}):\n`;
    communication.attachments.forEach(att => {
      text += `- ${att.originalName || att.filename} (${(att.size / 1024).toFixed(1)} KB)\n`;
    });
  }

  text += `
----------------------------------------------------
From: ${communication.sender?.fullName || 'Internal Communications'}
Sent: ${new Date(communication.sentAt || Date.now()).toLocaleString()}
Type: ${communication.messageType}
ID: COM-${communication._id.toString().slice(-6).toUpperCase()}
----------------------------------------------------

This is an official company communication.
© ${new Date().getFullYear()} Grato. All rights reserved.
`;

  return text;
};

/**
 * Send emails to recipients with limited concurrency.
 *
 * Gmail/SMTP providers throttle bursts, so recipients are processed by a small
 * worker pool with a pause between sends instead of 50 at once.
 * Returns per-recipient results in `log` so the outcome can be stored and failures re-sent.
 */
const batchSendEmails = async (communication, recipients, opts = {}) => {
  const concurrency = opts.concurrency || Number(process.env.COMM_EMAIL_CONCURRENCY) || 3;
  const pauseMs = opts.pauseMs !== undefined ? opts.pauseMs : (Number(process.env.COMM_EMAIL_PAUSE_MS) || 700);

  const results = { sent: 0, failed: 0, errors: [], log: [], aborted: null };

  console.log(`📧 Sending to ${recipients.length} recipients (concurrency ${concurrency})`);

  const subjectPrefix =
    communication.priority === 'urgent' ? '[🚨 URGENT] ' :
    communication.priority === 'important' ? '[⚠️ IMPORTANT] ' : '';
  const attachments = communication.attachments?.map(att => ({
    filename: att.originalName || att.filename,
    path: att.path
  }));

  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= recipients.length) return;
      const recipient = recipients[i];
      const entry = {
        user: recipient._id,
        email: recipient.email,
        fullName: recipient.fullName,
        lastAttemptAt: new Date()
      };

      if (results.aborted) {
        entry.status = 'failed';
        entry.attempts = 0;
        entry.error = `Not attempted: ${results.aborted}`;
        results.failed++;
        results.errors.push({ recipient: recipient.email, error: entry.error });
        results.log.push(entry);
        continue;
      }

      try {
        if (!recipient.email) throw new Error('User has no email address');

        const result = await sendCommunicationEmail({
          to: recipient.email,
          subject: `${subjectPrefix}${communication.title}`,
          html: generateCommunicationTemplate(communication, recipient),
          text: generatePlainText(communication, recipient),
          userId: recipient._id,
          priority: communication.priority,
          attachments
        }, communication._id);

        entry.attempts = result.attempts || 1;
        if (result.success) {
          entry.status = 'sent';
          entry.sentAt = new Date();
          entry.error = null;
          results.sent++;
          console.log(`✅ Sent to ${recipient.email}`);
        } else {
          entry.status = 'failed';
          entry.error = result.error;
          entry.errorCode = result.responseCode ? String(result.responseCode) : result.code;
          results.failed++;
          results.errors.push({ recipient: recipient.email, error: result.error });
          console.error(`❌ Failed to send to ${recipient.email}: ${result.error}`);
          if (result.fatal && !results.aborted) {
            results.aborted = result.quota
              ? 'email provider sending limit reached - stopped to avoid further rejections. Use "Resend to failed" later.'
              : 'email server authentication failed - check SMTP_USER / SMTP_PASS.';
            console.error(`🛑 Aborting send run: ${results.aborted}`);
          }
        }
      } catch (error) {
        entry.status = 'failed';
        entry.attempts = entry.attempts || 1;
        entry.error = error.message;
        results.failed++;
        results.errors.push({ recipient: recipient.email, error: error.message });
        console.error(`❌ Exception sending to ${recipient.email}:`, error.message);
      }

      results.log.push(entry);
      if (pauseMs > 0) await sleep(pauseMs);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, recipients.length) }, worker));

  console.log(`📊 Email send complete: ${results.sent} sent, ${results.failed} failed`);
  return results;
};

module.exports = {
  getClientUrl,
  getBackendUrl,
  sendCommunicationEmail,
  generateCommunicationTemplate,
  generatePlainText,
  batchSendEmails
};




