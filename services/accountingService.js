const mongoose = require('mongoose');
const Account = require('../models/Account');
const AccountingRule = require('../models/AccountingRule');
const AccountingPeriod = require('../models/AccountingPeriod');
const JournalEntry = require('../models/JournalEntry');
const CashRequest = require('../models/CashRequest');
const SupplierInvoice = require('../models/SupplierInvoice');
const Invoice = require('../models/Invoice');
const SalaryPayment = require('../models/SalaryPayment');
const Counter = require('../models/Counter');
const Payment = require('../models/Payment');
const BankTransaction = require('../models/BankTransaction');
const AuditLog = require('../models/AuditLog');
  const TaxGroup       = require('../models/TaxGroup');
  const Currency       = require('../models/Currency');
  const FixedAsset     = require('../models/FixedAsset');
  const AnalyticAccount= require('../models/AnalyticAccount');
  const AnalyticLine   = require('../models/AnalyticLine');
  const Budget         = require('../models/Budget');
  const CreditNote     = require('../models/CreditNote');
  const DunningAction  = require('../models/DunningAction');
  const PaymentBatch   = require('../models/PaymentBatch');
  const FiscalYear     = require('../models/FiscalYear');

const DEFAULT_CHART = [
  { code: '1000', name: 'Cash on Hand', type: 'asset', subType: 'current_asset', normalBalance: 'debit' },
  { code: '1010', name: 'Bank Account', type: 'asset', subType: 'current_asset', normalBalance: 'debit' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', subType: 'current_asset', normalBalance: 'debit' },
  { code: '1300', name: 'VAT Receivable', type: 'asset', subType: 'current_asset', normalBalance: 'debit' },
  { code: '1200', name: 'Staff Advances', type: 'asset', subType: 'current_asset', normalBalance: 'debit' },
  { code: '2000', name: 'Accounts Payable', type: 'liability', subType: 'current_liability', normalBalance: 'credit' },
  { code: '2200', name: 'VAT Payable', type: 'liability', subType: 'current_liability', normalBalance: 'credit' },
  { code: '2300', name: 'Withholding Tax Payable', type: 'liability', subType: 'current_liability', normalBalance: 'credit' },
  { code: '1500', name: 'Fixed Assets', type: 'asset', subType: 'non_current_asset', normalBalance: 'debit' },
  { code: '2100', name: 'Accrued Expenses', type: 'liability', subType: 'current_liability', normalBalance: 'credit' },
  { code: '3000', name: 'Owner Equity', type: 'equity', subType: 'equity', normalBalance: 'credit' },
  { code: '4000', name: 'Sales Revenue', type: 'revenue', subType: 'operating_revenue', normalBalance: 'credit' },
  { code: '5000', name: 'Cost of Services', type: 'expense', subType: 'cost_of_sales', normalBalance: 'debit' },
  { code: '5100', name: 'Salaries Expense', type: 'expense', subType: 'operating_expense', normalBalance: 'debit' },
  { code: '5200', name: 'Transport Expense', type: 'expense', subType: 'operating_expense', normalBalance: 'debit' },
  { code: '5300', name: 'General Admin Expense', type: 'expense', subType: 'operating_expense', normalBalance: 'debit' },
  { code:'1510', name:'Accumulated Depreciation',  type:'asset',     subType:'non_current_asset', normalBalance:'credit' },
  { code:'3100', name:'Retained Earnings',          type:'equity',    subType:'equity',            normalBalance:'credit' },
  { code:'3200', name:'Current Year Earnings',      type:'equity',    subType:'equity',            normalBalance:'credit' },
  { code:'4100', name:'Other Revenue',              type:'revenue',   subType:'other_revenue',     normalBalance:'credit' },
  { code:'5400', name:'Depreciation Expense',       type:'expense',   subType:'operating_expense', normalBalance:'debit'  },
  { code:'5500', name:'FX Gain/Loss',               type:'expense',   subType:'financial_expense', normalBalance:'debit'  },
];

const DEFAULT_MAPPINGS = {
  CASH: '1000',
  BANK: '1010',
  AR: '1100',
  VAT_RECEIVABLE: '1300',
  STAFF_ADVANCES: '1200',
  AP: '2000',
  VAT_PAYABLE: '2200',
  SALES: '4000',
  SALARIES_EXP: '5100',
  TRANSPORT_EXP: '5200',
  ADMIN_EXP: '5300'
};

const DEFAULT_RULES = [
  {
    name: 'Sales Invoice Standard',
    documentType: 'sales_invoice',
    sourceType: 'customer_invoice',
    description: 'Debit receivable, credit revenue and VAT payable where applicable',
    priority: 10,
    isActive: true,
    taxConfig: { enabled: true, defaultRate: 19.25 },
    lines: [
      { side: 'debit', accountCode: DEFAULT_MAPPINGS.AR, amountSource: 'gross', description: 'Accounts receivable' },
      { side: 'credit', accountCode: DEFAULT_MAPPINGS.SALES, amountSource: 'net', description: 'Sales revenue' },
      { side: 'credit', accountCode: DEFAULT_MAPPINGS.VAT_PAYABLE, amountSource: 'tax', description: 'VAT on sales', optional: true }
    ]
  },
  {
    name: 'Supplier Bill Standard',
    documentType: 'supplier_bill',
    sourceType: 'supplier_invoice',
    description: 'Debit expense and VAT receivable where applicable, credit accounts payable',
    priority: 10,
    isActive: true,
    taxConfig: { enabled: true, defaultRate: 19.25 },
    lines: [
      { side: 'debit', accountCode: DEFAULT_MAPPINGS.ADMIN_EXP, amountSource: 'net', description: 'Supplier expense' },
      { side: 'debit', accountCode: DEFAULT_MAPPINGS.VAT_RECEIVABLE, amountSource: 'tax', description: 'VAT receivable on purchases', optional: true },
      { side: 'credit', accountCode: DEFAULT_MAPPINGS.AP, amountSource: 'gross', description: 'Accounts payable to supplier' }
    ]
  },
  {
    name: 'Cash Disbursement Standard',
    documentType: 'cash_disbursement',
    sourceType: 'cash_request_disbursement',
    description: 'Debit staff advances, credit cash',
    priority: 10,
    isActive: true,
    taxConfig: { enabled: false, defaultRate: 0 },
    lines: [
      { side: 'debit', accountCode: DEFAULT_MAPPINGS.STAFF_ADVANCES, amountSource: 'gross', description: 'Staff advance issued' },
      { side: 'credit', accountCode: DEFAULT_MAPPINGS.CASH, amountSource: 'gross', description: 'Cash paid out' }
    ]
  },
  {
    name: 'Salary Payment Standard',
    documentType: 'salary_payment',
    sourceType: 'salary_payment',
    description: 'Debit salaries expense, credit cash',
    priority: 10,
    isActive: true,
    taxConfig: { enabled: false, defaultRate: 0 },
    lines: [
      { side: 'debit', accountCode: DEFAULT_MAPPINGS.SALARIES_EXP, amountSource: 'gross', description: 'Salary expense recognized' },
      { side: 'credit', accountCode: DEFAULT_MAPPINGS.CASH, amountSource: 'gross', description: 'Cash salary payout' }
    ]
  },
  {
    name: 'Partial Customer Invoice Standard',
    documentType: 'partial_customer_invoice',
    sourceType: 'partial_customer_invoice',
    description: 'Debit receivable for partial payment term amount, credit revenue and VAT',
    priority: 10,
    isActive: true,
    taxConfig: { enabled: true, defaultRate: 19.25 },
    lines: [
      { side: 'debit', accountCode: '1100', amountSource: 'gross', description: 'Accounts receivable (partial)' },
      { side: 'credit', accountCode: '4000', amountSource: 'net', description: 'Sales revenue (partial)' },
      { side: 'credit', accountCode: '2200', amountSource: 'tax', description: 'VAT on partial invoice', optional: true }
    ]
  },
  {
    name: 'Completion Milestone Recognition',
    documentType: 'completion_milestone',
    sourceType: 'project_plan_completion',
    description: 'Recognize cost when project plan completion item is marked done',
    priority: 10,
    isActive: true,
    taxConfig: { enabled: false, defaultRate: 0 },
    lines: [
      { side: 'debit', accountCode: '5000', amountSource: 'gross', description: 'Cost of services recognized' },
      { side: 'credit', accountCode: '2100', amountSource: 'gross', description: 'Accrued expense - milestone' }
    ]
  },
  { name: 'Payment Receipt', documentType: 'payment_receipt', sourceType: 'payment_receipt',
    description: 'Debit bank, credit AR', priority: 10, isActive: true,
    taxConfig: { enabled: false, defaultRate: 0 },
    lines: [
      { side: 'debit',  accountCode: '1010', amountSource: 'gross', description: 'Bank receipt' },
      { side: 'credit', accountCode: '1100', amountSource: 'gross', description: 'Clear AR' }
    ]
  },
  { name: 'Supplier Payment', documentType: 'supplier_payment', sourceType: 'supplier_payment',
    description: 'Debit AP, credit bank', priority: 10, isActive: true,
    taxConfig: { enabled: false, defaultRate: 0 },
    lines: [
      { side: 'debit',  accountCode: '2000', amountSource: 'gross', description: 'Clear AP' },
      { side: 'credit', accountCode: '1010', amountSource: 'gross', description: 'Bank payment' }
    ]
  }
];

function roundAmount(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function getPeriodParts(date) {
  const periodDate = date ? new Date(date) : new Date();
  return {
    year: periodDate.getFullYear(),
    month: periodDate.getMonth() + 1
  };
}

async function ensureOpenPeriod(date) {
  const { year, month } = getPeriodParts(date);
  const period = await AccountingPeriod.findOne({ year, month }).lean();

  if (period?.status === 'closed') {
    throw new Error(`Posting period ${year}-${String(month).padStart(2, '0')} is closed`);
  }

  return { year, month, period: period || null };
}

async function setPeriodStatus({ year, month, status, userId, notes = '' }) {
  if (!['open', 'closed'].includes(status)) {
    throw new Error('Invalid period status. Must be open or closed');
  }

  const update = {
    status,
    notes: notes || '',
    closedAt: status === 'closed' ? new Date() : null,
    closedBy: status === 'closed' ? userId : null
  };

  const period = await AccountingPeriod.findOneAndUpdate(
    { year: Number(year), month: Number(month) },
    { $set: update, $setOnInsert: { year: Number(year), month: Number(month) } },
    { upsert: true, new: true, runValidators: true }
  );

  return period;
}

async function listPeriods({ year, status }) {
  const filter = {};
  if (year) filter.year = Number(year);
  if (status) filter.status = status;

  return AccountingPeriod.find(filter)
    .populate('closedBy', 'fullName email')
    .sort({ year: -1, month: -1 })
    .lean();
}

function getPathValue(object, path) {
  if (!object || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), object);
}

function getContextAmounts(context = {}) {
  const gross = roundAmount(context.grossAmount);
  const tax = roundAmount(context.taxAmount);
  const net = roundAmount(
    context.netAmount !== undefined && context.netAmount !== null
      ? context.netAmount
      : (gross - tax)
  );

  return { gross, net, tax };
}

function resolveRuleLineAmount(line, context) {
  const amounts = getContextAmounts(context);

  if (line.amountSource === 'gross') return amounts.gross;
  if (line.amountSource === 'net') return amounts.net;
  if (line.amountSource === 'tax') return amounts.tax;
  if (line.amountSource === 'fixed') return roundAmount(line.fixedAmount);
  if (line.amountSource === 'field') return roundAmount(getPathValue(context, line.fieldPath));
  return 0;
}

function balanceLines(lines) {
  const debitTotal = roundAmount(lines.reduce((sum, line) => sum + (line.debit || 0), 0));
  const creditTotal = roundAmount(lines.reduce((sum, line) => sum + (line.credit || 0), 0));
  const difference = roundAmount(debitTotal - creditTotal);

  if (difference === 0) return lines;
  if (Math.abs(difference) > 0.01) {
    throw new Error(`Unbalanced rule output: debit=${debitTotal}, credit=${creditTotal}`);
  }

  const sideToAdjust = difference > 0 ? 'credit' : 'debit';
  const candidateIndex = lines
    .map((line, index) => ({ index, amount: line[sideToAdjust] || 0 }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)[0]?.index;

  if (candidateIndex === undefined) {
    throw new Error('Unable to auto-balance generated lines');
  }

  lines[candidateIndex][sideToAdjust] = roundAmount(lines[candidateIndex][sideToAdjust] + Math.abs(difference));
  return lines;
}

async function buildJournalLinesFromRule(rule, context) {
  const lines = [];

  for (const ruleLine of (rule.lines || [])) {
    const amount = resolveRuleLineAmount(ruleLine, context);

    if (amount <= 0) {
      if (ruleLine.optional) continue;
      continue;
    }

    const account = await getAccountByCode(ruleLine.accountCode);
    lines.push({
      account: account._id,
      description: ruleLine.description || '',
      debit: ruleLine.side === 'debit' ? amount : 0,
      credit: ruleLine.side === 'credit' ? amount : 0
    });
  }

  if (lines.length < 2) {
    throw new Error(`Rule ${rule.name || rule.documentType} did not produce enough journal lines`);
  }

  return balanceLines(lines);
}

async function stampAccountingAudit(Model, sourceId, sourceType, entry) {
  if (!sourceId || !entry) return;

  await Model.findByIdAndUpdate(sourceId, {
    $set: {
      accountingAudit: {
        isPosted: true,
        postedAt: entry.date || entry.createdAt || new Date(),
        entryId: entry._id,
        entryNumber: entry.entryNumber,
        sourceType
      }
    }
  });
}

// async function nextEntryNumber(session = null) {
//   const now = new Date();
//   const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
//   const prefix = `JE-${period}-`;

//   const latest = await JournalEntry.findOne({ entryNumber: { $regex: `^${prefix}` } })
//     .sort({ createdAt: -1 })
//     .session(session || null)
//     .lean();

//   let nextCounter = 1;
//   if (latest?.entryNumber) {
//     const parts = latest.entryNumber.split('-');
//     const counter = Number(parts[2]);
//     if (!Number.isNaN(counter)) nextCounter = counter + 1;
//   }

//   return `${prefix}${String(nextCounter).padStart(5, '0')}`;
// }


async function nextEntryNumber() {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const counterId = `JE-${period}`;
 
  const counter = await Counter.findByIdAndUpdate(
    counterId,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
 
  return `JE-${period}-${String(counter.seq).padStart(5, '0')}`;
}

async function ensureDefaultChart() {
  let created = 0;
  for (const account of DEFAULT_CHART) {
    const result = await Account.updateOne(
      { code: account.code },
      { $setOnInsert: account },
      { upsert: true }
    );

    if (result.upsertedCount > 0) created += 1;
  }

  return {
    created,
    message: created > 0 ? 'Default chart of accounts initialized/updated' : 'Chart of accounts already initialized'
  };
}

async function ensureDefaultRules() {
  let created = 0;

  for (const rule of DEFAULT_RULES) {
    const result = await AccountingRule.updateOne(
      { documentType: rule.documentType, sourceType: rule.sourceType, name: rule.name },
      { $setOnInsert: rule },
      { upsert: true }
    );

    if (result.upsertedCount > 0) created += 1;
  }

  return {
    created,
    message: created > 0 ? 'Default accounting rules initialized' : 'Accounting rules already initialized'
  };
}

async function getActiveRule(documentType, sourceType = '') {
  const primary = await AccountingRule.findOne({
    documentType,
    sourceType,
    isActive: true
  }).sort({ priority: 1, createdAt: 1 });

  if (primary) return primary;

  return AccountingRule.findOne({
    documentType,
    isActive: true
  }).sort({ priority: 1, createdAt: 1 });
}

async function postByRule({
  documentType,
  sourceType,
  sourceId,
  date,
  description,
  context,
  userId,
  auditModel
}) {
  await ensureDefaultChart();
  await ensureDefaultRules();

  const existing = await JournalEntry.findOne({ sourceType, sourceId, status: 'posted' });
  if (existing) {
    await stampAccountingAudit(auditModel, sourceId, sourceType, existing);
    return existing;
  }

  const rule = await getActiveRule(documentType, sourceType);
  if (!rule) {
    throw new Error(`No active accounting rule found for ${documentType}`);
  }

  const lines = await buildJournalLinesFromRule(rule, context);

  const entry = await createJournalEntry({
    date,
    description,
    sourceType,
    sourceId,
    lines
  }, userId);

  await stampAccountingAudit(auditModel, sourceId, sourceType, entry);
  return entry;
}

async function getAccountByCode(code) {
  const account = await Account.findOne({ code, isActive: true });
  if (!account) {
    throw new Error(`Account not found for code ${code}. Initialize chart first.`);
  }
  return account;
}

async function createJournalEntry({ date, description, sourceType = 'manual', sourceId = null, lines }, userId) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('Journal entry requires at least 2 lines');
  }

  const sanitized = lines.map((line) => ({
    account: line.account,
    description: line.description || '',
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0
  }));

  const postingDate = date || new Date();
  await ensureOpenPeriod(postingDate);

  const entryNumber = await nextEntryNumber();

  const journalEntry = await JournalEntry.create({
    entryNumber,
    date: postingDate,
    description,
    sourceType,
    sourceId,
    lines: sanitized,
    postedBy: userId
  });

  return journalEntry;
}

async function reverseJournalEntry(entryId, userId, { reason = '', reversalDate = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(entryId)) {
    throw new Error('Invalid journal entry ID');
  }

  const original = await JournalEntry.findById(entryId).lean();
  if (!original) {
    throw new Error('Original journal entry not found');
  }

  if (original.isReversal) {
    throw new Error('Cannot reverse a reversal entry');
  }

  const existingReversal = await JournalEntry.findOne({ reversalOf: original._id, status: 'posted' }).lean();
  if (existingReversal) {
    return existingReversal;
  }

  const lines = (original.lines || []).map((line) => ({
    account: line.account,
    description: `Reversal of ${original.entryNumber}${line.description ? ` - ${line.description}` : ''}`,
    debit: Number(line.credit || 0),
    credit: Number(line.debit || 0)
  }));

  const description = `Reversal entry for ${original.entryNumber}${reason ? `: ${reason}` : ''}`;
  const entryNumber = await nextEntryNumber();
  const dateToUse = reversalDate ? new Date(reversalDate) : new Date();

  await ensureOpenPeriod(dateToUse);

  return JournalEntry.create({
    entryNumber,
    date: dateToUse,
    description,
    sourceType: 'reversal',
    sourceId: original.sourceId || null,
    lines,
    postedBy: userId,
    isReversal: true,
    reversalOf: original._id,
    reversalReason: reason || ''
  });
}

async function postCashRequestDisbursement(requestId, userId) {
  const request = await CashRequest.findById(requestId).lean();
  if (!request) throw new Error('Cash request not found');

  const amount = Number(request.totalDisbursed || 0);
  if (amount <= 0) throw new Error('Cash request has no disbursed amount to post');

  return postByRule({
    documentType: 'cash_disbursement',
    sourceType: 'cash_request_disbursement',
    sourceId: request._id,
    date: new Date(),
    description: `Cash disbursement posted for ${request.displayId || request._id}`,
    context: {
      grossAmount: amount,
      netAmount: amount,
      taxAmount: 0
    },
    userId,
    auditModel: CashRequest
  });
}

async function postSupplierInvoice(invoiceId, userId) {
  const invoice = await SupplierInvoice.findById(invoiceId).lean();
  if (!invoice) throw new Error('Supplier invoice not found');

  const grossAmount = Number(invoice.invoiceAmount || 0);
  if (grossAmount <= 0) throw new Error('Supplier invoice amount must be greater than zero');
  const taxAmount = Number(invoice.taxAmount || 0);
  const netAmount = Number(invoice.netAmount || (grossAmount - taxAmount));

  return postByRule({
    documentType: 'supplier_bill',
    sourceType: 'supplier_invoice',
    sourceId: invoice._id,
    date: invoice.invoiceDate || new Date(),
    description: `Supplier invoice ${invoice.invoiceNumber || invoice._id}`,
    context: {
      grossAmount,
      netAmount,
      taxAmount,
      invoice
    },
    userId,
    auditModel: SupplierInvoice
  });
}

async function postCustomerInvoice(invoiceId, userId) {
  const invoice = await Invoice.findById(invoiceId).lean();
  if (!invoice) throw new Error('Customer invoice not found');

  const grossAmount = Number(invoice.totalAmount || 0);
  if (grossAmount <= 0) throw new Error('Customer invoice amount must be greater than zero');
  const taxAmount = Number(invoice.taxAmount || 0);
  const netAmount = Number(invoice.netAmount || (grossAmount - taxAmount));

  return postByRule({
    documentType: 'sales_invoice',
    sourceType: 'customer_invoice',
    sourceId: invoice._id,
    date: invoice.invoiceDate || new Date(),
    description: `Customer invoice ${invoice.invoiceNumber || invoice._id}`,
    context: {
      grossAmount,
      netAmount,
      taxAmount,
      invoice
    },
    userId,
    auditModel: Invoice
  });
}

async function postSalaryPayment(paymentId, userId) {
  const payment = await SalaryPayment.findById(paymentId).lean();
  if (!payment) throw new Error('Salary payment not found');

  const amount = Number(payment.totalAmount || 0);
  if (amount <= 0) throw new Error('Salary payment amount must be greater than zero');

  return postByRule({
    documentType: 'salary_payment',
    sourceType: 'salary_payment',
    sourceId: payment._id,
    date: payment.processedAt || new Date(),
    description: `Salary payment ${payment.paymentPeriod?.month || ''}/${payment.paymentPeriod?.year || ''}`,
    context: {
      grossAmount: amount,
      netAmount: amount,
      taxAmount: 0,
      payment
    },
    userId,
    auditModel: SalaryPayment
  });
}

async function postPartialInvoice(invoiceId, paymentTermIndex, userId) {
  const Invoice = require('../models/Invoice');
 
  const invoice = await Invoice.findById(invoiceId).lean();
  if (!invoice) throw new Error('Invoice not found');
 
  const term = (invoice.paymentTermsBreakdown || [])[paymentTermIndex];
  if (!term) throw new Error(`Payment term at index ${paymentTermIndex} not found`);
 
  // Check if already invoiced
  const alreadyInvoiced = (invoice.paymentTermsInvoiced || []).some(
    (t) => t.termIndex === paymentTermIndex
  );
  if (alreadyInvoiced) throw new Error('This payment term has already been invoiced');
 
  const percentage = Number(term.percentage || 0);
  if (percentage <= 0) throw new Error('Payment term percentage must be greater than zero');
 
  const baseAmount = Number(invoice.totalAmount || 0);
  const grossAmount = roundAmount((baseAmount * percentage) / 100);
  if (grossAmount <= 0) throw new Error('Calculated invoice amount is zero');
 
  const taxRate = 19.25;
  const taxAmount = roundAmount(grossAmount * (taxRate / (100 + taxRate)));
  const netAmount = roundAmount(grossAmount - taxAmount);
 
  // Use composite sourceId so each term gets its own unique entry
  const compositeSourceId = `${invoiceId}_term_${paymentTermIndex}`;
 
  // Check idempotency using entryNumber prefix in description (sourceId is string not ObjectId here)
  const existing = await JournalEntry.findOne({
    sourceType: 'partial_customer_invoice',
    description: { $regex: compositeSourceId }
  });
  if (existing) return existing;
 
  const lines = await buildJournalLinesFromRule(
    await getActiveRule('partial_customer_invoice', 'partial_customer_invoice'),
    { grossAmount, netAmount, taxAmount }
  );
 
  const entryNumber = await nextEntryNumber();
  await ensureOpenPeriod(new Date());
 
  const entry = await JournalEntry.create({
    entryNumber,
    date: new Date(),
    description: `Partial invoice ${term.description || ''} (${percentage}%) - Invoice ${invoice.invoiceNumber} [${compositeSourceId}]`,
    sourceType: 'partial_customer_invoice',
    sourceId: invoiceId,
    lines,
    postedBy: userId
  });
 
  // Mark the term as invoiced on the Invoice document
  await Invoice.findByIdAndUpdate(invoiceId, {
    $push: {
      paymentTermsInvoiced: {
        termIndex: paymentTermIndex,
        description: term.description,
        percentage
      }
    },
    $set: {
      accountingAudit: {
        isPosted: true,
        postedAt: new Date(),
        entryId: entry._id,
        entryNumber: entry.entryNumber,
        sourceType: 'partial_customer_invoice'
      }
    }
  });
 
  return entry;
}

async function postCompletionItemRecognized(planId, itemId, userId) {
  const ProjectPlan = require('../models/ProjectPlan');
 
  const plan = await ProjectPlan.findById(planId).lean();
  if (!plan) throw new Error('Project plan not found');
 
  const item = (plan.completionItems || []).find(
    (i) => String(i._id) === String(itemId)
  );
  if (!item) throw new Error('Completion item not found');
  if (!item.isCompleted) throw new Error('Completion item is not marked complete');
 
  // Derive amount: use linked invoice total if available, else use a
  // proportional share of the plan's estimated value or fall back to 0.
  // A zero amount is skipped gracefully.
  let grossAmount = 0;
 
  if (plan.estimatedValue) {
    const totalItems = (plan.completionItems || []).length || 1;
    grossAmount = roundAmount(Number(plan.estimatedValue) / totalItems);
  } else if (plan.totalAmount) {
    const totalItems = (plan.completionItems || []).length || 1;
    grossAmount = roundAmount(Number(plan.totalAmount) / totalItems);
  }
 
  if (grossAmount <= 0) {
    console.warn(`postCompletionItemRecognized: no amount derivable for plan ${planId}, item ${itemId}. Skipping.`);
    return null;
  }
 
  const compositeDesc = `${planId}_item_${itemId}`;
  const existing = await JournalEntry.findOne({
    sourceType: 'project_plan_completion',
    description: { $regex: compositeDesc }
  });
  if (existing) return existing;
 
  const rule = await getActiveRule('completion_milestone', 'project_plan_completion');
  if (!rule) throw new Error('No active rule for completion_milestone');
 
  const lines = await buildJournalLinesFromRule(rule, {
    grossAmount,
    netAmount: grossAmount,
    taxAmount: 0
  });
 
  const entryNumber = await nextEntryNumber();
  await ensureOpenPeriod(new Date());
 
  const entry = await JournalEntry.create({
    entryNumber,
    date: new Date(),
    description: `Milestone: ${item.description} [${compositeDesc}]`,
    sourceType: 'project_plan_completion',
    sourceId: planId,
    lines,
    postedBy: userId
  });
 
  // Stamp accountingAudit on ProjectPlan
  await ProjectPlan.findByIdAndUpdate(planId, {
    $set: {
      accountingAudit: {
        isPosted: true,
        postedAt: new Date(),
        entryId: entry._id,
        entryNumber: entry.entryNumber,
        sourceType: 'project_plan_completion'
      }
    }
  });
 
  return entry;
}


async function getTrialBalance({ startDate, endDate }) {
  const filter = { status: 'posted' };
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }

  const entries = await JournalEntry.find(filter)
    .populate('lines.account', 'code name type normalBalance')
    .lean();

  const buckets = new Map();

  entries.forEach((entry) => {
    (entry.lines || []).forEach((line) => {
      if (!line.account) return;

      const key = String(line.account._id);
      if (!buckets.has(key)) {
        buckets.set(key, {
          accountId: line.account._id,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
          debit: 0,
          credit: 0
        });
      }

      const bucket = buckets.get(key);
      bucket.debit += Number(line.debit || 0);
      bucket.credit += Number(line.credit || 0);
    });
  });

  const lines = Array.from(buckets.values())
    .map((item) => {
      const net = Number((item.debit - item.credit).toFixed(2));
      return {
        ...item,
        debitBalance: net > 0 ? net : 0,
        creditBalance: net < 0 ? Math.abs(net) : 0
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const totals = lines.reduce((sum, line) => {
    sum.debit += line.debitBalance;
    sum.credit += line.creditBalance;
    return sum;
  }, { debit: 0, credit: 0 });

  totals.debit = Number(totals.debit.toFixed(2));
  totals.credit = Number(totals.credit.toFixed(2));

  return { lines, totals, isBalanced: totals.debit === totals.credit };
}

async function getGeneralLedger(accountId, { startDate, endDate }) {
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw new Error('Invalid account ID');
  }

  const account = await Account.findById(accountId).lean();
  if (!account) throw new Error('Account not found');

  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const openingFilter = {
    status: 'posted',
    'lines.account': account._id
  };
  if (startDate) {
    openingFilter.date = { $lt: new Date(startDate) };
  }

  const openingEntries = await JournalEntry.find(openingFilter).lean();
  let openingBalance = 0;
  openingEntries.forEach((entry) => {
    const lines = (entry.lines || []).filter((line) => String(line.account) === String(account._id));
    lines.forEach((line) => {
      openingBalance += (Number(line.debit || 0) - Number(line.credit || 0));
    });
  });

  const txFilter = {
    status: 'posted',
    'lines.account': account._id
  };
  if (Object.keys(dateFilter).length > 0) txFilter.date = dateFilter;

  const entries = await JournalEntry.find(txFilter)
    .sort({ date: 1, createdAt: 1 })
    .lean();

  let running = Number(openingBalance.toFixed(2));
  const transactions = [];

  entries.forEach((entry) => {
    const lines = (entry.lines || []).filter((line) => String(line.account) === String(account._id));
    lines.forEach((line) => {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      running = Number((running + debit - credit).toFixed(2));

      transactions.push({
        date: entry.date,
        entryNumber: entry.entryNumber,
        description: entry.description,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        lineDescription: line.description || '',
        debit,
        credit,
        runningBalance: running
      });
    });
  });

  return {
    account: {
      _id: account._id,
      code: account.code,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance
    },
    openingBalance: Number(openingBalance.toFixed(2)),
    closingBalance: Number(running.toFixed(2)),
    transactions
  };
}

async function getProfitAndLoss({ startDate, endDate }) {
  const filter = { status: 'posted' };
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }
 
  const entries = await JournalEntry.find(filter)
    .populate('lines.account', 'code name type subType normalBalance')
    .lean();
 
  const buckets = new Map();
 
  entries.forEach((entry) => {
    (entry.lines || []).forEach((line) => {
      if (!line.account) return;
      if (!['revenue', 'expense'].includes(line.account.type)) return;
 
      const key = String(line.account._id);
      if (!buckets.has(key)) {
        buckets.set(key, {
          accountId: line.account._id,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
          subType: line.account.subType || '',
          debit: 0,
          credit: 0
        });
      }
 
      const b = buckets.get(key);
      b.debit += Number(line.debit || 0);
      b.credit += Number(line.credit || 0);
    });
  });
 
  const lines = Array.from(buckets.values()).map((item) => ({
    ...item,
    balance: roundAmount(item.credit - item.debit) // credit-normal for revenue, inverted for expense
  }));
 
  const revenueLines = lines
    .filter((l) => l.type === 'revenue')
    .sort((a, b) => a.code.localeCompare(b.code));
 
  const expenseLines = lines
    .filter((l) => l.type === 'expense')
    .sort((a, b) => a.code.localeCompare(b.code));
 
  const totalRevenue = roundAmount(revenueLines.reduce((s, l) => s + l.balance, 0));
  const totalExpenses = roundAmount(expenseLines.reduce((s, l) => s + Math.abs(l.balance), 0));
  const netProfit = roundAmount(totalRevenue - totalExpenses);
 
  return {
    revenueLines,
    expenseLines,
    totalRevenue,
    totalExpenses,
    netProfit,
    isProfit: netProfit >= 0
  };
}
 
async function getBalanceSheet({ asOfDate }) {
  const filter = { status: 'posted' };
  if (asOfDate) filter.date = { $lte: new Date(asOfDate) };
 
  const entries = await JournalEntry.find(filter)
    .populate('lines.account', 'code name type subType normalBalance')
    .lean();
 
  const buckets = new Map();
 
  entries.forEach((entry) => {
    (entry.lines || []).forEach((line) => {
      if (!line.account) return;
      if (!['asset', 'liability', 'equity'].includes(line.account.type)) return;
 
      const key = String(line.account._id);
      if (!buckets.has(key)) {
        buckets.set(key, {
          accountId: line.account._id,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
          subType: line.account.subType || '',
          normalBalance: line.account.normalBalance,
          debit: 0,
          credit: 0
        });
      }
 
      const b = buckets.get(key);
      b.debit += Number(line.debit || 0);
      b.credit += Number(line.credit || 0);
    });
  });
 
  const lines = Array.from(buckets.values()).map((item) => {
    const net = roundAmount(item.debit - item.credit);
    return {
      ...item,
      balance: item.normalBalance === 'debit' ? net : roundAmount(item.credit - item.debit)
    };
  });
 
  const assetLines = lines.filter((l) => l.type === 'asset').sort((a, b) => a.code.localeCompare(b.code));
  const liabilityLines = lines.filter((l) => l.type === 'liability').sort((a, b) => a.code.localeCompare(b.code));
  const equityLines = lines.filter((l) => l.type === 'equity').sort((a, b) => a.code.localeCompare(b.code));
 
  const totalAssets = roundAmount(assetLines.reduce((s, l) => s + l.balance, 0));
  const totalLiabilities = roundAmount(liabilityLines.reduce((s, l) => s + l.balance, 0));
  const totalEquity = roundAmount(equityLines.reduce((s, l) => s + l.balance, 0));
  const totalLiabEquity = roundAmount(totalLiabilities + totalEquity);
 
  return {
    assetLines,
    liabilityLines,
    equityLines,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabEquity,
    isBalanced: totalAssets === totalLiabEquity
  };
}


// ── AUDIT HELPER ─────────────────────────────────────────────────────────────
 
async function logAudit(action, entityType, entityId, userId, description = '', metadata = {}) {
  try {
    await AuditLog.create({ action, performedBy: userId, entityType, entityId, description, metadata });
  } catch (err) {
    console.warn('Audit log failed (non-blocking):', err.message);
  }
}
 
 
// ── PRIORITY 1: PAYMENT RECEIPTS ─────────────────────────────────────────────
 
async function nextPaymentNumber() {
  const Counter = require('../models/Counter');
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const counterId = `PAY-${period}`;
  const counter = await Counter.findByIdAndUpdate(
    counterId,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `PAY-${period}-${String(counter.seq).padStart(5, '0')}`;
}
 
async function createPayment({ type, invoiceId, supplierInvoiceId, customerId, supplierId,
  amount, paymentDate, paymentMethod, bankAccount, reference, notes }, userId) {
  const paymentNumber = await nextPaymentNumber();
  const payment = await Payment.create({
    paymentNumber, type, invoiceId: invoiceId || null,
    supplierInvoiceId: supplierInvoiceId || null,
    customerId: customerId || null, supplierId: supplierId || null,
    amount: Number(amount), paymentDate: paymentDate || new Date(),
    paymentMethod, bankAccount: bankAccount || '1010',
    reference: reference || '', notes: notes || '', recordedBy: userId
  });
  await logAudit('payment_recorded', 'Payment', payment._id, userId,
    `${type} of ${amount} recorded`, { paymentNumber });
  return payment;
}
 
async function postPaymentReceipt(paymentId, userId) {
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw new Error('Payment not found');
  if (payment.type !== 'receipt') throw new Error('Payment is not a receipt');
 
  const amount = Number(payment.amount);
  if (amount <= 0) throw new Error('Payment amount must be greater than zero');
 
  const entry = await postByRule({
    documentType: 'payment_receipt',
    sourceType: 'payment_receipt',
    sourceId: payment._id,
    date: payment.paymentDate || new Date(),
    description: `Customer receipt ${payment.paymentNumber}${payment.reference ? ' - ' + payment.reference : ''}`,
    context: { grossAmount: amount, netAmount: amount, taxAmount: 0 },
    userId,
    auditModel: Payment
  });
 
  // Mark invoice as paid if fully covered
  if (payment.invoiceId) {
    const Invoice = require('../models/Invoice');
    const invoice = await Invoice.findById(payment.invoiceId).lean();
    if (invoice) {
      const allPayments = await Payment.find({
        invoiceId: payment.invoiceId, type: 'receipt'
      }).lean();
      const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0);
      if (totalPaid >= Number(invoice.totalAmount || 0)) {
        await Invoice.findByIdAndUpdate(payment.invoiceId, { $set: { status: 'paid', approvalStatus: 'processed' } });
      }
    }
  }
 
  await logAudit('payment_posted', 'Payment', payment._id, userId,
    `Receipt ${payment.paymentNumber} posted`, { entryNumber: entry.entryNumber });
  return entry;
}
 
async function postSupplierPayment(paymentId, userId) {
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw new Error('Payment not found');
  if (payment.type !== 'disbursement') throw new Error('Payment is not a disbursement');
 
  const amount = Number(payment.amount);
  if (amount <= 0) throw new Error('Payment amount must be greater than zero');
 
  const entry = await postByRule({
    documentType: 'supplier_payment',
    sourceType: 'supplier_payment',
    sourceId: payment._id,
    date: payment.paymentDate || new Date(),
    description: `Supplier payment ${payment.paymentNumber}${payment.reference ? ' - ' + payment.reference : ''}`,
    context: { grossAmount: amount, netAmount: amount, taxAmount: 0 },
    userId,
    auditModel: Payment
  });
 
  await logAudit('payment_posted', 'Payment', payment._id, userId,
    `Supplier payment ${payment.paymentNumber} posted`, { entryNumber: entry.entryNumber });
  return entry;
}
 
async function listPayments({ type, startDate, endDate, invoiceId, supplierInvoiceId, page = 1, limit = 20 }) {
  const filter = {};
  if (type) filter.type = type;
  if (invoiceId) filter.invoiceId = invoiceId;
  if (supplierInvoiceId) filter.supplierInvoiceId = supplierInvoiceId;
  if (startDate || endDate) {
    filter.paymentDate = {};
    if (startDate) filter.paymentDate.$gte = new Date(startDate);
    if (endDate) filter.paymentDate.$lte = new Date(endDate);
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate('recordedBy', 'fullName email')
      .populate('invoiceId', 'invoiceNumber totalAmount')
      .populate('supplierInvoiceId', 'invoiceNumber invoiceAmount')
      .sort({ paymentDate: -1 })
      .skip(skip).limit(Number(limit)),
    Payment.countDocuments(filter)
  ]);
  return { payments, total, page: Number(page), pages: Math.ceil(total / Number(limit)) };
}
 
 
// ── PRIORITY 2: AGED RECEIVABLES & PAYABLES ──────────────────────────────────
 
