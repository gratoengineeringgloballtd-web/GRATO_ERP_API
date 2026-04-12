const express = require('express');
const Account = require('../models/Account');
const AccountingRule = require('../models/AccountingRule');
const JournalEntry = require('../models/JournalEntry');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const accountingService = require('../services/accountingService');

const router = express.Router();

router.use(authMiddleware);
router.use(requireRoles('finance', 'admin', 'ceo'));

router.post('/bootstrap/default-chart', async (req, res) => {
  try {
    const result = await accountingService.ensureDefaultChart();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to initialize chart of accounts', error: error.message });
  }
});

router.post('/bootstrap/default-rules', async (req, res) => {
  try {
    const result = await accountingService.ensureDefaultRules();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to initialize accounting rules', error: error.message });
  }
});

router.get('/rules', async (req, res) => {
  try {
    const { documentType, sourceType, active } = req.query;
    const filter = {};

    if (documentType) filter.documentType = String(documentType).toLowerCase();
    if (sourceType) filter.sourceType = sourceType;
    if (typeof active !== 'undefined') filter.isActive = active === 'true';

    const rules = await AccountingRule.find(filter).sort({ documentType: 1, priority: 1, createdAt: 1 });
    res.json({ success: true, data: rules, count: rules.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch accounting rules', error: error.message });
  }
});

router.post('/rules', async (req, res) => {
  try {
    const payload = {
      ...req.body,
      documentType: req.body.documentType ? String(req.body.documentType).toLowerCase() : req.body.documentType
    };
    const rule = await AccountingRule.create(payload);
    res.status(201).json({ success: true, data: rule, message: 'Accounting rule created' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to create accounting rule', error: error.message });
  }
});

router.put('/rules/:ruleId', async (req, res) => {
  try {
    const payload = {
      ...req.body,
      documentType: req.body.documentType ? String(req.body.documentType).toLowerCase() : req.body.documentType
    };

    const rule = await AccountingRule.findByIdAndUpdate(req.params.ruleId, payload, {
      new: true,
      runValidators: true
    });

    if (!rule) {
      return res.status(404).json({ success: false, message: 'Accounting rule not found' });
    }

    res.json({ success: true, data: rule, message: 'Accounting rule updated' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to update accounting rule', error: error.message });
  }
});

router.get('/accounts', async (req, res) => {
  try {
    const { type, active } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (typeof active !== 'undefined') filter.isActive = active === 'true';

    const accounts = await Account.find(filter).sort({ code: 1 });
    res.json({ success: true, data: accounts, count: accounts.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch accounts', error: error.message });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    const account = await Account.create(req.body);
    res.status(201).json({ success: true, data: account, message: 'Account created' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to create account', error: error.message });
  }
});

router.get('/journal-entries', async (req, res) => {
  try {
    const { startDate, endDate, sourceType, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (sourceType) filter.sourceType = sourceType;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [entries, total] = await Promise.all([
      JournalEntry.find(filter)
        .populate('lines.account', 'code name')
        .populate('postedBy', 'fullName email')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      JournalEntry.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: entries,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch journal entries', error: error.message });
  }
});

// router.post('/journal-entries', async (req, res) => {
//   try {
//     const { date, description, lines } = req.body;
//     const entry = await accountingService.createJournalEntry({ date, description, lines, sourceType: 'manual' }, req.user.userId);
//     res.status(201).json({ success: true, data: entry, message: 'Journal entry posted successfully' });
//   } catch (error) {
//     res.status(400).json({ success: false, message: 'Failed to post journal entry', error: error.message });
//   }
// });

router.post('/journal-entries/:entryId/reverse', async (req, res) => {
  try {
    const entry = await accountingService.reverseJournalEntry(req.params.entryId, req.user.userId, {
      reason: req.body.reason,
      reversalDate: req.body.reversalDate
    });

    res.status(201).json({
      success: true,
      data: entry,
      message: 'Reversal entry posted successfully'
    });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to reverse journal entry', error: error.message });
  }
});

router.get('/periods', async (req, res) => {
  try {
    const periods = await accountingService.listPeriods({
      year: req.query.year,
      status: req.query.status
    });

    res.json({ success: true, data: periods, count: periods.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch accounting periods', error: error.message });
  }
});

router.post('/periods/close', async (req, res) => {
  try {
    const { year, month, notes } = req.body;
    if (!year || !month) {
      return res.status(400).json({ success: false, message: 'year and month are required' });
    }

    const period = await accountingService.setPeriodStatus({
      year,
      month,
      status: 'closed',
      userId: req.user.userId,
      notes
    });

    res.json({ success: true, data: period, message: 'Accounting period closed successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to close accounting period', error: error.message });
  }
});

router.post('/periods/open', async (req, res) => {
  try {
    const { year, month, notes } = req.body;
    if (!year || !month) {
      return res.status(400).json({ success: false, message: 'year and month are required' });
    }

    const period = await accountingService.setPeriodStatus({
      year,
      month,
      status: 'open',
      userId: req.user.userId,
      notes
    });

    res.json({ success: true, data: period, message: 'Accounting period opened successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to open accounting period', error: error.message });
  }
});

router.post('/postings/cash-requests/:requestId/disbursement', async (req, res) => {
  try {
    const entry = await accountingService.postCashRequestDisbursement(req.params.requestId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Cash request disbursement posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post cash request disbursement', error: error.message });
  }
});

router.post('/postings/supplier-invoices/:invoiceId', async (req, res) => {
  try {
    const entry = await accountingService.postSupplierInvoice(req.params.invoiceId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Supplier invoice posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post supplier invoice', error: error.message });
  }
});

router.post('/postings/customer-invoices/:invoiceId', async (req, res) => {
  try {
    const entry = await accountingService.postCustomerInvoice(req.params.invoiceId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Customer invoice posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post customer invoice', error: error.message });
  }
});

router.post('/postings/salary-payments/:paymentId', async (req, res) => {
  try {
    const entry = await accountingService.postSalaryPayment(req.params.paymentId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Salary payment posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post salary payment', error: error.message });
  }
});

router.get('/reports/trial-balance', async (req, res) => {
  try {
    const result = await accountingService.getTrialBalance({
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate trial balance', error: error.message });
  }
});

router.get('/reports/general-ledger/:accountId', async (req, res) => {
  try {
    const result = await accountingService.getGeneralLedger(req.params.accountId, {
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to generate general ledger', error: error.message });
  }
});

// ── Partial Invoice Posting ────────────────────────────────
router.post('/postings/invoices/:invoiceId/payment-terms/:termIndex', async (req, res) => {
  try {
    const termIndex = Number(req.params.termIndex);
    if (isNaN(termIndex) || termIndex < 0) {
      return res.status(400).json({ success: false, message: 'termIndex must be a non-negative integer' });
    }
 
    const entry = await accountingService.postPartialInvoice(
      req.params.invoiceId,
      termIndex,
      req.user.userId
    );
 
    res.json({ success: true, data: entry, message: 'Partial invoice payment term posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post partial invoice', error: error.message });
  }
});
 
 
// ── Completion Item Posting ────────────────────────────────
router.post('/postings/project-plans/:planId/completion-items/:itemId', async (req, res) => {
  try {
    const entry = await accountingService.postCompletionItemRecognized(
      req.params.planId,
      req.params.itemId,
      req.user.userId
    );
 
    if (!entry) {
      return res.json({ success: true, data: null, message: 'No amount to post for this completion item' });
    }
 
    res.json({ success: true, data: entry, message: 'Completion milestone posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post completion milestone', error: error.message });
  }
});
 
 
// ── P&L Report ────────────────────────────────────────────
router.get('/reports/profit-and-loss', async (req, res) => {
  try {
    const result = await accountingService.getProfitAndLoss({
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });
 
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate P&L report', error: error.message });
  }
});
 
 
// ── Balance Sheet Report ───────────────────────────────────
router.get('/reports/balance-sheet', async (req, res) => {
  try {
    const result = await accountingService.getBalanceSheet({
      asOfDate: req.query.asOfDate
    });
 
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate balance sheet', error: error.message });
  }
});

// ── P1: PAYMENTS ─────────────────────────────────────────────────────────────
 
router.get('/payments', async (req, res) => {
  try {
    const result = await accountingService.listPayments({
      type: req.query.type,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      invoiceId: req.query.invoiceId,
      supplierInvoiceId: req.query.supplierInvoiceId,
      page: req.query.page,
      limit: req.query.limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payments', error: error.message });
  }
});
 
router.post('/payments', async (req, res) => {
  try {
    const payment = await accountingService.createPayment(req.body, req.user.userId);
    res.status(201).json({ success: true, data: payment, message: 'Payment recorded' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to record payment', error: error.message });
  }
});
 
router.post('/postings/payments/:paymentId/receipt', async (req, res) => {
  try {
    const entry = await accountingService.postPaymentReceipt(req.params.paymentId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Payment receipt posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post payment receipt', error: error.message });
  }
});
 
router.post('/postings/payments/:paymentId/supplier', async (req, res) => {
  try {
    const entry = await accountingService.postSupplierPayment(req.params.paymentId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Supplier payment posted to ledger' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to post supplier payment', error: error.message });
  }
});
 
 
// ── P2: AGED REPORTS ─────────────────────────────────────────────────────────
 
router.get('/reports/aged-receivables', async (req, res) => {
  try {
    const result = await accountingService.getAgedReceivables({ asOfDate: req.query.asOfDate });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate aged receivables', error: error.message });
  }
});
 
router.get('/reports/aged-payables', async (req, res) => {
  try {
    const result = await accountingService.getAgedPayables({ asOfDate: req.query.asOfDate });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate aged payables', error: error.message });
  }
});
 
 
// ── P3: MAKER-CHECKER ────────────────────────────────────────────────────────
 
// Override the existing POST /journal-entries to create drafts for manual entries
// Replace the existing route handler body with:
//   const { date, description, lines } = req.body;
//   const entry = await accountingService.createDraftJournalEntry({ date, description, lines }, req.user.userId);
//   res.status(201).json({ success: true, data: entry, message: 'Journal draft created — submit for review to post' });
//
// (The existing route stays in place, just swap the service call)
 
router.post('/journal-entries/:entryId/submit', async (req, res) => {
  try {
    const entry = await accountingService.submitJournalForReview(req.params.entryId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Journal submitted for review' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to submit journal', error: error.message });
  }
});
 
router.post('/journal-entries/:entryId/approve', async (req, res) => {
  try {
    const entry = await accountingService.approveJournal(req.params.entryId, req.user.userId);
    res.json({ success: true, data: entry, message: 'Journal approved and posted' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to approve journal', error: error.message });
  }
});
 
router.post('/journal-entries/:entryId/reject', async (req, res) => {
  try {
    const entry = await accountingService.rejectJournal(req.params.entryId, req.user.userId, req.body.reason);
    res.json({ success: true, data: entry, message: 'Journal rejected and returned to draft' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to reject journal', error: error.message });
  }
});
 
 
// ── P4: VAT RETURN ───────────────────────────────────────────────────────────
 
router.get('/reports/vat-return', async (req, res) => {
  try {
    const result = await accountingService.getVATReturn({
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate VAT return', error: error.message });
  }
});
 
 
// ── P5: DASHBOARD KPIs ───────────────────────────────────────────────────────
 
router.get('/dashboard/kpis', async (req, res) => {
  try {
    const result = await accountingService.getDashboardKPIs();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch KPIs', error: error.message });
  }
});
 
 
// ── P6: CASH FLOW ────────────────────────────────────────────────────────────
 
router.get('/reports/cash-flow', async (req, res) => {
  try {
    const result = await accountingService.getCashFlowStatement({
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate cash flow statement', error: error.message });
  }
});
 
 
// ── P7: BANK RECONCILIATION ───────────────────────────────────────────────────
 
router.get('/bank/transactions', async (req, res) => {
  try {
    const result = await accountingService.listBankTransactions({
      accountCode: req.query.accountCode,
      isReconciled: req.query.isReconciled,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to list bank transactions', error: error.message });
  }
});
 
router.post('/bank/import', async (req, res) => {
  try {
    const { rows, accountCode } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'rows array is required' });
    }
    const importBatch = `IMPORT-${Date.now()}`;
    const result = await accountingService.importBankTransactions(rows, accountCode, importBatch, req.user.userId);
    res.json({ success: true, ...result, importBatch, message: `${result.imported} transactions imported` });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to import bank transactions', error: error.message });
  }
});
 
router.post('/bank/reconcile', async (req, res) => {
  try {
    const { bankTxId, journalEntryId } = req.body;
    if (!bankTxId || !journalEntryId) {
      return res.status(400).json({ success: false, message: 'bankTxId and journalEntryId are required' });
    }
    const tx = await accountingService.reconcileTransaction(bankTxId, journalEntryId, req.user.userId);
    res.json({ success: true, data: tx, message: 'Transaction reconciled' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to reconcile transaction', error: error.message });
  }
});
 
router.get('/bank/summary', async (req, res) => {
  try {
    const result = await accountingService.getReconciliationSummary(
      req.query.accountCode || '1010',
      { startDate: req.query.startDate, endDate: req.query.endDate }
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get reconciliation summary', error: error.message });
  }
});
 
 
// ── P8: AUDIT LOG + CSV EXPORTS ───────────────────────────────────────────────
 
router.get('/audit-log', async (req, res) => {
  try {
    const result = await accountingService.getAuditLog({
      entityType: req.query.entityType,
      action: req.query.action,
      performedBy: req.query.performedBy,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit log', error: error.message });
  }
});
 
router.get('/exports/trial-balance.csv', async (req, res) => {
  try {
    const csv = await accountingService.exportTrialBalanceCSV({ startDate: req.query.startDate, endDate: req.query.endDate });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="trial-balance.csv"');
    await accountingService.logAudit('report_exported', 'Report', null, req.user.userId, 'Trial balance CSV exported');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed', error: error.message });
  }
});
 
router.get('/exports/journal-entries.csv', async (req, res) => {
  try {
    const csv = await accountingService.exportJournalEntriesCSV({ startDate: req.query.startDate, endDate: req.query.endDate });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="journal-entries.csv"');
    await accountingService.logAudit('report_exported', 'Report', null, req.user.userId, 'Journal entries CSV exported');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed', error: error.message });
  }
});
 
router.get('/exports/profit-and-loss.csv', async (req, res) => {
  try {
    const csv = await accountingService.exportProfitAndLossCSV({ startDate: req.query.startDate, endDate: req.query.endDate });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="profit-and-loss.csv"');
    await accountingService.logAudit('report_exported', 'Report', null, req.user.userId, 'P&L CSV exported');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed', error: error.message });
  }
});
 
router.get('/exports/balance-sheet.csv', async (req, res) => {
  try {
    const csv = await accountingService.exportBalanceSheetCSV({ asOfDate: req.query.asOfDate });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="balance-sheet.csv"');
    await accountingService.logAudit('report_exported', 'Report', null, req.user.userId, 'Balance sheet CSV exported');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed', error: error.message });
  }
});

module.exports = router;
