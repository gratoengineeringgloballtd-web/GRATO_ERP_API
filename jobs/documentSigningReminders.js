// ═══════════════════════════════════════════════════════════════════════════
// FILE: jobs/documentSigningReminders.js
//
// Mirrors the structure of jobs/ceoApprovalEscalation.js and the daily task
// reminder cron in app.js. Runs once a day and:
//   1. Sends a reminder email to any current-level signer who hasn't acted
//      within reminderConfig.reminderAfterDays.
//   2. Re-reminds (escalating tone) at escalateAfterDays, and also CCs the
//      initiator so they're aware of the holdup.
// ═══════════════════════════════════════════════════════════════════════════

const cron = require('node-cron');
const SignableDocument = require('../models/SignableDocument');
const User = require('../models/User');
const emailSvc = require('../services/documentSigningEmailService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const runReminderSweep = async () => {
  console.log('\n=== RUNNING DOCUMENT SIGNING REMINDER SWEEP ===');
  try {
    const pendingDocs = await SignableDocument.find({ status: 'pending_signatures' })
      .populate('initiator', 'fullName email');

    let remindersSent = 0;
    let escalationsSent = 0;

    for (const doc of pendingDocs) {
      const currentSigner = doc.getCurrentSigner();
      if (!currentSigner || !currentSigner.notifiedAt) continue;

      const daysSinceNotified = (Date.now() - currentSigner.notifiedAt.getTime()) / MS_PER_DAY;
      const { reminderAfterDays, escalateAfterDays } = doc.reminderConfig;

      // Only send ONE reminder per threshold crossing — guard using remindersSent count
      // mapped loosely to "how many thresholds have we already notified for".
      const shouldSendReminder = daysSinceNotified >= reminderAfterDays && currentSigner.remindersSent === 0;
      const shouldEscalate = daysSinceNotified >= escalateAfterDays && currentSigner.remindersSent === 1;

      if (shouldSendReminder) {
        await emailSvc.sendSigningRequest(currentSigner, doc, true);
        currentSigner.remindersSent = 1;
        currentSigner.lastReminderAt = new Date();
        doc.addAudit('reminder_sent', { meta: { level: currentSigner.level, daysSinceNotified: Math.round(daysSinceNotified) } });
        remindersSent++;
      } else if (shouldEscalate) {
        await emailSvc.sendSigningRequest(currentSigner, doc, true);
        // Let the initiator know this signer is significantly overdue
        await emailSvc.sendOverrideNotice(
          doc.initiator.email, doc.initiator.fullName, doc,
          `${currentSigner.name} has not signed after ${Math.round(daysSinceNotified)} days — consider reassigning or force-advancing via Admin`,
          { fullName: 'System', role: 'Automated Escalation' }
        );
        currentSigner.remindersSent = 2;
        currentSigner.lastReminderAt = new Date();
        doc.addAudit('reminder_sent', { meta: { level: currentSigner.level, escalated: true, daysSinceNotified: Math.round(daysSinceNotified) } });
        escalationsSent++;
      }

      if (shouldSendReminder || shouldEscalate) {
        await doc.save();
      }
    }

    console.log(`✅ Reminder sweep complete: ${remindersSent} reminder(s), ${escalationsSent} escalation(s)`);
  } catch (error) {
    console.error('❌ Error in document signing reminder sweep:', error);
  }
};

const start = () => {
  // Runs daily at 8:30am — staggered slightly from the 8am task reminder cron in app.js
  cron.schedule('30 8 * * *', runReminderSweep);
  console.log('✅ Document signing reminder cron scheduled (daily 8:30am)');
};

module.exports = { start, runReminderSweep };