function ageLabel(daysDiff) {
  if (daysDiff <= 0)  return 'current';
  if (daysDiff <= 30) return 'days30';
  if (daysDiff <= 60) return 'days60';
  if (daysDiff <= 90) return 'days90';
  return 'over90';
}
 
async function getAgedReceivables({ asOfDate } = {}) {
  const Invoice = require('../models/Invoice');
  const ref = asOfDate ? new Date(asOfDate) : new Date();
 
  const invoices = await Invoice.find({
    approvalStatus: { $nin: ['processed'] },
    status: { $nin: ['paid'] },
    totalAmount: { $gt: 0 }
  }).populate('customer', 'name email').lean();
 
  const customerMap = new Map();
 
  for (const inv of invoices) {
    const due = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.uploadedDate || inv.createdAt);
    const daysPast = Math.floor((ref - due) / (1000 * 60 * 60 * 24));
    const bucket = ageLabel(daysPast);
    const amount = roundAmount(Number(inv.totalAmount || 0));
    const key = String(inv.customer?._id || inv.customerDetails?.name || 'unknown');
    const name = inv.customer?.name || inv.customerDetails?.name || 'Unknown Customer';
 
    if (!customerMap.has(key)) {
      customerMap.set(key, { customerId: key, customerName: name, current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 });
    }
    const row = customerMap.get(key);
    row[bucket] = roundAmount(row[bucket] + amount);
    row.total = roundAmount(row.total + amount);
  }
 
  const rows = Array.from(customerMap.values()).sort((a, b) => b.total - a.total);
  const grandTotal = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
  rows.forEach(r => {
    ['current','days30','days60','days90','over90','total'].forEach(k => {
      grandTotal[k] = roundAmount(grandTotal[k] + r[k]);
    });
  });
  return { rows, grandTotal, asOfDate: ref };
}
 
