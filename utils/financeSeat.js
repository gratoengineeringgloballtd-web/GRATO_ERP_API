const User = require('../models/User');

/**
 * Lainjo Remyhans took over the finance seat from Ranibell Mambo. Her past actions keep her name
 * (the audit trail is never rewritten), but they must also be visible in his history. This helper
 * returns what he inherits: her e-mail addresses and her user id(s). For anyone else it returns
 * nothing, so no other user's view changes.
 */
const SUCCESSOR_EMAIL = 'lainjo.remyhans@gratoglobal.com';
const FORMER_EMAILS = ['ranibell.mambo@gratoglobal.com', 'ranibellmambo@gratoengineering.com'];

async function getInheritedSeat(email) {
  if (!email || String(email).toLowerCase() !== SUCCESSOR_EMAIL) return { emails: [], userIds: [] };
  const users = await User.find({ email: { $in: FORMER_EMAILS } }).select('_id');
  return { emails: FORMER_EMAILS.slice(), userIds: users.map(u => u._id) };
}

module.exports = { getInheritedSeat, SUCCESSOR_EMAIL, FORMER_EMAILS };
