const BudgetCode = require('../models/BudgetCode');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

/**
 * Check all budget codes and send alerts based on utilization
 */
const sendBudgetAlerts = async () => {
  try {
    console.log('\n📧 Running budget alert checks...');

    const budgetCodes = await BudgetCode.find({ active: true })
      .populate('budgetOwner', 'fullName email')
      .populate('createdBy', 'fullName email');

    let criticalAlerts = 0;
    let warningAlerts = 0;
    let staleAlerts = 0;

    for (const code of budgetCodes) {
      const utilization = code.utilizationPercentage;

      // Critical alert (≥90% utilization)
      if (utilization >= 90 && !code.criticalAlertSent) {
        await sendCriticalBudgetAlert(code);
        code.criticalAlertSent = true;
        code.lastAlertDate = new Date();
        await code.save();
        criticalAlerts++;
      }

      // Warning alert (75-89% utilization)
      else if (utilization >= 75 && utilization < 90 && !code.warningAlertSent) {
        await sendWarningBudgetAlert(code);
        code.warningAlertSent = true;
        code.lastAlertDate = new Date();
        await code.save();
        warningAlerts++;
      }

      // Check for stale reservations (>30 days)
      const staleReservations = code.allocations.filter(alloc => {
        if (alloc.status !== 'allocated') return false;
        const daysSince = (Date.now() - alloc.allocatedDate) / (1000 * 60 * 60 * 24);
        return daysSince > 30;
      });

      if (staleReservations.length > 0) {
        await sendStaleReservationAlert(code, staleReservations);
        staleAlerts++;
      }
    }

    console.log(`✅ Budget alerts completed:`);
    console.log(`   - Critical alerts sent: ${criticalAlerts}`);
    console.log(`   - Warning alerts sent: ${warningAlerts}`);
    console.log(`   - Stale reservation alerts: ${staleAlerts}\n`);

    return {
      criticalAlerts,
      warningAlerts,
      staleAlerts
    };
  } catch (error) {
    console.error('Error sending budget alerts:', error);
    throw error;
  }
};

/**
 * Send critical budget alert (≥90% utilized)
 */
