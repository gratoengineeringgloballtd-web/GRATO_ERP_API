const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Validate required environment variables
const validateEnv = () => {
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missingVars = requiredVars.filter(v => !process.env[v]);

  if (missingVars.length) {
    console.error('❌ Missing required email environment variables:', missingVars);
    throw new Error('Missing email configuration');
  }
};

// Create transporter with enhanced configuration
const createTransporter = () => {
  // Only validate when actually creating transporter (lazy validation)
  validateEnv();

  const config = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465', 
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    // Enhanced connection settings
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    logger: true,
    debug: process.env.NODE_ENV !== 'production'
  };

  const transporter = nodemailer.createTransport(config);

  // Verify connection when transporter is created
  transporter.verify((error) => {
    if (error) {
      console.error('❌ SMTP Connection Error:', error);
    } else {
      console.log('✅ SMTP Connection Verified - Ready to send emails');
    }
  });

  return transporter;
};

// Lazy transporter creation - only create when needed
let _transporter = null;
const getTransporter = () => {
  if (!_transporter) {
    _transporter = createTransporter();
  }
  return _transporter;
};

/**
 * Enhanced email sending with retry logic
 * @param {Object} options - Email options
 * @param {number} [retries=3] - Number of retry attempts
 * @returns {Promise<Object>} - Result object
 */
const sendEmail = async (options, retries = 3) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || `"Finance System" <${process.env.SMTP_USER}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html || generateHtmlFromText(options.text),
    attachments: options.attachments,
    // DKIM signing options would go here if needed
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📧 Attempt ${attempt}/${retries} to send email to ${options.to}`);
      const info = await getTransporter().sendMail(mailOptions);
      console.log('✅ Email sent successfully:', {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected
      });
      return { 
        success: true, 
        messageId: info.messageId,
        accepted: info.accepted,
        response: info.response 
      };
    } catch (error) {
      console.error(`❌ Email attempt ${attempt} failed:`, {
        error: error.message,
        code: error.code,
        command: error.command
      });
      
      if (attempt === retries) {
        return { 
          success: false, 
          error: error.message,
          code: error.code,
          stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        };
      }
      
      // Exponential backoff
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

/**
 * Generate HTML template from plain text
 * @param {string} text - Plain text content
 * @returns {string} HTML content
 */
const generateHtmlFromText = (text) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
        <h2 style="color: #333; margin-top: 0;">Finance System Notification</h2>
        <p style="color: #555; line-height: 1.6; margin-bottom: 20px;">
          ${text.replace(/\n/g, '<br>')}
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #888; font-size: 12px; margin-bottom: 0;">
          This is an automated message from the Finance Management System. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
};

/**
 * Cash Request Email Templates
 */