async function getAgedPayables({ asOfDate } = {}) {
  const SupplierInvoice = require('../models/SupplierInvoice');
  const ref = asOfDate ? new Date(asOfDate) : new Date();
 
  const invoices = await SupplierInvoice.find({
    status: { $nin: ['paid', 'cancelled'] },
    invoiceAmount: { $gt: 0 }
  }).populate('supplier', 'name email').lean();
 
  const supplierMap = new Map();
 
  for (const inv of invoices) {
    const due = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate || inv.createdAt);
    const daysPast = Math.floor((ref - due) / (1000 * 60 * 60 * 24));
    const bucket = ageLabel(daysPast);
    const amount = roundAmount(Number(inv.invoiceAmount || 0));
    const key = String(inv.supplier?._id || inv.supplierDetails?.name || 'unknown');
    const name = inv.supplier?.name || inv.supplierDetails?.name || 'Unknown Supplier';
 
    if (!supplierMap.has(key)) {
      supplierMap.set(key, { supplierId: key, supplierName: name, current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 });
    }
    const row = supplierMap.get(key);
    row[bucket] = roundAmount(row[bucket] + amount);
    row.total = roundAmount(row.total + amount);
  }
 
  const rows = Array.from(supplierMap.values()).sort((a, b) => b.total - a.total);
  const grandTotal = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
  rows.forEach(r => {
    ['current','days30','days60','days90','over90','total'].forEach(k => {
      grandTotal[k] = roundAmount(grandTotal[k] + r[k]);
    });
  });
  return { rows, grandTotal, asOfDate: ref };
}
 
 
// ── PRIORITY 3: MAKER-CHECKER FOR MANUAL JOURNALS ────────────────────────────
 
