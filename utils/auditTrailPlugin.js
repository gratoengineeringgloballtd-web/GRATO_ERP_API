/**
 * Global mongoose plugin: records field-level changes for the models listed in AUDITED.
 * Register once, before any model is compiled (see top of app.js).
 * Failures here never block the real save.
 */
const { currentActor } = require('./auditContext');

const AUDITED = new Set([
  'User', 'StructureEntry', 'Supplier', 'Customer', 'Invoice', 'SupplierInvoice', 'CashRequest',
  'PurchaseRequisition', 'PurchaseOrder', 'BudgetCode', 'Account', 'AccountingRule', 'TaxGroup',
  'Currency', 'FiscalYear', 'FinancialAsset', 'Leave', 'SalaryPayment', 'Contract', 'Project', 'Lead', 'SalesQuotation',
  'SalaryProfile', 'PayrollRate', 'PayrollRun', 'ExpenseClaim', 'JobOpening', 'Candidate', 'Document', 'DocumentTemplate', 'RetentionRule'
]);

const IGNORED = new Set(['updatedAt', 'createdAt', '__v', 'lastLogin', 'lastActive', 'lastLoginAt', 'loginAttempts', 'lockUntil']);
const SENSITIVE = /password|token|secret|otp|hash|pin$/i;
const MAX = 500;

function plain(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v._bsontype === 'ObjectId') return String(v);
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v, (k, val) => (val && val._bsontype === 'ObjectId' ? String(val) : val));
      return s.length > MAX ? `${s.slice(0, MAX)}... (${s.length} chars)` : s;
    } catch (e) { return '[unserialisable]'; }
  }
  if (typeof v === 'string' && v.length > MAX) return `${v.slice(0, MAX)}... (${v.length} chars)`;
  return v;
}

const same = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));

function diff(oldDoc, newDoc, fields) {
  const out = [];
  for (const f of fields) {
    if (IGNORED.has(f)) continue;
    const o = oldDoc ? oldDoc[f] : undefined;
    const n = newDoc ? newDoc[f] : undefined;
    if (same(o, n)) continue;
    if (SENSITIVE.test(f)) out.push({ field: f, masked: true });
    else out.push({ field: f, old: plain(o), new: plain(n) });
  }
  return out;
}

function label(doc) {
  if (!doc) return '';
  return String(doc.displayId || doc.requisitionId || doc.invoiceNumber || doc.poNumber || doc.entryNumber || doc.fullName || doc.name || doc.email || doc.code || doc._id || '').slice(0, 120);
}

async function write(modelName, doc, action, changes) {
  try {
    if (action === 'update' && !changes.length) return;
    const RecordChange = require('../models/RecordChange');
    await RecordChange.collection.insertOne({
      model: modelName, recordId: doc && doc._id ? String(doc._id) : null, recordLabel: label(doc),
      action, changes, actor: currentActor(), at: new Date()
    });
  } catch (e) {
    console.warn('[audit] could not record change:', e.message);
  }
}

module.exports = function auditTrailPlugin(schema) {
  schema.pre('save', async function () {
    try {
      const name = this.constructor.modelName;
      if (!AUDITED.has(name)) return;
      this.$locals.__auditNew = this.isNew;
      if (this.isNew) return;
      const tops = [...new Set(this.modifiedPaths().map((p) => p.split('.')[0]))];
      if (!tops.length) return;
      const orig = await this.constructor.findById(this._id).lean();
      const cur = this.toObject({ depopulate: true });
      this.$locals.__auditChanges = diff(orig, cur, tops);
    } catch (e) { /* never block */ }
  });

  schema.post('save', async function (doc) {
    const name = doc.constructor.modelName;
    if (!AUDITED.has(name)) return;
    if (doc.$locals.__auditNew) {
      const snap = doc.toObject({ depopulate: true });
      const fields = Object.keys(snap).filter((k) => !IGNORED.has(k) && snap[k] !== undefined && snap[k] !== null && !(Array.isArray(snap[k]) && !snap[k].length));
      await write(name, doc, 'create', diff({}, snap, fields).slice(0, 40));
    } else if (doc.$locals.__auditChanges) {
      await write(name, doc, 'update', doc.$locals.__auditChanges);
    }
    doc.$locals.__auditNew = undefined; doc.$locals.__auditChanges = undefined;
  });

  const preQuery = async function () {
    try {
      const name = this.model.modelName;
      if (!AUDITED.has(name)) return;
      this._auditBefore = await this.model.findOne(this.getFilter()).lean();
    } catch (e) { /* never block */ }
  };
  const postQuery = async function () {
    try {
      const name = this.model.modelName;
      const before = this._auditBefore;
      if (!AUDITED.has(name) || !before) return;
      const upd = this.getUpdate() || {};
      const next = { ...(upd.$set || {}) };
      Object.keys(upd).forEach((k) => { if (!k.startsWith('$')) next[k] = upd[k]; });
      ['$inc', '$push', '$pull', '$addToSet', '$unset'].forEach((op) => Object.keys(upd[op] || {}).forEach((k) => { next[k] = `[${op}]`; }));
      const tops = [...new Set(Object.keys(next).map((p) => p.split('.')[0]))];
      const after = await this.model.findById(before._id).lean();
      await write(name, before, 'update', diff(before, after, tops));
    } catch (e) { /* never block */ }
  };
  schema.pre('findOneAndUpdate', preQuery);
  schema.post('findOneAndUpdate', postQuery);
  schema.pre('updateOne', preQuery);
  schema.post('updateOne', postQuery);

  schema.pre('findOneAndDelete', async function () {
    try { if (AUDITED.has(this.model.modelName)) this._auditBefore = await this.model.findOne(this.getFilter()).lean(); } catch (e) { /* never block */ }
  });
  schema.post('findOneAndDelete', async function (doc) {
    if (doc && AUDITED.has(this.model.modelName)) await write(this.model.modelName, doc, 'delete', []);
  });
  schema.post('deleteOne', { document: true, query: false }, async function (doc) {
    if (AUDITED.has(doc.constructor.modelName)) await write(doc.constructor.modelName, doc, 'delete', []);
  });
};
module.exports.AUDITED = AUDITED;
