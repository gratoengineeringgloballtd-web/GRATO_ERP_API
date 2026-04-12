const nodemailer = require('nodemailer');

const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || 'marcelngong50@gmail.com',
    pass: process.env.SMTP_PASS || 'qyi rcys fcdr dnqv'
  }
};

// Create transporter
const transporter = nodemailer.createTransporter(emailConfig);

// Enhanced verify connection with better error handling
transporter.verify(function(error, success) {
  if (error) {
    console.error('❌ Email service connection error:', error);
    console.error('Check your SMTP configuration and credentials');
  } else {
    console.log('✅ Email service is ready to send messages');
  }
});

/**
 * Enhanced send email function with better debugging
 */
const sendEmail = async (options) => {
  try {
    console.log('📧 Attempting to send email:', {
      to: options.to,
      subject: options.subject,
      from: options.from || process.env.SMTP_FROM || '"Finance System" <finance@company.com>'
    });

    const mailOptions = {
      from: options.from || process.env.SMTP_FROM || '"Finance System" <finance@company.com>',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || generateHtmlFromText(options.text)
    };

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
      rejected: info.rejected
    };
  } catch (error) {
    console.error('❌ Error sending email:', {
      error: error.message,
      code: error.code,
      command: error.command
    });
    
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
};

/**
 * Generate basic HTML template from plain text
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
 * Enhanced cash request email functions with better error handling
 */
const sendCashRequestEmail = {
  // Enhanced newRequestToSupervisor function
  newRequestToSupervisor: async (supervisorEmail, employeeName, amount, requestId) => {
    try {
      console.log('🔄 Preparing supervisor email:', {
        supervisorEmail,
        employeeName,
        amount,
        requestId: requestId.toString()
      });

      // Validate inputs
      if (!supervisorEmail || !employeeName || !amount || !requestId) {
        throw new Error('Missing required email parameters');
      }

      // Ensure amount is treated as a number
      const formattedAmount = typeof amount === 'number' ? amount.toFixed(2) : Number(amount).toFixed(2);
      
      if (isNaN(formattedAmount)) {
        throw new Error('Invalid amount format');
      }

      const approvalLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/supervisor/request/${requestId}`;
      
      const subject = 'New Cash Request Approval Needed';
      const html = `
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
            
            <p style="color: #777; margin-top: 20px;">
              Or copy this link: ${approvalLink}
            </p>
          </div>
        </div>
      `;

      const text = `Hello,\n\nYou have received a new cash request that requires your approval.\n\nEmployee: ${employeeName}\nAmount Requested: XAF ${formattedAmount}\nRequest ID: REQ-${requestId.toString().slice(-6).toUpperCase()}\n\nPlease click this link to review: ${approvalLink}\n\nBest regards,\nFinance System`;

      console.log('📤 Sending email with subject:', subject);
      
      const result = await sendEmail({
        to: supervisorEmail,
        subject,
        text,
        html
      });

      console.log('📧 Supervisor email result:', result);
      return result;

    } catch (error) {
      console.error('❌ Error in newRequestToSupervisor:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Other email functions remain the same...
  approvedToFinance: async (financeEmail, employeeName, amount, requestId) => {
    const subject = 'New Cash Request for Finance Approval';
    const text = `Hello Finance Team,\n\nA cash request has been approved by the supervisor and requires your final approval.\n\nEmployee: ${employeeName}\nAmount Approved: XAF ${amount.toFixed(2)}\nRequest ID: REQ-${requestId.slice(-6).toUpperCase()}\n\nPlease log into the finance system to review and process this request.\n\nBest regards,\nFinance System`;

    return await sendEmail({
      to: financeEmail,
      subject,
      text
    });
  },

  approvalToEmployee: async (employeeEmail, amount, requestId) => {
    const subject = 'Cash Request Approved';
    const text = `Hello,\n\nGood news! Your cash request has been approved.\n\nAmount Approved: XAF ${amount.toFixed(2)}\nRequest ID: REQ-${requestId.slice(-6).toUpperCase()}\n\nPlease collect your cash from the finance department during business hours.\n\nBest regards,\nFinance Team`;

    return await sendEmail({
      to: employeeEmail,
      subject,
      text
    });
  },

  denialToEmployee: async (employeeEmail, reason, requestId) => {
    const subject = 'Cash Request Update';
    const text = `Hello,\n\nWe regret to inform you that your cash request has been declined.\n\nRequest ID: REQ-${requestId.slice(-6).toUpperCase()}\nReason: ${reason}\n\nIf you have any questions, please contact your supervisor or the finance department.\n\nBest regards,\nFinance Team`;

    return await sendEmail({
      to: employeeEmail,
      subject,
      text
    });
  },

  justificationToFinance: async (financeEmail, employeeName, amountSpent, balanceReturned, requestId) => {
    const subject = 'Cash Justification Submitted';
    const text = `Hello Finance Team,\n\nAn employee has submitted their cash justification.\n\nEmployee: ${employeeName}\nRequest ID: REQ-${requestId.slice(-6).toUpperCase()}\nAmount Spent: XAF ${amountSpent.toFixed(2)}\nBalance Returned: XAF ${balanceReturned.toFixed(2)}\n\nPlease review the justification in the finance system.\n\nBest regards,\nFinance System`;

    return await sendEmail({
      to: financeEmail,
      subject,
      text
    });
  }
};

module.exports = {
  sendEmail,
  sendCashRequestEmail,
  transporter // Export transporter for direct access if needed
};