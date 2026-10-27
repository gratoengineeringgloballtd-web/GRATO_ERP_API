/**
 * Moves every finance step that is still PENDING at Ranibell Mambo to Lainjo Remyhans
 * (cash requests, justifications, purchase requisitions, invoices).
 * Steps already approved/rejected keep Ranibell's name: history is not rewritten.
 *
 * Usage (from GRATO_ERP_API):
 *   node scripts/moveFinancePendingToRemyhans.js            # dry run
 *   node scripts/moveFinancePendingToRemyhans.js --apply
 *
 * Remyhans' user account must exist first (scripts/createRemyhansUser.js).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const APPLY = process.argv.includes('--apply');
const FROM = ['ranibell.mambo@gratoglobal.com', 'ranibellmambo@gratoengineering.com'];
const TO = { email: 'lainjo.remyhans@gratoglobal.com', name: 'Mr. Lainjo Remyhans' };

const TARGETS = [
  { name: 'CashRequest', model: '../models/CashRequest', fields: ['approvalChain', 'justificationApprovalChain'] },
  { name: 'PurchaseRequisition', model: '../models/PurchaseRequisition', fields: ['approvalChain', 'justificationApprovalChain'] },
  { name: 'Invoice', model: '../models/Invoice', fields: ['approvalChain'] }
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const u = await User.findOne({ email: TO.email }).select('fullName');
  if (!u) { console.error(`No user ${TO.email}. Run scripts/createRemyhansUser.js first.`); process.exit(1); }

  const pendingFor = (field) => ({
    [field]: { $elemMatch: { status: 'pending', 'approver.email': { $in: FROM } } }
  });

  for (const t of TARGETS) {
    let Model;
    try { Model = require(t.model); } catch (e) { console.warn(`Skipping ${t.name}: ${e.message}`); continue; }
    for (const field of t.fields) {
      if (!Model.schema.path(field)) continue;
      const n = await Model.collection.countDocuments(pendingFor(field));
      if (APPLY && n) {
        await Model.collection.updateMany(
          pendingFor(field),
          { $set: { [`${field}.$[s].approver.email`]: TO.email, [`${field}.$[s].approver.name`]: TO.name } },
          { arrayFilters: [{ 's.status': 'pending', 's.approver.email': { $in: FROM } }] }
        );
      }
      console.log(`${t.name}.${field}: ${n} request(s) ${APPLY ? 'moved' : 'would be moved'} to ${TO.email}`);
    }
  }
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to save.');
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
