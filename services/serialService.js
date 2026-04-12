const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Validate required environment variables
const validateEnv = () => {
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FRONTEND_URL'];
  const missingVars = requiredVars.filter(v => !process.env[v]);

  if (missingVars.length) {
    console.error('❌ Missing required email environment variables:', missingVars);
    throw new Error('Missing email configuration');
  }
};

// Create transporter with enhanced configuration
const createTransporter = () => {
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

  // Verify connection on startup
  transporter.verify((error) => {
    if (error) {
      console.error('❌ SMTP Connection Error:', error);
    } else {
      console.log('✅ SMTP Connection Verified - Ready to send emails');
    }
  });

  return transporter;
};

const transporter = createTransporter();

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
      const info = await transporter.sendMail(mailOptions);
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
   * Notify finance team when supervisor approves a request
   * @param {Array|string} financeEmails - Finance team emails
   * @param {string} employeeName - Employee name
   * @param {number} amount - Approved amount
   * @param {string} requestId - Request ID
   * @param {string} supervisorComments - Supervisor comments
   * @returns {Promise<Object>}
   */
   supervisorApprovalToFinance: async (financeEmails, employeeName, amount, requestId, supervisorComments = '') => {
    try {
      // Validate inputs
      if (!financeEmails || !employeeName || amount == null || !requestId) {
        throw new Error('Missing required parameters for finance email');
      }

      const formattedAmount = Number(amount).toFixed(2);
      const reviewLink = `${process.env.FRONTEND_URL}/finance/request/${requestId}`;
      
      const subject = `Cash Request Ready for Finance Approval - ${employeeName}`;
      
      const text = `Hello Finance Team,\n\nA cash request has been approved by the supervisor and is now ready for your final approval and disbursement.\n\nEmployee: ${employeeName}\nApproved Amount: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\nSupervisor Comments: ${supervisorComments || 'None'}\n\nPlease click this link to review and process: ${reviewLink}\n\nBest regards,\nFinance System`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
            <h2 style="color: #333; margin-top: 0;">Cash Request Ready for Finance Approval</h2>
            
            <p style="color: #555; line-height: 1.6;">
              A cash request has been approved by the supervisor and is now ready for your final approval and disbursement.
            </p>
            
            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0; border: 1px solid #d9d9d9;">
              <h3 style="color: #1890ff; margin-top: 0;">Request Details</h3>
              <p><strong>Employee:</strong> ${employeeName}</p>
              <p><strong>Approved Amount:</strong> <span style="color: #52c41a; font-weight: bold;">XAF ${formattedAmount}</span></p>
              <p><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</p>
              <p><strong>Status:</strong> <span style="color: #52c41a;">✓ Approved by Supervisor</span></p>
              ${supervisorComments ? `<p><strong>Supervisor Comments:</strong> ${supervisorComments}</p>` : ''}
            </div>
            
            <div style="text-align: center; margin: 20px 0;">
              <a href="${reviewLink}" 
                 style="display: inline-block; background-color: #1890ff; color: white; 
                        padding: 12px 24px; text-decoration: none; border-radius: 4px;
                        font-weight: bold; font-size: 16px;">
                Review & Process Request
              </a>
            </div>
            
            <div style="background-color: #fff7e6; padding: 10px; border-radius: 4px; border-left: 3px solid #faad14;">
              <p style="margin: 0; color: #d46b08;">
                <strong>Action Required:</strong> This request requires final approval and disbursement processing.
              </p>
            </div>
            
            <p style="color: #777; margin-top: 15px; font-size: 12px;">
              Direct link: ${reviewLink}
            </p>
          </div>
        </div>
      `;

      return await sendEmail({
        to: Array.isArray(financeEmails) ? financeEmails : [financeEmails],
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
   * Notify supervisor of new request with approval link
   */
  newRequestToSupervisor: async (supervisorEmail, employeeName, amount, requestId) => {
    try {
      if (!supervisorEmail || !employeeName || amount == null || !requestId) {
        throw new Error('Missing required parameters for supervisor email');
      }

      const formattedAmount = Number(amount).toFixed(2);
      const approvalLink = `${process.env.FRONTEND_URL}/supervisor/request/${requestId}`;
      
      return await sendEmail({
        to: supervisorEmail,
        subject: 'New Cash Request Approval Needed',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
              <h2 style="color: #333; margin-top: 0;">Cash Request Approval Needed</h2>
              <p style="color: #555; line-height: 1.6;">
                You have received a new cash request that requires your approval.
              </p>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Employee:</strong> ${employeeName}</p>
                <p><strong>Amount Requested:</strong> XAF ${formattedAmount}</p>
                <p><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</p>
              </div>
              
              <a href="${approvalLink}" 
                 style="display: inline-block; background-color: #1890ff; color: white; 
                        padding: 10px 20px; text-decoration: none; border-radius: 4px;
                        font-weight: bold; margin-top: 10px;">
                Review & Approve Request
              </a>
            </div>
          </div>
        `
      });

    } catch (error) {
      console.error('❌ Error in newRequestToSupervisor:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify admin team of new cash request
   */
  notifyAdminNewRequest: async (adminEmails, employeeName, amount, requestId, purpose) => {
    try {
      if (!adminEmails || !employeeName || amount == null || !requestId) {
        throw new Error('Missing required parameters for admin notification');
      }

      const formattedAmount = Number(amount).toFixed(2);
      const adminLink = `${process.env.FRONTEND_URL}/admin/cash-requests/${requestId}`;
      
      return await sendEmail({
        to: adminEmails,
        subject: `New Cash Request: REQ-${requestId.toString().slice(-6).toUpperCase()}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
              <h2 style="color: #333; margin-top: 0;">New Cash Request Submitted</h2>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Employee:</strong> ${employeeName}</p>
                <p><strong>Amount:</strong> XAF ${formattedAmount}</p>
                <p><strong>Purpose:</strong> ${purpose || 'Not specified'}</p>
                <p><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</p>
              </div>
              
              <a href="${adminLink}" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 10px 20px; text-decoration: none; border-radius: 4px;
                        font-weight: bold; margin-top: 10px;">
                View Request in Admin Portal
              </a>
              
              <p style="color: #777; margin-top: 20px; font-size: 14px;">
                This request is currently pending supervisor approval.
              </p>
            </div>
          </div>
        `
      });

    } catch (error) {
      console.error('❌ Error in notifyAdminNewRequest:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify admin team of supervisor's decision
   */
  notifyAdminSupervisorDecision: async (adminEmails, requestId, employeeName, decision, comments) => {
    try {
      const adminLink = `${process.env.FRONTEND_URL}/admin/cash-requests/${requestId}`;
      const isApproved = decision === 'approve';
      
      return await sendEmail({
        to: adminEmails,
        subject: `Supervisor ${isApproved ? 'Approved' : 'Rejected'} Request: REQ-${requestId.toString().slice(-6).toUpperCase()}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid ${isApproved ? '#28a745' : '#dc3545'};">
              <h2 style="color: #333; margin-top: 0;">Supervisor ${isApproved ? 'Approval' : 'Rejection'}</h2>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</p>
                <p><strong>Employee:</strong> ${employeeName}</p>
                <p><strong>Decision:</strong> ${isApproved ? 'Approved ✅' : 'Rejected ❌'}</p>
                ${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}
              </div>
              
              <a href="${adminLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 10px 20px; text-decoration: none; border-radius: 4px;
                        font-weight: bold; margin-top: 10px;">
                View Request Details
              </a>
              
              ${isApproved ? `
                <p style="color: #777; margin-top: 20px; font-size: 14px;">
                  This request is now pending finance department approval.
                </p>
              ` : ''}
            </div>
          </div>
        `
      });

    } catch (error) {
      console.error('❌ Error in notifyAdminSupervisorDecision:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify admin team of finance decision
   */
  notifyAdminFinanceDecision: async (adminEmails, requestId, employeeName, decision, disbursedAmount) => {
    try {
      const adminLink = `${process.env.FRONTEND_URL}/admin/cash-requests/${requestId}`;
      const isApproved = decision === 'approve';
      
      return await sendEmail({
        to: adminEmails,
        subject: `Request ${isApproved ? 'Disbursed' : 'Rejected'}: REQ-${requestId.toString().slice(-6).toUpperCase()}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid ${isApproved ? '#28a745' : '#dc3545'};">
              <h2 style="color: #333; margin-top: 0;">Finance ${isApproved ? 'Disbursement' : 'Rejection'}</h2>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</p>
                <p><strong>Employee:</strong> ${employeeName}</p>
                ${isApproved ? `<p><strong>Amount Disbursed:</strong> XAF ${Number(disbursedAmount).toFixed(2)}</p>` : ''}
              </div>
              
              <a href="${adminLink}" 
                 style="display: inline-block; background-color: #17a2b8; color: white; 
                        padding: 10px 20px; text-decoration: none; border-radius: 4px;
                        font-weight: bold; margin-top: 10px;">
                View Request Details
              </a>
            </div>
          </div>
        `
      });

    } catch (error) {
      console.error('❌ Error in notifyAdminFinanceDecision:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Notify admin team of justification submission
   */
  notifyAdminJustification: async (adminEmails, requestId, employeeName, amountSpent, balanceReturned) => {
    try {
      const adminLink = `${process.env.FRONTEND_URL}/admin/cash-requests/${requestId}`;
      
      return await sendEmail({
        to: adminEmails,
        subject: `Justification Submitted: REQ-${requestId.toString().slice(-6).toUpperCase()}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #6f42c1;">
              <h2 style="color: #333; margin-top: 0;">Cash Justification Submitted</h2>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <p><strong>Request ID:</strong> REQ-${requestId.toString().slice(-6).toUpperCase()}</p>
                <p><strong>Employee:</strong> ${employeeName}</p>
                <p><strong>Amount Spent:</strong> XAF ${Number(amountSpent).toFixed(2)}</p>
                <p><strong>Balance Returned:</strong> XAF ${Number(balanceReturned).toFixed(2)}</p>
              </div>
              
              <a href="${adminLink}" 
                 style="display: inline-block; background-color: #6f42c1; color: white; 
                        padding: 10px 20px; text-decoration: none; border-radius: 4px;
                        font-weight: bold; margin-top: 10px;">
                Review Justification
              </a>
            </div>
          </div>
        `
      });

    } catch (error) {
      console.error('❌ Error in notifyAdminJustification:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Standard finance notification emails (kept from original)
   */
  approvedToFinance: async (financeEmail, employeeName, amount, requestId) => {
    return await sendEmail({
      to: financeEmail,
      subject: 'New Cash Request for Finance Approval',
      text: `Hello Finance Team,\n\nA cash request has been approved by the supervisor and requires your final approval.\n\nEmployee: ${employeeName}\nAmount Approved: XAF ${Number(amount).toFixed(2)}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n\nPlease log into the finance system to review and process this request.\n\nBest regards,\nFinance System`
    });
  },

  approvalToEmployee: async (employeeEmail, amount, requestId) => {
    return await sendEmail({
      to: employeeEmail,
      subject: 'Cash Request Approved',
      text: `Hello,\n\nGood news! Your cash request has been approved.\n\nAmount Approved: XAF ${Number(amount).toFixed(2)}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n\nPlease collect your cash from the finance department during business hours.\n\nBest regards,\nFinance Team`
    });
  },

  denialToEmployee: async (employeeEmail, reason, requestId) => {
    return await sendEmail({
      to: employeeEmail,
      subject: 'Cash Request Update',
      text: `Hello,\n\nWe regret to inform you that your cash request has been declined.\n\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\nReason: ${reason}\n\nIf you have any questions, please contact your supervisor or the finance department.\n\nBest regards,\nFinance Team`
    });
  },

  justificationToFinance: async (financeEmail, employeeName, amountSpent, balanceReturned, requestId) => {
    return await sendEmail({
      to: financeEmail,
      subject: 'Cash Justification Submitted',
      text: `Hello Finance Team,\n\nAn employee has submitted their cash justification.\n\nEmployee: ${employeeName}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\nAmount Spent: XAF ${Number(amountSpent).toFixed(2)}\nBalance Returned: XAF ${Number(balanceReturned).toFixed(2)}\n\nPlease review the justification in the finance system.\n\nBest regards,\nFinance System`
    });
  }
};

module.exports = {
  sendEmail,
  sendCashRequestEmail,
  transporter
};