async function createDraftJournalEntry({ date, description, lines }, userId) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('Journal entry requires at least 2 lines');
  }
  const sanitized = lines.map(line => ({
    account: line.account,
    description: line.description || '',
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0
  }));
 
  const postingDate = date || new Date();
  await ensureOpenPeriod(postingDate);
  const entryNumber = await nextEntryNumber();
 
  const entry = await JournalEntry.create({
    entryNumber, date: postingDate, description,
    sourceType: 'manual', lines: sanitized,
    postedBy: userId,
    status: 'draft'   // manual entries start as draft
  });
 
  await logAudit('journal_submitted', 'JournalEntry', entry._id, userId,
    `Draft ${entryNumber} created`);
  return entry;
}
 
async function submitJournalForReview(entryId, userId) {
  const entry = await JournalEntry.findById(entryId);
  if (!entry) throw new Error('Journal entry not found');
  if (entry.status !== 'draft') throw new Error('Only draft entries can be submitted for review');
  if (String(entry.postedBy) !== String(userId)) throw new Error('Only the maker can submit for review');
 
  entry.status = 'pending_approval';
  entry.submittedBy = userId;
  entry.submittedAt = new Date();
  await entry.save();
 
  await logAudit('journal_submitted', 'JournalEntry', entry._id, userId,
    `${entry.entryNumber} submitted for review`);
  return entry;
}
 
