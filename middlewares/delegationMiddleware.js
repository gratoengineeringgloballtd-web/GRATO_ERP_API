// ═══════════════════════════════════════════════════════════════════════════
// FILE: middlewares/delegationMiddleware.js  (NEW FILE)
//
// PURPOSE: Two Express middlewares used by submission endpoints:
//
//   enforceDelegationLock(processType)
//     → Rejects requests from users who have DELEGATED `processType`
//       (they are read-only while delegation is active).
//       Attach BEFORE the route handler on CREATE / UPDATE endpoints.
//
//   resolveDelegateIdentity(processType)
//     → When an `X-On-Behalf-Of` header (or `onBehalfOfEmail` body field)
//       is present, validates the delegation and rewrites req.delegationContext
//       so route handlers know to use the principal's identity for:
//         • The `employee` / `createdBy` field on the document
//         • The approval chain (built from principal's org position)
//       Also sets req.submittedBy = acting user's details.
//       Attach BEFORE the route handler on CREATE endpoints.
//
// USAGE IN ROUTE FILES:
//   const { enforceDelegationLock, resolveDelegateIdentity } =
//     require('../middlewares/delegationMiddleware');
//
//   // On POST /cash-requests  (creation)
//   router.post('/',
//     authMiddleware,
//     enforceDelegationLock('cash_request'),     // blocks delegator from self-submitting
//     resolveDelegateIdentity('cash_request'),   // transforms identity if on-behalf-of
//     cashRequestController.create
//   );
//
// IN THE CONTROLLER, read:
//   req.delegationContext  → { isBehalf, principal, delegation } or null
//   req.principalUser      → principal User doc (or req.user if not on-behalf-of)
//   req.submittedByUser    → acting User doc (always req.user)
// ═══════════════════════════════════════════════════════════════════════════

const UserDelegation = require('../models/UserDelegation');
const User           = require('../models/User');
const {
  isActionLocked,
  resolveSubmitterIdentity,
  buildOnBehalfOfNote,
} = require('../services/userDelegationService');
const { isValidProcessType } = require('../config/delegationProcessTypes');


