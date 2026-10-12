const Communication = require('../models/Communication');
const { batchSendEmails } = require('./communicationEmailService');

/**
 * Deliver a communication (email + in-app) and record the per-recipient outcome.
 * Shared by "send now", "resend to failed" and the scheduled-message cron.
 *
 * @param {ObjectId|string} communicationId
 * @param {{ onlyFailed?: boolean }} options  onlyFailed: retry just the recipients whose email failed
 */
const deliverCommunication = async (communicationId, { onlyFailed = false } = {}) => {
  const communication = await Communication.findById(communicationId)
    .populate('sender', 'fullName email');

  if (!communication) {
    console.error('Communication not found:', communicationId);
    return null;
  }

  const emailEnabled = !!communication.deliveryMethod?.email;
  const inAppEnabled = !!communication.deliveryMethod?.inApp;
  const wasSentBefore = !!communication.sentAt;

  let recipients = await communication.getRecipientList();

  if (onlyFailed) {
    const failedIds = new Set(
      communication.emailLog.filter(l => l.status === 'failed').map(l => String(l.user))
    );
    recipients = recipients.filter(r => failedIds.has(String(r._id)));
  }

  if (recipients.length === 0) {
    if (!onlyFailed) {
      communication.status = 'failed';
      await communication.save();
      console.error('No recipients found for communication:', communicationId);
    } else {
      communication.status = wasSentBefore ? 'sent' : communication.status;
      await communication.save();
    }
    return communication;
  }

  if (emailEnabled) {
    const results = await batchSendEmails(communication, recipients);

    // Merge this run's results into the stored log (one entry per user)
    for (const entry of results.log) {
      const idx = communication.emailLog.findIndex(l => String(l.user) === String(entry.user));
      if (idx >= 0) {
        const prev = communication.emailLog[idx];
        entry.attempts = (prev.attempts || 0) + (entry.attempts || 0);
        communication.emailLog.set(idx, { ...(prev.toObject ? prev.toObject() : prev), ...entry });
      } else {
        communication.emailLog.push(entry);
      }
    }

    communication.deliveryStats.emailsSent = communication.emailLog.filter(l => l.status === 'sent').length;
    communication.deliveryStats.emailsFailed = communication.emailLog.filter(l => l.status === 'failed').length;
  }

  // In-app: the message appears in each recipient's inbox (GET /communications/employee/list)
  // as soon as the status is 'sent', so every recipient counts as delivered in-app.
  if (inAppEnabled && !onlyFailed) {
    communication.deliveryStats.inAppDelivered = recipients.length;
  }

  // Delivered if at least one email went out, or the in-app copy is available
  const delivered = (emailEnabled && communication.deliveryStats.emailsSent > 0) || inAppEnabled;
  communication.status = delivered ? 'sent' : 'failed';
  if (delivered && !wasSentBefore) communication.sentAt = new Date();
  communication.deliveryStats.lastUpdated = new Date();
  communication.markModified('emailLog');
  await communication.save();

  console.log(
    `✅ Communication ${communicationId}: ${communication.deliveryStats.emailsSent} emails sent, ` +
    `${communication.deliveryStats.emailsFailed} failed, status=${communication.status}`
  );
  return communication;
};

/**
 * Reset communications left on "sending" by a server restart or crash.
 *
 * The send runs inside the server process, so a restart mid-send leaves the status
 * stuck forever. We never re-send automatically (the record of who already got the
 * email is lost with the crash, so a retry could send duplicates). Instead:
 *  - a resend run that was interrupted goes back to 'sent' (its earlier log is intact)
 *  - a first send that was interrupted becomes 'failed', so the sender can review it
 *    and press "Send Now" again knowingly.
 *
 * @param {{ onStartup?: boolean, staleMinutes?: number }} options
 *   onStartup: true  -> every 'sending' item is stuck (this process just started)
 *   otherwise        -> only items not updated for `staleMinutes` (default 60)
 */
const recoverStuckCommunications = async ({ onStartup = false, staleMinutes = 60 } = {}) => {
  const query = { status: 'sending' };
  if (!onStartup) {
    query.updatedAt = { $lt: new Date(Date.now() - staleMinutes * 60 * 1000) };
  }

  const stuck = await Communication.find(query).select('_id title sentAt');
  for (const c of stuck) {
    const next = c.sentAt ? 'sent' : 'failed';
    await Communication.updateOne(
      { _id: c._id, status: 'sending' },
      { $set: { status: next, 'deliveryStats.lastUpdated': new Date() } }
    );
    console.warn(`⚠️ Recovered communication "${c.title}" (${c._id}) stuck on 'sending' -> '${next}'`);
  }
  return stuck.length;
};

module.exports = { deliverCommunication, recoverStuckCommunications };
