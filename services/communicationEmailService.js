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
      rateLimit: 5
    };
    _transporter = nodemailer.createTransport(config);
  }
  return _transporter;
};

/**
 * Send communication email with tracking
 */
const sendCommunicationEmail = async (options, communicationId, retries = 3) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  
  // Generate tracking pixel for email opens
  const trackingPixel = `<img src="${clientUrl}/api/communications/${communicationId}/track-open?user=${options.userId}" width="1" height="1" style="display:none;" alt="" />`;
  
  // Add tracking to links in HTML
  let contentWithTracking = options.html || '';
  if (contentWithTracking) {
    contentWithTracking = contentWithTracking.replace(
      /<a\s+href="([^"]+)"/gi, 
      (match, url) => {
        // Don't track if it's already a tracking link
        if (url.includes('track-click')) return match;
        const encodedUrl = encodeURIComponent(url);
        return `<a href="${clientUrl}/api/communications/${communicationId}/track-click?url=${encodedUrl}&user=${options.userId}" target="_blank"`;
      }
    );
  }
  
  // Prepare attachments with logo
  const logoPath = path.join(__dirname, '../public/images/company-logo.jpg');
  const attachments = options.attachments || [];
  
  // Add logo as inline attachment if it exists
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
      'X-Communication-ID': communicationId,
      'X-Priority': options.priority === 'urgent' ? '1' : options.priority === 'important' ? '2' : '3',
      'Importance': options.priority === 'urgent' ? 'high' : options.priority === 'important' ? 'high' : 'normal'
    }
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await getTransporter().sendMail(mailOptions);
      return { 
        success: true, 
        messageId: info.messageId,
        accepted: info.accepted,
        response: info.response 
      };
    } catch (error) {
      console.error(`❌ Email attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        return { 
          success: false, 
          error: error.message,
          code: error.code
        };
      }
      
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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
  
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  
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
                    <h2 style="color: #333333; margin: 0 0 10px 0; font-size: 22px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">
                      ${communication.title}
                    </h2>
                    <p style="color: #666666; margin: 0; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">
                      Hello ${recipient.fullName},
                    </p>
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
                                <a href="${clientUrl}/api/communications/${communication._id}/attachment/${att._id}" style="color: #1890ff; text-decoration: none; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">
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

Hello ${recipient.fullName},

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
 * Batch send emails with rate limiting
 */
const batchSendEmails = async (communication, recipients, batchSize = 50) => {
  const results = {
    sent: 0,
    failed: 0,
    errors: []
  };
  
  console.log(`📧 Starting batch email send to ${recipients.length} recipients`);
  
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    console.log(`📤 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} emails)`);
    
    const promises = batch.map(async (recipient) => {
      try {
        const html = generateCommunicationTemplate(communication, recipient);
        const text = generatePlainText(communication, recipient);
        
        // Build subject with priority indicator
        let subjectPrefix = '';
        if (communication.priority === 'urgent') {
          subjectPrefix = '[🚨 URGENT] ';
        } else if (communication.priority === 'important') {
          subjectPrefix = '[⚠️ IMPORTANT] ';
        }
        
        const result = await sendCommunicationEmail({
          to: recipient.email,
          subject: `${subjectPrefix}${communication.title}`,
          html,
          text,
          userId: recipient._id,
          priority: communication.priority,
          attachments: communication.attachments?.map(att => ({
            filename: att.originalName || att.filename,
            path: att.path
          }))
        }, communication._id);
        
        if (result.success) {
          results.sent++;
          console.log(`✅ Sent to ${recipient.email}`);
        } else {
          results.failed++;
          results.errors.push({
            recipient: recipient.email,
            error: result.error
          });
          console.error(`❌ Failed to send to ${recipient.email}: ${result.error}`);
        }
        
        return result;
      } catch (error) {
        results.failed++;
        results.errors.push({
          recipient: recipient.email,
          error: error.message
        });
        console.error(`❌ Exception sending to ${recipient.email}:`, error.message);
        return { success: false, error: error.message };
      }
    });
    
    await Promise.allSettled(promises);
    
    // Rate limiting delay between batches
    if (i + batchSize < recipients.length) {
      console.log('⏳ Waiting 2 seconds before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`📊 Batch send complete: ${results.sent} sent, ${results.failed} failed`);
  return results;
};

module.exports = {
  sendCommunicationEmail,
  generateCommunicationTemplate,
  generatePlainText,
  batchSendEmails
};