// ─────────────────────────────────────────────────────────────────────────────
// enforceDelegationLock(processType)
//
// Returns an Express middleware that blocks the request if the authenticated
// user has an active outgoing delegation covering `processType`.
//
// Allows GET requests through (read-only is permitted).
// Blocks POST, PUT, PATCH, DELETE (write operations).
// ─────────────────────────────────────────────────────────────────────────────
const enforceDelegationLock = (processType) => async (req, res, next) => {
  // Only enforce on write operations
  if (req.method === 'GET') return next();

  // Skip lock check if the user is submitting ON BEHALF OF someone else
  // (in that case they are the delegate, not the delegator)
  const onBehalfOf =
    req.headers['x-on-behalf-of'] ||
    req.body?.onBehalfOfEmail      ||
    req.body?.onBehalfOf;

  if (onBehalfOf) return next();

  try {
    const locked = await isActionLocked(req.user.email, processType);

    if (locked) {
      // Find who their delegate is for a helpful error message
      const delegations = await UserDelegation.findOutgoing(req.user.email);
      const relevant    = delegations.find((d) => d.coversProcessType(processType));
      const delegateName = relevant?.delegateName || 'your delegate';

      return res.status(403).json({
        success:    false,
        code:       'DELEGATION_LOCK',
        message:    `You have delegated "${processType.replace(/_/g, ' ')}" to ${delegateName}. ` +
                    `While delegation is active, you can only read — not create or approve. ` +
                    `Revoke the delegation first to regain write access.`,
        delegation: relevant
          ? { id: relevant._id, delegateName: relevant.delegateName }
          : null,
      });
    }

    next();
  } catch (err) {
    console.error('[delegationMiddleware] enforceDelegationLock error:', err.message);
    next(); // fail open — don't block the user if the check errors
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// resolveDelegateIdentity(processType)
//
// Returns an Express middleware that:
//   1. Reads `X-On-Behalf-Of` header or `onBehalfOfEmail` body field.
//   2. If present, validates the delegation and populates:
//        req.delegationContext = {
//          isBehalf:      true,
//          principal:     User doc of A (the delegator),
//          delegation:    UserDelegation doc,
//          onBehalfNote:  'Action performed by B on behalf of A',
//        }
//        req.principalUser   = principal (A's User doc)
//        req.submittedByUser = acting user (B's User doc)
//   3. If NOT present, sets:
//        req.delegationContext = { isBehalf: false }
//        req.principalUser     = req.user
//        req.submittedByUser   = req.user
//
// After this middleware, controllers use `req.principalUser` for everything
// that depends on identity (chain building, employee field, dept lookup).
// ─────────────────────────────────────────────────────────────────────────────
const resolveDelegateIdentity = (processType) => async (req, res, next) => {
  // Only relevant on write operations
  if (req.method === 'GET') {
    req.delegationContext = { isBehalf: false };
    req.principalUser     = req.user;
    req.submittedByUser   = req.user;
    return next();
  }

  const onBehalfOfEmail =
    req.headers['x-on-behalf-of'] ||
    req.body?.onBehalfOfEmail      ||
    (typeof req.body?.onBehalfOf === 'string' ? req.body.onBehalfOf : null);

  if (!onBehalfOfEmail) {
    req.delegationContext = { isBehalf: false };
    req.principalUser     = req.user;
    req.submittedByUser   = req.user;
    return next();
  }

  try {
    const { principal, delegation, isBehalf } = await resolveSubmitterIdentity(
      req.user.email,
      onBehalfOfEmail,
      processType
    );

    if (!isBehalf || !principal) {
      req.delegationContext = { isBehalf: false };
      req.principalUser     = req.user;
      req.submittedByUser   = req.user;
      return next();
    }

    const onBehalfNote = buildOnBehalfOfNote(req.user.fullName, principal.fullName);

    req.delegationContext = {
      isBehalf:    true,
      principal,
      delegation,
      onBehalfNote,
    };
    req.principalUser   = principal;   // use A's identity for chain building
    req.submittedByUser = req.user;    // B is the actual actor

    next();
  } catch (err) {
    return res.status(400).json({
      success: false,
      code:    'DELEGATION_INVALID',
      message: err.message,
    });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// applyDelegationToApproval(req, approvalStep, comments)
//
// Call this inside approval route handlers when recording an approval action.
// If B is approving at A's step under a delegation, it:
//   1. Appends the "on behalf of" note to the comments
//   2. Logs the action in the delegation document
//   3. Returns the enriched comments string
//
// Usage in approval controller:
//   const finalComments = await applyDelegationToApproval(
//     req, currentStep, req.body.comments
//   );
//   currentStep.comments = finalComments;
// ─────────────────────────────────────────────────────────────────────────────
const applyDelegationToApproval = async (
  req,
  approvalStep,
  comments       = '',
  processType    = null,
  requestId      = null,
  requestModel   = null,
  requestDisplayId = null
) => {
  const stepEmail    = String(approvalStep?.approver?.email || '').toLowerCase();
  const actingEmail  = req.user.email.toLowerCase();

  // Check if this step was delegated (step has delegatedFrom)
  const delegatedFrom = approvalStep?.delegatedFrom;

  if (!delegatedFrom) {
    // Not a delegated step — return comments as-is
    return comments;
  }

  // Build the on-behalf-of note
  const originalOwnerEmail = delegatedFrom.email;
  let   originalOwnerName  = delegatedFrom.name || originalOwnerEmail;

  // Append note to comments
  const note         = `[Approved by ${req.user.fullName} on behalf of ${originalOwnerName}]`;
  const finalComments = comments ? `${comments}\n${note}` : note;

  // Log action in the delegation document if we have a reference
  if (delegatedFrom.delegationId) {
    try {
      const delegation = await UserDelegation.findById(delegatedFrom.delegationId);
      if (delegation) {
        await delegation.logAction({
          action:          'approved',
          processType:     processType || 'unknown',
          requestId:       requestId   || null,
          requestDisplayId: requestDisplayId || null,
          requestModel:    requestModel || null,
          performedBy:     req.user._id || req.user.id,
          performedByName: req.user.fullName,
          onBehalfOf:      delegation.delegatorId,
          onBehalfOfName:  delegation.delegatorName,
          timestamp:       new Date(),
          note:            finalComments,
        });
      }
    } catch (e) {
      console.error('[delegationMiddleware] logAction error:', e.message);
    }
  }

  return finalComments;
};


// ─────────────────────────────────────────────────────────────────────────────
// logDelegatedSubmission(req, document, processType)
//
// Call this after successfully creating a document on behalf of a principal.
// Logs the action in the delegation's action log.
// ─────────────────────────────────────────────────────────────────────────────
const logDelegatedSubmission = async (req, document, processType) => {
  const ctx = req.delegationContext;
  if (!ctx?.isBehalf || !ctx.delegation) return;

  try {
    await ctx.delegation.logAction({
      action:           'submitted',
      processType,
      requestId:        document._id,
      requestDisplayId: document.displayId || document._id.toString().slice(-8).toUpperCase(),
      requestModel:     document.constructor?.modelName || processType,
      performedBy:      req.user._id || req.user.id,
      performedByName:  req.user.fullName,
      onBehalfOf:       ctx.principal._id,
      onBehalfOfName:   ctx.principal.fullName,
      timestamp:        new Date(),
      note:             ctx.onBehalfNote,
    });
  } catch (e) {
    console.error('[delegationMiddleware] logDelegatedSubmission error:', e.message);
  }
};


module.exports = {
  enforceDelegationLock,
  resolveDelegateIdentity,
  applyDelegationToApproval,
  logDelegatedSubmission,
};