const sendCashRequestEmail = {
  /**
   * Notify supervisor of new request with approval link
   * @param {string} supervisorEmail 
   * @param {string} employeeName 
   * @param {number} amount 
   * @param {string} requestId 
   * @param {string} [purpose] - Request purpose
   * @returns {Promise<Object>} 
   */
  newRequestToSupervisor: async (supervisorEmail, employeeName, amount, requestId, purpose = '') => {
    try {
      // Validate inputs
      if (!supervisorEmail || !employeeName || amount == null || !requestId) {
        throw new Error('Missing required parameters for supervisor email');
      }

      const formattedAmount = Number(amount).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const approvalLink = `${clientUrl}/supervisor/request/${requestId}`;
      
      const subject = '🔔 New Cash Request Approval Needed';
      const text = `Hello,\n\nYou have received a new cash request that requires your approval.\n\nEmployee: ${employeeName}\nAmount Requested: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n${purpose ? `Purpose: ${purpose}\n` : ''}\nPlease click this link to review: ${approvalLink}\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #333; margin-top: 0;">🔔 Cash Request Approval Needed</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Supervisor,
            </p>
            <p style="color: #555; line-height: 1.6;">
              You have received a new cash request that requires your approval.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount Requested:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${formattedAmount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${purpose ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Purpose:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${purpose}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px;">AWAITING YOUR APPROVAL</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${approvalLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                👀 Review & Process Request
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${approvalLink}" style="color: #007bff; text-decoration: none;">${approvalLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in newRequestToSupervisor:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify finance team when supervisor approves
   * @param {Array|string} financeEmails 
   * @param {string} employeeName 
   * @param {number} amount 
   * @param {string} requestId 
   * @param {string} [supervisorComments]
   * @returns {Promise<Object>} 
   */
  supervisorApprovalToFinance: async (financeEmails, employeeName, amount, requestId, supervisorComments = '') => {
    try {
      const formattedAmount = Number(amount).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const financeLink = `${clientUrl}/finance/request/${requestId}`;
      
      const subject = '💰 Cash Request Ready for Finance Approval';
      const text = `Hello Finance Team,\n\nA cash request has been approved by the supervisor and requires your final approval.\n\nEmployee: ${employeeName}\nAmount Approved: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n${supervisorComments ? `Supervisor Comments: ${supervisorComments}\n` : ''}Please click this link to review: ${financeLink}\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 4px solid #17a2b8;">
            <h2 style="color: #333; margin-top: 0;">💰 Cash Request Ready for Finance Approval</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Finance Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A cash request has been <strong style="color: #28a745;">approved by the supervisor</strong> and is now ready for your final review and processing.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #17a2b8; padding-bottom: 10px;">Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Approved Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${formattedAmount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${supervisorComments ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Supervisor Notes:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-style: italic;">${supervisorComments}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ SUPERVISOR APPROVED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${financeLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                💼 Review & Process Payment
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${financeLink}" style="color: #007bff; text-decoration: none;">${financeLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: financeEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in supervisorApprovalToFinance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Legacy method - kept for backward compatibility
   */
  approvedToFinance: async (financeEmail, employeeName, amount, requestId) => {
    return await sendCashRequestEmail.supervisorApprovalToFinance(financeEmail, employeeName, amount, requestId);
  },

  /**
   * Notify employee of approval
   * @param {string} employeeEmail 
   * @param {number} amount 
   * @param {string} requestId 
   * @param {string} [supervisorName]
   * @param {string} [comments]
   * @returns {Promise<Object>}
   */
  approvalToEmployee: async (employeeEmail, amount, requestId, supervisorName = '', comments = '') => {
    try {
      const formattedAmount = Number(amount).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/request/${requestId}`;
      
      const subject = '🎉 Your Cash Request Has Been Approved!';
      const text = `Congratulations!\n\nYour cash request has been approved and is being processed.\n\nAmount Approved: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n${supervisorName ? `Approved by: ${supervisorName}\n` : ''}${comments ? `Comments: ${comments}\n` : ''}\nTrack your request: ${trackingLink}\n\nPlease collect your cash from the finance department during business hours.\n\nBest regards,\nFinance Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">🎉 Congratulations! Your Request is Approved</h2>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Great news! Your cash request has been approved and is now being processed for payment.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #28a745; padding-bottom: 10px;">Approval Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Approved Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold; font-size: 18px;">XAF ${formattedAmount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${supervisorName ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Approved by:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${supervisorName}</td>
                </tr>
                ` : ''}
                ${comments ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Comments:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-style: italic;">${comments}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ APPROVED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h4 style="color: #856404; margin-top: 0;">📋 Next Steps:</h4>
              <ul style="color: #856404; margin: 0; padding-left: 20px;">
                <li>Your request is now with the finance team for final processing</li>
                <li>You will receive another notification when payment is ready</li>
                <li>Please collect your cash from the finance department during business hours</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #007bff; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📊 Track Your Request
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in approvalToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee of denial
   * @param {string} employeeEmail 
   * @param {string} reason 
   * @param {string} requestId 
   * @param {string} [deniedBy]
   * @returns {Promise<Object>}
   */
  denialToEmployee: async (employeeEmail, reason, requestId, deniedBy = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/request/${requestId}`;
      
      const subject = '📋 Cash Request Status Update';
      const text = `Hello,\n\nWe regret to inform you that your cash request has not been approved.\n\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\nReason: ${reason}\n${deniedBy ? `Reviewed by: ${deniedBy}\n` : ''}\nView details: ${trackingLink}\n\nIf you have any questions, please contact your supervisor or the finance department.\n\nBest regards,\nFinance Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
            <h2 style="color: #721c24; margin-top: 0;">📋 Cash Request Status Update</h2>
            <p style="color: #721c24; line-height: 1.6;">
              We regret to inform you that your cash request has not been approved at this time.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><span style="background-color: #dc3545; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">❌ NOT APPROVED</span></td>
                </tr>
                ${deniedBy ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Reviewed by:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${deniedBy}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Reason:</strong></td>
                  <td style="padding: 8px 0; font-style: italic; color: #721c24;">${reason}</td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <h4 style="color: #0c5460; margin-top: 0;">💡 What You Can Do:</h4>
              <ul style="color: #0c5460; margin: 0; padding-left: 20px;">
                <li>Review the reason for denial above</li>
                <li>Contact your supervisor for clarification</li>
                <li>Submit a new request if circumstances change</li>
                <li>Reach out to the finance department if you have questions</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #6c757d; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📊 View Request Details
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #f5c6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in denialToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify finance team of justification submission
   * @param {Array|string} financeEmails 
   * @param {string} employeeName 
   * @param {number} amountSpent 
   * @param {number} balanceReturned 
   * @param {string} requestId 
   * @returns {Promise<Object>}
   */
  justificationToFinance: async (financeEmails, employeeName, amountSpent, balanceReturned, requestId) => {
    try {
      const formattedSpent = Number(amountSpent).toFixed(2);
      const formattedReturned = Number(balanceReturned).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/finance/request/${requestId}`;
      
      const subject = '📄 Cash Justification Submitted for Review';
      const text = `Hello Finance Team,\n\nAn employee has submitted their cash justification for review.\n\nEmployee: ${employeeName}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\nAmount Spent: XAF ${formattedSpent}\nBalance Returned: XAF ${formattedReturned}\n\nReview justification: ${reviewLink}\n\nPlease review the justification documentation in the finance system.\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e2e3e5; padding: 20px; border-radius: 8px; border-left: 4px solid #6c757d;">
            <h2 style="color: #333; margin-top: 0;">📄 Cash Justification Submitted</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Finance Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              <strong>${employeeName}</strong> has submitted justification documentation for their completed cash request.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #6c757d; padding-bottom: 10px;">Justification Summary</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount Spent:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #dc3545; font-weight: bold;">XAF ${formattedSpent}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Balance Returned:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${formattedReturned}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ COMPLETED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #6c757d; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                📋 Review Justification Documents
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${reviewLink}" style="color: #007bff; text-decoration: none;">${reviewLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: financeEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in justificationToFinance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when payment is disbursed
   * @param {string} employeeEmail 
   * @param {number} amount 
   * @param {string} requestId 
   * @param {string} [disbursedBy]
   * @returns {Promise<Object>}
   */
  disbursementToEmployee: async (employeeEmail, amount, requestId, disbursedBy = '') => {
    try {
      const formattedAmount = Number(amount).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const justificationLink = `${clientUrl}/employee/request/${requestId}/justify`;
      
      const subject = '💰 Cash Request Payment Ready for Collection';
      const text = `Hello,\n\nGreat news! Your cash request has been processed and payment is ready for collection.\n\nAmount: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n${disbursedBy ? `Processed by: ${disbursedBy}\n` : ''}\nSubmit justification: ${justificationLink}\n\nIMPORTANT: Please collect your cash from the finance department and remember to submit your justification after spending.\n\nBest regards,\nFinance Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">💰 Payment Ready for Collection!</h2>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Excellent news! Your cash request has been fully processed and approved for payment.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #28a745; padding-bottom: 10px;">Payment Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount Available:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold; font-size: 18px;">XAF ${formattedAmount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${disbursedBy ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Processed by:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${disbursedBy}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #17a2b8; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">💰 READY FOR COLLECTION</span></td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h4 style="color: #856404; margin-top: 0;">📋 Important Next Steps:</h4>
              <ol style="color: #856404; margin: 0; padding-left: 20px;">
                <li><strong>Collect your cash</strong> from the finance department during business hours</li>
                <li><strong>Keep all receipts</strong> for expenses related to this request</li>
                <li><strong>Submit justification</strong> within the required timeframe after spending</li>
                <li><strong>Return any unused balance</strong> to the finance department</li>
              </ol>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${justificationLink}" 
                 style="display: inline-block; background-color: #ffc107; color: #333; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; border: 2px solid #ffc107;">
                📝 Submit Justification (Later)
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Justification Link:</strong> <a href="${justificationLink}" style="color: #007bff; text-decoration: none;">${justificationLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in disbursementToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Send general notification email
   * @param {Array|string} recipients 
   * @param {string} subject 
   * @param {string} message 
   * @param {string} [type='info'] - Type: 'info', 'success', 'warning', 'error'
   * @returns {Promise<Object>}
   */
  sendNotification: async (recipients, subject, message, type = 'info') => {
    try {
      const typeStyles = {
        info: { color: '#007bff', bg: '#d1ecf1', border: '#17a2b8' },
        success: { color: '#28a745', bg: '#d4edda', border: '#28a745' },
        warning: { color: '#ffc107', bg: '#fff3cd', border: '#ffc107' },
        error: { color: '#dc3545', bg: '#f8d7da', border: '#dc3545' }
      };

      const style = typeStyles[type] || typeStyles.info;
      
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${style.bg}; padding: 20px; border-radius: 8px; border-left: 4px solid ${style.border};">
            <h2 style="color: #333; margin-top: 0;">${subject}</h2>
            <div style="color: #555; line-height: 1.6;">
              ${message.replace(/\n/g, '<br>')}
            </div>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: recipients,
        subject,
        text: message,
        html
      });

    } catch (error) {
      console.error('❌ Error in sendNotification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * ✅ NEW: Notify HR of new request requiring approval
   * @param {string} hrEmail 
   * @param {string} employeeName 
   * @param {number} amount 
   * @param {string} requestId 
   * @param {string} purpose 
   * @returns {Promise<Object>}
   */
  newRequestToHR: async (hrEmail, employeeName, amount, requestId, purpose = '') => {
    try {
      const formattedAmount = Number(amount).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const approvalLink = `${clientUrl}/hr/request/${requestId}`;
      
      const subject = '👥 Cash Request - HR Review Required';
      const text = `Hello,\n\nA cash request requires HR review and approval.\n\nEmployee: ${employeeName}\nAmount: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n${purpose ? `Purpose: ${purpose}\n` : ''}\nReview: ${approvalLink}\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
            <h2 style="color: #333; margin-top: 0;">👥 Cash Request - HR Review Required</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear HR Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A cash request has been approved by the department and requires HR review and approval.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #007bff; font-weight: bold;">XAF ${formattedAmount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${purpose ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Purpose:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${purpose}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #007bff; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">AWAITING HR APPROVAL</span></td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #ffc107;">
              <p style="color: #856404; margin: 0; font-size: 14px;">
                <strong>📋 Your Review:</strong> Please verify compliance with HR policies, employment terms, and company regulations before approval.
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${approvalLink}" 
                 style="display: inline-block; background-color: #007bff; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                👀 Review & Process Request
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${approvalLink}" style="color: #007bff;">${approvalLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: hrEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in newRequestToHR:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * ✅ NEW: Notify Finance after HR approval
   * @param {string} financeEmail 
   * @param {string} employeeName 
   * @param {number} amount 
   * @param {string} requestId 
   * @param {string} hrComments 
   * @returns {Promise<Object>}
   */
  hrApprovalToFinance: async (financeEmail, employeeName, amount, requestId, hrComments = '') => {
    try {
      const formattedAmount = Number(amount).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const financeLink = `${clientUrl}/finance/request/${requestId}`;
      
      const subject = '💰 Cash Request - Approved by HR, Ready for Finance Review';
      const text = `Hello Finance Team,\n\nA cash request has been approved by HR and requires your review.\n\nEmployee: ${employeeName}\nAmount: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n${hrComments ? `HR Comments: ${hrComments}\n` : ''}\nReview: ${financeLink}\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 4px solid #17a2b8;">
            <h2 style="color: #333; margin-top: 0;">💰 Cash Request - HR Approved</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Finance Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A cash request has been <strong style="color: #28a745;">approved by HR</strong> and is now ready for your financial review and budget allocation.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #17a2b8; padding-bottom: 10px;">Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${formattedAmount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${hrComments ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>HR Notes:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-style: italic;">${hrComments}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ HR APPROVED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${financeLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                💼 Review & Allocate Budget
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: financeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in hrApprovalToFinance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * ✅ NEW: Notify employee of HR approval
   * @param {string} employeeEmail 
   * @param {string} employeeName 
   * @param {string} requestId 
   * @returns {Promise<Object>}
   */
  hrApprovalToEmployee: async (employeeEmail, employeeName, requestId) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/request/${requestId}`;
      
      const subject = '✅ HR Approved - Request Progressing';
      const text = `Hello ${employeeName},\n\nYour cash request has been approved by HR and is moving to Finance for final review.\n\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n\nTrack your request: ${trackingLink}\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">✅ HR Approved Your Request!</h2>
            <p style="color: #155724; line-height: 1.6;">
              Dear ${employeeName},
            </p>
            <p style="color: #155724; line-height: 1.6;">
              Great progress! Your cash request has been approved by HR and is now with Finance for budget allocation and final approval.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #28a745; padding-bottom: 10px;">Progress Update</h3>
              <ul style="list-style: none; padding: 0;">
                <li style="padding: 8px 0; border-bottom: 1px solid #eee;">✅ Supervisor - Approved</li>
                <li style="padding: 8px 0; border-bottom: 1px solid #eee;">✅ Department Head - Approved</li>
                <li style="padding: 8px 0; border-bottom: 1px solid #eee;">✅ HR - Approved</li>
                <li style="padding: 8px 0; border-bottom: 1px solid #eee;">⏳ Finance - Pending Review</li>
                <li style="padding: 8px 0;">⏳ Head of Business - Pending</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #007bff; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📊 Track Your Request
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in hrApprovalToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * ✅ NEW: Notify HR of justification requiring approval
   * @param {string} hrEmail 
   * @param {string} employeeName 
   * @param {number} amountSpent 
   * @param {number} balanceReturned 
   * @param {string} requestId 
   * @returns {Promise<Object>}
   */
  justificationToHR: async (hrEmail, employeeName, amountSpent, balanceReturned, requestId) => {
    try {
      const formattedSpent = Number(amountSpent).toFixed(2);
      const formattedReturned = Number(balanceReturned).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/hr/justification/${requestId}`;
      
      const subject = '📄 Cash Justification - HR Review Required';
      const text = `Hello HR Team,\n\nA cash justification has been approved by the department and requires HR review.\n\nEmployee: ${employeeName}\nAmount Spent: XAF ${formattedSpent}\nBalance Returned: XAF ${formattedReturned}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n\nReview: ${reviewLink}\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
            <h2 style="color: #333; margin-top: 0;">📄 Cash Justification - HR Review</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear HR Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A cash justification has been approved by the department and requires HR review before final Finance approval.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Justification Summary</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount Spent:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #dc3545; font-weight: bold;">XAF ${formattedSpent}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Balance Returned:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${formattedReturned}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requestId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #007bff; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">AWAITING HR REVIEW</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #007bff; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                📋 Review Justification Documents
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: hrEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in justificationToHR:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};


/**
 * Purchase Requisition Email Templates
 */
 const sendPurchaseRequisitionEmail = {
  /**
   * Notify supervisor of new requisition with approval link
   * @param {string} supervisorEmail 
   * @param {string} employeeName 
   * @param {string} title
   * @param {string} requisitionId 
   * @param {number} itemCount
   * @param {number} [budget] - Estimated budget
   * @returns {Promise<Object>} 
   */
  newRequisitionToSupervisor: async (supervisorEmail, employeeName, title, requisitionId, itemCount, budget = null) => {
    try {
      // Validate inputs
      if (!supervisorEmail || !employeeName || !title || !requisitionId) {
        throw new Error('Missing required parameters for supervisor email');
      }

      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const approvalLink = `${clientUrl}/supervisor/requisition/${requisitionId}`;
      
      const subject = '🛒 New Purchase Requisition Approval Needed';
      const text = `Hello,\n\nYou have received a new purchase requisition that requires your approval.\n\nEmployee: ${employeeName}\nTitle: ${title}\nItems: ${itemCount}\nRequisition ID: REQ-${requisitionId.toString().slice(-6).toUpperCase()}\n${budget ? `Budget: XAF ${budget.toFixed(2)}\n` : ''}\nPlease click this link to review: ${approvalLink}\n\nBest regards,\nProcurement System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #333; margin-top: 0;">🛒 Purchase Requisition Approval Needed</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Supervisor,
            </p>
            <p style="color: #555; line-height: 1.6;">
              You have received a new purchase requisition that requires your approval.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Requisition Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Items Count:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${itemCount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Requisition ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requisitionId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${budget ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Estimated Budget:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${budget.toFixed(2)}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px;">AWAITING YOUR APPROVAL</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${approvalLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                📋 Review & Process Requisition
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${approvalLink}" style="color: #007bff; text-decoration: none;">${approvalLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Procurement Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in newRequisitionToSupervisor:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify supply chain team when supervisor approves
   * @param {Array|string} supplyChainEmails 
   * @param {string} employeeName 
   * @param {string} title
   * @param {string} requisitionId 
   * @param {number} itemCount
   * @param {number} [budget] - Estimated budget
   * @returns {Promise<Object>} 
   */
  supervisorApprovalToSupplyChain: async (supplyChainEmails, employeeName, title, requisitionId, itemCount, budget = null) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/supply-chain/requisition/${requisitionId}`;
      
      const subject = '📦 Purchase Requisition Ready for Supply Chain Review';
      const text = `Hello Supply Chain Team,\n\nA purchase requisition has been approved by the supervisor and requires your review.\n\nEmployee: ${employeeName}\nTitle: ${title}\nItems: ${itemCount}\nRequisition ID: REQ-${requisitionId.toString().slice(-6).toUpperCase()}\n${budget ? `Budget: XAF ${budget.toFixed(2)}\n` : ''}\nPlease click this link to review: ${reviewLink}\n\nBest regards,\nProcurement System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 4px solid #17a2b8;">
            <h2 style="color: #333; margin-top: 0;">📦 Purchase Requisition Ready for Review</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Supply Chain Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A purchase requisition has been <strong style="color: #28a745;">approved by the supervisor</strong> and is now ready for your review and procurement planning.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #17a2b8; padding-bottom: 10px;">Requisition Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Items Count:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${itemCount}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Requisition ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requisitionId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${budget ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Estimated Budget:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${budget.toFixed(2)}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ SUPERVISOR APPROVED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                📊 Review & Process Requisition
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${reviewLink}" style="color: #007bff; text-decoration: none;">${reviewLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Procurement Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supplyChainEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in supervisorApprovalToSupplyChain:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify finance team when supply chain approves
   * @param {Array|string} financeEmails 
   * @param {string} employeeName 
   * @param {string} title
   * @param {string} requisitionId 
   * @param {number} estimatedCost
   * @param {string} [supplyChainComments]
   * @returns {Promise<Object>}
   */
  supplyChainApprovalToFinance: async (financeEmails, employeeName, title, requisitionId, estimatedCost, supplyChainComments = '') => {
    try {
      const formattedCost = Number(estimatedCost).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const financeLink = `${clientUrl}/finance/requisition/${requisitionId}`;
      
      const subject = '💰 Purchase Requisition Ready for Finance Approval';
      const text = `Hello Finance Team,\n\nA purchase requisition has been approved by supply chain and requires your final approval.\n\nEmployee: ${employeeName}\nTitle: ${title}\nEstimated Cost: XAF ${formattedCost}\nRequisition ID: REQ-${requisitionId.toString().slice(-6).toUpperCase()}\n${supplyChainComments ? `Supply Chain Comments: ${supplyChainComments}\n` : ''}\nPlease click this link to review: ${financeLink}\n\nBest regards,\nProcurement System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 4px solid #17a2b8;">
            <h2 style="color: #333; margin-top: 0;">💰 Purchase Requisition Ready for Finance Approval</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Finance Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A purchase requisition has been <strong style="color: #28a745;">approved by supply chain</strong> and is now ready for your final approval and budget authorization.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #17a2b8; padding-bottom: 10px;">Requisition Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Estimated Cost:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${formattedCost}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Requisition ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requisitionId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${supplyChainComments ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Supply Chain Notes:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-style: italic;">${supplyChainComments}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ SUPPLY CHAIN APPROVED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${financeLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                💼 Review & Approve Budget
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${financeLink}" style="color: #007bff; text-decoration: none;">${financeLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Procurement Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: financeEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in supplyChainApprovalToFinance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee of approval
   * @param {string} employeeEmail 
   * @param {string} title
   * @param {string} requisitionId 
   * @param {string} [approverName]
   * @param {string} [comments]
   * @returns {Promise<Object>}
   */
  approvalToEmployee: async (employeeEmail, title, requisitionId, approverName = '', comments = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/requisition/${requisitionId}`;
      
      const subject = '🎉 Your Purchase Requisition Has Been Approved!';
      const text = `Congratulations!\n\nYour purchase requisition has been approved and is being processed for procurement.\n\nTitle: ${title}\nRequisition ID: REQ-${requisitionId.toString().slice(-6).toUpperCase()}\n${approverName ? `Approved by: ${approverName}\n` : ''}${comments ? `Comments: ${comments}\n` : ''}\nTrack your requisition: ${trackingLink}\n\nThe procurement process will begin shortly.\n\nBest regards,\nProcurement Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">🎉 Congratulations! Your Requisition is Approved</h2>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Great news! Your purchase requisition has been fully approved and is now ready for procurement.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #28a745; padding-bottom: 10px;">Approval Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Requisition ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requisitionId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                ${approverName ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Approved by:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${approverName}</td>
                </tr>
                ` : ''}
                ${comments ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Comments:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-style: italic;">${comments}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ APPROVED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h4 style="color: #856404; margin-top: 0;">📋 Next Steps:</h4>
              <ul style="color: #856404; margin: 0; padding-left: 20px;">
                <li>Your requisition is now with the procurement team</li>
                <li>The procurement process will begin based on your expected delivery date</li>
                <li>You will receive updates on procurement progress</li>
                <li>Final notification will be sent when items are delivered</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #007bff; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📊 Track Your Requisition
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Procurement Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in approvalToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee of denial
   * @param {string} employeeEmail 
   * @param {string} reason 
   * @param {string} requisitionId 
   * @param {string} [deniedBy]
   * @returns {Promise<Object>}
   */
  denialToEmployee: async (employeeEmail, reason, requisitionId, deniedBy = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/requisition/${requisitionId}`;
      
      const subject = '📋 Purchase Requisition Status Update';
      const text = `Hello,\n\nWe regret to inform you that your purchase requisition has not been approved.\n\nRequisition ID: REQ-${requisitionId.toString().slice(-6).toUpperCase()}\nReason: ${reason}\n${deniedBy ? `Reviewed by: ${deniedBy}\n` : ''}\nView details: ${trackingLink}\n\nIf you have any questions, please contact your supervisor or the procurement team.\n\nBest regards,\nProcurement Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
            <h2 style="color: #721c24; margin-top: 0;">📋 Purchase Requisition Status Update</h2>
            <p style="color: #721c24; line-height: 1.6;">
              We regret to inform you that your purchase requisition has not been approved at this time.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">Requisition Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Requisition ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requisitionId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><span style="background-color: #dc3545; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">❌ NOT APPROVED</span></td>
                </tr>
                ${deniedBy ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Reviewed by:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${deniedBy}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Reason:</strong></td>
                  <td style="padding: 8px 0; font-style: italic; color: #721c24;">${reason}</td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <h4 style="color: #0c5460; margin-top: 0;">💡 What You Can Do:</h4>
              <ul style="color: #0c5460; margin: 0; padding-left: 20px;">
                <li>Review the reason for denial above</li>
                <li>Contact your supervisor for clarification</li>
                <li>Modify and resubmit your requisition if circumstances change</li>
                <li>Reach out to the procurement team if you have questions</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #6c757d; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📊 View Requisition Details
              </a>
            </div>
            
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #6c757d; margin: 0; font-size: 14px;">
                <strong>Direct Link:</strong> <a href="${trackingLink}" style="color: #007bff; text-decoration: none;">${trackingLink}</a>
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #f5c6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Procurement Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in denialToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify supply chain when procurement is complete
   * @param {Array|string} supplyChainEmails 
   * @param {string} employeeName 
   * @param {string} title
   * @param {string} requisitionId 
   * @param {number} finalCost
   * @returns {Promise<Object>}
   */
  procurementCompleteToSupplyChain: async (supplyChainEmails, employeeName, title, requisitionId, finalCost) => {
    try {
      const formattedCost = Number(finalCost).toFixed(2);
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/supply-chain/requisition/${requisitionId}`;
      
      const subject = '📦 Procurement Completed - Ready for Delivery';
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">📦 Procurement Completed Successfully</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Supply Chain Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              The procurement for the following requisition has been completed and items are ready for delivery.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #28a745; padding-bottom: 10px;">Completed Procurement</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Final Cost:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #28a745; font-weight: bold;">XAF ${formattedCost}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Requisition ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requisitionId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #17a2b8; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">📦 READY FOR DELIVERY</span></td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                📋 Arrange Delivery
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Procurement Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supplyChainEmails,
        subject,
        text: subject + '\n\n' + `Employee: ${employeeName}\nTitle: ${title}\nFinal Cost: XAF ${formattedCost}\nRequisition ID: REQ-${requisitionId.toString().slice(-6).toUpperCase()}\nTrack delivery: ${trackingLink}`,
        html
      });

    } catch (error) {
      console.error('❌ Error in procurementCompleteToSupplyChain:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when items are delivered
   * @param {string} employeeEmail 
   * @param {string} title
   * @param {string} requisitionId 
   * @param {string} deliveryLocation
   * @param {string} [deliveredBy]
   * @returns {Promise<Object>}
   */
  deliveryToEmployee: async (employeeEmail, title, requisitionId, deliveryLocation, deliveredBy = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/requisition/${requisitionId}`;
      
      const subject = '📦 Purchase Requisition Items Delivered!';
      const text = `Hello,\n\nGreat news! The items from your purchase requisition have been delivered.\n\nTitle: ${title}\nRequisition ID: REQ-${requisitionId.toString().slice(-6).toUpperCase()}\nDelivery Location: ${deliveryLocation}\n${deliveredBy ? `Delivered by: ${deliveredBy}\n` : ''}\nView details: ${trackingLink}\n\nPlease confirm receipt of all items and report any issues to the procurement team.\n\nBest regards,\nProcurement Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">📦 Your Items Have Been Delivered!</h2>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Excellent news! The items from your purchase requisition have been successfully delivered.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #28a745; padding-bottom: 10px;">Delivery Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Requisition ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">REQ-${requisitionId.toString().slice(-6).toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Delivery Location:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${deliveryLocation}</td>
                </tr>
                ${deliveredBy ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Delivered by:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${deliveredBy}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ DELIVERED</span></td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h4 style="color: #856404; margin-top: 0;">📋 Next Steps:</h4>
              <ul style="color: #856404; margin: 0; padding-left: 20px;">
                <li><strong>Check all delivered items</strong> against your original requisition</li>
                <li><strong>Report any missing or damaged items</strong> immediately</li>
                <li><strong>Contact procurement team</strong> if you have any concerns</li>
                <li><strong>Confirm receipt</strong> if everything is satisfactory</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #007bff; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📊 View Requisition Details
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Procurement Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in deliveryToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};


/**
 * LEAVE EMAIL TEMPLATES
 */
const sendLeaveEmail = {
  /**
   * Notify supervisor of new leave request
   */
  newLeaveToSupervisor: async (
    supervisorEmail,
    employeeName,
    leaveType,
    leaveId,
    totalDays,
    urgency,
    reason,
    leaveCategory
  ) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const approvalLink = `${clientUrl}/supervisor/leave/${leaveId}`;

      const urgencyColors = {
        'low': '#28a745',
        'medium': '#ffc107',
        'high': '#fd7e14',
        'critical': '#dc3545'
      };

      const urgencyIcons = {
        'low': '📝',
        'medium': '⚠️',
        'high': '⚡',
        'critical': '🚨'
      };

      const categoryIcons = {
        'medical': '🏥',
        'vacation': '🌴',
        'emergency': '🚨',
        'family': '👨‍👩‍👧‍👦',
        'bereavement': '💔',
        'study': '📚'
      };

      const subject = `${urgencyIcons[urgency] || '📋'} New ${leaveCategory} Leave Request - ${employeeName}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid ${urgencyColors[urgency] || '#ffc107'};">
            <h2 style="color: #333; margin-top: 0;">
              ${urgencyIcons[urgency] || '📋'} ${categoryIcons[leaveCategory] || '📋'} Leave Request - Approval Needed
            </h2>
            <p style="color: #555;">Dear Supervisor,</p>
            <p style="color: #555;">You have received a new leave request requiring your approval.</p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid ${urgencyColors[urgency] || '#ffc107'}; padding-bottom: 10px;">Leave Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Leave Category:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${leaveCategory}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Leave Type:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${leaveType.replace(/_/g, ' ')}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Duration:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">${totalDays} day${totalDays !== 1 ? 's' : ''}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Urgency:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: ${urgencyColors[urgency]}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase;">
                      ${urgencyIcons[urgency]} ${urgency}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; vertical-align: top;"><strong>Reason:</strong></td>
                  <td style="padding: 8px 0; font-style: italic; color: #666;">
                    ${reason.length > 150 ? reason.substring(0, 150) + '...' : reason}
                  </td>
                </tr>
              </table>
            </div>

            ${urgency === 'critical' ? `
            <div style="background-color: #f8d7da; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #dc3545;">
              <h4 style="color: #721c24; margin-top: 0;">🚨 CRITICAL URGENCY</h4>
              <p style="color: #721c24; margin: 0; font-weight: bold;">
                This request requires immediate attention.
              </p>
            </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${approvalLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                📋 Review & Process Request
              </a>
            </div>

            <p style="color: #888; font-size: 12px; text-align: center;">
              This is an automated message. Please do not reply.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        text: `New ${leaveCategory} leave request from ${employeeName} requires your approval. Duration: ${totalDays} days. Urgency: ${urgency}. Review at: ${approvalLink}`,
        html
      });

    } catch (error) {
      console.error('❌ Error in newLeaveToSupervisor:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify HR team of new leave request
   */
  newLeaveToHR: async (
    hrEmail,
    employeeName,
    department,
    leaveType,
    leaveId,
    totalDays,
    urgency,
    reason,
    leaveCategory
  ) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/hr/leave/${leaveId}`;

      const subject = `📋 New ${leaveCategory} Leave - ${employeeName} (${department})`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h2 style="color: #52c41a;">📋 New Leave Request</h2>
            <p>A new ${leaveCategory} leave request has been submitted.</p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Department:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${department}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Category:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${leaveCategory}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Duration:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${totalDays} days</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Urgency:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${urgency}</td>
                </tr>
              </table>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #52c41a; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold;">
                📊 Track Request
              </a>
            </div>
          </div>
        </div>
      `;

      return await sendEmail({
        to: hrEmail,
        subject,
        text: `New ${leaveCategory} leave from ${employeeName} (${department}). Duration: ${totalDays} days. Track at: ${trackingLink}`,
        html
      });

    } catch (error) {
      console.error('❌ Error in newLeaveToHR:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify employee of decision
   */
  leaveDecisionToEmployee: async (
    employeeEmail,
    leaveType,
    leaveId,
    decision,
    comments
  ) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/leave/${leaveId}`;

      const isApproved = decision === 'approved' || decision === 'approve';
      const subject = isApproved 
        ? '🎉 Your Leave Request Has Been Approved!'
        : '📋 Leave Request Status Update';

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${isApproved ? '#d4edda' : '#f8d7da'}; padding: 20px; border-radius: 8px; border-left: 4px solid ${isApproved ? '#28a745' : '#dc3545'};">
            <h2 style="color: ${isApproved ? '#155724' : '#721c24'};">
              ${isApproved ? '🎉 Leave Approved!' : '📋 Leave Status Update'}
            </h2>
            <p>Your ${leaveType.replace(/_/g, ' ')} leave request has been ${decision}.</p>

            ${comments ? `
            <div style="background-color: white; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <strong>Comments:</strong>
              <p style="margin: 10px 0 0 0; font-style: italic;">${comments}</p>
            </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: ${isApproved ? '#007bff' : '#6c757d'}; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold;">
                📊 View Details
              </a>
            </div>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text: `Your ${leaveType} leave request has been ${decision}. ${comments ? 'Comments: ' + comments : ''} View at: ${trackingLink}`,
        html
      });

    } catch (error) {
      console.error('❌ Error in leaveDecisionToEmployee:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * EMERGENCY ACTIONS EMAILS
   */

  // Notify bypassed approver about emergency override
  notifyBypassedApprover: async (
    approverEmail,
    approverName,
    employeeName,
    leaveType,
    leaveId,
    overrideReason,
    hrName
  ) => {
    try {
      const subject = `⚡ Emergency Override - ${employeeName}'s Leave Request`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #ff4d4f; color: white; padding: 20px; text-align: center;">
            <h2>⚡ Emergency Override Notice</h2>
          </div>
          
          <div style="padding: 20px; background-color: #fff;">
            <p>Dear ${approverName},</p>
            
            <p>A leave request requiring your approval has been <strong>bypassed via HR emergency override</strong>.</p>
            
            <div style="background-color: #fff1f0; border-left: 4px solid #ff4d4f; padding: 15px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #cf1322;">Leave Details</h3>
              <p><strong>Employee:</strong> ${employeeName}</p>
              <p><strong>Leave Type:</strong> ${leaveType.replace(/_/g, ' ')}</p>
              <p><strong>Status:</strong> APPROVED (via Emergency Override)</p>
            </div>
            
            <div style="background-color: #fffbf0; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #d48806;">Override Reason</h3>
              <p>${overrideReason}</p>
              <p style="margin-top: 10px;"><em>- ${hrName}, HR Department</em></p>
            </div>
            
            <p>This action has been logged for audit purposes.</p>
            
            <p>Best regards,<br>HR Department</p>
          </div>
        </div>
      `;

      return await sendEmail({ to: approverEmail, subject, html });
    } catch (error) {
      console.error('❌ Error in notifyBypassedApprover:', error);
      return { success: false, error: error.message };
    }
  },

  // Notify HR team about override
  notifyHROverride: async (
    hrEmail,
    performedBy,
    employeeName,
    leaveType,
    leaveId,
    reason,
    bypassedApprovers
  ) => {
    try {
      const subject = `⚡ HR Emergency Override Applied - ${employeeName}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #722ed1; color: white; padding: 20px; text-align: center;">
            <h2>🔔 HR Emergency Override Log</h2>
          </div>
          
          <div style="padding: 20px; background-color: #fff;">
            <p>An emergency override has been applied:</p>
            
            <div style="background-color: #f9f0ff; border-left: 4px solid #722ed1; padding: 15px; margin: 20px 0;">
              <p><strong>Performed By:</strong> ${performedBy}</p>
              <p><strong>Employee:</strong> ${employeeName}</p>
              <p><strong>Leave Type:</strong> ${leaveType.replace(/_/g, ' ')}</p>
              <p><strong>Bypassed Approvers:</strong> ${bypassedApprovers}</p>
              <p><strong>Reason:</strong> ${reason}</p>
            </div>
            
            <p>This override has been logged in the audit trail.</p>
          </div>
        </div>
      `;

      return await sendEmail({ to: hrEmail, subject, html });
    } catch (error) {
      console.error('❌ Error in notifyHROverride:', error);
      return { success: false, error: error.message };
    }
  },

  // Notify approver about escalation
  notifyEscalation: async (
    approverEmail,
    approverName,
    employeeName,
    leaveType,
    leaveId,
    fromApprover,
    escalationReason,
    urgency,
    totalDays
  ) => {
    try {
      const subject = `📈 Escalated Leave Request - ${employeeName} (${urgency?.toUpperCase()})`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #1890ff; color: white; padding: 20px; text-align: center;">
            <h2>📈 Leave Request Escalated to You</h2>
          </div>
          
          <div style="padding: 20px; background-color: #fff;">
            <p>Dear ${approverName},</p>
            
            <p>A leave request has been <strong>escalated to your level</strong> by HR.</p>
            
            <div style="background-color: ${urgency === 'critical' ? '#fff1f0' : '#e6f7ff'}; border-left: 4px solid ${urgency === 'critical' ? '#ff4d4f' : '#1890ff'}; padding: 15px; margin: 20px 0;">
              <p><strong>Employee:</strong> ${employeeName}</p>
              <p><strong>Leave Type:</strong> ${leaveType.replace(/_/g, ' ')}</p>
              <p><strong>Duration:</strong> ${totalDays} days</p>
              <p><strong>Urgency:</strong> <span style="color: ${urgency === 'critical' ? '#cf1322' : '#1890ff'}; font-weight: bold;">${urgency?.toUpperCase()}</span></p>
            </div>
            
            <div style="background-color: #fffbf0; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Escalation Information</h3>
              <p><strong>Previously With:</strong> ${fromApprover}</p>
              <p><strong>Reason:</strong> ${escalationReason}</p>
            </div>
            
            <p style="color: #ff4d4f;"><strong>⚠️ This request requires prompt attention.</strong></p>
          </div>
        </div>
      `;

      return await sendEmail({ to: approverEmail, subject, html });
    } catch (error) {
      console.error('❌ Error in notifyEscalation:', error);
      return { success: false, error: error.message };
    }
  },

  // Notify original approver that request was escalated
  notifyApproverEscalated: async (
    approverEmail,
    approverName,
    employeeName,
    leaveType,
    leaveId,
    reason,
    escalatedBy
  ) => {
    try {
      const subject = `📢 Leave Request Escalated - ${employeeName}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #faad14; color: white; padding: 20px; text-align: center;">
            <h2>📢 Leave Request Escalated</h2>
          </div>
          
          <div style="padding: 20px; background-color: #fff;">
            <p>Dear ${approverName},</p>
            
            <p>A leave request pending your approval has been escalated to a higher level.</p>
            
            <div style="background-color: #fffbf0; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
              <p><strong>Employee:</strong> ${employeeName}</p>
              <p><strong>Leave Type:</strong> ${leaveType.replace(/_/g, ' ')}</p>
              <p><strong>Escalated By:</strong> ${escalatedBy}, HR</p>
              <p><strong>Reason:</strong> ${reason}</p>
            </div>
            
            <p>Your approval is no longer required. This has been logged for audit purposes.</p>
          </div>
        </div>
      `;

      return await sendEmail({ to: approverEmail, subject, html });
    } catch (error) {
      console.error('❌ Error in notifyApproverEscalated:', error);
      return { success: false, error: error.message };
    }
  },

  // Notify employee about escalation
  notifyEmployeeEscalation: async (
    employeeEmail,
    leaveType,
    leaveId,
    fromApprover,
    toApprover,
    reason
  ) => {
    try {
      const subject = `📈 Your Leave Request Has Been Escalated`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #1890ff; color: white; padding: 20px; text-align: center;">
            <h2>📈 Leave Request Update</h2>
          </div>
          
          <div style="padding: 20px; background-color: #fff;">
            <p>Your leave request has been <strong>escalated for priority handling</strong>.</p>
            
            <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
              <p><strong>Leave Type:</strong> ${leaveType.replace(/_/g, ' ')}</p>
              <p><strong>Status:</strong> Escalated to ${toApprover}</p>
            </div>
            
            <p>Your request is being prioritized. You will be notified of the decision.</p>
          </div>
        </div>
      `;

      return await sendEmail({ to: employeeEmail, subject, html });
    } catch (error) {
      console.error('❌ Error in notifyEmployeeEscalation:', error);
      return { success: false, error: error.message };
    }
  },

  // Notify about direct approval
  notifyDirectApproval: async (
    approverEmail,
    approverName,
    employeeName,
    leaveType,
    leaveId,
    reason,
    hrName
  ) => {
    try {
      const subject = `✅ Direct Approval - ${employeeName}'s Leave Request`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #52c41a; color: white; padding: 20px; text-align: center;">
            <h2>✅ Direct Approval Notice</h2>
          </div>
          
          <div style="padding: 20px; background-color: #fff;">
            <p>Dear ${approverName},</p>
            
            <p>A leave request has been <strong>directly approved by HR</strong> as it meets all policy requirements.</p>
            
            <div style="background-color: #f6ffed; border-left: 4px solid #52c41a; padding: 15px; margin: 20px 0;">
              <p><strong>Employee:</strong> ${employeeName}</p>
              <p><strong>Leave Type:</strong> ${leaveType.replace(/_/g, ' ')}</p>
              <p><strong>Status:</strong> APPROVED</p>
            </div>
            
            <div style="background-color: #e6f7ff; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <h3 style="margin-top: 0;">Approval Reason</h3>
              <p>${reason}</p>
              <p style="margin-top: 10px;"><em>- ${hrName}, HR Department</em></p>
            </div>
            
            <p>This is informational only. No action is required.</p>
          </div>
        </div>
      `;

      return await sendEmail({ to: approverEmail, subject, html });
    } catch (error) {
      console.error('❌ Error in notifyDirectApproval:', error);
      return { success: false, error: error.message };
    }
  }
};


/**
 * HSE Incident Report Email Templates (No Approval Workflow)
 */
const sendIncidentReportEmail = {
  /**
   * Notify employee of status update from HSE
   */
  hseStatusUpdate: async (employeeEmail, reportNumber, status, message, hseCoordinator, additionalInfo = '') => {
    try {
      const statusColors = {
        'submitted': '#52c41a',
        'under_review': '#1890ff',
        'under_investigation': '#fa8c16',
        'action_required': '#faad14',
        'resolved': '#52c41a',
        'archived': '#8c8c8c'
      };

      const statusIcons = {
        'submitted': '✅',
        'under_review': '🔍',
        'under_investigation': '🔬',
        'action_required': '⚠️',
        'resolved': '✅',
        'archived': '📁'
      };

      const subject = `Incident Report Status Update - ${reportNumber}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid ${statusColors[status] || '#1890ff'};">
            <h2 style="color: #1890ff; margin-top: 0;">
              ${statusIcons[status] || '📋'} Incident Report Status Update
            </h2>
            <p style="color: #666;">Your incident report has been updated by HSE.</p>
          </div>

          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
            <h3 style="color: #333; margin-top: 0;">Update Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${reportNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>New Status:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                  <span style="color: ${statusColors[status] || '#1890ff'}; font-weight: bold; text-transform: uppercase;">
                    ${status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Updated By:</strong></td>
                <td style="padding: 8px 0;">${hseCoordinator}</td>
              </tr>
            </table>
          </div>

          <div style="background-color: #f0f8ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #1890ff;">Message from HSE:</h4>
            <p style="margin: 0; color: #333;">${message}</p>
          </div>

          ${additionalInfo ? `
          <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #d48806;">Additional Information:</h4>
            <p style="margin: 0; color: #333;">${additionalInfo}</p>
          </div>
          ` : ''}

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/incident-reports" 
               style="display: inline-block; background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              View Your Reports
            </a>
          </div>

          <p style="color: #888; font-size: 12px; text-align: center;">
            This is an automated message from the Safety Management System.
          </p>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in hseStatusUpdate:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify employee that investigation has started
   */
  investigationStarted: async (employeeEmail, reportNumber, incidentType, hseCoordinator, estimatedDuration) => {
    try {
      const subject = `Investigation Started - ${reportNumber}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #856404; margin-top: 0;">🔬 Investigation Started</h2>
            <p style="color: #666;">HSE has initiated an investigation into your reported incident.</p>
          </div>

          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
            <h3 style="color: #333;">Investigation Details</h3>
            <ul style="list-style: none; padding: 0;">
              <li style="padding: 5px 0;"><strong>Report Number:</strong> ${reportNumber}</li>
              <li style="padding: 5px 0;"><strong>Incident Type:</strong> ${incidentType}</li>
              <li style="padding: 5px 0;"><strong>Investigator:</strong> ${hseCoordinator}</li>
              ${estimatedDuration ? `<li style="padding: 5px 0;"><strong>Estimated Duration:</strong> ${estimatedDuration}</li>` : ''}
            </ul>
          </div>

          <div style="background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #1565c0;">What This Means:</h4>
            <ul style="margin: 0; padding-left: 20px; color: #333;">
              <li>HSE will conduct a thorough investigation</li>
              <li>You may be contacted for additional information or interviews</li>
              <li>Root causes and contributing factors will be identified</li>
              <li>Recommendations will be made to prevent recurrence</li>
              <li>You'll be notified when the investigation is complete</li>
            </ul>
          </div>

          <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #d48806;">
              <strong>Please Note:</strong> Your cooperation during this investigation is important. 
              Please be available to provide any additional information that may be requested.
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/incident-reports" 
               style="display: inline-block; background-color: #ffc107; color: #333; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              View Report Status
            </a>
          </div>

          <p style="color: #888; font-size: 12px; text-align: center;">
            This is an automated message from the Safety Management System.
          </p>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in investigationStarted:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify employee that incident is resolved
   */
  incidentResolved: async (employeeEmail, reportNumber, resolutionSummary, correctiveActions, preventiveActions, lessonsLearned) => {
    try {
      const subject = `✅ Incident Report Resolved - ${reportNumber}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">✅ Incident Report Resolved</h2>
            <p style="color: #666;">Your incident report has been successfully resolved by HSE.</p>
          </div>

          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
            <h3 style="color: #333; margin-top: 0;">Report Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${reportNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;">
                  <span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    RESOLVED
                  </span>
                </td>
              </tr>
            </table>
          </div>

          ${resolutionSummary ? `
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #333;">Resolution Summary:</h4>
            <p style="color: #555; line-height: 1.6; margin-bottom: 0;">${resolutionSummary}</p>
          </div>
          ` : ''}

          ${correctiveActions && correctiveActions.length > 0 ? `
          <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #856404;">Corrective Actions Taken:</h4>
            <ul style="margin: 0; padding-left: 20px; color: #856404;">
              ${correctiveActions.map(action => `<li style="margin-bottom: 8px;">${action.action}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          ${preventiveActions && preventiveActions.length > 0 ? `
          <div style="background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #1565c0;">Preventive Measures Implemented:</h4>
            <ul style="margin: 0; padding-left: 20px; color: #1565c0;">
              ${preventiveActions.map(action => `<li style="margin-bottom: 8px;">${action.action}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          ${lessonsLearned ? `
          <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #2e7d32;">Lessons Learned:</h4>
            <p style="margin: 0; color: #2e7d32;">${lessonsLearned}</p>
          </div>
          ` : ''}

          <div style="background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #0c5460;">
              <strong>Thank You:</strong> Your incident report has helped us improve workplace safety. 
              We appreciate your contribution to maintaining a safe working environment.
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/employee/incident-reports" 
               style="display: inline-block; background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              View Your Reports
            </a>
          </div>

          <p style="color: #888; font-size: 12px; text-align: center;">
            This is an automated message from the Safety Management System.
          </p>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in incidentResolved:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify about corrective action assignment
   */
  correctiveActionAssigned: async (assigneeEmail, reportNumber, action, dueDate, incidentSummary) => {
    try {
      const subject = `Corrective Action Assigned - ${reportNumber}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #856404; margin-top: 0;">📋 Corrective Action Assigned</h2>
            <p style="color: #666;">You have been assigned a corrective action for an incident report.</p>
          </div>

          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
            <h3 style="color: #333;">Action Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${reportNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Action Required:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${action}</td>
              </tr>
              ${dueDate ? `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Due Date:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                  <span style="color: #dc3545; font-weight: bold;">${new Date(dueDate).toLocaleDateString()}</span>
                </td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;">
                  <span style="background-color: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    PENDING
                  </span>
                </td>
              </tr>
            </table>
          </div>

          ${incidentSummary ? `
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #333;">Incident Background:</h4>
            <p style="color: #555; line-height: 1.6; margin-bottom: 0;">${incidentSummary}</p>
          </div>
          ` : ''}

          <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #d48806;">Important:</h4>
            <p style="margin: 0; color: #d48806;">
              Please complete this action by the due date and update the status in the system. 
              Contact HSE if you need clarification or assistance.
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/hse/incident-reports/${reportNumber}" 
               style="display: inline-block; background-color: #ffc107; color: #333; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              View Action Details
            </a>
          </div>

          <p style="color: #888; font-size: 12px; text-align: center;">
            This is an automated message from the Safety Management System.
          </p>
        </div>
      `;

      return await sendEmail({
        to: assigneeEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in correctiveActionAssigned:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send investigation findings to stakeholders
   */
  investigationComplete: async (recipientEmails, reportNumber, findings, recommendations, hseCoordinator) => {
    try {
      const subject = `Investigation Complete - ${reportNumber}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; border-left: 4px solid #2196F3;">
            <h2 style="color: #1565c0; margin-top: 0;">🔬 Investigation Complete</h2>
            <p style="color: #666;">HSE has completed the investigation for incident report ${reportNumber}.</p>
          </div>

          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
            <h3 style="color: #333;">Investigation Summary</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Report Number:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${reportNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Investigator:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${hseCoordinator}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;">
                  <span style="background-color: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    COMPLETE
                  </span>
                </td>
              </tr>
            </table>
          </div>

          ${findings ? `
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #333;">Key Findings:</h4>
            <p style="color: #555; line-height: 1.6; margin-bottom: 0;">${findings}</p>
          </div>
          ` : ''}

          ${recommendations && recommendations.length > 0 ? `
          <div style="background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #1565c0;">Recommendations:</h4>
            <ul style="margin: 0; padding-left: 20px; color: #1565c0;">
              ${recommendations.map(rec => `<li style="margin-bottom: 8px;">${rec}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #d48806;">
              <strong>Next Steps:</strong> Corrective and preventive actions will be assigned based on these findings. 
              You may be contacted to implement specific measures.
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/hse/incident-reports/${reportNumber}" 
               style="display: inline-block; background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              View Full Report
            </a>
          </div>

          <p style="color: #888; font-size: 12px; text-align: center;">
            This is an automated message from the Safety Management System.
          </p>
        </div>
      `;

      return await sendEmail({
        to: recipientEmails,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in investigationComplete:', error);
      return { success: false, error: error.message };
    }
  }
};


/**
 * Employee Suggestion Email Templates
 * Add these functions to your existing emailService.js file
 */

 const sendSuggestionEmail = {
  /**
   * Notify HR team of new suggestion submission
   * @param {Array|string} hrEmails - HR team email addresses
   * @param {string} employeeName - Name of employee (or "Anonymous")
   * @param {string} title - Suggestion title
   * @param {string} suggestionId - Suggestion ID for tracking
   * @param {string} category - Suggestion category
   * @param {string} priority - Priority level
   * @param {boolean} isAnonymous - Whether submission is anonymous
   * @returns {Promise<Object>}
   */
  newSuggestionToHR: async (hrEmails, employeeName, title, suggestionId, category, priority, isAnonymous = false) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/hr/suggestions/${suggestionId}`;

      const subject = `💡 New Employee Suggestion: ${title}`;
      const text = `Hello HR Team,\n\nA new employee suggestion has been submitted for review.\n\nEmployee: ${employeeName}\nTitle: ${title}\nCategory: ${category}\nPriority: ${priority}\nSuggestion ID: ${suggestionId}\n\nPlease review at: ${reviewLink}\n\nBest regards,\nSuggestion Management System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
            <h2 style="color: #333; margin-top: 0;">💡 New Employee Suggestion Submitted</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear HR Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A new employee suggestion has been submitted and requires your review.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #1890ff; padding-bottom: 10px;">Suggestion Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Category:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${category.replace('_', ' ').toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Priority:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><span style="background-color: ${priority === 'high' ? '#fa8c16' : priority === 'medium' ? '#faad14' : '#52c41a'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${priority.toUpperCase()}</span></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Suggestion ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${suggestionId}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Submission Type:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: ${isAnonymous ? '#722ed1' : '#1890ff'}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${isAnonymous ? 'ANONYMOUS' : 'IDENTIFIED'}</span></td>
                </tr>
              </table>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #1890ff; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                📋 Review Suggestion
              </a>
            </div>

            <div style="background-color: #f0f8ff; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #1890ff; margin: 0; font-size: 14px;">
                <strong>Quick Actions Available:</strong> Approve, Request Modifications, Schedule Review, or Archive
              </p>
            </div>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Employee Suggestion System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: hrEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in newSuggestionToHR:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee that their suggestion was approved by HR
   * @param {string} employeeEmail - Employee's email
   * @param {string} title - Suggestion title
   * @param {string} suggestionId - Suggestion ID
   * @param {string} hrComments - HR reviewer comments
   * @param {number} feasibilityScore - Score from 1-10
   * @returns {Promise<Object>}
   */
  hrApprovalToEmployee: async (employeeEmail, title, suggestionId, hrComments, feasibilityScore) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/suggestions/${suggestionId}`;

      const subject = `🎉 Your Suggestion "${title}" Has Been Approved!`;
      const text = `Congratulations!\n\nYour employee suggestion has been approved by the HR team and is moving forward in the review process.\n\nTitle: ${title}\nSuggestion ID: ${suggestionId}\nFeasibility Score: ${feasibilityScore}/10\n\nHR Comments: ${hrComments}\n\nTrack progress: ${trackingLink}\n\nThank you for contributing to our workplace improvement!\n\nBest regards,\nHR Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h2 style="color: #389e0d; margin-top: 0;">🎉 Congratulations! Your Suggestion is Approved</h2>
            <p style="color: #389e0d; line-height: 1.6; font-size: 16px;">
              Your innovative suggestion has been reviewed and approved by our HR team!
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #52c41a; padding-bottom: 10px;">Approval Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Your Suggestion:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Suggestion ID:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${suggestionId}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Feasibility Score:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${feasibilityScore}/10</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Current Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ HR APPROVED</span></td>
                </tr>
              </table>
            </div>

            ${hrComments ? `
            <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
              <h4 style="color: #1890ff; margin-top: 0;">💬 HR Team Feedback:</h4>
              <p style="color: #333; margin-bottom: 0; font-style: italic;">"${hrComments}"</p>
            </div>
            ` : ''}

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <h4 style="color: #856404; margin-top: 0;">📋 What Happens Next?</h4>
              <ul style="color: #856404; margin-bottom: 0; padding-left: 20px;">
                <li>Your suggestion moves to management review for implementation planning</li>
                <li>The community can continue to vote and comment on your idea</li>
                <li>You may be contacted for additional input during planning</li>
                <li>You'll receive updates as your suggestion progresses</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #52c41a; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px; margin-right: 10px;">
                📊 Track Your Suggestion
              </a>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/employee/suggestions/new" 
                 style="display: inline-block; background-color: #1890ff; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                💡 Submit Another Idea
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #b7eb8f; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              Thank you for contributing to our continuous improvement! Your innovative thinking makes a difference.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in hrApprovalToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify management about HR-approved suggestions ready for implementation review
   * @param {Array|string} managementEmails - Management team email addresses
   * @param {string} employeeName - Employee name (or "Anonymous")
   * @param {string} title - Suggestion title
   * @param {string} suggestionId - Suggestion ID
   * @param {number} feasibilityScore - HR feasibility score
   * @param {number} communityVotes - Total upvotes from community
   * @param {string} category - Suggestion category
   * @returns {Promise<Object>}
   */
  hrApprovalToManagement: async (managementEmails, employeeName, title, suggestionId, feasibilityScore, communityVotes, category) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/admin/suggestions/${suggestionId}`;

      const subject = `HR Approved Suggestion Ready for Implementation Review: ${title}`;
      const text = `Hello Management Team,\n\nAn employee suggestion has been approved by HR and is ready for your implementation review.\n\nEmployee: ${employeeName}\nTitle: ${title}\nCategory: ${category}\nHR Feasibility Score: ${feasibilityScore}/10\nCommunity Support: ${communityVotes} upvotes\nSuggestion ID: ${suggestionId}\n\nPlease review for implementation: ${reviewLink}\n\nBest regards,\nHR Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #333; margin-top: 0;">Management Review Required: HR-Approved Suggestion</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Management Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              An employee suggestion has been reviewed and approved by HR. It's now ready for your evaluation for potential implementation.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Suggestion Overview</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Suggestion:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Category:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${category.replace('_', ' ').toUpperCase()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>HR Feasibility Score:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: ${feasibilityScore >= 8 ? '#52c41a' : feasibilityScore >= 6 ? '#faad14' : '#fa8c16'}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${feasibilityScore}/10</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Community Support:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: #1890ff; color: white; padding: 4px 8px; border-radius: 4px;">${communityVotes} upvotes</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">HR APPROVED - READY FOR IMPLEMENTATION REVIEW</span></td>
                </tr>
              </table>
            </div>

            <div style="background-color: #e6f7ff; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <h4 style="color: #1890ff; margin-top: 0;">Implementation Considerations:</h4>
              <ul style="color: #1890ff; margin-bottom: 0; padding-left: 20px;">
                <li>Review detailed implementation plan and resource requirements</li>
                <li>Assess budget implications and ROI potential</li>
                <li>Consider timeline and team assignment</li>
                <li>Evaluate alignment with strategic objectives</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #ffc107; color: #333; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                Review for Implementation
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Employee Suggestion System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: managementEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('Error in hrApprovalToManagement:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when their suggestion is approved for implementation
   * @param {string} employeeEmail - Employee's email
   * @param {string} title - Suggestion title
   * @param {string} suggestionId - Suggestion ID
   * @param {string} implementationTeam - Team assigned to implement
   * @param {number} [budget] - Budget allocated
   * @param {string} [comments] - Management comments
   * @returns {Promise<Object>}
   */
  implementationApprovalToEmployee: async (employeeEmail, title, suggestionId, implementationTeam, budget = null, comments = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/suggestions/${suggestionId}`;

      const subject = `Your Suggestion is Being Implemented: ${title}`;
      const text = `Congratulations!\n\nYour suggestion has been approved for implementation by management.\n\nTitle: ${title}\nSuggestion ID: ${suggestionId}\nImplementation Team: ${implementationTeam}\n${budget ? `Budget Allocated: XAF ${budget.toLocaleString()}\n` : ''}${comments ? `Comments: ${comments}\n` : ''}\nTrack progress: ${trackingLink}\n\nThank you for your innovative contribution!\n\nBest regards,\nManagement Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h2 style="color: #389e0d; margin-top: 0;">Your Idea is Coming to Life!</h2>
            <p style="color: #389e0d; line-height: 1.6; font-size: 16px;">
              Management has approved your suggestion for implementation. Your innovative thinking is making a real difference!
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #52c41a; padding-bottom: 10px;">Implementation Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Your Suggestion:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Implementation Team:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${implementationTeam}</td>
                </tr>
                ${budget ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Budget Allocated:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><span style="color: #52c41a; font-weight: bold;">XAF ${budget.toLocaleString()}</span></td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">APPROVED FOR IMPLEMENTATION</span></td>
                </tr>
              </table>
            </div>

            ${comments ? `
            <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
              <h4 style="color: #1890ff; margin-top: 0;">Management Comments:</h4>
              <p style="color: #333; margin-bottom: 0; font-style: italic;">"${comments}"</p>
            </div>
            ` : ''}

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <h4 style="color: #856404; margin-top: 0;">What's Next?</h4>
              <ul style="color: #856404; margin-bottom: 0; padding-left: 20px;">
                <li>The implementation team will begin detailed planning</li>
                <li>You may be contacted for additional input or clarification</li>
                <li>Regular progress updates will be shared</li>
                <li>You'll be recognized once implementation is complete</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${trackingLink}" 
                 style="display: inline-block; background-color: #52c41a; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                Track Implementation Progress
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #b7eb8f; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              Your innovative thinking drives our continuous improvement. Thank you for making a difference!
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('Error in implementationApprovalToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when their suggestion implementation is completed
   * @param {string} employeeEmail - Employee's email
   * @param {string} title - Suggestion title
   * @param {string} suggestionId - Suggestion ID
   * @param {string} [results] - Implementation results
   * @param {string} [impactMeasurement] - Measured impact
   * @returns {Promise<Object>}
   */
  implementationCompleteToEmployee: async (employeeEmail, title, suggestionId, results = '', impactMeasurement = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const suggestionLink = `${clientUrl}/employee/suggestions/${suggestionId}`;

      const subject = `Implementation Complete: Your Suggestion "${title}" is Now Live!`;
      const text = `Congratulations!\n\nYour suggestion has been successfully implemented and is now making a positive impact.\n\nTitle: ${title}\nSuggestion ID: ${suggestionId}\n${results ? `Results: ${results}\n` : ''}${impactMeasurement ? `Impact: ${impactMeasurement}\n` : ''}\nView details: ${suggestionLink}\n\nThank you for your valuable contribution to our continuous improvement!\n\nBest regards,\nImplementation Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h2 style="color: #389e0d; margin-top: 0;">Success! Your Idea is Now Reality</h2>
            <p style="color: #389e0d; line-height: 1.6; font-size: 16px;">
              Your suggestion has been successfully implemented and is now making a positive impact across our organization!
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #52c41a; padding-bottom: 10px;">Implementation Success</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Your Suggestion:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Completion Date:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${new Date().toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">SUCCESSFULLY IMPLEMENTED</span></td>
                </tr>
              </table>
            </div>

            ${results ? `
            <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
              <h4 style="color: #1890ff; margin-top: 0;">Implementation Results:</h4>
              <p style="color: #333; margin-bottom: 0;">${results}</p>
            </div>
            ` : ''}

            ${impactMeasurement ? `
            <div style="background-color: #f0f8ff; border-left: 4px solid #722ed1; padding: 15px; margin: 20px 0;">
              <h4 style="color: #722ed1; margin-top: 0;">Measured Impact:</h4>
              <p style="color: #333; margin-bottom: 0; font-weight: 500;">${impactMeasurement}</p>
            </div>
            ` : ''}

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <h4 style="color: #856404; margin-top: 0;">Recognition & Next Steps:</h4>
              <ul style="color: #856404; margin-bottom: 0; padding-left: 20px;">
                <li>Your contribution will be recognized in company communications</li>
                <li>This success story may be featured in internal newsletters</li>
                <li>Continue sharing your innovative ideas - they make a difference!</li>
                <li>Consider mentoring others in the suggestion process</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${suggestionLink}" 
                 style="display: inline-block; background-color: #52c41a; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px; margin-right: 10px;">
                View Success Story
              </a>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/employee/suggestions/new" 
                 style="display: inline-block; background-color: #1890ff; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                Share Another Idea
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #b7eb8f; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              You are an innovation champion! Thank you for helping us create a better workplace for everyone.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('Error in implementationCompleteToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when their suggestion receives community engagement
   * @param {string} employeeEmail - Employee's email
   * @param {string} title - Suggestion title
   * @param {string} suggestionId - Suggestion ID
   * @param {string} engagementType - Type of engagement (vote, comment, milestone)
   * @param {Object} engagementData - Additional engagement details
   * @returns {Promise<Object>}
   */
  communityEngagementToEmployee: async (employeeEmail, title, suggestionId, engagementType, engagementData) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const suggestionLink = `${clientUrl}/employee/suggestions/${suggestionId}`;

      let subject, content;

      switch (engagementType) {
        case 'milestone_votes':
          subject = `Your Suggestion "${title}" Reached ${engagementData.voteCount} Community Votes!`;
          content = `Your suggestion is gaining traction with ${engagementData.voteCount} community votes!`;
          break;
        case 'trending':
          subject = `Your Suggestion "${title}" is Now Trending!`;
          content = `Your suggestion is trending due to recent community engagement!`;
          break;
        case 'featured':
          subject = `Your Suggestion "${title}" Has Been Featured!`;
          content = `Your suggestion has been selected as a featured idea!`;
          break;
        default:
          subject = `Community Update: Your Suggestion "${title}"`;
          content = `Your suggestion has received new community engagement!`;
      }

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
            <h2 style="color: #1890ff; margin-top: 0;">Community Loves Your Idea!</h2>
            <p style="color: #1890ff; line-height: 1.6; font-size: 16px;">
              ${content}
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0;">${title}</h3>
              <p style="color: #666;">Suggestion ID: ${suggestionId}</p>
              
              ${engagementData.voteCount ? `<p style="color: #52c41a; font-weight: bold;">Total Community Votes: ${engagementData.voteCount}</p>` : ''}
              ${engagementData.commentCount ? `<p style="color: #1890ff; font-weight: bold;">Comments: ${engagementData.commentCount}</p>` : ''}
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${suggestionLink}" 
                 style="display: inline-block; background-color: #1890ff; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                View Community Feedback
              </a>
            </div>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text: `${content}\n\nSuggestion: ${title}\nID: ${suggestionId}\n\nView community feedback: ${suggestionLink}`,
        html
      });

    } catch (error) {
      console.error('Error in communityEngagementToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

/**
 * Vendor Management Email Templates
 */
 const sendVendorEmail = {
  /**
   * Welcome email for new vendor registration
   */
  vendorRegistrationConfirmation: async (vendorEmail, vendorName, vendorId) => {
    try {
      const subject = 'Welcome to Our Vendor Network - Registration Confirmed';
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #1890ff; margin: 0;">Welcome to Our Vendor Network!</h2>
            <p style="color: #666; margin: 5px 0 0 0;">Your vendor registration has been received and is under review.</p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
            <h3 style="color: #333; margin-top: 0;">Registration Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Vendor Name:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendorName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Vendor ID:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendorId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;"><span style="background-color: #faad14; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">UNDER REVIEW</span></td>
              </tr>
            </table>
          </div>

          <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h4 style="color: #856404; margin-top: 0;">Next Steps:</h4>
            <ul style="color: #856404; margin: 0; padding-left: 20px;">
              <li>Our procurement team will review your registration</li>
              <li>You may be contacted for additional information</li>
              <li>You'll receive notification once your vendor status is updated</li>
              <li>Upon approval, you can participate in our procurement processes</li>
            </ul>
          </div>

          <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
            <p style="margin: 0;">Thank you for your interest in partnering with us!</p>
            <p style="margin: 10px 0 0 0;">Best regards,<br>Procurement Team</p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: vendorEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('Failed to send vendor registration confirmation:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Vendor status update notification
   */
  vendorStatusUpdate: async (vendorEmail, vendorName, newStatus, reason = '') => {
    try {
      const statusColors = {
        'active': '#52c41a',
        'suspended': '#ff4d4f',
        'inactive': '#d9d9d9',
        'under_review': '#faad14'
      };

      const subject = `Vendor Status Update - ${vendorName}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: ${statusColors[newStatus] || '#1890ff'}; margin: 0;">Vendor Status Update</h2>
            <p style="color: #666; margin: 5px 0 0 0;">Your vendor status has been updated in our system.</p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
            <h3 style="color: #333; margin-top: 0;">Status Update Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Vendor:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${vendorName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>New Status:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
                  <span style="background-color: ${statusColors[newStatus] || '#1890ff'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                    ${newStatus.toUpperCase()}
                  </span>
                </td>
              </tr>
              ${reason ? `
              <tr>
                <td style="padding: 8px 0;"><strong>Reason:</strong></td>
                <td style="padding: 8px 0; font-style: italic;">${reason}</td>
              </tr>
              ` : ''}
            </table>
          </div>

          ${newStatus === 'active' ? `
          <div style="background-color: #f6ffed; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #52c41a;">
            <p style="color: #52c41a; margin: 0; font-weight: bold;">
              Congratulations! You are now an active vendor and can participate in our procurement processes.
            </p>
          </div>
          ` : newStatus === 'suspended' ? `
          <div style="background-color: #fff2f0; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ff4d4f;">
            <p style="color: #ff4d4f; margin: 0;">
              Your vendor account has been suspended. Please contact our procurement team for assistance.
            </p>
          </div>
          ` : ''}

          <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
            <p style="margin: 0;">If you have any questions, please contact our procurement team.</p>
            <p style="margin: 10px 0 0 0;">Best regards,<br>Procurement Team</p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: vendorEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('Failed to send vendor status update:', error);
      return { success: false, error: error.message };
    }
  }
};

const sendITSupportEmail = {
  /**
   * Notify supervisor of new IT support request with approval link
   * @param {string} supervisorEmail 
   * @param {string} employeeName 
   * @param {string} requestType - 'material_request' or 'technical_issue'
   * @param {string} title
   * @param {string} requestId 
   * @param {string} priority
   * @param {number} [estimatedCost] - For material requests
   * @param {string} urgency
   * @returns {Promise<Object>} 
   */
  newRequestToSupervisor: async (supervisorEmail, employeeName, requestType, title, requestId, priority, estimatedCost = null, urgency = 'normal') => {
    try {
      if (!supervisorEmail || !employeeName || !requestType || !title || !requestId) {
        throw new Error('Missing required parameters for supervisor email');
      }

      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const approvalLink = `${clientUrl}/supervisor/it-support/${requestId}`;

      const isUrgent = urgency === 'urgent' || priority === 'critical';
      const requestTypeLabel = requestType === 'material_request' ? 'Material Request' : 'Technical Issue';
      
      const subject = `${isUrgent ? '🚨 URGENT' : '📋'} IT ${requestTypeLabel} Approval Required - ${employeeName}`;
      const text = `${isUrgent ? 'URGENT - ' : ''}IT Support Request Approval Needed\n\nEmployee: ${employeeName}\nType: ${requestTypeLabel}\nTitle: ${title}\nPriority: ${priority.toUpperCase()}\nUrgency: ${urgency.toUpperCase()}\n${estimatedCost ? `Estimated Cost: XAF ${estimatedCost.toFixed(2)}\n` : ''}\nPlease review immediately: ${approvalLink}\n\nBest regards,\nIT Support System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${isUrgent ? '#fff2f0' : '#e6f7ff'}; padding: 20px; border-radius: 8px; border-left: 4px solid ${isUrgent ? '#ff4d4f' : '#1890ff'};">
            <h2 style="color: ${isUrgent ? '#cf1322' : '#0050b3'}; margin-top: 0;">
              ${isUrgent ? '🚨 URGENT' : '📋'} IT Support Request - Approval Required
            </h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Supervisor,
            </p>
            <p style="color: #555; line-height: 1.6;">
              You have received a new IT support request that requires your ${isUrgent ? 'immediate' : ''} attention and approval.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid ${isUrgent ? '#ff4d4f' : '#1890ff'}; padding-bottom: 10px;">Request Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request Type:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${requestTypeLabel}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Priority Level:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: ${priority === 'critical' ? '#ff4d4f' : priority === 'high' ? '#fa8c16' : priority === 'medium' ? '#faad14' : '#52c41a'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase;">
                      ${priority}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Urgency:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="color: ${isUrgent ? '#cf1322' : '#666'}; font-weight: ${isUrgent ? 'bold' : 'normal'}; text-transform: uppercase;">
                      ${urgency}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Ticket Number:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${requestId}</td>
                </tr>
                ${estimatedCost ? `
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Estimated Cost:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #fa8c16; font-weight: bold;">XAF ${estimatedCost.toFixed(2)}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;">
                    <span style="background-color: #faad14; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                      AWAITING YOUR APPROVAL
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            ${isUrgent ? `
            <div style="background-color: #fff2f0; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ff4d4f;">
              <h4 style="color: #cf1322; margin-top: 0;">🚨 URGENT ATTENTION REQUIRED</h4>
              <p style="color: #cf1322; margin: 0; font-weight: bold;">
                This ${requestTypeLabel.toLowerCase()} requires immediate attention. Please review and process as soon as possible.
              </p>
            </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${approvalLink}" 
                 style="display: inline-block; background-color: ${isUrgent ? '#ff4d4f' : '#1890ff'}; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                ${isUrgent ? '🚨 URGENT: Review Request' : '📋 Review & Process Request'}
              </a>
            </div>

            <div style="background-color: #f6ffed; padding: 15px; border-radius: 6px; margin-top: 20px;">
              <p style="color: #389e0d; margin: 0; font-size: 14px;">
                <strong>Quick Actions Available:</strong> Approve, Request More Info, Escalate, or Reject
              </p>
            </div>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the IT Support Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in newRequestToSupervisor:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify IT department when supervisor approves
   * @param {Array|string} itEmails 
   * @param {string} employeeName 
   * @param {string} requestType
   * @param {string} title
   * @param {string} requestId 
   * @param {string} supervisorName
   * @param {number} [estimatedCost]
   * @param {string} [comments]
   * @returns {Promise<Object>} 
   */
  supervisorApprovalToIT: async (itEmails, employeeName, requestType, title, requestId, supervisorName, estimatedCost = null, comments = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/it/support-requests/${requestId}`;

      const requestTypeLabel = requestType === 'material_request' ? 'Material Request' : 'Technical Issue';
      const subject = `IT ${requestTypeLabel} Approved by Supervisor - Ready for IT Review`;
      const text = `IT Support Request Approved by Supervisor\n\nEmployee: ${employeeName}\nType: ${requestTypeLabel}\nTitle: ${title}\nSupervisor: ${supervisorName}\n${estimatedCost ? `Estimated Cost: XAF ${estimatedCost.toFixed(2)}\n` : ''}${comments ? `Comments: ${comments}\n` : ''}\nReview link: ${reviewLink}\n\nBest regards,\nIT Support System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h2 style="color: #333; margin-top: 0;">✅ IT Support Request Ready for IT Review</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear IT Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              An IT support request has been <strong style="color: #52c41a;">approved by the supervisor</strong> and is now ready for your technical review and processing.
            </p>
          </div>

          <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #52c41a; padding-bottom: 10px;">Approved Request Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request Type:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${requestTypeLabel}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Title:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Approved by:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${supervisorName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Ticket Number:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${requestId}</td>
              </tr>
              ${estimatedCost ? `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Estimated Cost:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #fa8c16; font-weight: bold;">XAF ${estimatedCost.toFixed(2)}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0;"><strong>Status:</strong></td>
                <td style="padding: 8px 0;"><span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ SUPERVISOR APPROVED</span></td>
              </tr>
            </table>
          </div>

          ${comments ? `
          <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
            <h4 style="color: #1890ff; margin-top: 0;">Supervisor Comments:</h4>
            <p style="color: #333; margin-bottom: 0; font-style: italic;">"${comments}"</p>
          </div>
          ` : ''}

          <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #faad14;">
            <h4 style="color: #ad6800; margin-top: 0;">IT Review Actions:</h4>
            <ul style="color: #ad6800; margin-bottom: 0; padding-left: 20px;">
              <li>Assess technical requirements and feasibility</li>
              <li>Assign appropriate IT staff member</li>
              <li>Estimate completion time and resources needed</li>
              <li>Provide cost validation for material requests</li>
              <li>Begin implementation or procurement process</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${reviewLink}" 
               style="display: inline-block; background-color: #52c41a; color: white; 
                      padding: 15px 30px; text-decoration: none; border-radius: 8px;
                      font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
              🔧 Review & Assign IT Request
            </a>
          </div>

          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
            This is an automated message from the IT Support Management System. Please do not reply to this email.
          </p>
        </div>
      `;

      return await sendEmail({
        to: itEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in supervisorApprovalToIT:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify finance team for high-cost material requests
   * @param {Array|string} financeEmails 
   * @param {string} employeeName 
   * @param {string} title
   * @param {string} requestId 
   * @param {number} estimatedCost
   * @param {string} itRecommendation
   * @returns {Promise<Object>}
   */
  itApprovalToFinance: async (financeEmails, employeeName, title, requestId, estimatedCost, itRecommendation) => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const reviewLink = `${clientUrl}/finance/it-support/${requestId}`;

      const subject = `High-Cost IT Material Request - Finance Approval Required`;
      const text = `High-Cost IT Material Request - Finance Approval Needed\n\nEmployee: ${employeeName}\nTitle: ${title}\nEstimated Cost: XAF ${estimatedCost.toFixed(2)}\nIT Recommendation: ${itRecommendation}\nTicket: ${requestId}\n\nReview link: ${reviewLink}\n\nBest regards,\nIT Support System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #faad14;">
            <h2 style="color: #333; margin-top: 0;">💰 High-Cost IT Request - Finance Approval Required</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear Finance Team,
            </p>
            <p style="color: #555; line-height: 1.6;">
              A high-cost IT material request has been approved by both supervisor and IT department. Your budget approval is required to proceed.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #faad14; padding-bottom: 10px;">Budget Approval Request</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Request Title:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Estimated Cost:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #fa8c16; font-weight: bold; font-size: 16px;">XAF ${estimatedCost.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>IT Recommendation:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${itRecommendation}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #faad14; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px;">PENDING FINANCE APPROVAL</span></td>
                </tr>
              </table>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #faad14; color: #333; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; transition: background-color 0.3s;">
                💼 Review Budget Request
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the IT Support Management System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: financeEmails,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in itApprovalToFinance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee of request status updates
   * @param {string} employeeEmail 
   * @param {string} ticketNumber
   * @param {string} status
   * @param {string} updateMessage
   * @param {string} [updatedBy]
   * @param {string} [nextSteps]
   * @returns {Promise<Object>}
   */
  statusUpdateToEmployee: async (employeeEmail, ticketNumber, status, updateMessage, updatedBy = '', nextSteps = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const trackingLink = `${clientUrl}/employee/it-support`;

      const statusMap = {
        'approved': { text: 'Approved', color: '#52c41a', icon: '✅' },
        'rejected': { text: 'Not Approved', color: '#ff4d4f', icon: '❌' },
        'in_progress': { text: 'Work in Progress', color: '#1890ff', icon: '🔧' },
        'resolved': { text: 'Resolved', color: '#52c41a', icon: '✅' },
        'pending_finance': { text: 'Pending Finance Approval', color: '#faad14', icon: '💰' },
        'it_assigned': { text: 'Assigned to IT Team', color: '#722ed1', icon: '👨‍💻' }
      };

      const statusInfo = statusMap[status] || { text: status, color: '#666', icon: '📋' };

      const subject = `IT Support Update - ${ticketNumber}`;
      const text = `IT Support Request Status Update\n\nYour IT support request ${ticketNumber} has been updated.\n\nNew Status: ${statusInfo.text}\nUpdate: ${updateMessage}\n${updatedBy ? `Updated by: ${updatedBy}\n` : ''}${nextSteps ? `Next Steps: ${nextSteps}\n` : ''}\nTrack your request: ${trackingLink}\n\nBest regards,\nIT Support Team`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${status === 'rejected' ? '#fff2f0' : '#e6f7ff'}; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: ${statusInfo.color}; margin: 0;">
              ${statusInfo.icon} IT Support Request Update
            </h2>
            <p style="color: #666; margin: 5px 0 0 0;">Your IT support request status has been updated.</p>
          </div>

          <div style="background-color: white; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">Request Status</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Ticket Number:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${ticketNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>New Status:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
                  <span style="color: ${statusInfo.color}; font-weight: bold;">${statusInfo.text}</span>
                </td>
              </tr>
              ${updatedBy ? `
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;"><strong>Updated by:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0;">${updatedBy}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0;"><strong>Update:</strong></td>
                <td style="padding: 8px 0;">${updateMessage}</td>
              </tr>
            </table>
          </div>

          ${nextSteps ? `
          <div style="background-color: #f0f8ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #1890ff;">Next Steps:</h4>
            <p style="margin: 0; color: #333;">${nextSteps}</p>
          </div>
          ` : ''}

          <div style="text-align: center; margin: 30px 0;">
            <a href="${trackingLink}" 
               style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Track Your Requests
            </a>
          </div>

          <div style="border-top: 1px solid #e8e8e8; padding-top: 20px; color: #666; font-size: 14px;">
            <p style="margin: 0;">Thank you for using our IT Support System!</p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text,
        html
      });

    } catch (error) {
      console.error('❌ Error in statusUpdateToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Notify employee when their request is resolved
   * @param {string} employeeEmail 
   * @param {string} ticketNumber
   * @param {string} requestType
   * @param {string} resolutionDetails
   * @param {string} resolvedBy
   * @param {string} [deliveryInfo] - For material requests
   * @returns {Promise<Object>}
   */
  resolutionToEmployee: async (employeeEmail, ticketNumber, requestType, resolutionDetails, resolvedBy, deliveryInfo = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
      const feedbackLink = `${clientUrl}/employee/it-support/feedback/${ticketNumber}`;

      const isMaterialRequest = requestType === 'material_request';
      const subject = `${isMaterialRequest ? '📦' : '🔧'} Your IT ${isMaterialRequest ? 'Material Request' : 'Issue'} Has Been Resolved!`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; border-left: 4px solid #52c41a;">
            <h2 style="color: #389e0d; margin-top: 0;">
              ${isMaterialRequest ? '📦' : '🔧'} Your IT Request Has Been Resolved!
            </h2>
            <p style="color: #389e0d; line-height: 1.6; font-size: 16px;">
              Great news! Your IT ${isMaterialRequest ? 'material request' : 'support issue'} has been successfully resolved.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #52c41a; padding-bottom: 10px;">Resolution Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Ticket Number:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${ticketNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Resolved by:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${resolvedBy}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Resolution Date:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${new Date().toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Status:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #52c41a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">✅ RESOLVED</span></td>
                </tr>
              </table>
            </div>

            <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
              <h4 style="color: #1890ff; margin-top: 0;">Resolution Summary:</h4>
              <p style="color: #333; margin-bottom: 0;">${resolutionDetails}</p>
            </div>

            ${deliveryInfo ? `
            <div style="background-color: #fff3cd; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
              <h4 style="color: #ad6800; margin-top: 0;">Delivery Information:</h4>
              <p style="color: #333; margin-bottom: 0;">${deliveryInfo}</p>
            </div>
            ` : ''}

            <div style="background-color: #f0f8ff; border-left: 4px solid #722ed1; padding: 15px; margin: 20px 0;">
              <h4 style="color: #722ed1; margin-top: 0;">Your Feedback Matters:</h4>
              <p style="color: #333; margin-bottom: 10px;">Please take a moment to rate your experience and help us improve our IT support services.</p>
              <div style="text-align: center;">
                <a href="${feedbackLink}" 
                   style="display: inline-block; background-color: #722ed1; color: white; 
                          padding: 10px 20px; text-decoration: none; border-radius: 6px;
                          font-weight: bold; font-size: 14px;">
                  📝 Provide Feedback
                </a>
              </div>
            </div>

            <hr style="border: none; border-top: 1px solid #b7eb8f; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              Thank you for using our IT Support System! If you experience any further issues, please don't hesitate to submit a new request.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: employeeEmail,
        subject,
        text: `Your IT ${isMaterialRequest ? 'material request' : 'support issue'} has been resolved.\n\nTicket: ${ticketNumber}\nResolved by: ${resolvedBy}\nResolution: ${resolutionDetails}\n\nPlease provide feedback: ${feedbackLink}`,
        html
      });

    } catch (error) {
      console.error('❌ Error in resolutionToEmployee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};



/**
 * Budget Code Approval Email Templates
 * Complete email service component for budget code workflow notifications
 */

const budgetCodeEmailTemplates = {
  /**
   * Notify approver of new budget code requiring approval
   * @param {Object} params - Email parameters
   * @param {string} params.approverEmail - Approver's email
   * @param {string} params.approverName - Approver's name
   * @param {string} params.budgetCodeNumber - Budget code (e.g., DEPT-IT-2024)
   * @param {string} params.budgetCodeName - Budget name
   * @param {string} params.department - Department
   * @param {number} params.budgetAmount - Total budget amount
   * @param {string} params.budgetType - Type of budget
   * @param {string} params.createdBy - Creator's name
   * @param {string} params.budgetCodeId - Budget code ID for approval link
   * @param {number} [params.currentLevel=1] - Current approval level
   * @returns {Object} Email content object
   */
  newBudgetCodeToApprover: (params) => {
    const {
      approverEmail,
      approverName,
      budgetCodeNumber,
      budgetCodeName,
      department,
      budgetAmount,
      budgetType,
      createdBy,
      budgetCodeId,
      currentLevel = 1
    } = params;

    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const approvalLink = `${clientUrl}/finance/budget-codes/${budgetCodeId}/approve`;

    const subject = `Budget Code Approval Required: ${budgetCodeNumber}`;
    
    const text = `Budget Code Approval Required\n\nDear ${approverName},\n\nA new budget code requires your approval.\n\nBudget Code: ${budgetCodeNumber}\nName: ${budgetCodeName}\nDepartment: ${department}\nBudget Amount: XAF ${budgetAmount.toLocaleString()}\nType: ${budgetType}\nCreated by: ${createdBy}\n\nPlease review and approve: ${approvalLink}\n\nBest regards,\nFinance System`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Budget Code Approval Required</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #faad14, #fadb14); padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin: 0; font-size: 24px; font-weight: bold;">💰 Budget Code Approval Required</h1>
          </div>

          <!-- Greeting -->
          <div style="margin-bottom: 25px;">
            <p style="color: #555; line-height: 1.6; font-size: 16px; margin: 0;">
              Dear <strong>${approverName}</strong>,
            </p>
            <p style="color: #555; line-height: 1.6; font-size: 16px; margin: 15px 0 0 0;">
              A new budget code has been created and requires your approval before it can be activated.
            </p>
          </div>

          <!-- Budget Code Details -->
          <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #faad14;">
            <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #faad14; padding-bottom: 10px; font-size: 18px;">Budget Code Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold; width: 40%;">Budget Code:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <code style="background-color: #fff3cd; padding: 6px 12px; border-radius: 4px; color: #333; font-weight: bold; font-size: 14px;">${budgetCodeNumber}</code>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Name:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${budgetCodeName}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Department:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${department}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Budget Amount:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong style="color: #faad14; font-size: 18px; font-weight: bold;">XAF ${budgetAmount.toLocaleString()}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Budget Type:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">
                  ${budgetType.replace(/_/g, ' ').toUpperCase()}
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Created by:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${createdBy}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #666; font-weight: bold;">Approval Level:</td>
                <td style="padding: 12px 0;">
                  <span style="background-color: #faad14; color: #333; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">LEVEL ${currentLevel}</span>
                </td>
              </tr>
            </table>
          </div>

          <!-- Action Required -->
          <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #1890ff;">
            <h4 style="color: #1890ff; margin-top: 0; font-size: 16px; font-weight: bold;">Your Action Required:</h4>
            <p style="color: #333; margin-bottom: 0; line-height: 1.6;">
              Please review this budget code request and approve or reject based on budget availability, department needs, and organizational priorities.
            </p>
          </div>

          <!-- Action Button -->
          <div style="text-align: center; margin: 35px 0;">
            <a href="${approvalLink}" 
               style="display: inline-block; background: linear-gradient(135deg, #faad14, #fadb14); color: #333; 
                      padding: 16px 35px; text-decoration: none; border-radius: 8px;
                      font-weight: bold; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              📝 Review & Approve Budget Code
            </a>
          </div>

          <!-- Footer -->
          <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; text-align: center;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; line-height: 1.4;">
              This is an automated message from the Budget Management System.<br>
              Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: approverEmail,
      subject,
      text,
      html
    };
  },

  /**
   * Notify creator when budget code is approved and activated
   * @param {Object} params - Email parameters
   * @param {string} params.creatorEmail - Creator's email
   * @param {string} params.creatorName - Creator's name
   * @param {string} params.budgetCodeNumber - Budget code
   * @param {string} params.budgetCodeName - Budget name
   * @param {number} params.budgetAmount - Total budget amount
   * @param {string} params.approvedBy - Final approver's name
   * @param {string} params.budgetCodeId - Budget code ID
   * @returns {Object} Email content object
   */
  budgetCodeActivated: (params) => {
    const {
      creatorEmail,
      creatorName,
      budgetCodeNumber,
      budgetCodeName,
      budgetAmount,
      approvedBy,
      budgetCodeId
    } = params;

    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const viewLink = `${clientUrl}/finance/budget-codes/${budgetCodeId}`;

    const subject = `Budget Code Activated: ${budgetCodeNumber}`;
    
    const text = `Budget Code Successfully Activated\n\nDear ${creatorName},\n\nYour budget code has been fully approved and is now active.\n\nBudget Code: ${budgetCodeNumber}\nName: ${budgetCodeName}\nBudget Amount: XAF ${budgetAmount.toLocaleString()}\nFinal Approved by: ${approvedBy}\n\nThe budget code is now available for use with purchase requisitions.\n\nView details: ${viewLink}\n\nBest regards,\nFinance Team`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Budget Code Activated</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #52c41a, #73d13d); padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 24px; font-weight: bold;">✅ Budget Code Successfully Activated!</h1>
          </div>

          <!-- Greeting -->
          <div style="margin-bottom: 25px;">
            <p style="color: #389e0d; line-height: 1.6; font-size: 16px; margin: 0; font-weight: bold;">
              Dear ${creatorName},
            </p>
            <p style="color: #555; line-height: 1.6; font-size: 16px; margin: 15px 0 0 0;">
              Great news! Your budget code has completed all approval steps and is now active.
            </p>
          </div>

          <!-- Activated Budget Code Details -->
          <div style="background-color: #f6ffed; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #52c41a;">
            <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #52c41a; padding-bottom: 10px; font-size: 18px;">Activated Budget Code</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold; width: 40%;">Budget Code:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <code style="background-color: #f6ffed; padding: 6px 12px; border-radius: 4px; color: #52c41a; font-weight: bold; font-size: 14px; border: 1px solid #b7eb8f;">${budgetCodeNumber}</code>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Name:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${budgetCodeName}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Budget Amount:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong style="color: #52c41a; font-size: 18px; font-weight: bold;">XAF ${budgetAmount.toLocaleString()}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Final Approved by:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${approvedBy}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #666; font-weight: bold;">Status:</td>
                <td style="padding: 12px 0;">
                  <span style="background-color: #52c41a; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">ACTIVE</span>
                </td>
              </tr>
            </table>
          </div>

          <!-- Next Steps -->
          <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #1890ff;">
            <h4 style="color: #1890ff; margin-top: 0; font-size: 16px; font-weight: bold;">Next Steps:</h4>
            <ul style="color: #333; margin: 0; padding-left: 20px; line-height: 1.6;">
              <li>The budget code can now be assigned to purchase requisitions</li>
              <li>Track budget utilization in real-time through the finance dashboard</li>
              <li>Receive alerts when utilization reaches 75% and 90%</li>
              <li>Generate reports on budget allocation and spending</li>
            </ul>
          </div>

          <!-- Action Button -->
          <div style="text-align: center; margin: 35px 0;">
            <a href="${viewLink}" 
               style="display: inline-block; background: linear-gradient(135deg, #52c41a, #73d13d); color: white; 
                      padding: 14px 30px; text-decoration: none; border-radius: 8px;
                      font-weight: bold; font-size: 15px; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              📊 View Budget Code Details
            </a>
          </div>

          <!-- Footer -->
          <div style="border-top: 1px solid #b7eb8f; padding-top: 20px; text-align: center;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; line-height: 1.4;">
              Thank you for maintaining sound financial management practices!
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: creatorEmail,
      subject,
      text,
      html
    };
  },

  /**
   * Notify creator when budget code is rejected
   * @param {Object} params - Email parameters
   * @param {string} params.creatorEmail - Creator's email
   * @param {string} params.creatorName - Creator's name
   * @param {string} params.budgetCodeNumber - Budget code
   * @param {string} params.budgetCodeName - Budget name
   * @param {string} params.rejectedBy - Rejector's name
   * @param {string} params.rejectionReason - Reason for rejection
   * @param {number} params.rejectionLevel - Level at which it was rejected
   * @returns {Object} Email content object
   */
  budgetCodeRejected: (params) => {
    const {
      creatorEmail,
      creatorName,
      budgetCodeNumber,
      budgetCodeName,
      rejectedBy,
      rejectionReason,
      rejectionLevel
    } = params;

    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const createNewLink = `${clientUrl}/finance/budget-codes/create`;

    const subject = `Budget Code Rejected: ${budgetCodeNumber}`;
    
    const text = `Budget Code Rejected\n\nDear ${creatorName},\n\nYour budget code request has been rejected.\n\nBudget Code: ${budgetCodeNumber}\nName: ${budgetCodeName}\nRejected by: ${rejectedBy}\nRejection Level: ${rejectionLevel}\nReason: ${rejectionReason}\n\nYou may create a new budget code with the necessary adjustments.\n\nBest regards,\nFinance Team`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Budget Code Rejected</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #ff4d4f, #ff7875); padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 24px; font-weight: bold;">❌ Budget Code Rejected</h1>
          </div>

          <!-- Greeting -->
          <div style="margin-bottom: 25px;">
            <p style="color: #555; line-height: 1.6; font-size: 16px; margin: 0;">
              Dear ${creatorName},
            </p>
            <p style="color: #555; line-height: 1.6; font-size: 16px; margin: 15px 0 0 0;">
              We regret to inform you that your budget code request has been rejected during the approval process.
            </p>
          </div>

          <!-- Rejection Details -->
          <div style="background-color: #fff2f0; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ff4d4f;">
            <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ff4d4f; padding-bottom: 10px; font-size: 18px;">Rejection Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold; width: 40%;">Budget Code:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <code style="background-color: #fff2f0; padding: 6px 12px; border-radius: 4px; color: #333; font-weight: bold; font-size: 14px; border: 1px solid #ffccc7;">${budgetCodeNumber}</code>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Name:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${budgetCodeName}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Rejected by:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${rejectedBy}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Rejection Level:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">Level ${rejectionLevel}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #666; font-weight: bold;">Status:</td>
                <td style="padding: 12px 0;">
                  <span style="background-color: #ff4d4f; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">REJECTED</span>
                </td>
              </tr>
            </table>
          </div>

          <!-- Rejection Reason -->
          <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 20px; margin: 25px 0;">
            <h4 style="color: #ad6800; margin-top: 0; font-size: 16px; font-weight: bold;">Rejection Reason:</h4>
            <p style="color: #333; margin-bottom: 0; font-style: italic; line-height: 1.6; background-color: white; padding: 15px; border-radius: 6px; border: 1px solid #ffe58f;">
              "${rejectionReason}"
            </p>
          </div>

          <!-- What You Can Do -->
          <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #1890ff;">
            <h4 style="color: #1890ff; margin-top: 0; font-size: 16px; font-weight: bold;">What You Can Do:</h4>
            <ul style="color: #333; margin: 0; padding-left: 20px; line-height: 1.6;">
              <li>Review the rejection reason carefully</li>
              <li>Address the concerns raised by the approver</li>
              <li>Consult with your department head if needed</li>
              <li>Submit a new budget code request with adjustments</li>
            </ul>
          </div>

          <!-- Action Button -->
          <div style="text-align: center; margin: 35px 0;">
            <a href="${createNewLink}" 
               style="display: inline-block; background: linear-gradient(135deg, #1890ff, #40a9ff); color: white; 
                      padding: 14px 30px; text-decoration: none; border-radius: 8px;
                      font-weight: bold; font-size: 15px; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              📋 Create New Budget Code
            </a>
          </div>

          <!-- Footer -->
          <div style="border-top: 1px solid #ffccc7; padding-top: 20px; text-align: center;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; line-height: 1.4;">
              If you have questions about this rejection, please contact the Finance team.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: creatorEmail,
      subject,
      text,
      html
    };
  },

  /**
   * Notify budget owner when budget utilization reaches threshold
   * @param {Object} params - Email parameters
   * @param {string} params.ownerEmail - Budget owner's email
   * @param {string} params.ownerName - Budget owner's name
   * @param {string} params.budgetCodeNumber - Budget code
   * @param {string} params.budgetCodeName - Budget name
   * @param {number} params.budgetAmount - Total budget
   * @param {number} params.usedAmount - Amount used
   * @param {number} params.utilizationPercentage - Utilization percentage
   * @param {string} params.budgetCodeId - Budget code ID
   * @returns {Object} Email content object
   */
  budgetUtilizationAlert: (params) => {
    const {
      ownerEmail,
      ownerName,
      budgetCodeNumber,
      budgetCodeName,
      budgetAmount,
      usedAmount,
      utilizationPercentage,
      budgetCodeId
    } = params;

    const isCritical = utilizationPercentage >= 90;
    const alertLevel = isCritical ? 'CRITICAL' : 'WARNING';
    const alertColor = isCritical ? '#ff4d4f' : '#faad14';
    const bgColor = isCritical ? '#fff2f0' : '#fff3cd';
    const gradient = isCritical 
      ? 'linear-gradient(135deg, #ff4d4f, #ff7875)' 
      : 'linear-gradient(135deg, #faad14, #fadb14)';

    const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const viewLink = `${clientUrl}/finance/budget-codes/${budgetCodeId}`;

    const subject = `${alertLevel}: Budget Code ${budgetCodeNumber} at ${utilizationPercentage}% Utilization`;
    
    const text = `Budget Utilization Alert - ${alertLevel}\n\nDear ${ownerName},\n\nYour budget code has reached ${utilizationPercentage}% utilization.\n\nBudget Code: ${budgetCodeNumber}\nName: ${budgetCodeName}\nTotal Budget: XAF ${budgetAmount.toLocaleString()}\nUsed: XAF ${usedAmount.toLocaleString()}\nRemaining: XAF ${(budgetAmount - usedAmount).toLocaleString()}\nUtilization: ${utilizationPercentage}%\n\n${isCritical ? 'URGENT ACTION REQUIRED: Budget is nearly depleted!' : 'Please monitor spending closely.'}\n\nView details: ${viewLink}\n\nBest regards,\nFinance System`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Budget Utilization Alert</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: ${gradient}; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: ${isCritical ? 'white' : '#333'}; margin: 0; font-size: 24px; font-weight: bold;">
              ${isCritical ? '🚨' : '⚠️'} Budget Utilization Alert - ${alertLevel}
            </h1>
          </div>

          <!-- Greeting -->
          <div style="margin-bottom: 25px;">
            <p style="color: #555; line-height: 1.6; font-size: 16px; margin: 0;">
              Dear ${ownerName},
            </p>
            <p style="color: #555; line-height: 1.6; font-size: 16px; margin: 15px 0 0 0;">
              Your budget code has reached <strong style="color: ${alertColor}; font-size: 18px;">${utilizationPercentage}%</strong> utilization and requires your attention.
            </p>
          </div>

          <!-- Budget Status -->
          <div style="background-color: ${bgColor}; padding: 25px; border-radius: 8px; margin: 25px 0; border-left: 4px solid ${alertColor};">
            <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid ${alertColor}; padding-bottom: 10px; font-size: 18px;">Budget Status</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold; width: 40%;">Budget Code:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <code style="background-color: white; padding: 6px 12px; border-radius: 4px; color: #333; font-weight: bold; font-size: 14px; border: 1px solid ${alertColor};">${budgetCodeNumber}</code>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Name:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">${budgetCodeName}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Total Budget:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #333;">XAF ${budgetAmount.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Used Amount:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong style="color: ${alertColor}; font-size: 16px; font-weight: bold;">XAF ${usedAmount.toLocaleString()}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0; color: #666; font-weight: bold;">Remaining:</td>
                <td style="padding: 12px 0; border-bottom: 1px solid #e0e0e0;">
                  <strong style="color: ${isCritical ? '#ff4d4f' : '#52c41a'}; font-size: 16px; font-weight: bold;">XAF ${(budgetAmount - usedAmount).toLocaleString()}</strong>
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #666; font-weight: bold;">Utilization:</td>
                <td style="padding: 12px 0;">
                  <div style="background-color: #f0f0f0; height: 24px; border-radius: 12px; overflow: hidden; position: relative; box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);">
                    <div style="background: ${gradient}; height: 100%; width: ${utilizationPercentage}%; display: flex; align-items: center; justify-content: center; color: ${isCritical ? 'white' : '#333'}; font-size: 12px; font-weight: bold; transition: width 0.3s ease;">
                      ${utilizationPercentage}%
                    </div>
                  </div>
                </td>
              </tr>
            </table>
          </div>

          <!-- Alert Message -->
          ${isCritical ? `
          <div style="background-color: #fff2f0; border-left: 4px solid #ff4d4f; padding: 20px; margin: 25px 0;">
            <h4 style="color: #cf1322; margin-top: 0; font-size: 16px; font-weight: bold;">🚨 URGENT ACTION REQUIRED</h4>
            <p style="color: #cf1322; margin-bottom: 0; font-weight: bold; line-height: 1.6;">
              Budget is critically low! Please review pending requisitions and consider requesting additional budget allocation immediately.
            </p>
          </div>
          ` : `
          <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 20px; margin: 25px 0;">
            <h4 style="color: #ad6800; margin-top: 0; font-size: 16px; font-weight: bold;">⚠️ Recommended Actions:</h4>
            <ul style="color: #333; margin: 0; padding-left: 20px; line-height: 1.6;">
              <li>Review current budget allocations and spending</li>
              <li>Prioritize essential requisitions only</li>
              <li>Consider requesting budget increase if needed</li>
              <li>Monitor utilization closely going forward</li>
            </ul>
          </div>
          `}

          <!-- Action Button -->
          <div style="text-align: center; margin: 35px 0;">
            <a href="${viewLink}" 
               style="display: inline-block; background: ${gradient}; color: ${isCritical ? 'white' : '#333'}; 
                      padding: 14px 30px; text-decoration: none; border-radius: 8px;
                      font-weight: bold; font-size: 15px; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
              📊 View Budget Details
            </a>
          </div>

          <!-- Footer -->
          <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; text-align: center;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; line-height: 1.4;">
              This is an automated budget monitoring alert.<br>
              You will receive notifications at 75%, 90%, and 100% utilization.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      to: ownerEmail,
      subject,
      text,
      html
    };
  }
};

// Usage example with email service integration
const sendBudgetCodeEmail = {
  /**
   * Send new budget code approval email
   */
  sendNewBudgetCodeToApprover: async (params) => {
    try {
      const emailContent = budgetCodeEmailTemplates.newBudgetCodeToApprover(params);
      return await sendEmail(emailContent);
    } catch (error) {
      console.error('Error sending budget code approval email:', error);
      throw error;
    }
  },

  /**
   * Send budget code activated email
   */
  sendBudgetCodeActivated: async (params) => {
    try {
      const emailContent = budgetCodeEmailTemplates.budgetCodeActivated(params);
      return await sendEmail(emailContent);
    } catch (error) {
      console.error('Error sending budget code activated email:', error);
      throw error;
    }
  },

  /**
   * Send budget code rejected email
   */
  sendBudgetCodeRejected: async (params) => {
    try {
      const emailContent = budgetCodeEmailTemplates.budgetCodeRejected(params);
      return await sendEmail(emailContent);
    } catch (error) {
      console.error('Error sending budget code rejected email:', error);
      throw error;
    }
  },

  /**
   * Send budget utilization alert email
   */
  sendBudgetUtilizationAlert: async (params) => {
    try {
      const emailContent = budgetCodeEmailTemplates.budgetUtilizationAlert(params);
      return await sendEmail(emailContent);
    } catch (error) {
      console.error('Error sending budget utilization alert:', error);
      throw error;
    }
  }
};




const sendActionItemEmail = {
  /**
   * Send email when task is assigned to a user
   */
  taskAssigned: async (
    recipientEmail,
    recipientName,
    assignedByName,
    taskTitle,
    taskDescription,
    priority,
    dueDate,
    taskId,
    projectName = null
  ) => {
    try {
      const priorityEmoji = {
        'LOW': '🟢',
        'MEDIUM': '🟡',
        'HIGH': '🟠',
        'CRITICAL': '🔴'
      };

      const priorityLabel = priorityEmoji[priority] || '○';

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #1890ff; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            .task-details { background-color: white; padding: 15px; border-left: 4px solid #1890ff; margin: 15px 0; }
            .label { font-weight: bold; color: #555; }
            .value { color: #333; margin-bottom: 10px; }
            .priority { display: inline-block; padding: 5px 10px; border-radius: 3px; font-weight: bold; }
            .priority-low { background-color: #f6ffed; color: #52c41a; }
            .priority-medium { background-color: #e6f7ff; color: #1890ff; }
            .priority-high { background-color: #fff7e6; color: #fa8c16; }
            .priority-critical { background-color: #fff1f0; color: #ff4d4f; }
            .action-button { 
              display: inline-block; 
              background-color: #1890ff; 
              color: white; 
              padding: 10px 20px; 
              text-decoration: none; 
              border-radius: 5px; 
              margin-top: 15px;
            }
            .footer { text-align: center; padding-top: 20px; color: #999; font-size: 12px; }
            .divider { border-top: 1px solid #ddd; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0; font-size: 24px;">📋 New Task Assigned</h2>
            </div>
            
            <div class="content">
              <p>Hello <strong>${recipientName}</strong>,</p>
              
              <p><strong>${assignedByName}</strong> has assigned a new task to you:</p>
              
              <div class="task-details">
                <div class="value">
                  <span class="label">Task Title:</span><br>
                  <strong style="font-size: 18px; color: #1890ff;">${taskTitle}</strong>
                </div>
                
                ${projectName ? `
                <div class="value">
                  <span class="label">Project:</span><br>
                  ${projectName}
                </div>
                ` : ''}
                
                <div class="value">
                  <span class="label">Description:</span><br>
                  ${taskDescription}
                </div>
                
                <div class="divider"></div>
                
                <div style="display: flex; justify-content: space-between;">
                  <div class="value">
                    <span class="label">Priority:</span><br>
                    <span class="priority ${
                      priority === 'LOW' ? 'priority-low' :
                      priority === 'MEDIUM' ? 'priority-medium' :
                      priority === 'HIGH' ? 'priority-high' :
                      'priority-critical'
                    }">
                      ${priorityLabel} ${priority}
                    </span>
                  </div>
                  
                  <div class="value">
                    <span class="label">Due Date:</span><br>
                    ${new Date(dueDate).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </div>
                </div>
              </div>
              
              <p>The task is now available on your dashboard and ready to start. You can begin work immediately.</p>
              
              <a href="${process.env.CLIENT_URL}/action-items/${taskId}" class="action-button">
                View Task in Dashboard
              </a>
              
              <div class="footer">
                <p>
                  This is an automated message from the Action Items Management System.<br>
                  Please do not reply to this email.
                </p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      const textContent = `
New Task Assigned

Hello ${recipientName},

${assignedByName} has assigned a new task to you:

Task Title: ${taskTitle}
${projectName ? `Project: ${projectName}\n` : ''}Description: ${taskDescription}
Priority: ${priority}
Due Date: ${new Date(dueDate).toLocaleDateString('en-US', { 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
})}

The task is now available on your dashboard and ready to start.

View the task: ${process.env.CLIENT_URL}/action-items/${taskId}

This is an automated message from the Action Items Management System.
      `;

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@gratoglobal.com',
        to: recipientEmail,
        subject: `📋 New Task Assigned: ${taskTitle}`,
        text: textContent,
        html: htmlContent,
        headers: {
          'X-Priority': priority === 'CRITICAL' ? '1' : priority === 'HIGH' ? '2' : '3',
          'X-MSMail-Priority': priority === 'CRITICAL' ? 'High' : priority === 'HIGH' ? 'High' : 'Normal'
        }
      });

      console.log(`✅ Task assignment email sent to: ${recipientEmail}`);
      return { success: true };
    } catch (error) {
      console.error('Error sending task assignment email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send summary email to supervisor about assigned tasks
   */
  taskAssignmentSummary: async (
    supervisorEmail,
    supervisorName,
    assignedTasks
  ) => {
    try {
      const tasksHtml = assignedTasks.map((task, index) => `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">${index + 1}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">
            <strong>${task.title}</strong><br>
            <span style="color: #999; font-size: 12px;">${task.description.substring(0, 50)}...</span>
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">${task.assignedTo.fullName}</td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">
            <span style="
              padding: 3px 8px; 
              border-radius: 3px; 
              background-color: ${task.priority === 'CRITICAL' ? '#ff4d4f' : task.priority === 'HIGH' ? '#fa8c16' : '#1890ff'};
              color: white;
              font-size: 12px;
            ">${task.priority}</span>
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #eee;">
            ${new Date(task.dueDate).toLocaleDateString('en-GB')}
          </td>
        </tr>
      `).join('');

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
            .container { max-width: 700px; margin: 0 auto; padding: 20px; }
            .header { background-color: #1890ff; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
            .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th { background-color: #f0f0f0; padding: 10px; text-align: left; font-weight: bold; border-bottom: 2px solid #1890ff; }
            .footer { text-align: center; padding-top: 20px; color: #999; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0; font-size: 24px;">📊 Task Assignment Summary</h2>
            </div>
            
            <div class="content">
              <p>Hello <strong>${supervisorName}</strong>,</p>
              
              <p>Here is a summary of tasks that have been assigned today:</p>
              
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Task</th>
                    <th>Assigned To</th>
                    <th>Priority</th>
                    <th>Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${tasksHtml}
                </tbody>
              </table>
              
              <p>Total assigned: <strong>${assignedTasks.length}</strong> tasks</p>
              
              <div class="footer">
                <p>
                  This is an automated summary from the Action Items Management System.<br>
                  Please do not reply to this email.
                </p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@gratoglobal.com',
        to: supervisorEmail,
        subject: `📊 Task Assignment Summary - ${assignedTasks.length} tasks assigned`,
        html: htmlContent
      });

      console.log(`✅ Task assignment summary sent to: ${supervisorEmail}`);
      return { success: true };
    } catch (error) {
      console.error('Error sending task assignment summary:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify supervisor of new task creation (for approval before starting)
   */
  taskCreationApproval: async (supervisorEmail, supervisorName, employeeName, title, description, priority, dueDate, taskId, projectName = null) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;
      const formattedDueDate = new Date(dueDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

      const priorityColors = {
        'LOW': '#28a745',
        'MEDIUM': '#17a2b8',
        'HIGH': '#ffc107',
        'CRITICAL': '#dc3545'
      };

      const priorityColor = priorityColors[priority] || '#6c757d';

      const subject = `🔔 Task Creation Approval Needed: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #856404; margin-top: 0;">🔔 Task Creation Needs Your Approval</h2>
            <p style="color: #856404; line-height: 1.6;">
              Dear ${supervisorName},
            </p>
            <p style="color: #856404; line-height: 1.6;">
              <strong>${employeeName}</strong> has created a new task${projectName ? ` for project <strong>${projectName}</strong>` : ''} and needs your approval before starting work.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Task Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Task:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Description:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${description}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Created By:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Priority:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: ${priorityColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                      ${priority}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Due Date:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #dc3545; font-weight: bold;">
                    ${formattedDueDate}
                  </td>
                </tr>
                ${projectName ? `
                <tr>
                  <td style="padding: 8px 0;"><strong>Project:</strong></td>
                  <td style="padding: 8px 0;">${projectName}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <p style="color: #0c5460; margin: 0; font-weight: bold;">
                ⚠️ Action Required: Please approve or reject this task so ${employeeName} can proceed.
              </p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #ffc107; color: #333; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; border: 2px solid #ffc107;">
                ✅ Review & Approve Task
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #ffeeba; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Action Items System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCreationApproval:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify employee that task creation was approved
   */
  taskCreationApproved: async (userEmail, userName, supervisorName, title, taskId, comments = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;

      const subject = `✅ Task Approved - You Can Start: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">✅ Task Approved - You Can Start!</h2>
            <p style="color: #155724; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Great news! Your supervisor <strong>${supervisorName}</strong> has approved your task "<strong>${title}</strong>". You can now start working on it.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <p style="color: #28a745; font-size: 18px; font-weight: bold; text-align: center; margin: 0;">
                ✓ APPROVED - READY TO START
              </p>
            </div>

            ${comments ? `
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="color: #333; margin: 0;"><strong>Supervisor Comments:</strong></p>
              <p style="color: #555; margin: 10px 0 0 0; font-style: italic;">${comments}</p>
            </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                🚀 Start Working on Task
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Action Items System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCreationApproved:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify employee that task creation was rejected
   */
  taskCreationRejected: async (userEmail, userName, supervisorName, title, taskId, reason) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;

      const subject = `❌ Task Not Approved: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
            <h2 style="color: #721c24; margin-top: 0;">❌ Task Not Approved</h2>
            <p style="color: #721c24; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #721c24; line-height: 1.6;">
              Your supervisor <strong>${supervisorName}</strong> has not approved the task "<strong>${title}</strong>".
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">Reason</h3>
              <p style="color: #555; font-style: italic;">${reason || 'No specific reason provided'}</p>
            </div>

            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <p style="color: #0c5460; margin: 0;">
                <strong>💡 Next Steps:</strong> Please discuss with your supervisor to understand their concerns and make necessary adjustments.
              </p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #6c757d; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📋 View Task Details
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #f5c6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Action Items System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCreationRejected:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify supervisor that task is submitted for completion approval
   */
  taskCompletionApproval: async (supervisorEmail, supervisorName, employeeName, title, description, taskId, documentsCount, completionNotes) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;

      const subject = `✅ Task Completion Needs Approval: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 4px solid #17a2b8;">
            <h2 style="color: #0c5460; margin-top: 0;">✅ Task Completion Needs Your Approval</h2>
            <p style="color: #0c5460; line-height: 1.6;">
              Dear ${supervisorName},
            </p>
            <p style="color: #0c5460; line-height: 1.6;">
              <strong>${employeeName}</strong> has completed the task "<strong>${title}</strong>" and submitted it for your approval.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #17a2b8; padding-bottom: 10px;">Task Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Task:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Completed By:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${employeeName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Documents Attached:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">
                    <span style="background-color: #17a2b8; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                      📎 ${documentsCount} file${documentsCount !== 1 ? 's' : ''}
                    </span>
                  </td>
                </tr>
                ${completionNotes ? `
                <tr>
                  <td style="padding: 8px 0;"><strong>Completion Notes:</strong></td>
                  <td style="padding: 8px 0; font-style: italic;">${completionNotes}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="color: #856404; margin: 0; font-weight: bold;">
                ⚠️ Action Required: Please review the task completion and supporting documents.
              </p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                🔍 Review & Approve Completion
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #bee5eb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Action Items System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCompletionApproval:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify employee that task completion was approved
   */
   taskCompletionApproved: async (userEmail, userName, supervisorName, title, taskId, comments = '', grade = null) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;

      const gradeDisplay = grade ? `
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: center;">
          <p style="color: #856404; margin: 0; font-size: 14px;"><strong>Performance Grade:</strong></p>
          <p style="color: #856404; font-size: 32px; font-weight: bold; margin: 10px 0;">${grade}/5</p>
          <p style="color: #856404; margin: 0; font-size: 12px;">
            ${'⭐'.repeat(grade)}${'☆'.repeat(5 - grade)}
          </p>
        </div>
      ` : '';

      const subject = `🎉 Task Completed & Approved: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">🎉 Task Completed Successfully!</h2>
            <p style="color: #155724; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Excellent work! Your supervisor <strong>${supervisorName}</strong> has approved the completion of your task "<strong>${title}</strong>".
            </p>

            ${gradeDisplay}

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <p style="color: #28a745; font-size: 24px; font-weight: bold; text-align: center; margin: 0;">
                ✓ COMPLETED & APPROVED
              </p>
            </div>

            ${comments ? `
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="color: #333; margin: 0;"><strong>Supervisor Feedback:</strong></p>
              <p style="color: #555; margin: 10px 0 0 0; font-style: italic;">${comments}</p>
            </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 12px 25px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 14px;">
                📊 View Completed Task
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Action Items System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCompletionApproved:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify employee that task completion was rejected
   */
  taskCompletionRejected: async (userEmail, userName, supervisorName, title, taskId, reason) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const taskLink = `${clientUrl}/action-items/${taskId}`;

      const subject = `🔄 Task Needs Revision: ${title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #856404; margin-top: 0;">🔄 Task Needs Revision</h2>
            <p style="color: #856404; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #856404; line-height: 1.6;">
              Your supervisor <strong>${supervisorName}</strong> has reviewed your task "<strong>${title}</strong>" and requires some revisions before final approval.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Supervisor Feedback</h3>
              <p style="color: #555; font-style: italic; line-height: 1.6;">${reason || 'Please discuss with your supervisor for specific requirements'}</p>
            </div>

            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <p style="color: #0c5460; margin: 0;">
                <strong>💡 Next Steps:</strong>
              </p>
              <ul style="color: #0c5460; margin: 10px 0 0 0; padding-left: 20px;">
                <li>Review the supervisor's feedback carefully</li>
                <li>Make the necessary improvements or corrections</li>
                <li>Resubmit the task with updated documentation</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${taskLink}" 
                 style="display: inline-block; background-color: #ffc107; color: #333; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; border: 2px solid #ffc107;">
                🔧 Revise Task
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #ffeeba; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Action Items System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });

    } catch (error) {
      console.error('❌ Error in taskCompletionRejected:', error);
      return { success: false, error: error.message };
    }
  }
};

// KPI Email Notifications
const sendKPIEmail = {
  kpiSubmittedForApproval: async (supervisorEmail, supervisorName, employeeName, quarter, kpiCount, kpiId) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const kpiLink = `${clientUrl}/supervisor/kpis/approve/${kpiId}`;

      const subject = `📊 KPI Approval Needed: ${employeeName} - ${quarter}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #856404; margin-top: 0;">📊 KPI Approval Request</h2>
            <p style="color: #856404; line-height: 1.6;">
              Dear ${supervisorName},
            </p>
            <p style="color: #856404; line-height: 1.6;">
              <strong>${employeeName}</strong> has submitted their quarterly KPIs for <strong>${quarter}</strong> and needs your approval.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <p style="text-align: center; margin: 0;">
                <span style="font-size: 48px; font-weight: bold; color: #ffc107;">${kpiCount}</span>
                <br>
                <span style="color: #666; font-size: 14px;">KPIs Submitted</span>
              </p>
            </div>

            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <p style="color: #0c5460; margin: 0; font-weight: bold;">
                ⚠️ Action Required: Please review and approve the KPIs so ${employeeName} can link tasks to them.
              </p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${kpiLink}" 
                 style="display: inline-block; background-color: #ffc107; color: #333; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px; border: 2px solid #ffc107;">
                ✅ Review & Approve KPIs
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #ffeeba; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Performance Evaluation System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: supervisorEmail,
        subject,
        html
      });
    } catch (error) {
      console.error('❌ Error in kpiSubmittedForApproval:', error);
      return { success: false, error: error.message };
    }
  },

  kpiApproved: async (userEmail, userName, supervisorName, quarter, kpiId, comments = '') => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const kpiLink = `${clientUrl}/kpis/${kpiId}`;

      const subject = `✅ KPIs Approved: ${quarter}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
            <h2 style="color: #155724; margin-top: 0;">✅ KPIs Approved!</h2>
            <p style="color: #155724; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #155724; line-height: 1.6; font-size: 16px;">
              Great news! Your supervisor <strong>${supervisorName}</strong> has approved your KPIs for <strong>${quarter}</strong>.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <p style="color: #28a745; font-size: 24px; font-weight: bold; text-align: center; margin: 0;">
                ✓ KPIs APPROVED
              </p>
              <p style="text-align: center; color: #666; margin: 10px 0 0 0; font-size: 14px;">
                You can now start linking tasks to your approved KPIs
              </p>
            </div>

            ${comments ? `
            <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="color: #333; margin: 0;"><strong>Supervisor Comments:</strong></p>
              <p style="color: #555; margin: 10px 0 0 0; font-style: italic;">${comments}</p>
            </div>
            ` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${kpiLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                📊 View Approved KPIs
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #c3e6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Performance Evaluation System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });
    } catch (error) {
      console.error('❌ Error in kpiApproved:', error);
      return { success: false, error: error.message };
    }
  },

  kpiRejected: async (userEmail, userName, supervisorName, quarter, kpiId, reason) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const kpiLink = `${clientUrl}/kpis/${kpiId}`;

      const subject = `❌ KPIs Need Revision: ${quarter}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
            <h2 style="color: #721c24; margin-top: 0;">🔄 KPIs Need Revision</h2>
            <p style="color: #721c24; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #721c24; line-height: 1.6;">
              Your supervisor <strong>${supervisorName}</strong> has reviewed your KPIs for <strong>${quarter}</strong> and requires some revisions.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">Supervisor Feedback</h3>
              <p style="color: #555; font-style: italic; line-height: 1.6;">${reason || 'Please discuss with your supervisor for specific requirements'}</p>
            </div>

            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <p style="color: #0c5460; margin: 0;">
                <strong>💡 Next Steps:</strong> Review the feedback, make necessary adjustments, and resubmit your KPIs.
              </p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${kpiLink}" 
                 style="display: inline-block; background-color: #dc3545; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                🔧 Revise KPIs
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #f5c6cb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Performance Evaluation System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });
    } catch (error) {
      console.error('❌ Error in kpiRejected:', error);
      return { success: false, error: error.message };
    }
  }
};

// Evaluation Email Notifications
const sendEvaluationEmail = {
  behavioralEvaluationSubmitted: async (userEmail, userName, supervisorName, quarter, score, evaluationId) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const evaluationLink = `${clientUrl}/evaluations/behavioral/${evaluationId}`;

      const subject = `📋 Behavioral Evaluation Ready: ${quarter}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d1ecf1; padding: 20px; border-radius: 8px; border-left: 4px solid #17a2b8;">
            <h2 style="color: #0c5460; margin-top: 0;">📋 Behavioral Evaluation Submitted</h2>
            <p style="color: #0c5460; line-height: 1.6;">
            Dear ${userName},
            </p>
            <p style="color: #0c5460; line-height: 1.6;">
              Your supervisor <strong>${supervisorName}</strong> has completed your behavioral evaluation for <strong>${quarter}</strong>.
            </p>

            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center;">
              <p style="color: #666; margin: 0; font-size: 14px;">Overall Behavioral Score</p>
              <p style="font-size: 48px; font-weight: bold; color: #17a2b8; margin: 10px 0;">${score.toFixed(1)}%</p>
              <div style="width: 100%; background-color: #e9ecef; height: 20px; border-radius: 10px; overflow: hidden; margin-top: 15px;">
                <div style="width: ${score}%; background-color: #17a2b8; height: 100%;"></div>
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${evaluationLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                📊 View Detailed Evaluation
              </a>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="color: #856404; margin: 0;">
                <strong>💡 Action Required:</strong> Please review and acknowledge your evaluation.
              </p>
            </div>

            <hr style="border: none; border-top: 1px solid #bee5eb; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Performance Evaluation System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });
    } catch (error) {
      console.error('❌ Error in behavioralEvaluationSubmitted:', error);
      return { success: false, error: error.message };
    }
  },

  quarterlyEvaluationReady: async (userEmail, userName, supervisorName, quarter, finalScore, grade, evaluationId) => {
    try {
      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const evaluationLink = `${clientUrl}/evaluations/quarterly/${evaluationId}`;

      const gradeColor = 
        grade.startsWith('A') ? '#28a745' :
        grade.startsWith('B') ? '#17a2b8' :
        grade.startsWith('C') ? '#ffc107' :
        grade.startsWith('D') ? '#fd7e14' :
        '#dc3545';

      const subject = `🏆 Quarterly Performance Evaluation: ${quarter}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
            <h2 style="color: #004085; margin-top: 0;">🏆 Your Quarterly Evaluation is Ready</h2>
            <p style="color: #004085; line-height: 1.6;">
              Dear ${userName},
            </p>
            <p style="color: #004085; line-height: 1.6;">
              Your supervisor <strong>${supervisorName}</strong> has completed your quarterly performance evaluation for <strong>${quarter}</strong>.
            </p>

            <div style="background-color: white; padding: 30px; border-radius: 8px; margin: 20px 0; box-shadow: 0 4px 8px rgba(0,0,0,0.1); text-align: center;">
              <p style="color: #666; margin: 0; font-size: 16px;">Final Performance Score</p>
              <p style="font-size: 64px; font-weight: bold; color: ${gradeColor}; margin: 15px 0;">${finalScore.toFixed(1)}%</p>
              <p style="font-size: 32px; font-weight: bold; color: ${gradeColor}; margin: 10px 0; padding: 10px 20px; background-color: ${gradeColor}20; border-radius: 8px; display: inline-block;">
                Grade: ${grade}
              </p>
              
              <div style="margin-top: 25px; text-align: left;">
                <div style="margin-bottom: 15px;">
                  <p style="color: #666; margin: 0; font-size: 14px;">Task Performance (70%)</p>
                  <div style="width: 100%; background-color: #e9ecef; height: 20px; border-radius: 10px; overflow: hidden; margin-top: 5px;">
                    <div style="width: ${finalScore * 0.7 / 0.7}%; background-color: #007bff; height: 100%;"></div>
                  </div>
                </div>
                <div>
                  <p style="color: #666; margin: 0; font-size: 14px;">Behavioral Assessment (30%)</p>
                  <div style="width: 100%; background-color: #e9ecef; height: 20px; border-radius: 10px; overflow: hidden; margin-top: 5px;">
                    <div style="width: ${finalScore * 0.3 / 0.3}%; background-color: #17a2b8; height: 100%;"></div>
                  </div>
                </div>
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${evaluationLink}" 
                 style="display: inline-block; background-color: #007bff; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                📊 View Complete Evaluation
              </a>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="color: #856404; margin: 0;">
                <strong>💡 Action Required:</strong> Please review your evaluation and acknowledge receipt.
              </p>
            </div>

            <hr style="border: none; border-top: 1px solid #cce5ff; margin: 20px 0;">
            <p style="color: #6c757d; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Performance Evaluation System.
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: userEmail,
        subject,
        html
      });
    } catch (error) {
      console.error('❌ Error in quarterlyEvaluationReady:', error);
      return { success: false, error: error.message };
    }
  }
};

module.exports = {
  sendEmail,
  sendCashRequestEmail,
  sendPurchaseRequisitionEmail,
  // sendSickLeaveEmail,
  sendLeaveEmail,
  sendITSupportEmail,
  sendIncidentReportEmail,
  sendVendorEmail,
  sendSuggestionEmail,
  budgetCodeEmailTemplates,
  sendBudgetCodeEmail,
  sendActionItemEmail,
  sendKPIEmail,
  sendEvaluationEmail,
  getTransporter
};