async function approveJournal(entryId, reviewerId) {
  const entry = await JournalEntry.findById(entryId);
  if (!entry) throw new Error('Journal entry not found');
  if (entry.status !== 'pending_approval') throw new Error('Entry is not pending approval');
  if (String(entry.postedBy) === String(reviewerId)) throw new Error('Maker cannot approve their own entry');
 
  entry.status = 'posted';
  entry.reviewedBy = reviewerId;
  entry.reviewedAt = new Date();
  await entry.save();
 
  await logAudit('journal_approved', 'JournalEntry', entry._id, reviewerId,
    `${entry.entryNumber} approved and posted`);
  return entry;
}
 
async function rejectJournal(entryId, reviewerId, reason) {
  const entry = await JournalEntry.findById(entryId);
  if (!entry) throw new Error('Journal entry not found');
  if (entry.status !== 'pending_approval') throw new Error('Entry is not pending approval');
 
  entry.status = 'draft';
  entry.reviewedBy = reviewerId;
  entry.reviewedAt = new Date();
  entry.reviewComments = reason || '';
  await entry.save();
 
  await logAudit('journal_rejected', 'JournalEntry', entry._id, reviewerId,
    `${entry.entryNumber} rejected: ${reason}`);
  return entry;
}
 
 
// ── PRIORITY 4: VAT RETURN ───────────────────────────────────────────────────
 
