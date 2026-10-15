const express = require('express');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

const R = (label, model, roles) => ({ label, model, roles });
const RESOURCES = {
  users: R('Users', 'User', ['admin', 'ceo', 'hr', 'it']),
  suppliers: R('Suppliers', 'Supplier', ['admin', 'ceo', 'supply_chain', 'finance']),
  customers: R('Customers', 'Customer', ['admin', 'ceo', 'finance']),
  'customer-invoices': R('Customer invoices', 'Invoice', ['admin', 'ceo', 'finance']),
  'supplier-invoices': R('Supplier invoices', 'SupplierInvoice', ['admin', 'ceo', 'finance', 'supply_chain']),
  'cash-requests': R('Cash requests', 'CashRequest', ['admin', 'ceo', 'finance']),
  requisitions: R('Purchase requisitions', 'PurchaseRequisition', ['admin', 'ceo', 'finance', 'supply_chain']),
  'purchase-orders': R('Purchase orders', 'PurchaseOrder', ['admin', 'ceo', 'finance', 'supply_chain']),
  leave: R('Leave requests', 'Leave', ['admin', 'ceo', 'hr']),
  accounts: R('Chart of accounts', 'Account', ['admin', 'ceo', 'finance']),
  leads: R('Sales leads', 'Lead', ['admin', 'ceo', 'finance', 'sales']),
  'sales-quotations': R('Sales quotations', 'SalesQuotation', ['admin', 'ceo', 'finance', 'sales']),
  'fixed-assets': R('Fixed assets (accounting)', 'FinancialAsset', ['admin', 'ceo', 'finance'])
};

const ALWAYS_HIDDEN = /password|token|secret|otp|hash|pin$|signature|resetPassword/i;
const PAY_FIELDS = /salary|iban|bankAccount|bank_account/i;
const PAY_ROLES = ['admin', 'ceo', 'hr', 'finance'];
const MAX_ROWS = 50000;

const getModel = (name) => require(`../models/${name}`);

function columnsFor(resource, role) {
  const Model = getModel(RESOURCES[resource].model);
  const cols = [];
  Model.schema.eachPath((path, type) => {
    if (path === '__v' || ALWAYS_HIDDEN.test(path)) return;
    if (PAY_FIELDS.test(path) && !PAY_ROLES.includes(role)) return;
    const inst = type.instance;
    if (!['String', 'Number', 'Date', 'Boolean', 'ObjectId', 'ObjectID'].includes(inst)) return;
    if (type.$isMongooseArray || type.$isMongooseDocumentArray) return;
    if (path.split('.').length > 3) return;
    cols.push({ key: path, type: inst === 'ObjectID' ? 'ObjectId' : inst });
  });
  return cols;
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function cell(v) {
  if (v === undefined || v === null) return '';
  let s;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = v._bsontype === 'ObjectId' ? String(v) : JSON.stringify(v);
  else s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/resources', (req, res) => {
  const data = Object.entries(RESOURCES)
    .filter(([, r]) => r.roles.includes(req.user.role))
    .map(([key, r]) => ({ key, label: r.label }));
  res.json({ success: true, data });
});

function authorise(req, res) {
  const r = RESOURCES[req.params.resource];
  if (!r) { res.status(404).json({ success: false, message: 'Unknown resource' }); return null; }
  if (!r.roles.includes(req.user.role)) { res.status(403).json({ success: false, message: 'You are not allowed to export this data' }); return null; }
  return r;
}

router.get('/:resource/columns', (req, res) => {
  if (!authorise(req, res)) return;
  res.json({ success: true, data: columnsFor(req.params.resource, req.user.role) });
});

router.get('/:resource', async (req, res) => {
  try {
    const r = authorise(req, res);
    if (!r) return;
    const all = columnsFor(req.params.resource, req.user.role);
    const wanted = String(req.query.columns || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cols = wanted.length ? all.filter((c) => wanted.includes(c.key)) : all.slice(0, 15);
    if (!cols.length) return res.status(400).json({ success: false, message: 'No valid columns selected' });

    const Model = getModel(r.model);
    const filter = {};
    const dateField = all.find((c) => c.key === req.query.dateField && c.type === 'Date') ? req.query.dateField : 'createdAt';
    if (req.query.from || req.query.to) {
      filter[dateField] = {};
      if (req.query.from) filter[dateField].$gte = new Date(req.query.from);
      if (req.query.to) { const t = new Date(req.query.to); t.setHours(23, 59, 59, 999); filter[dateField].$lte = t; }
    }
    const projection = Object.fromEntries(cols.map((c) => [c.key, 1]));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.resource}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write('﻿' + cols.map((c) => cell(c.key)).join(',') + '\r\n');

    let n = 0;
    const cursor = Model.find(filter, projection).sort({ _id: -1 }).lean().cursor();
    for await (const doc of cursor) {
      res.write(cols.map((c) => cell(getPath(doc, c.key))).join(',') + '\r\n');
      if (++n >= MAX_ROWS) break;
    }
    res.end();

    try {
      const { currentActor } = require('../utils/auditContext');
      await require('../models/RecordChange').collection.insertOne({
        model: r.model, recordId: null, recordLabel: `Export: ${r.label} (${n} rows)`, action: 'export',
        changes: [{ field: 'columns', new: cols.map((c) => c.key).join(',') }], actor: currentActor(), at: new Date()
      });
    } catch (e) { /* audit failure must not break the download */ }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Export failed', error: e.message });
    else res.end();
  }
});

module.exports = router;
