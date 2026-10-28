/**
 * Finds customer invoices whose accounting entries are wrong and (optionally) corrects them.
 *
 * What it checks, per invoice:
 *  1. Approved/processed invoice booked the OLD way: receivable = amount before VAT and revenue =
 *     amount minus VAT. Correct is receivable = amount + VAT, revenue = amount.
 *     Fix: a small adjustment entry (Dr receivable VAT / Cr revenue VAT). Originals are untouched.
 *  2. Invoice that was booked at assignment but never got fully approved (still pending or rejected).
 *     Fix: reverse its entry.
 *  3. Approved/processed invoice with NO entry (the earlier posting failure was swallowed).
 *     Fix: post it now with the corrected amounts.
 *  4. Anything that matches none of the patterns is listed for manual review and never touched.
 * It also lists duplicate invoice numbers.
 *
 * Usage (from GRATO_ERP_API):
 *   node scripts/correctBookedInvoices.js            # DRY RUN: only prints
 *   node scripts/correctBookedInvoices.js --apply    # writes the corrections
 *   Add --user=someone@gratoglobal.com to choose whose name appears as "posted by"
 *   (default: the first admin / finance user found).
 * Run the dry run first and read it. Each correction can be re-run safely (already-corrected
 * invoices are skipped).
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Invoice = require('../models/Invoice');
  const JournalEntry = require('../models/JournalEntry');
  const accounting = require('../services/accountingService');
  const User = require('../models/User');

  const userArg = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1];
  const poster = userArg
    ? await User.findOne({ email: new RegExp(`^${userArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id email')
    : (await User.findOne({ role: 'admin' }).select('_id email')) || (await User.findOne({ role: 'finance' }).select('_id email'));
  if (APPLY && !poster) { console.error('No user found to record as "posted by". Use --user=email'); process.exit(1); }
  const postedBy = poster ? poster._id : null;
  if (poster) console.log(`Entries will be recorded as posted by ${poster.email}`);

  const invoices = await Invoice.find({ status: { $ne: 'voided' } })
    .select('invoiceNumber totalAmount taxAmount approvalStatus status')
    .lean();

  const summary = { ok: 0, adjust: 0, reverse: 0, post: 0, manual: 0, failed: 0 };
  console.log(`Checking ${invoices.length} invoices (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);

  for (const inv of invoices) {
    const label = `${inv.invoiceNumber || inv._id}`;
    const net = Number(inv.totalAmount || 0);
    const tax = Number(inv.taxAmount || 0);
    const isApproved = ['approved', 'processed'].includes(inv.approvalStatus);

    const entry = await JournalEntry.findOne({
      sourceType: 'customer_invoice', sourceId: inv._id, isReversal: { $ne: true }, status: 'posted'
    }).lean();

    if (!entry) {
      if (isApproved && net > 0) {
        summary.post++;
        console.log(`[POST]    ${label}: approved but never booked -> book Dr AR ${fmt(net + tax)} / Cr Sales ${fmt(net)} / Cr VAT ${fmt(tax)}`);
        if (APPLY) {
          try {
            await accounting.ensureDefaultChart();
            await accounting.postCustomerInvoice(inv._id, postedBy);
            await Invoice.updateOne({ _id: inv._id }, { $set: { postingStatus: 'posted', postingError: null, postingAttemptedAt: new Date() } });
          } catch (e) { summary.failed++; console.log(`          FAILED: ${e.message}`); }
        }
      }
      continue;
    }

    const reversal = await JournalEntry.findOne({ reversalOf: entry._id }).lean();
    if (reversal) { summary.ok++; continue; }

    if (!isApproved) {
      summary.reverse++;
      console.log(`[REVERSE] ${label}: booked ${entry.entryNumber} but approval status is "${inv.approvalStatus}" -> reverse the entry`);
      if (APPLY) {
        try { await accounting.reverseJournalEntry(entry._id, postedBy, { reason: `Invoice ${label} was booked before final approval` }); }
        catch (e) { summary.failed++; console.log(`          FAILED: ${e.message}`); }
      }
      continue;
    }

    const debitTotal = (entry.lines || []).reduce((s, l) => s + Number(l.debit || 0), 0);
    if (close(debitTotal, net + tax)) { summary.ok++; continue; }

    const oldPattern = tax > 0 && close(debitTotal, net);
    if (!oldPattern) {
      summary.manual++;
      console.log(`[MANUAL]  ${label}: entry ${entry.entryNumber} debits ${fmt(debitTotal)}, expected ${fmt(net + tax)} (amount ${fmt(net)} + VAT ${fmt(tax)}) - does not match the known pattern, review by hand`);
      continue;
    }

    const already = await JournalEntry.findOne({ sourceType: 'manual', sourceId: inv._id, description: /^Correction of invoice/ }).lean();
    if (already) { summary.ok++; continue; }

    const arLine = (entry.lines || []).find(l => Number(l.debit) > 0);
    const salesLine = (entry.lines || []).find(l => Number(l.credit) > 0 && close(l.credit, net - tax))
      || [...(entry.lines || [])].filter(l => Number(l.credit) > 0).sort((a, b) => b.credit - a.credit)[0];
    if (!arLine || !salesLine) {
      summary.manual++;
      console.log(`[MANUAL]  ${label}: could not identify receivable/revenue lines in ${entry.entryNumber}`);
      continue;
    }

    summary.adjust++;
    console.log(`[ADJUST]  ${label}: ${entry.entryNumber} booked receivable ${fmt(debitTotal)}, should be ${fmt(net + tax)} -> add Dr AR ${fmt(tax)} / Cr Sales ${fmt(tax)}`);
    if (APPLY) {
      try {
        await accounting.createJournalEntry({
          date: new Date(),
          description: `Correction of invoice ${label}: VAT added to receivable and revenue (was booked as amount minus VAT)`,
          sourceType: 'manual',
          sourceId: inv._id,
          lines: [
            { account: arLine.account, description: `VAT omitted from receivable - ${label}`, debit: tax, credit: 0 },
            { account: salesLine.account, description: `Revenue understated by VAT - ${label}`, debit: 0, credit: tax }
          ]
        }, postedBy);
      } catch (e) { summary.failed++; console.log(`          FAILED: ${e.message}`); }
    }
  }

  const dups = await Invoice.aggregate([
    { $match: { invoiceNumber: { $type: 'string' } } },
    { $group: { _id: '$invoiceNumber', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }
  ]);
  if (dups.length) {
    console.log('\nDuplicate invoice numbers (resolve by hand):');
    dups.forEach(d => console.log(`  ${d._id}  x${d.n}`));
  }

  console.log('\nSummary:', summary);
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write the corrections.');
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