async function getVATReturn({ startDate, endDate } = {}) {
  const filter = { status: 'posted' };
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate)   filter.date.$lte = new Date(endDate);
  }
 
  const entries = await JournalEntry.find(filter)
    .populate('lines.account', 'code name type')
    .lean();
 
  let outputVAT = 0;   // credits to 2200 (VAT collected from customers)
  let inputVAT  = 0;   // debits  to 1300 (VAT paid to suppliers)
  const outputLines = [];
  const inputLines  = [];
 
  entries.forEach(entry => {
    (entry.lines || []).forEach(line => {
      if (!line.account) return;
      if (line.account.code === '2200' && line.credit > 0) {
        outputVAT += Number(line.credit);
        outputLines.push({ date: entry.date, entryNumber: entry.entryNumber, description: entry.description, amount: line.credit });
      }
      if (line.account.code === '1300' && line.debit > 0) {
        inputVAT += Number(line.debit);
        inputLines.push({ date: entry.date, entryNumber: entry.entryNumber, description: entry.description, amount: line.debit });
      }
    });
  });
 
  outputVAT = roundAmount(outputVAT);
  inputVAT  = roundAmount(inputVAT);
  const netVATDue = roundAmount(outputVAT - inputVAT);
 
  return { outputVAT, inputVAT, netVATDue, outputLines, inputLines, isRefund: netVATDue < 0 };
}
 
 
// ── PRIORITY 5: DASHBOARD KPIs ───────────────────────────────────────────────
 
