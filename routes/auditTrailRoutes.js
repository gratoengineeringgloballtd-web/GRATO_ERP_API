const express = require('express');
const RecordChange = require('../models/RecordChange');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRoles('admin', 'ceo', 'it', 'finance', 'hr', 'supply_chain'));

// Which records each role may see the history of. IT sees operational/identity data only, never financial values.
const FINANCE = ['Invoice', 'SupplierInvoice', 'CashRequest', 'Account', 'AccountingRule', 'TaxGroup', 'Currency', 'FiscalYear', 'FinancialAsset', 'BudgetCode', 'SalaryPayment', 'SalaryProfile', 'PayrollRate', 'PayrollRun', 'ExpenseClaim'];
const VISIBLE = {
  it: ['User', 'StructureEntry'],
  finance: FINANCE,
  hr: ['User', 'Leave', 'SalaryProfile', 'PayrollRun', 'ExpenseClaim', 'JobOpening', 'Candidate', 'Document'],
  supply_chain: ['Supplier', 'PurchaseRequisition', 'PurchaseOrder']
};
const visibleModels = (role) => (['admin', 'ceo'].includes(role) ? null : (VISIBLE[role] || []));

router.get('/models', (req, res) => {
  const { AUDITED } = require('../utils/auditTrailPlugin');
  const allowed = visibleModels(req.user.role);
  const models = [...AUDITED].filter((m) => !allowed || allowed.includes(m)).sort();
  res.json({ success: true, data: models });
});

router.get('/changes', async (req, res) => {
  try {
    const { model, recordId, userId, action, from, to, q } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const allowed = visibleModels(req.user.role);

    const filter = {};
    if (allowed) filter.model = { $in: allowed };
    if (model) {
      if (allowed && !allowed.includes(model)) return res.status(403).json({ success: false, message: 'You cannot view the history of this record type' });
      filter.model = model;
    }
    if (recordId) filter.recordId = String(recordId);
    if (userId) filter['actor.id'] = String(userId);
    if (action) filter.action = action;
    if (from || to) { filter.at = {}; if (from) filter.at.$gte = new Date(from); if (to) filter.at.$lte = new Date(to); }
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ recordLabel: rx }, { 'actor.name': rx }, { 'actor.email': rx }, { 'changes.field': rx }];
    }

    const [rows, total] = await Promise.all([
      RecordChange.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      RecordChange.countDocuments(filter)
    ]);
    res.json({ success: true, data: rows, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load the audit trail', error: e.message });
  }
});

module.exports = router;
