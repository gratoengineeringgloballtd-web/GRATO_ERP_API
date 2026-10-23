/**
 * Repairs approval chains whose approver email no longer matches a real user.
 *
 * Why: chains were built with a hard-coded finance email
 * (ranibellmambo@gratoengineering.com) while the finance officer's account is
 * ranibell.mambo@gratoglobal.com, so requests never reached her pending list.
 *
 * Usage (from GRATO_ERP_API):
 *   node scripts/fixLegacyApproverEmails.js            # dry run: prints what would change
 *   node scripts/fixLegacyApproverEmails.js --apply    # writes the changes
 *
 * Covers cash requests, purchase requisitions and invoices. It also lists every approver
 * email that matches NO user account (reported only, never changed) so other stale
 * addresses can be spotted.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const APPLY = process.argv.includes('--apply');

// legacy address -> current account address
const MAP = {
  'ranibellmambo@gratoengineering.com': 'ranibell.mambo@gratoglobal.com',
  'didier.oyong@gratoengineering.com': 'didier.oyong@gratoglobal.com'
};

const TARGETS = [
  { name: 'CashRequest', model: '../models/CashRequest', fields: ['approvalChain', 'justificationApprovalChain'] },
  { name: 'PurchaseRequisition', model: '../models/PurchaseRequisition', fields: ['approvalChain', 'justificationApprovalChain'] },
  { name: 'Invoice', model: '../models/Invoice', fields: ['approvalChain'] }
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const users = await User.find({}).select('email');
  const known = new Set(users.map(u => String(u.email).toLowerCase()));
  const unknown = {};

  for (const [from, to] of Object.entries(MAP)) {
    if (!known.has(to)) console.warn(`! No user has email ${to}; skipping ${from}`);
  }

  for (const t of TARGETS) {
    let Model;
    try { Model = require(t.model); } catch (e) { console.warn(`Skipping ${t.name}: ${e.message}`); continue; }
    for (const field of t.fields) {
      if (!Model.schema.path(field)) continue;
      const path = `${field}.approver.email`;

      for (const [from, to] of Object.entries(MAP)) {
        if (!known.has(to)) continue;
        const q = { [path]: new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
        const n = await Model.countDocuments(q);
        if (APPLY && n) {
          await Model.collection.updateMany(
            { [path]: { $regex: `^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
            { $set: { [`${field}.$[s].approver.email`]: to } },
            { arrayFilters: [{ 's.approver.email': { $regex: `^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }] }
          );
        }
        console.log(`${t.name}.${field}: ${n} document(s) ${APPLY ? 'updated' : 'would be updated'} (${from} -> ${to})`);
      }

      const emails = await Model.distinct(path);
      for (const e of emails) {
        const low = String(e || '').toLowerCase();
        if (low && !known.has(low) && !MAP[low]) unknown[low] = (unknown[low] || 0) + 1;
      }
    }
  }

  const rest = Object.keys(unknown);
  if (rest.length) {
    console.log('\nApprover emails with no matching user account (NOT changed):');
    rest.sort().forEach(e => console.log('  ' + e));
  }
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to save.');
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