async function getDashboardKPIs() {
  const Invoice = require('../models/Invoice');
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
 
  const [
    trialBal,
    plThisMonth,
    overdueInvoices,
    pendingJournals,
    totalPayments
  ] = await Promise.all([
    getTrialBalance({}),
    getProfitAndLoss({ startDate: firstOfMonth, endDate: endOfMonth }),
    Invoice.countDocuments({ dueDate: { $lt: now }, status: { $nin: ['paid'] }, approvalStatus: { $nin: ['processed'] } }),
    JournalEntry.countDocuments({ status: 'pending_approval' }),
    Payment.countDocuments({ paymentDate: { $gte: firstOfMonth } })
  ]);
 
  const findBalance = (code) => {
    const line = trialBal.lines.find(l => l.code === code);
    return line ? roundAmount((line.debitBalance || 0) - (line.creditBalance || 0)) : 0;
  };
  const absBalance = (code) => {
    const line = trialBal.lines.find(l => l.code === code);
    if (!line) return 0;
    return roundAmount(Math.abs((line.debitBalance || 0) - (line.creditBalance || 0)));
  };
 
  const cashBalance      = roundAmount(absBalance('1000') + absBalance('1010'));
  const totalReceivables = absBalance('1100');
  const totalPayables    = absBalance('2000');
 
  return {
    cashBalance,
    totalReceivables,
    totalPayables,
    revenueThisMonth:  roundAmount(plThisMonth.totalRevenue),
    expensesThisMonth: roundAmount(plThisMonth.totalExpenses),
    netProfitThisMonth: roundAmount(plThisMonth.netProfit),
    overdueInvoices,
    pendingJournals,
    totalPaymentsThisMonth: totalPayments,
    isProfit: plThisMonth.isProfit,
    asOf: now
  };
}
 
 
// ── PRIORITY 6: CASH FLOW STATEMENT ──────────────────────────────────────────
 
async function getCashFlowStatement({ startDate, endDate } = {}) {
  const [pl, openingTB, closingTB] = await Promise.all([
    getProfitAndLoss({ startDate, endDate }),
    getTrialBalance({ endDate: startDate ? new Date(new Date(startDate) - 1) : undefined }),
    getTrialBalance({ endDate: endDate ? new Date(endDate) : new Date() })
  ]);
 
  const getNetBalance = (tb, code) => {
    const line = tb.lines.find(l => l.code === code);
    if (!line) return 0;
    return roundAmount((line.debitBalance || 0) - (line.creditBalance || 0));
  };
 
  // Operating activities (indirect method)
  const netProfit = pl.netProfit;
 
  const arOpen  = getNetBalance(openingTB, '1100');
  const arClose = getNetBalance(closingTB,  '1100');
  const arChange = roundAmount(arOpen - arClose);   // decrease in AR = cash inflow
 
  const apOpen  = Math.abs(getNetBalance(openingTB, '2000'));
  const apClose = Math.abs(getNetBalance(closingTB,  '2000'));
  const apChange = roundAmount(apClose - apOpen);   // increase in AP = cash inflow
 
  const accruedOpen  = Math.abs(getNetBalance(openingTB, '2100'));
  const accruedClose = Math.abs(getNetBalance(closingTB,  '2100'));
  const accruedChange = roundAmount(accruedClose - accruedOpen);
 
  const operatingTotal = roundAmount(netProfit + arChange + apChange + accruedChange);
 
  // Investing activities (changes in fixed assets 1500)
  const faOpen  = getNetBalance(openingTB, '1500');
  const faClose = getNetBalance(closingTB,  '1500');
  const investingTotal = roundAmount(faOpen - faClose);  // decrease in FA = cash inflow
 
  // Financing activities (changes in equity 3000)
  const eqOpen  = Math.abs(getNetBalance(openingTB, '3000'));
  const eqClose = Math.abs(getNetBalance(closingTB,  '3000'));
  const financingTotal = roundAmount(eqClose - eqOpen);
 
  const netCashChange = roundAmount(operatingTotal + investingTotal + financingTotal);
 
  const openingCash = roundAmount(
    Math.abs(getNetBalance(openingTB, '1000')) + Math.abs(getNetBalance(openingTB, '1010'))
  );
  const closingCash = roundAmount(openingCash + netCashChange);
 
  return {
    operating: {
      netProfit,
      arChange,
      apChange,
      accruedChange,
      total: operatingTotal
    },
    investing: {
      fixedAssetChange: investingTotal,
      total: investingTotal
    },
    financing: {
      equityChange: financingTotal,
      total: financingTotal
    },
    netCashChange,
    openingCash,
    closingCash
  };
}
 
 
// ── PRIORITY 7: BANK RECONCILIATION ──────────────────────────────────────────
 
async function importBankTransactions(rows, accountCode, importBatch, userId) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows to import');
 
  const docs = rows.map(row => ({
    accountCode: accountCode || '1010',
    date: new Date(row.date),
    description: String(row.description || '').trim(),
    amount: Math.abs(Number(row.amount)),
    type: Number(row.amount) >= 0 ? 'credit' : 'debit',
    reference: String(row.reference || '').trim(),
    importBatch
  }));
 
  const inserted = await BankTransaction.insertMany(docs, { ordered: false });
  await logAudit('bank_transaction_imported', 'BankTransaction', null, userId,
    `${inserted.length} transactions imported (batch: ${importBatch})`);
  return { imported: inserted.length };
}
 
async function reconcileTransaction(bankTxId, journalEntryId, userId) {
  const [tx, entry] = await Promise.all([
    BankTransaction.findById(bankTxId),
    JournalEntry.findById(journalEntryId)
  ]);
  if (!tx)    throw new Error('Bank transaction not found');
  if (!entry) throw new Error('Journal entry not found');
  if (tx.isReconciled) throw new Error('Transaction already reconciled');
 
  tx.isReconciled    = true;
  tx.matchedEntryId  = entry._id;
  tx.reconciledAt    = new Date();
  tx.reconciledBy    = userId;
  await tx.save();
 
  await logAudit('bank_transaction_reconciled', 'BankTransaction', tx._id, userId,
    `Tx matched to ${entry.entryNumber}`);
  return tx;
}
 
