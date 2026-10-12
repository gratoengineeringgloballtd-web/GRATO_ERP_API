/**
 * One-off repair for a communication that was sent BEFORE per-recipient delivery
 * logging existed (its emailLog is empty, so "Resend to failed" has nothing to retry).
 *
 * It rebuilds the log from the current recipient list:
 *   - people in --received  -> marked 'sent'   (they already got the email)
 *   - everybody else        -> marked 'failed' (so "Resend to failed" will send to them)
 * and can also switch on the in-app copy so everyone sees it under "My Messages".
 *
 * Usage (from the Back folder):
 *   node scripts/repairCommunicationLog.js <communicationId>                         # preview only
 *   node scripts/repairCommunicationLog.js <id> --received=a@x.com,b@x.com --apply   # save changes
 *   node scripts/repairCommunicationLog.js <id> --in-app --apply                     # also enable in-app copy
 *
 * Flags:
 *   --received=<emails>   comma-separated emails that DID receive the original (optional)
 *   --in-app              enable the in-app copy for this message
 *   --apply               actually write to the database (without it nothing is changed)
 */
require('dotenv').config();
const mongoose = require('mongoose');

const FAILED_NOTE = 'No delivery record (sent before delivery logging existed) - treated as not delivered';

/** Pure helper: build emailLog entries from recipients and the set of emails known to have received it. */
const buildLog = (recipients, receivedEmails = []) => {
  const received = new Set(receivedEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  const now = new Date();
  return recipients.map((r) => {
    const got = received.has(String(r.email || '').trim().toLowerCase());
    return {
      user: r._id,
      email: r.email,
      fullName: r.fullName,
      status: got ? 'sent' : 'failed',
      attempts: got ? 1 : 0,
      error: got ? null : FAILED_NOTE,
      sentAt: got ? now : undefined,
      lastAttemptAt: now
    };
  });
};

const main = async () => {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const enableInApp = args.includes('--in-app');
  const receivedArg = (args.find((a) => a.startsWith('--received=')) || '').slice('--received='.length);
  const receivedEmails = receivedArg ? receivedArg.split(',') : [];

  if (!id || !mongoose.isValidObjectId(id)) {
    console.error('Usage: node scripts/repairCommunicationLog.js <communicationId> [--received=a@x.com,b@x.com] [--in-app] [--apply]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Communication = require('../models/Communication');
  require('../models/User');

  const communication = await Communication.findById(id);
  if (!communication) throw new Error(`Communication ${id} not found`);
  if (communication.emailLog && communication.emailLog.length > 0) {
    throw new Error('This communication already has a delivery log - nothing to repair.');
  }

  const recipients = await communication.getRecipientList();
  const log = buildLog(recipients, receivedEmails);
  const sent = log.filter((l) => l.status === 'sent').length;
  const failed = log.length - sent;

  const unknown = receivedEmails.filter(
    (e) => !recipients.some((r) => String(r.email).toLowerCase() === e.trim().toLowerCase())
  );

  console.log(`\nCommunication: "${communication.title}"`);
  console.log(`Recipients now: ${recipients.length} (originally ${communication.recipients.totalCount})`);
  console.log(`Will mark as already received: ${sent}`);
  console.log(`Will mark as needing a resend: ${failed}`);
  if (unknown.length) console.log(`⚠️  Not found among recipients (ignored): ${unknown.join(', ')}`);
  if (enableInApp) console.log(`In-app copy: will be ENABLED for all ${recipients.length} recipients`);

  if (!apply) {
    console.log('\nPreview only - nothing was changed. Re-run with --apply to save.');
  } else {
    communication.emailLog = log;
    communication.deliveryStats.emailsSent = sent;
    communication.deliveryStats.emailsFailed = failed;
    communication.deliveryStats.lastUpdated = new Date();
    if (enableInApp) {
      communication.deliveryMethod.inApp = true;
      communication.deliveryStats.inAppDelivered = recipients.length;
    }
    communication.markModified('emailLog');
    await communication.save();
    console.log('\n✅ Saved. Open the communication and press "Resend to failed".');
  }

  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch(async (e) => {
    console.error('❌', e.message);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  });
}

module.exports = { buildLog };
