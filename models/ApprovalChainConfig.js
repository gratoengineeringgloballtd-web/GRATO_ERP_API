/**
 * ApprovalChainConfig.js
 *
 * DB-backed, admin-editable replacement for the six hardcoded named
 * approvers previously baked directly into config/fuelRequestApprovalChain.js
 * (Minka, Pascal, Didier, Ranibell, Kelvin, Tom — by name AND email address).
 *
 * Why this matters: if any of those six people changes their email, leaves
 * the company, or is temporarily covered by someone else, the ONLY way to
 * update the approval chain was previously a code change + deploy. Any
 * fuel request created in the meantime would route approval emails to a
 * dead inbox with no error — a silent failure in a chain that gates real
 * money and real diesel.
 *
 * Singleton document (chain_name: 'fuel_request'). If no document exists
 * yet, config/fuelRequestApprovalChain.js falls back to the original
 * hardcoded defaults, so this is a non-breaking, purely additive change —
 * nothing stops working the moment this file is added.
 */
const mongoose = require('mongoose');

const approverStepSchema = new mongoose.Schema({
  level:      { type: Number, required: true },
  name:       { type: String, required: true },
  email:      { type: String, required: true, lowercase: true, trim: true },
  role:       { type: String, required: true },
  department: { type: String, required: true },
  // CEO-only step: only included in the built chain when the request
  // meets/exceeds ceo_liters_threshold. All other steps are unconditional.
  conditional_ceo_step: { type: Boolean, default: false },
}, { _id: false });

const approvalChainConfigSchema = new mongoose.Schema({
  chain_name: { type: String, required: true, unique: true, default: 'fuel_request' },
  steps:      { type: [approverStepSchema], required: true, validate: v => v.length > 0 },
  ceo_liters_threshold: { type: Number, default: 100 }, // L — requests at/above this route to the conditional_ceo_step

  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/**
 * Get the active config, or null if none has been configured yet — callers
 * decide how to fall back (config/fuelRequestApprovalChain.js falls back
 * to the original hardcoded defaults).
 */
approvalChainConfigSchema.statics.getActive = function (chain_name = 'fuel_request') {
  return this.findOne({ chain_name }).lean();
};

module.exports = mongoose.model('ApprovalChainConfig', approvalChainConfigSchema);