async function getReconciliationSummary(accountCode, { startDate, endDate } = {}) {
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate)   dateFilter.$lte = new Date(endDate);
 
  const [reconciledTx, unreconciledTx, ledgerData] = await Promise.all([
    BankTransaction.find({ accountCode, isReconciled: true, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) }).lean(),
    BankTransaction.find({ accountCode, isReconciled: false, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) }).lean(),
    getGeneralLedger(
      (await Account.findOne({ code: accountCode }).lean())?._id,
      { startDate, endDate }
    ).catch(() => ({ transactions: [], openingBalance: 0, closingBalance: 0 }))
  ]);
 
  const bankBalance = roundAmount(
    unreconciledTx.reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0) +
    reconciledTx.reduce((s, t)  => s + (t.type === 'credit' ? t.amount : -t.amount), 0)
  );
 
  const unreconciledLedger = (ledgerData.transactions || []).filter(t => !t.isReconciled);
 
  return {
    accountCode,
    ledgerBalance: roundAmount(ledgerData.closingBalance || 0),
    bankBalance,
    difference: roundAmount(bankBalance - (ledgerData.closingBalance || 0)),
    unreconciledBankCount: unreconciledTx.length,
    unreconciledLedgerCount: unreconciledLedger.length,
    unreconciledBank: unreconciledTx,
    reconciledCount: reconciledTx.length
  };
}
 
async function listBankTransactions({ accountCode, isReconciled, startDate, endDate, page = 1, limit = 50 }) {
  const filter = {};
  if (accountCode) filter.accountCode = accountCode;
  if (typeof isReconciled !== 'undefined') filter.isReconciled = isReconciled === 'true' || isReconciled === true;
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate)   filter.date.$lte = new Date(endDate);
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [txs, total] = await Promise.all([
    BankTransaction.find(filter).sort({ date: -1 }).skip(skip).limit(Number(limit)),
    BankTransaction.countDocuments(filter)
  ]);
  return { transactions: txs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) };
}
 
 
// ── PRIORITY 8: AUDIT LOG + EXPORTS ──────────────────────────────────────────
 
async function getAuditLog({ entityType, action, performedBy, startDate, endDate, page = 1, limit = 50 }) {
  const filter = {};
  if (entityType)   filter.entityType = entityType;
  if (action)       filter.action = action;
  if (performedBy)  filter.performedBy = performedBy;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate)   filter.createdAt.$lte = new Date(endDate);
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).populate('performedBy', 'fullName email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    AuditLog.countDocuments(filter)
  ]);
  return { logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) };
}
 
// CSV export helper — returns a CSV string
function toCSV(headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = headers.map(h => escape(h.label)).join(',');
  const body = rows.map(row => headers.map(h => escape(row[h.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}
 
async function exportTrialBalanceCSV({ startDate, endDate } = {}) {
  const data = await getTrialBalance({ startDate, endDate });
  return toCSV(
    [
      { key: 'code', label: 'Account Code' },
      { key: 'name', label: 'Account Name' },
      { key: 'type', label: 'Type' },
      { key: 'debitBalance', label: 'Debit Balance' },
      { key: 'creditBalance', label: 'Credit Balance' }
    ],
    data.lines
  );
}
 
async function exportJournalEntriesCSV({ startDate, endDate } = {}) {
  const filter = { status: 'posted' };
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate)   filter.date.$lte = new Date(endDate);
  }
  const entries = await JournalEntry.find(filter)
    .populate('lines.account', 'code name')
    .sort({ date: -1 }).lean();
 
  const rows = [];
  entries.forEach(e => {
    (e.lines || []).forEach(line => {
      rows.push({
        entryNumber: e.entryNumber,
        date: new Date(e.date).toISOString().slice(0, 10),
        description: e.description,
        sourceType: e.sourceType,
        accountCode: line.account?.code || '',
        accountName: line.account?.name || '',
        debit: line.debit || 0,
        credit: line.credit || 0
      });
    });
  });
 
  return toCSV(
    [
      { key: 'entryNumber', label: 'Entry Number' },
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
      { key: 'sourceType', label: 'Source Type' },
      { key: 'accountCode', label: 'Account Code' },
      { key: 'accountName', label: 'Account Name' },
      { key: 'debit', label: 'Debit' },
      { key: 'credit', label: 'Credit' }
    ],
    rows
  );
}
 
async function exportProfitAndLossCSV({ startDate, endDate } = {}) {
  const data = await getProfitAndLoss({ startDate, endDate });
  const rows = [
    ...data.revenueLines.map(l => ({ section: 'Revenue', code: l.code, name: l.name, amount: l.balance })),
    { section: 'TOTAL REVENUE', code: '', name: '', amount: data.totalRevenue },
    ...data.expenseLines.map(l => ({ section: 'Expense', code: l.code, name: l.name, amount: Math.abs(l.balance) })),
    { section: 'TOTAL EXPENSES', code: '', name: '', amount: data.totalExpenses },
    { section: data.isProfit ? 'NET PROFIT' : 'NET LOSS', code: '', name: '', amount: Math.abs(data.netProfit) }
  ];
  return toCSV(
    [{ key: 'section', label: 'Section' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount' }],
    rows
  );
}
 
async function exportBalanceSheetCSV({ asOfDate } = {}) {
  const data = await getBalanceSheet({ asOfDate });
  const rows = [
    ...data.assetLines.map(l => ({ section: 'Asset', code: l.code, name: l.name, amount: l.balance })),
    { section: 'TOTAL ASSETS', code: '', name: '', amount: data.totalAssets },
    ...data.liabilityLines.map(l => ({ section: 'Liability', code: l.code, name: l.name, amount: l.balance })),
    { section: 'TOTAL LIABILITIES', code: '', name: '', amount: data.totalLiabilities },
    ...data.equityLines.map(l => ({ section: 'Equity', code: l.code, name: l.name, amount: l.balance })),
    { section: 'TOTAL EQUITY', code: '', name: '', amount: data.totalEquity },
    { section: 'TOTAL LIAB + EQUITY', code: '', name: '', amount: data.totalLiabEquity }
  ];
  return toCSV(
    [{ key: 'section', label: 'Section' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'Amount' }],
    rows
  );
}

module.exports = {
  DEFAULT_CHART,
  DEFAULT_RULES,
  ensureDefaultChart,
  ensureDefaultRules,
  ensureOpenPeriod,
  setPeriodStatus,
  listPeriods,
  createJournalEntry,
  reverseJournalEntry,
  postCashRequestDisbursement,
  postSupplierInvoice,
  postCustomerInvoice,
  postSalaryPayment,
  getTrialBalance,
  getGeneralLedger,
  postPartialInvoice,
  postCompletionItemRecognized,
  getProfitAndLoss,
  getBalanceSheet,
  logAudit,
  createPayment, postPaymentReceipt, postSupplierPayment, listPayments,
  getAgedReceivables, getAgedPayables,
  createDraftJournalEntry, submitJournalForReview, approveJournal, rejectJournal,
  getVATReturn,
  getDashboardKPIs,
  getCashFlowStatement,
  importBankTransactions, reconcileTransaction, getReconciliationSummary, listBankTransactions,
  getAuditLog,
  exportTrialBalanceCSV, exportJournalEntriesCSV, exportProfitAndLossCSV, exportBalanceSheetCSV
};
