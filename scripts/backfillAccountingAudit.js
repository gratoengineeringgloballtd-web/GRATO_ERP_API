require('dotenv').config();
const mongoose = require('mongoose');
const JournalEntry = require('../models/JournalEntry');
const CashRequest = require('../models/CashRequest');
const SupplierInvoice = require('../models/SupplierInvoice');
const Invoice = require('../models/Invoice');
const SalaryPayment = require('../models/SalaryPayment');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

const SOURCE_MODEL_MAP = {
  cash_request_disbursement: {
    model: CashRequest,
    sourceType: 'cash_request_disbursement',
    label: 'Cash Request'
  },
  supplier_invoice: {
    model: SupplierInvoice,
    sourceType: 'supplier_invoice',
    label: 'Supplier Invoice'
  },
  customer_invoice: {
    model: Invoice,
    sourceType: 'customer_invoice',
    label: 'Customer Invoice'
  },
  salary_payment: {
    model: SalaryPayment,
    sourceType: 'salary_payment',
    label: 'Salary Payment'
  }
};

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run')
  };
}

async function connectDB() {
  if (!MONGO_URI) {
    throw new Error('Missing MONGO_URI/MONGODB_URI in environment');
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');
}

async function backfillType(config, dryRun) {
  const stats = {
    sourceType: config.sourceType,
    label: config.label,
    entriesScanned: 0,
    updated: 0,
    alreadyLinked: 0,
    missingSourceDoc: 0,
    invalidSourceId: 0,
    errors: 0
  };

  const entries = await JournalEntry.find({
    sourceType: config.sourceType,
    status: 'posted'
  })
    .select('_id sourceId sourceType entryNumber date createdAt')
    .sort({ date: 1, createdAt: 1 })
    .lean();

  stats.entriesScanned = entries.length;

  for (const entry of entries) {
    try {
      const sourceId = entry.sourceId;

      if (!sourceId || !mongoose.Types.ObjectId.isValid(sourceId)) {
        stats.invalidSourceId += 1;
        continue;
      }

      const sourceDoc = await config.model.findById(sourceId).select('_id accountingAudit').lean();
      if (!sourceDoc) {
        stats.missingSourceDoc += 1;
        continue;
      }

      const existingAudit = sourceDoc.accountingAudit || {};
      const isSameEntry = existingAudit.entryId && String(existingAudit.entryId) === String(entry._id);
      const alreadyPosted = existingAudit.isPosted === true;

      if (alreadyPosted && isSameEntry) {
        stats.alreadyLinked += 1;
        continue;
      }

      if (!dryRun) {
        await config.model.updateOne(
          { _id: sourceId },
          {
            $set: {
              accountingAudit: {
                isPosted: true,
                postedAt: entry.date || entry.createdAt || new Date(),
                entryId: entry._id,
                entryNumber: entry.entryNumber,
                sourceType: config.sourceType
              }
            }
          }
        );
      }

      stats.updated += 1;
    } catch (error) {
      stats.errors += 1;
      console.error(`❌ Failed ${config.label} entry ${entry._id}: ${error.message}`);
    }
  }

  return stats;
}

function printTypeSummary(stats) {
  console.log(`\n${stats.label} (${stats.sourceType})`);
  console.log(`- Entries scanned   : ${stats.entriesScanned}`);
  console.log(`- Updated           : ${stats.updated}`);
  console.log(`- Already linked    : ${stats.alreadyLinked}`);
  console.log(`- Missing source doc: ${stats.missingSourceDoc}`);
  console.log(`- Invalid sourceId  : ${stats.invalidSourceId}`);
  console.log(`- Errors            : ${stats.errors}`);
}

async function run() {
  const { dryRun } = parseArgs();
  console.log('=== ACCOUNTING AUDIT BACKFILL ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'WRITE'}`);

  await connectDB();

  const summaries = [];

  for (const config of Object.values(SOURCE_MODEL_MAP)) {
    const summary = await backfillType(config, dryRun);
    summaries.push(summary);
    printTypeSummary(summary);
  }

  const totals = summaries.reduce(
    (acc, item) => {
      acc.entriesScanned += item.entriesScanned;
      acc.updated += item.updated;
      acc.alreadyLinked += item.alreadyLinked;
      acc.missingSourceDoc += item.missingSourceDoc;
      acc.invalidSourceId += item.invalidSourceId;
      acc.errors += item.errors;
      return acc;
    },
    {
      entriesScanned: 0,
      updated: 0,
      alreadyLinked: 0,
      missingSourceDoc: 0,
      invalidSourceId: 0,
      errors: 0
    }
  );

  console.log('\n=== TOTAL SUMMARY ===');
  console.log(`- Entries scanned   : ${totals.entriesScanned}`);
  console.log(`- Updated           : ${totals.updated}`);
  console.log(`- Already linked    : ${totals.alreadyLinked}`);
  console.log(`- Missing source doc: ${totals.missingSourceDoc}`);
  console.log(`- Invalid sourceId  : ${totals.invalidSourceId}`);
  console.log(`- Errors            : ${totals.errors}`);

  if (dryRun) {
    console.log('\nDry run complete. Re-run without --dry-run to persist changes.');
  }

  await mongoose.disconnect();
  console.log('✅ Disconnected');
}

run().catch(async (error) => {
  console.error('❌ Backfill failed:', error.message);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error('Disconnect error:', disconnectError.message);
  }
  process.exit(1);
});
