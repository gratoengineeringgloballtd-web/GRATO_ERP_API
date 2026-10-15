/**
 * Accounting extensions: tax groups, currencies/FX, credit notes, dunning, payment batches,
 * fixed assets, analytic accounts, budgets, fiscal years, comparative + management reports.
 * Loaded by accountingService.js, which passes itself in as `base`.
 */
const mongoose = require('mongoose');

module.exports = function buildExtensions(base) {
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const paging = (page, limit, def = 20) => {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit, 10) || def));
    return { p, l, skip: (p - 1) * l };
  };
  const model = (n) => require(`../models/${n}`);
  const oid = (id, label = 'ID') => {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new Error(`Invalid ${label}`);
    return id;
  };
  const clean = (body) => {
    const o = { ...(body || {}) };
    ['_id', '__v', 'createdAt', 'updatedAt'].forEach((k) => delete o[k]);
    return o;
  };
  async function nextSeq(prefix, withMonth = false) {
    const Counter = model('Counter');
    const now = new Date();
    const key = withMonth ? `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}` : `${prefix}-${now.getFullYear()}`;
    const c = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true });
    return `${key}-${String(c.seq).padStart(5, '0')}`;
  }
  const endOfMonth = (d, add) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth() + add + 1, 0); };
  async function existingPosted(sourceType, sourceId) {
    return model('JournalEntry').findOne({ sourceType, sourceId, status: 'posted' });
  }
  const line = (account, debit, credit, description) => ({ account: account._id, debit: r2(debit), credit: r2(credit), description });

  // ── TAX GROUPS ─────────────────────────────────────────────────────────────
  async function normaliseTaxes(taxes) {
    const out = [];
    for (const t of taxes || []) {
      const code = base.normCode(t.accountCode);
      await base.getAccountByCode(code);
      out.push({ ...t, accountCode: code });
    }
    return out;
  }

  async function listTaxGroups({ isActive } = {}) {
    const TaxGroup = model('TaxGroup');
    if ((await TaxGroup.countDocuments()) === 0) {
      await base.ensureDefaultChart();
      await TaxGroup.create([
        { name: 'TVA 19,25%', description: 'Cameroon standard VAT (17.5% + 10% council tax)', taxes: [{ name: 'TVA 19,25%', rate: 19.25, taxType: 'vat', accountCode: base.CODES.VAT_PAYABLE, sequence: 10 }] },
        { name: 'Retenue a la source 5,5%', description: 'Withholding on supplier payments', taxes: [{ name: 'Retenue 5,5%', rate: 5.5, taxType: 'wht', accountCode: base.CODES.WHT_PAYABLE, sequence: 10 }] }
      ]);
    }
    const filter = {};
    if (typeof isActive !== 'undefined') filter.isActive = isActive === 'true' || isActive === true;
    return TaxGroup.find(filter).sort({ name: 1 }).lean();
  }

  async function createTaxGroup(body) {
    const b = clean(body);
    if (!b.name) throw new Error('Tax group name is required');
    if (!Array.isArray(b.taxes) || !b.taxes.length) throw new Error('At least one tax line is required');
    b.taxes = await normaliseTaxes(b.taxes);
    return model('TaxGroup').create(b);
  }

  async function updateTaxGroup(id, body) {
    oid(id, 'tax group ID');
    const b = clean(body);
    if (b.taxes) b.taxes = await normaliseTaxes(b.taxes);
    const doc = await model('TaxGroup').findByIdAndUpdate(id, b, { new: true, runValidators: true });
    if (!doc) throw new Error('Tax group not found');
    return doc;
  }

  // ── CURRENCIES / FX ────────────────────────────────────────────────────────
  async function listCurrencies() {
    const Currency = model('Currency');
    if ((await Currency.countDocuments()) === 0) {
      await Currency.create({ code: 'XAF', name: 'Franc CFA (BEAC)', symbol: 'FCFA', rateToBase: 1, isBase: true, decimalPlaces: 0 });
    }
    return Currency.find({}).sort({ isBase: -1, code: 1 }).lean();
  }

  async function upsertCurrency(body) {
    const Currency = model('Currency');
    const b = clean(body);
    const code = String(b.code || '').toUpperCase().trim();
    if (!code) throw new Error('Currency code is required');
    if (!(Number(b.rateToBase) > 0)) throw new Error('Rate to base must be greater than zero');
    const isBase = !!b.isBase;
    const doc = await Currency.findOneAndUpdate(
      { code },
      { $set: { ...b, code, rateToBase: isBase ? 1 : Number(b.rateToBase), isBase, updatedAt: new Date() } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    if (isBase) await Currency.updateMany({ _id: { $ne: doc._id } }, { $set: { isBase: false } });
    return doc;
  }

  /**
   * Post a currency revaluation. `difference` is the change in the base-currency carrying value
   * of `accountCode` (positive = the account's normal balance grew). For a receivable/cash account
   * that is a gain; for a payable it is a loss.
   */
  async function postFXGainLoss({ accountCode, difference, date, description, userId }) {
    const diff = r2(difference);
    if (!accountCode) throw new Error('accountCode is required');
    if (Math.abs(diff) < 0.01) return null;
    const account = await base.getAccountByCode(accountCode);
    const gain = account.normalBalance === 'debit' ? diff > 0 : diff < 0;
    const amount = Math.abs(diff);
    const fx = await base.getAccountByCode(gain ? base.CODES.FX_GAIN : base.CODES.FX_LOSS);
    const growsDebit = account.normalBalance === 'debit' ? diff > 0 : diff < 0;
    const lines = growsDebit
      ? [line(account, amount, 0, 'FX revaluation'), line(fx, 0, amount, 'Foreign exchange gain')]
      : [line(account, 0, amount, 'FX revaluation'), line(fx, amount, 0, 'Foreign exchange loss')];
    const entry = await base.createJournalEntry({ date: date || new Date(), description: description || `FX revaluation ${account.code}`, sourceType: 'fx_adjustment', lines }, userId);
    await base.logAudit('fx_posted', 'JournalEntry', entry._id, userId, `FX ${gain ? 'gain' : 'loss'} ${amount} on ${account.code}`);
    return entry;
  }

  // ── CREDIT NOTES ───────────────────────────────────────────────────────────
  async function listCreditNotes({ type, status, page, limit } = {}) {
    const CreditNote = model('CreditNote');
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    const { p, l, skip } = paging(page, limit);
    const [notes, total] = await Promise.all([
      CreditNote.find(filter).sort({ creditNoteDate: -1, createdAt: -1 }).skip(skip).limit(l).lean(),
      CreditNote.countDocuments(filter)
    ]);
    return { notes, total, page: p, pages: Math.ceil(total / l) };
  }

  async function createCreditNote(body, userId) {
    const CreditNote = model('CreditNote');
    const b = clean(body);
    if (!['customer', 'supplier'].includes(b.type)) throw new Error('Type must be customer or supplier');
    const amount = Number(b.amount);
    if (!(amount > 0)) throw new Error('Amount must be greater than zero');
    if (!b.reason) throw new Error('Reason is required');

    let taxAmount = Number(b.taxAmount);
    const doc = { type: b.type, amount, reason: b.reason, creditNoteDate: b.creditNoteDate || new Date(), createdBy: userId };

    if (b.type === 'customer' && b.invoiceId) {
      const inv = await model('Invoice').findById(oid(b.invoiceId, 'invoice ID')).lean();
      if (!inv) throw new Error('Customer invoice not found');
      if (amount > Number(inv.totalAmount || 0)) throw new Error('Credit note exceeds the invoice amount');
      doc.invoiceId = inv._id; doc.customerId = inv.customer || null;
      doc.customerDetails = { name: inv.customerDetails?.name, email: inv.customerDetails?.email };
      if (!Number.isFinite(taxAmount) && Number(inv.totalAmount) > 0) taxAmount = amount * Number(inv.taxAmount || 0) / Number(inv.totalAmount);
    }
    if (b.type === 'supplier' && b.supplierInvoiceId) {
      const si = await model('SupplierInvoice').findById(oid(b.supplierInvoiceId, 'supplier invoice ID')).lean();
      if (!si) throw new Error('Supplier invoice not found');
      doc.supplierInvoiceId = si._id; doc.supplierId = si.supplier || null;
    }
    doc.taxAmount = r2(Number.isFinite(taxAmount) ? taxAmount : 0);
    if (doc.taxAmount > amount) throw new Error('Tax amount cannot exceed the credit note amount');
    doc.creditNoteNumber = await nextSeq('CN');
    return CreditNote.create(doc);
  }

  async function postCreditNote(id, userId, kind) {
    const CreditNote = model('CreditNote');
    const note = await CreditNote.findById(oid(id, 'credit note ID'));
    if (!note) throw new Error('Credit note not found');
    if (note.type !== kind) throw new Error(`This is a ${note.type} credit note`);
    const sourceType = kind === 'customer' ? 'credit_note_customer' : 'credit_note_supplier';
    const already = await existingPosted(sourceType, note._id);
    if (already) return already;
    if (note.status !== 'draft') throw new Error(`Credit note is already ${note.status}`);

    await base.ensureDefaultChart();
    const gross = r2(note.amount), tax = r2(note.taxAmount), net = r2(gross - tax);
    let lines;
    if (kind === 'customer') {
      const [sales, vat, ar] = await Promise.all([base.getAccountByCode(base.CODES.SALES), base.getAccountByCode(base.CODES.VAT_PAYABLE), base.getAccountByCode(base.CODES.AR)]);
      lines = [line(sales, net, 0, 'Sales returned / credited')];
      if (tax > 0) lines.push(line(vat, tax, 0, 'VAT reversed'));
      lines.push(line(ar, 0, gross, 'Customer account credited'));
    } else {
      const [ap, exp, vat] = await Promise.all([base.getAccountByCode(base.CODES.AP), base.getAccountByCode(base.CODES.ADMIN_EXP), base.getAccountByCode(base.CODES.VAT_RECEIVABLE)]);
      lines = [line(ap, gross, 0, 'Supplier account debited')];
      lines.push(line(exp, 0, net, 'Expense reduced'));
      if (tax > 0) lines.push(line(vat, 0, tax, 'Input VAT reversed'));
    }
    const entry = await base.createJournalEntry({ date: note.creditNoteDate, description: `Credit note ${note.creditNoteNumber}: ${note.reason}`, sourceType, sourceId: note._id, lines }, userId);
    note.status = 'posted';
    note.accountingAudit = { isPosted: true, postedAt: new Date(), entryId: entry._id, entryNumber: entry.entryNumber, sourceType };
    await note.save();
    await base.logAudit('credit_note_posted', 'CreditNote', note._id, userId, `Credit note ${note.creditNoteNumber} posted`, { entryNumber: entry.entryNumber });
    return entry;
  }
  const postCustomerCreditNote = (id, userId) => postCreditNote(id, userId, 'customer');
  const postSupplierCreditNote = (id, userId) => postCreditNote(id, userId, 'supplier');

  // ── DUNNING ────────────────────────────────────────────────────────────────
  const dunningLevel = (days) => (days >= 30 ? 3 : days >= 15 ? 2 : days >= 1 ? 1 : 0);
  const levelAction = { 1: 'email', 2: 'phone', 3: 'legal' };

  async function listDunningActions({ status, level, page, limit } = {}) {
    const DunningAction = model('DunningAction');
    const filter = {};
    if (status) filter.status = status;
    if (level) filter.level = Number(level);
    const { p, l, skip } = paging(page, limit);
    const [actions, total] = await Promise.all([
      DunningAction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
      DunningAction.countDocuments(filter)
    ]);
    return { actions, total, page: p, pages: Math.ceil(total / l) };
  }

  async function runDunningCheck(userId) {
    const Invoice = model('Invoice');
    const DunningAction = model('DunningAction');
    const now = new Date();
    const invoices = await Invoice.find({
      approvalStatus: { $nin: ['processed'] }, status: { $nin: ['paid'] }, totalAmount: { $gt: 0 }, dueDate: { $lt: now }
    }).populate('customer', 'name email').lean();

    let created = 0;
    const actions = [];
    for (const inv of invoices) {
      const days = Math.floor((now - new Date(inv.dueDate)) / 86400000);
      const level = dunningLevel(days);
      if (!level) continue;
      const exists = await DunningAction.findOne({ invoiceId: inv._id, level: { $gte: level }, status: { $ne: 'ignored' } }).lean();
      if (exists) continue;
      const a = await DunningAction.create({
        invoiceId: inv._id, customerId: inv.customer?._id, customerName: inv.customer?.name || inv.customerDetails?.name || 'Unknown customer',
        customerEmail: inv.customer?.email || inv.customerDetails?.email || '', level, daysOverdue: days,
        amountDue: r2(inv.totalAmount), action: levelAction[level], status: 'pending'
      });
      actions.push(a); created += 1;
    }
    await base.logAudit('dunning_run', 'DunningAction', null, userId, `Dunning run created ${created} actions`);
    return { created, actions };
  }

  async function sendDunningAction(id, userId) {
    const action = await model('DunningAction').findById(oid(id, 'dunning action ID'));
    if (!action) throw new Error('Dunning action not found');
    if (action.status === 'sent') throw new Error('Already sent');
    if (action.action === 'email') {
      if (!action.customerEmail) throw new Error('This customer has no email address on file');
      const { sendEmail } = require('./emailService');
      const tone = action.level === 1 ? 'friendly reminder' : action.level === 2 ? 'second notice' : 'final notice';
      await sendEmail({
        to: action.customerEmail,
        subject: `Payment ${tone}: invoice overdue by ${action.daysOverdue} days`,
        text: `Dear ${action.customerName},\n\nOur records show an outstanding balance of XAF ${action.amountDue.toLocaleString()} that is ${action.daysOverdue} days overdue. Please arrange payment or contact our finance team if you believe this is an error.\n\nThank you.`
      });
    }
    action.status = 'sent'; action.sentAt = new Date(); action.sentBy = userId;
    await action.save();
    return action;
  }

  // ── PAYMENT BATCHES ────────────────────────────────────────────────────────
  async function listPaymentBatches({ type, status, page, limit } = {}) {
    const PaymentBatch = model('PaymentBatch');
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    const { p, l, skip } = paging(page, limit);
    const [batches, total] = await Promise.all([
      PaymentBatch.find(filter).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
      PaymentBatch.countDocuments(filter)
    ]);
    return { batches, total, page: p, pages: Math.ceil(total / l) };
  }

  async function createPaymentBatch(body, userId) {
    const b = clean(body);
    if (!['receipt', 'disbursement'].includes(b.type)) throw new Error('Type must be receipt or disbursement');
    if (!Array.isArray(b.paymentIds) || !b.paymentIds.length) throw new Error('Select at least one payment');
    const payments = await model('Payment').find({ _id: { $in: b.paymentIds.map((i) => oid(i, 'payment ID')) } }).lean();
    if (payments.length !== b.paymentIds.length) throw new Error('One or more payments were not found');
    if (payments.some((p) => p.type !== b.type)) throw new Error(`All payments must be of type ${b.type}`);
    const taken = await model('PaymentBatch').findOne({ paymentIds: { $in: payments.map((p) => p._id) }, status: { $ne: 'draft' } }).lean();
    if (taken) throw new Error(`A payment is already in batch ${taken.batchNumber}`);
    return model('PaymentBatch').create({
      batchNumber: await nextSeq('PB', true), type: b.type, paymentMethod: b.paymentMethod || 'bank_transfer',
      bankAccount: base.normCode(b.bankAccount) || base.CODES.BANK, batchDate: b.batchDate || new Date(),
      paymentIds: payments.map((p) => p._id), totalAmount: r2(payments.reduce((s, p) => s + p.amount, 0)),
      reference: b.reference || '', createdBy: userId
    });
  }

  async function validatePaymentBatch(id, userId) {
    const batch = await model('PaymentBatch').findById(oid(id, 'batch ID'));
    if (!batch) throw new Error('Batch not found');
    if (batch.status !== 'draft') throw new Error(`Batch is already ${batch.status}`);
    let postedCount = 0; const errors = [];
    for (const pid of batch.paymentIds) {
      try {
        const pay = await model('Payment').findById(pid).lean();
        if (pay?.accountingAudit?.isPosted) continue;
        if (batch.type === 'receipt') await base.postPaymentReceipt(pid, userId); else await base.postSupplierPayment(pid, userId);
        postedCount += 1;
      } catch (e) { errors.push({ paymentId: pid, message: e.message }); }
    }
    if (errors.length) return { batch, postedCount, errors, validated: false };
    batch.status = 'validated';
    await batch.save();
    await base.logAudit('payment_batch_validated', 'PaymentBatch', batch._id, userId, `Batch ${batch.batchNumber} validated`, { postedCount });
    return { batch, postedCount, errors: [], validated: true };
  }

  // ── FIXED ASSETS (accounting register) ─────────────────────────────────────
  function buildSchedule({ cost, residual, months, method, start }) {
    const depreciable = r2(cost - residual);
    const lines = [];
    let book = cost, accumulated = 0;
    const annualRate = method === 'declining-balance' ? 2 / (months / 12) : 0;
    for (let i = 1; i <= months; i += 1) {
      let amount;
      if (method === 'declining-balance') {
        amount = r2(Math.min(book * annualRate / 12, book - residual));
        if (i === months) amount = r2(book - residual);
      } else {
        amount = i === months ? r2(depreciable - accumulated) : r2(depreciable / months);
      }
      if (amount <= 0) break;
      accumulated = r2(accumulated + amount);
      book = r2(cost - accumulated);
      lines.push({ sequence: i, date: endOfMonth(start, i - 1), amount, bookValue: book, isPosted: false });
    }
    return lines;
  }

  async function createFixedAsset(body, userId) {
    const FinancialAsset = model('FinancialAsset');
    const b = clean(body);
    const cost = Number(b.acquisitionValue), residual = Number(b.residualValue) || 0, months = parseInt(b.usefulLifeMonths, 10);
    if (!b.name) throw new Error('Asset name is required');
    if (!(cost > 0)) throw new Error('Cost must be greater than zero');
    if (!(months >= 1)) throw new Error('Useful life must be at least 1 month');
    if (residual >= cost) throw new Error('Residual value must be below cost');
    const method = b.depreciationMethod === 'declining-balance' ? 'declining-balance' : 'straight-line';
    const acquisitionDate = new Date(b.acquisitionDate);
    if (Number.isNaN(acquisitionDate.getTime())) throw new Error('Valid acquisition date is required');

    await base.ensureDefaultChart();
    const paidFrom = b.paidFrom === 'payable' ? base.CODES.AP : (base.normCode(b.paidFrom) || base.CODES.BANK);
    const codes = {
      assetAccount: base.normCode(b.accountCodes?.assetAccount) || base.CODES.FIXED_ASSETS,
      depreciationAccount: base.normCode(b.accountCodes?.depreciationAccount) || base.CODES.DEPRECIATION_EXP,
      accumulatedAccount: base.normCode(b.accountCodes?.accumulatedAccount) || base.CODES.ACCUM_DEPRECIATION
    };
    const [assetAcc, payAcc] = await Promise.all([base.getAccountByCode(codes.assetAccount), base.getAccountByCode(paidFrom)]);
    await Promise.all([base.getAccountByCode(codes.depreciationAccount), base.getAccountByCode(codes.accumulatedAccount)]);

    const asset = new FinancialAsset({
      name: b.name, description: b.description || '', acquisitionDate, acquisitionValue: cost, residualValue: residual,
      usefulLifeMonths: months, depreciationMethod: method, accountCodes: codes, paidFrom, createdBy: userId,
      depreciationLines: buildSchedule({ cost, residual, months, method, start: acquisitionDate })
    });
    const entry = await base.createJournalEntry({
      date: acquisitionDate, description: `Acquisition of fixed asset: ${asset.name}`, sourceType: 'asset_acquisition', sourceId: asset._id,
      lines: [line(assetAcc, cost, 0, asset.name), line(payAcc, 0, cost, 'Payment for asset')]
    }, userId);
    asset.acquisitionEntryId = entry._id;
    await asset.save();
    await base.logAudit('asset_created', 'FinancialAsset', asset._id, userId, `Asset ${asset.name} created`, { entryNumber: entry.entryNumber });
    return asset;
  }

  async function listFixedAssets({ status } = {}) {
    const filter = status ? { status } : {};
    const assets = await model('FinancialAsset').find(filter).sort({ acquisitionDate: -1 });
    return assets.map((a) => a.toJSON());
  }

  async function getFixedAssetRegister() {
    const assets = await model('FinancialAsset').find({ status: { $ne: 'disposed' } }).lean();
    const totalCost = r2(assets.reduce((s, a) => s + a.acquisitionValue, 0));
    const totalAccDep = r2(assets.reduce((s, a) => s + a.accumulatedDepreciation, 0));
    return { totalCost, totalAccDep, totalNBV: r2(totalCost - totalAccDep), count: assets.length };
  }

  async function postDepreciationLine(asset, userId) {
    const idx = asset.depreciationLines.findIndex((l) => !l.isPosted);
    if (idx === -1) throw new Error('No pending depreciation');
    const dl = asset.depreciationLines[idx];
    const [exp, acc] = await Promise.all([base.getAccountByCode(asset.accountCodes.depreciationAccount), base.getAccountByCode(asset.accountCodes.accumulatedAccount)]);
    const entry = await base.createJournalEntry({
      date: dl.date, description: `Depreciation ${dl.sequence}/${asset.usefulLifeMonths}: ${asset.name}`, sourceType: 'asset_depreciation', sourceId: asset._id,
      lines: [line(exp, dl.amount, 0, 'Depreciation expense'), line(acc, 0, dl.amount, 'Accumulated depreciation')]
    }, userId);
    dl.isPosted = true; dl.entryId = entry._id;
    asset.accumulatedDepreciation = r2(asset.accumulatedDepreciation + dl.amount);
    const remaining = asset.depreciationLines.filter((l) => !l.isPosted).length;
    if (remaining === 0) asset.status = 'fully_depreciated';
    asset.markModified('depreciationLines');
    await asset.save();
    return { entry, remainingLines: remaining };
  }

  async function postNextDepreciation(id, userId) {
    const asset = await model('FinancialAsset').findById(oid(id, 'asset ID'));
    if (!asset) throw new Error('Asset not found');
    if (asset.status !== 'active') throw new Error(`Asset is ${asset.status}`);
    await base.ensureDefaultChart();
    const res = await postDepreciationLine(asset, userId);
    return { assetId: asset._id, entryNumber: res.entry.entryNumber, remainingLines: res.remainingLines };
  }

  async function postAllPendingDepreciations(userId) {
    await base.ensureDefaultChart();
    const assets = await model('FinancialAsset').find({ status: 'active' });
    let posted = 0; const errors = [];
    for (const asset of assets) {
      while (asset.status === 'active') {
        const next = asset.depreciationLines.find((l) => !l.isPosted);
        if (!next || new Date(next.date) > new Date()) break;
        try { await postDepreciationLine(asset, userId); posted += 1; }
        catch (e) { errors.push({ asset: asset.name, message: e.message }); break; }
      }
    }
    return { posted, errors };
  }

  // ── ANALYTIC ───────────────────────────────────────────────────────────────
  async function listAnalyticAccounts({ type, isActive } = {}) {
    const f = {};
    if (type) f.type = type;
    if (typeof isActive !== 'undefined') f.isActive = isActive === 'true' || isActive === true;
    return model('AnalyticAccount').find(f).sort({ code: 1 }).lean();
  }
  async function createAnalyticAccount(body) {
    const b = clean(body);
    if (!b.code || !b.name) throw new Error('Code and name are required');
    return model('AnalyticAccount').create(b);
  }
  async function getAnalyticReport(id, { startDate, endDate } = {}) {
    oid(id, 'analytic account ID');
    const f = { analyticAccountId: id };
    if (startDate || endDate) { f.date = {}; if (startDate) f.date.$gte = new Date(startDate); if (endDate) f.date.$lte = new Date(endDate); }
    const lines = await model('AnalyticLine').find(f).sort({ date: -1 }).lean();
    const totalCost = r2(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
    const totalRevenue = r2(lines.filter((l) => l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0));
    return { lines, totalCost, totalRevenue, balance: r2(totalRevenue - totalCost) };
  }

  // ── BUDGETS ────────────────────────────────────────────────────────────────
  async function listBudgets({ fiscalYear, status } = {}) {
    const f = {};
    if (fiscalYear) f.fiscalYear = Number(fiscalYear);
    if (status) f.status = status;
    return model('Budget').find(f).sort({ fiscalYear: -1, name: 1 }).lean();
  }
  async function createBudget(body, userId) {
    const b = clean(body);
    delete b.linesJson;
    if (!b.name) throw new Error('Budget name is required');
    if (!Array.isArray(b.lines) || !b.lines.length) throw new Error('At least one budget line is required');
    const lines = [];
    for (const l of b.lines) {
      const code = base.normCode(l.accountCode);
      await base.getAccountByCode(code);
      if (!Number.isFinite(Number(l.plannedAmount))) throw new Error(`Invalid planned amount for ${code}`);
      lines.push({ ...l, accountCode: code, plannedAmount: Number(l.plannedAmount) });
    }
    return model('Budget').create({ ...b, lines, createdBy: userId });
  }
  async function actualsByAccountCode(codes, startDate, endDate) {
    const Account = model('Account');
    const accounts = await Account.find({ code: { $in: codes } }).lean();
    const ids = accounts.map((a) => a._id);
    const rows = await model('JournalEntry').aggregate([
      { $match: { status: 'posted', date: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
      { $unwind: '$lines' },
      { $match: { 'lines.account': { $in: ids } } },
      { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } }
    ]);
    const out = {};
    for (const a of accounts) {
      const row = rows.find((x) => String(x._id) === String(a._id)) || { debit: 0, credit: 0 };
      out[a.code] = { type: a.type, net: a.type === 'revenue' ? row.credit - row.debit : row.debit - row.credit };
    }
    return out;
  }
  async function getBudgetVsActual(id) {
    const budget = await model('Budget').findById(oid(id, 'budget ID')).lean();
    if (!budget) throw new Error('Budget not found');
    const actuals = await actualsByAccountCode(budget.lines.map((l) => l.accountCode), budget.startDate, budget.endDate);
    const lines = budget.lines.map((l) => {
      const a = actuals[l.accountCode] || { type: 'expense', net: 0 };
      const actual = r2(a.net);
      const variance = r2(a.type === 'revenue' ? actual - l.plannedAmount : l.plannedAmount - actual);
      return { accountCode: l.accountCode, plannedAmount: r2(l.plannedAmount), actualAmount: actual, variance,
        variancePct: l.plannedAmount ? Math.round(variance / l.plannedAmount * 1000) / 10 : 0, overBudget: variance < 0 };
    });
    return {
      budget: { _id: budget._id, name: budget.name, fiscalYear: budget.fiscalYear }, lines,
      totalPlanned: r2(lines.reduce((s, l) => s + l.plannedAmount, 0)),
      totalActual: r2(lines.reduce((s, l) => s + l.actualAmount, 0)),
      totalVariance: r2(lines.reduce((s, l) => s + l.variance, 0))
    };
  }

  // ── FISCAL YEARS ───────────────────────────────────────────────────────────
  async function listFiscalYears() { return model('FiscalYear').find({}).sort({ year: -1 }).lean(); }
  async function createFiscalYear(body) {
    const b = clean(body);
    const year = parseInt(b.year, 10);
    if (!year) throw new Error('Year is required');
    const startDate = b.startDate ? new Date(b.startDate) : new Date(year, 0, 1);
    const endDate = b.endDate ? new Date(b.endDate) : new Date(year, 11, 31, 23, 59, 59, 999);
    if (endDate <= startDate) throw new Error('End date must be after start date');
    const overlap = await model('FiscalYear').findOne({ startDate: { $lte: endDate }, endDate: { $gte: startDate } }).lean();
    if (overlap) throw new Error(`Overlaps fiscal year ${overlap.year}`);
    const re = base.normCode(b.retainedEarningsAccount) || base.CODES.RETAINED_EARNINGS;
    return model('FiscalYear').create({ year, startDate, endDate, retainedEarningsAccount: re, notes: b.notes || '' });
  }
  async function lockFiscalYear(year, userId) {
    const fy = await model('FiscalYear').findOne({ year: parseInt(year, 10) });
    if (!fy) throw new Error('Fiscal year not found');
    if (fy.status !== 'open') throw new Error(`Fiscal year is already ${fy.status}`);
    fy.status = 'locked'; fy.lockedAt = new Date();
    await fy.save();
    await base.logAudit('fiscal_year_locked', 'FiscalYear', fy._id, userId, `Fiscal year ${fy.year} locked`);
    return fy;
  }
  async function closeFiscalYear(year, userId) {
    const fy = await model('FiscalYear').findOne({ year: parseInt(year, 10) });
    if (!fy) throw new Error('Fiscal year not found');
    if (fy.status === 'closed') throw new Error('Fiscal year is already closed');
    await base.ensureDefaultChart();
    const tb = await base.getTrialBalance({ startDate: fy.startDate, endDate: fy.endDate });
    const pnl = tb.lines.filter((l) => l.type === 'revenue' || l.type === 'expense');
    const lines = []; let net = 0;
    for (const l of pnl) {
      const bal = r2(l.debit - l.credit); // >0 debit balance
      if (bal === 0) continue;
      lines.push({ account: l.accountId, debit: bal < 0 ? Math.abs(bal) : 0, credit: bal > 0 ? bal : 0, description: `Close ${l.code}` });
      net += -bal; // credit-balance (revenue) adds to profit
    }
    net = r2(net);
    let entry = null;
    if (lines.length) {
      const re = await base.getAccountByCode(fy.retainedEarningsAccount);
      lines.push({ account: re._id, debit: net < 0 ? Math.abs(net) : 0, credit: net > 0 ? net : 0, description: 'Net result of the year' });
      entry = await base.createJournalEntry({ date: fy.endDate, description: `Year-end closing ${fy.year}`, sourceType: 'year_end_closing', sourceId: fy._id, lines, bypassFiscalLock: true }, userId);
    }
    fy.status = 'closed'; fy.closedAt = new Date(); fy.closedBy = userId; fy.closingEntryId = entry ? entry._id : null;
    await fy.save();
    await base.logAudit('fiscal_year_closed', 'FiscalYear', fy._id, userId, `Fiscal year ${fy.year} closed`, { netResult: net });
    return { fiscalYear: fy, netResult: net, entryNumber: entry?.entryNumber || null };
  }

  // ── COMPARATIVE + MANAGEMENT REPORTS ───────────────────────────────────────
  async function getComparativePL(periods) {
    if (!Array.isArray(periods) || !periods.length) throw new Error('Provide at least one period');
    const results = [];
    for (const p of periods) results.push({ label: p.label || `${p.startDate} to ${p.endDate}`, ...(await base.getProfitAndLoss({ startDate: p.startDate, endDate: p.endDate })) });
    const codes = new Map();
    results.forEach((res, i) => [...res.revenueLines, ...res.expenseLines].forEach((l) => {
      if (!codes.has(l.code)) codes.set(l.code, { code: l.code, name: l.name, type: l.type, values: periods.map(() => 0) });
      codes.get(l.code).values[i] = Math.abs(l.balance);
    }));
    return { periods: results.map((r) => ({ label: r.label, totalRevenue: r.totalRevenue, totalExpenses: r.totalExpenses, netProfit: r.netProfit })), rows: [...codes.values()].sort((a, b) => a.code.localeCompare(b.code)) };
  }
  async function getComparativeBalanceSheet(dates) {
    if (!Array.isArray(dates) || !dates.length) throw new Error('Provide at least one date');
    const results = [];
    for (const d of dates) results.push({ label: d.label || d.asOfDate, ...(await base.getBalanceSheet({ asOfDate: d.asOfDate })) });
    const codes = new Map();
    results.forEach((res, i) => [...res.assetLines, ...res.liabilityLines, ...res.equityLines].forEach((l) => {
      if (!codes.has(l.code)) codes.set(l.code, { code: l.code, name: l.name, type: l.type, values: dates.map(() => 0) });
      codes.get(l.code).values[i] = l.balance;
    }));
    return { dates: results.map((r) => ({ label: r.label, totalAssets: r.totalAssets, totalLiabilities: r.totalLiabilities, totalEquity: r.totalEquity, isBalanced: r.isBalanced })), rows: [...codes.values()].sort((a, b) => a.code.localeCompare(b.code)) };
  }

  async function getManagementReport({ startDate, endDate, compareStartDate, compareEndDate } = {}) {
    const now = new Date();
    const sd = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const ed = endDate || now;
    const [cur, prev, bs, kpi, ar] = await Promise.all([
      base.getProfitAndLoss({ startDate: sd, endDate: ed }),
      compareStartDate && compareEndDate ? base.getProfitAndLoss({ startDate: compareStartDate, endDate: compareEndDate }) : null,
      base.getBalanceSheet({ asOfDate: ed }),
      base.getDashboardKPIs().catch(() => ({})),
      base.getAgedReceivables({ asOfDate: ed }).catch(() => ({ grandTotal: {} }))
    ]);
    const growth = (a, b) => (b ? Math.round((a - b) / Math.abs(b) * 1000) / 10 : null);
    const cashBalance = kpi.cashBalance ?? 0;
    const currentAssets = bs.assetLines.filter((l) => l.subType === 'current_asset').reduce((s, l) => s + l.balance, 0);
    const currentLiab = bs.liabilityLines.filter((l) => l.subType === 'current_liability').reduce((s, l) => s + l.balance, 0);
    const overdueAR = r2((ar.grandTotal.days30 || 0) + (ar.grandTotal.days60 || 0) + (ar.grandTotal.days90 || 0) + (ar.grandTotal.over90 || 0));
    return {
      revenue: { current: cur.totalRevenue, previous: prev?.totalRevenue ?? null, growth: prev ? growth(cur.totalRevenue, prev.totalRevenue) : null },
      expenses: { current: cur.totalExpenses, previous: prev?.totalExpenses ?? null, growth: prev ? growth(cur.totalExpenses, prev.totalExpenses) : null },
      netProfit: { current: cur.netProfit, previous: prev?.netProfit ?? null, margin: cur.totalRevenue ? Math.round(cur.netProfit / cur.totalRevenue * 1000) / 10 : 0 },
      cashBalance, totalReceivables: kpi.totalReceivables ?? 0, totalPayables: kpi.totalPayables ?? 0, overdueAR,
      currentRatio: currentLiab ? Math.round(currentAssets / currentLiab * 10) / 10 : 0,
      balanceSheet: { totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity, isBalanced: bs.isBalanced }
    };
  }

  // ── CASH ROUNDING ──────────────────────────────────────────────────────────
  function applyCashRounding(amount, precision = 0.05) {
    const p = Number(precision) > 0 ? Number(precision) : 0.05;
    return r2(Math.round(Number(amount) / p) * p);
  }
  async function postCashRoundingDifference(invoiceId, original, rounded, userId) {
    const diff = r2(rounded - original);
    if (Math.abs(diff) < 0.01) return null;
    await base.ensureDefaultChart();
    const [ar, adj] = await Promise.all([base.getAccountByCode(base.CODES.AR), base.getAccountByCode(diff > 0 ? base.CODES.OTHER_REVENUE : base.CODES.ADMIN_EXP)]);
    const a = Math.abs(diff);
    const lines = diff > 0
      ? [line(ar, a, 0, 'Rounding up'), line(adj, 0, a, 'Rounding gain')]
      : [line(adj, a, 0, 'Rounding loss'), line(ar, 0, a, 'Rounding down')];
    return base.createJournalEntry({ date: new Date(), description: `Cash rounding on invoice ${invoiceId || ''}`.trim(), sourceType: 'cash_rounding', sourceId: invoiceId && mongoose.Types.ObjectId.isValid(invoiceId) ? invoiceId : null, lines }, userId);
  }

  return {
    listTaxGroups, createTaxGroup, updateTaxGroup,
    listCurrencies, upsertCurrency, postFXGainLoss,
    listCreditNotes, createCreditNote, postCustomerCreditNote, postSupplierCreditNote,
    listDunningActions, runDunningCheck, sendDunningAction,
    listPaymentBatches, createPaymentBatch, validatePaymentBatch,
    listFixedAssets, getFixedAssetRegister, createFixedAsset, postNextDepreciation, postAllPendingDepreciations,
    listAnalyticAccounts, createAnalyticAccount, getAnalyticReport,
    listBudgets, createBudget, getBudgetVsActual,
    listFiscalYears, createFiscalYear, lockFiscalYear, closeFiscalYear,
    getComparativePL, getComparativeBalanceSheet, getManagementReport,
    applyCashRounding, postCashRoundingDifference
  };
};
