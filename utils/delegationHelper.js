const User = require('../models/User');

/**
 * Resolve the full set of emails a user can act as for approval purposes: their own,
 * plus the email of anyone who currently has an active delegation pointing at them.
 *
 * This is the one place that knows how to check delegation, so every approval-chain
 * permission check (canUserApprove, canUserApprove-style methods on other models, etc.)
 * can stay a simple array-includes check instead of each reimplementing delegation logic
 * - or worse, some remembering to check it and others not.
 *
 * @param {string} userId    - the acting user's ObjectId (as a string or ObjectId)
 * @param {string} userEmail - the acting user's own email (already known from req.user,
 *                              avoids an extra lookup for the common no-delegation case)
 * @returns {Promise<string[]>} lowercased emails this user may currently approve as
 */
async function getEffectiveApprovalEmails(userId, userEmail) {
  const emails = new Set();
  if (userEmail) emails.add(userEmail.toLowerCase());

  if (!userId) return Array.from(emails);

  const now = new Date();
  const delegators = await User.find({
    'delegation.isActive': true,
    'delegation.delegateId': userId,
    $or: [
      { 'delegation.untilDate': { $exists: false } },
      { 'delegation.untilDate': null },
      { 'delegation.untilDate': { $gte: now } }
    ]
  }).select('email');

  delegators.forEach(u => { if (u.email) emails.add(u.email.toLowerCase()); });

  return Array.from(emails);
}

/**
 * Check whether an approval-chain step's approver email matches any of the acting
 * user's effective approval emails (their own, or anyone who's delegated to them).
 */
function matchesEffectiveApprover(approverEmail, effectiveEmails) {
  if (!approverEmail || !effectiveEmails?.length) return false;
  return effectiveEmails.includes(approverEmail.toLowerCase());
}

module.exports = { getEffectiveApprovalEmails, matchesEffectiveApprover };