const sendCriticalBudgetAlert = async (budgetCode) => {
  const recipients = [];

  if (budgetCode.budgetOwner?.email) {
    recipients.push(budgetCode.budgetOwner.email);
  }

  // Always CC finance
  recipients.push('ranibellmambo@gratoengineering.com');

  await sendEmail({
    to: recipients[0],
    cc: recipients.slice(1),
    subject: `🚨 CRITICAL: Budget ${budgetCode.code} Nearly Exhausted`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <div style="background-color: #fff2f0; border-left: 4px solid #ff4d4f; padding: 20px; margin-bottom: 20px;">
          <h2 style="color: #ff4d4f; margin: 0 0 10px 0;">🚨 Critical Budget Alert</h2>
          <p style="margin: 0; color: #666;">Immediate action required</p>
        </div>

        <p>Your budget code <strong>${budgetCode.code}</strong> has reached critical utilization levels:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0;"><strong>Budget Code:</strong></td>
              <td style="padding: 8px 0;">${budgetCode.code} - ${budgetCode.name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Department:</strong></td>
              <td style="padding: 8px 0;">${budgetCode.department}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Total Budget:</strong></td>
              <td style="padding: 8px 0;">XAF ${budgetCode.budget.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Used:</strong></td>
              <td style="padding: 8px 0; color: #ff4d4f;">XAF ${budgetCode.used.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Remaining:</strong></td>
              <td style="padding: 8px 0; color: #ff4d4f;"><strong>XAF ${budgetCode.remaining.toLocaleString()}</strong></td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Utilization:</strong></td>
              <td style="padding: 8px 0; color: #ff4d4f;"><strong>${budgetCode.utilizationPercentage}%</strong></td>
            </tr>
          </table>
        </div>

        <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0; color: #faad14;">⚠️ Action Required</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li>Review all pending requests and reservations</li>
            <li>Consider requesting a budget increase</li>
            <li>Defer non-critical purchases if possible</li>
            <li>Monitor closely to avoid budget overruns</li>
          </ul>
        </div>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/budget-codes/${budgetCode._id}" 
             style="background-color: #ff4d4f; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
            View Budget Details
          </a>
        </p>

        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #e8e8e8; padding-top: 20px;">
          This is an automated alert from the Budget Management System.<br>
          Alert sent: ${new Date().toLocaleString()}
        </p>
      </div>
    `
  });
};

/**
 * Send warning budget alert (75-89% utilized)
 */
const sendWarningBudgetAlert = async (budgetCode) => {
  const recipients = [];

  if (budgetCode.budgetOwner?.email) {
    recipients.push(budgetCode.budgetOwner.email);
  }

  await sendEmail({
    to: recipients[0] || 'ranibellmambo@gratoengineering.com',
    subject: `⚠️ Budget Alert: ${budgetCode.code} at ${budgetCode.utilizationPercentage}%`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 20px; margin-bottom: 20px;">
          <h2 style="color: #faad14; margin: 0 0 10px 0;">⚠️ Budget Usage Warning</h2>
          <p style="margin: 0; color: #666;">Monitor and plan accordingly</p>
        </div>

        <p>Your budget code <strong>${budgetCode.code}</strong> has reached ${budgetCode.utilizationPercentage}% utilization:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0;"><strong>Budget Code:</strong></td>
              <td style="padding: 8px 0;">${budgetCode.code} - ${budgetCode.name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Total Budget:</strong></td>
              <td style="padding: 8px 0;">XAF ${budgetCode.budget.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Used:</strong></td>
              <td style="padding: 8px 0;">XAF ${budgetCode.used.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Remaining:</strong></td>
              <td style="padding: 8px 0; color: #faad14;"><strong>XAF ${budgetCode.remaining.toLocaleString()}</strong></td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Utilization:</strong></td>
              <td style="padding: 8px 0; color: #faad14;"><strong>${budgetCode.utilizationPercentage}%</strong></td>
            </tr>
          </table>
        </div>

        <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0; color: #1890ff;">💡 Recommendations</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li>Review upcoming expenses and priorities</li>
            <li>Plan for potential budget increase if needed</li>
            <li>Monitor utilization trends closely</li>
            <li>Communicate with your team about budget status</li>
          </ul>
        </div>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/budget-codes/${budgetCode._id}" 
             style="background-color: #1890ff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Budget Details
          </a>
        </p>

        <p style="color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #e8e8e8; padding-top: 20px;">
          This is an automated alert from the Budget Management System.<br>
          Alert sent: ${new Date().toLocaleString()}
        </p>
      </div>
    `
  });
};

/**
 * Send stale reservation alert
 */
const sendStaleReservationAlert = async (budgetCode, staleReservations) => {
  const recipients = [];

  if (budgetCode.budgetOwner?.email) {
    recipients.push(budgetCode.budgetOwner.email);
  }

  // Always CC finance
  recipients.push('ranibellmambo@gratoengineering.com');

  const totalStaleAmount = staleReservations.reduce((sum, res) => sum + res.amount, 0);

  await sendEmail({
    to: recipients[0],
    cc: recipients.slice(1),
    subject: `📋 Stale Budget Reservations: ${budgetCode.code}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #1890ff;">Stale Budget Reservations Detected</h2>
        <p>Budget code <strong>${budgetCode.code}</strong> has ${staleReservations.length} reservation(s) older than 30 days:</p>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Budget Code:</strong> ${budgetCode.code} - ${budgetCode.name}</p>
          <p><strong>Stale Reservations:</strong> ${staleReservations.length}</p>
          <p><strong>Total Amount Reserved:</strong> XAF ${totalStaleAmount.toLocaleString()}</p>
          <p><strong>Current Remaining:</strong> XAF ${budgetCode.remaining.toLocaleString()}</p>
        </div>

        <div style="background-color: #fff7e6; border-left: 4px solid #faad14; padding: 15px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0;">Action Required</h3>
          <p style="margin: 0;">Review these reservations and release any that are no longer needed to free up budget.</p>
        </div>

        <p style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/finance/budget-codes/${budgetCode._id}" 
             style="background-color: #1890ff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Review Reservations
          </a>
        </p>
      </div>
    `
  });
};

/**
 * Schedule budget alerts (called from server.js)
 */
const scheduleBudgetAlerts = () => {
  const cron = require('node-cron');

  // Run every day at 8 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Running scheduled budget alerts...');
    try {
      await sendBudgetAlerts();
    } catch (error) {
      console.error('❌ Error in scheduled budget alerts:', error);
    }
  });

  console.log('✅ Budget alert scheduler initialized (runs daily at 8 AM)');
};

module.exports = {
  sendBudgetAlerts,
  sendCriticalBudgetAlert,
  sendWarningBudgetAlert,
  sendStaleReservationAlert,
  scheduleBudgetAlerts
};