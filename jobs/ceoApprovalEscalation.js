// ═══════════════════════════════════════════════════════════════════════════
// FILE: jobs/ceoApprovalEscalation.js  (NEW FILE)
// PURPOSE: Runs on a schedule (every morning at 7am) and:
//   1. Finds all requests sitting at the CEO step for too long
//   2. Sends Tom a reminder after N days
//   3. Auto-delegates to Kelvin after M days if Tom hasn't acted
//
// Mount in server.js the same way releaseStaleReservationsJob is mounted.
// ═══════════════════════════════════════════════════════════════════════════

const cron = require('node-cron');
const User = require('../models/User');
const {
  CEO,
  DEFAULT_CEO_DELEGATE,
  CEO_ESCALATION_TIMEOUTS,
} = require('../config/ceoApprovalConfig');
const { sendEmail } = require('../services/emailService');

// Models that have an approvalChain with CEO steps
// Add any new models here as you build them
const MODELS_WITH_CEO_STEP = [
  { name: 'CashRequest',          model: () => require('../models/CashRequest'),          labelField: 'requestType',   amountField: 'amount',         urlPath: '/admin/cash-approvals' },
  { name: 'PurchaseRequisition',  model: () => require('../models/PurchaseRequisition'),  labelField: 'itemDescription', amountField: 'totalBudget',  urlPath: '/admin/purchase-requisitions' },
  { name: 'SupplierInvoice',      model: () => require('../models/SupplierInvoice'),      labelField: 'invoiceNumber', amountField: 'invoiceAmount',  urlPath: '/admin/invoice-management' },
  { name: 'PurchaseOrder',        model: () => require('../models/PurchaseOrder'),        labelField: 'poNumber',      amountField: 'totalAmount',    urlPath: '/buyer/purchase-orders' },
  { name: 'DebitNote',            model: () => require('../models/DebitNote'),            labelField: 'debitNoteNumber', amountField: 'amount',       urlPath: '/supervisor/debit-note-approvals' },
  { name: 'BudgetCode',           model: () => require('../models/BudgetCode'),           labelField: 'code',          amountField: 'budget',         urlPath: '/finance/budget-codes' },
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE: find all items sitting at CEO step and take action
// ─────────────────────────────────────────────────────────────────────────────
const runEscalationCheck = async () => {
  console.log('\n=== CEO APPROVAL ESCALATION CHECK ===');

  try {
    // Fetch CEO user and their settings
    const ceoUser = await User.findOne({ email: CEO.email }).select('fullName email ceoAvailability');

    if (!ceoUser) {
      console.warn('CEO user not found — skipping escalation check');
      return;
    }

    const av = ceoUser.ceoAvailability || {};
    const autoEsc = av.autoEscalation || {};
    const isEnabled = autoEsc.enabled !== false; // default: enabled

    if (!isEnabled) {
      console.log('Auto-escalation is disabled — skipping');
      return;
    }

    const reminderDays     = autoEsc.reminderAfterDays      || CEO_ESCALATION_TIMEOUTS.reminderAfterDays;
    const autoDelDays      = autoEsc.autoDelegateAfterDays  || CEO_ESCALATION_TIMEOUTS.autoDelegateAfterDays;
    const isCEOUnavailable = ceoUser.hasActiveDelegate?.() ?? false;

    const now          = new Date();
    const reminderCutoff  = new Date(now - reminderDays  * 24 * 60 * 60 * 1000);
    const delegateCutoff  = new Date(now - autoDelDays   * 24 * 60 * 60 * 1000);

    const delegateEmail = av.delegateEmail || DEFAULT_CEO_DELEGATE.email;
    const delegateName  = av.delegateName  || DEFAULT_CEO_DELEGATE.name;

    let totalReminders  = 0;
    let totalDelegated  = 0;

    for (const entry of MODELS_WITH_CEO_STEP) {
      try {
        const Model = entry.model();

        // Find documents where the CEO step is pending and was assigned before the cutoff
        const overdueItems = await Model.find({
          'approvalChain': {
            $elemMatch: {
              'approver.email': CEO.email,
              'approver.role':  'CEO - Final Authority',
              status:           'pending',
              assignedDate:     { $lte: delegateCutoff },
            },
          },
        }).lean();

        for (const item of overdueItems) {
          const ceoStep = item.approvalChain.find(
            s => s.approver?.email === CEO.email && s.status === 'pending'
          );
          if (!ceoStep) continue;

          const assignedDate = new Date(ceoStep.assignedDate || ceoStep.assignedAt || now);
          const daysPending  = Math.floor((now - assignedDate) / (1000 * 60 * 60 * 24));

          const label  = item[entry.labelField]  || entry.name;
          const amount = item[entry.amountField] || 0;

          // ── AUTO-DELEGATE ─────────────────────────────────────────────
          if (daysPending >= autoDelDays) {
            console.log(`  → Auto-delegating ${entry.name} #${item._id} (${daysPending} days pending)`);

            await Model.findByIdAndUpdate(item._id, {
              $set: {
                'approvalChain.$[elem].approver.email':      delegateEmail,
                'approvalChain.$[elem].approver.name':       delegateName,
                'approvalChain.$[elem].approver.role':       'Acting CEO (Delegate)',
                'approvalChain.$[elem].autoEscalated':       true,
                'approvalChain.$[elem].originalApprover':    CEO.email,
                'approvalChain.$[elem].escalatedAt':         new Date(),
              },
            }, {
              arrayFilters: [{ 'elem.approver.email': CEO.email, 'elem.status': 'pending' }],
            });

            // Notify delegate
            await sendEscalationEmail({
              to:           delegateEmail,
              name:         delegateName,
              subject:      `Action Required: CEO approval auto-delegated to you`,
              requestLabel: label,
              amount,
              daysPending,
              urlPath:      entry.urlPath,
              reason:       `No action from CEO after ${autoDelDays} days`,
              isCEOInformed: av.keepTomInformed,
              ceoEmail:     CEO.email,
            });

            totalDelegated++;

          // ── REMINDER ONLY ─────────────────────────────────────────────
          } else if (daysPending >= reminderDays) {
            console.log(`  → Sending reminder for ${entry.name} #${item._id} (${daysPending} days pending)`);

            // Only send if not already unavailable (if already unavailable, delegate handles it)
            if (!isCEOUnavailable) {
              await sendReminderEmail({
                to:           CEO.email,
                name:         ceoUser.fullName,
                requestLabel: label,
                amount,
                daysPending,
                urlPath:      entry.urlPath,
              });
              totalReminders++;
            }
          }
        }
      } catch (modelErr) {
        console.warn(`  ⚠ Could not process ${entry.name}: ${modelErr.message}`);
      }
    }

    console.log(`✅ Escalation check complete: ${totalReminders} reminders sent, ${totalDelegated} auto-delegated`);
    console.log('=== END ESCALATION CHECK ===\n');

  } catch (err) {
    console.error('❌ CEO escalation check failed:', err.message);
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// EMAIL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function sendReminderEmail({ to, name, requestLabel, amount, daysPending, urlPath }) {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  await sendEmail({
    to,
    subject: `⏰ Reminder: ${requestLabel} awaiting your approval (${daysPending} days)`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #faad14;">Approval Reminder</h2>
        <p>Dear ${name},</p>
        <p>The following request has been waiting for your approval for <strong>${daysPending} day(s)</strong>.</p>
        <div style="background: #fff7e6; border-left: 4px solid #faad14; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <p><strong>Request:</strong> ${requestLabel}</p>
          ${amount ? `<p><strong>Amount:</strong> ${Number(amount).toLocaleString()} XAF</p>` : ''}
          <p><strong>Days pending:</strong> ${daysPending}</p>
        </div>
        <p style="text-align:center;">
          <a href="${clientUrl}${urlPath}"
             style="background:#faad14;color:#fff;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;">
            Review Now
          </a>
        </p>
      </div>
    `,
  }).catch(e => console.error('Reminder email failed:', e.message));
}

async function sendEscalationEmail({ to, name, subject, requestLabel, amount, daysPending, urlPath, reason, isCEOInformed, ceoEmail }) {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  await sendEmail({
    to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #ff4d4f;">⚡ Auto-Escalated Approval</h2>
        <p>Dear ${name},</p>
        <p>The following request has been <strong>automatically delegated</strong> to you for final approval.</p>
        <div style="background: #fff2f0; border-left: 4px solid #ff4d4f; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <p><strong>Request:</strong> ${requestLabel}</p>
          ${amount ? `<p><strong>Amount:</strong> ${Number(amount).toLocaleString()} XAF</p>` : ''}
          <p><strong>Days pending at CEO level:</strong> ${daysPending}</p>
          <p><strong>Reason for escalation:</strong> ${reason}</p>
        </div>
        ${isCEOInformed ? `<p style="color:#888;font-size:12px;">Mr. Tom has been CC'd on this notification.</p>` : ''}
        <p style="text-align:center;">
          <a href="${clientUrl}${urlPath}"
             style="background:#ff4d4f;color:#fff;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;">
            Review &amp; Approve Now
          </a>
        </p>
      </div>
    `,
  }).catch(e => console.error('Escalation email failed:', e.message));

  if (isCEOInformed) {
    await sendEmail({
      to:      ceoEmail,
      subject: `[FYI] ${requestLabel} has been delegated to ${name}`,
      html:    `<p>The request <strong>${requestLabel}</strong> was auto-delegated to <strong>${name}</strong> after ${daysPending} days without action.</p>`,
    }).catch(() => {});
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — mount in server.js like:
//   const ceoEscalation = require('./jobs/ceoApprovalEscalation');
//   ceoEscalation.start();
// ─────────────────────────────────────────────────────────────────────────────

const start = () => {
  // Runs every day at 07:00
  cron.schedule('0 7 * * *', runEscalationCheck);
  console.log('✅ CEO approval escalation job scheduled (daily 07:00)');
};

module.exports = { start, runEscalationCheck };