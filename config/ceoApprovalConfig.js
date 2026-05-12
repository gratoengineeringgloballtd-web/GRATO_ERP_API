// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/ceoApprovalConfig.js
// PURPOSE: Single source of truth for:
//   1. Which request types / amounts require CEO approval
//   2. CEO delegation and availability settings
//   3. Auto-escalation timeouts
//
// USAGE: Every approval chain builder imports requiresCEOApproval() and
//        calls it before deciding whether to add Tom as the final step.
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: THRESHOLD TABLE
// Amounts are in XAF (Central African Francs).
// 'alwaysEscalate' means the request type goes to Tom regardless of amount
// (e.g. supplier onboarding is strategic, not financial).
// 'neverEscalate' means it never reaches Tom regardless of amount.
// ─────────────────────────────────────────────────────────────────────────────

const CEO_THRESHOLDS = {

  // ── CASH / PETTY CASH ────────────────────────────────────────────────────
  cash_request: {
    // minAmountForCEO: 100_000,       // Below 100k → stops at Kelvin
    minAmountForCEO: 100_000, 
    currency: 'XAF',
    description: 'Cash / petty cash requests',
    escalationField: 'amount',       // field on the request object to check
  },

  // ── PURCHASE REQUISITIONS ────────────────────────────────────────────────
  purchase_requisition: {
    minAmountForCEO: 500_000,        // Below 500k → stops at Supply Chain + Kelvin
    currency: 'XAF',
    description: 'Purchase requisition requests',
    escalationField: 'totalBudget',  // or estimatedCost / budgetXAF
  },

  // ── INVOICES ─────────────────────────────────────────────────────────────
  invoice: {
    minAmountForCEO: 1_000_000,      // Below 1M → stops at Finance
    currency: 'XAF',
    description: 'Supplier / employee invoices',
    escalationField: 'invoiceAmount',
  },

  // ── PURCHASE ORDERS ──────────────────────────────────────────────────────
  purchase_order: {
    minAmountForCEO: 500_000,
    currency: 'XAF',
    description: 'Purchase orders raised by buyers',
    escalationField: 'totalAmount',
  },

  // ── DEBIT NOTES ──────────────────────────────────────────────────────────
  debit_note: {
    minAmountForCEO: 100_000,
    currency: 'XAF',
    description: 'Debit notes for supplier disputes',
    escalationField: 'amount',
  },

  // ── BUDGET CODES ─────────────────────────────────────────────────────────
  budget_code: {
    minAmountForCEO: 1_000_000,      // Budget codes below 1M end at Finance
    currency: 'XAF',
    description: 'Budget code creation and revisions',
    escalationField: 'budget',
  },

  // ── BUDGET TRANSFERS ─────────────────────────────────────────────────────
  budget_transfer: {
    minAmountForCEO: 500_000,
    currency: 'XAF',
    description: 'Budget transfers between codes',
    escalationField: 'transferAmount',
  },

  // ── SALARY PAYMENTS ──────────────────────────────────────────────────────
  salary_payment: {
    minAmountForCEO: 5_000_000,      // Bulk payroll above 5M needs CEO
    currency: 'XAF',
    description: 'Bulk salary payment processing',
    escalationField: 'totalAmount',
  },

  // ── SUPPLIER ONBOARDING ──────────────────────────────────────────────────
  // Strategic — always goes to CEO regardless of any amount
  supplier: {
    alwaysEscalate: true,
    currency: 'XAF',
    description: 'New supplier registration and approval',
  },

  // ── PROJECT PLANS ────────────────────────────────────────────────────────
  // Strategic — always goes to CEO
  project_plan: {
    alwaysEscalate: true,
    description: 'Weekly / monthly project plans',
  },

  // ── LEAVE REQUESTS ───────────────────────────────────────────────────────
  // Non-financial — never reaches CEO, HR is the final authority
  leave_request: {
    neverEscalate: true,
    description: 'Employee leave / sick leave requests',
  },

  // ── IT SUPPORT ───────────────────────────────────────────────────────────
  // Operational — never reaches CEO, IT department is final
  it_support: {
    neverEscalate: true,
    description: 'IT material requests and issue reports',
  },

  // ── INCIDENT REPORTS ─────────────────────────────────────────────────────
  // HSE-managed — never reaches CEO unless escalated manually
  incident_report: {
    neverEscalate: true,
    description: 'Workplace incident reports',
  },

  // ── SUGGESTIONS ──────────────────────────────────────────────────────────
  // HR-managed — never reaches CEO
  suggestion: {
    neverEscalate: true,
    description: 'Employee suggestions and feedback',
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: AUTO-ESCALATION TIMEOUTS
// How many days before the system:
//   - Sends a reminder to Tom
//   - Auto-delegates to Kelvin if still no action
// ─────────────────────────────────────────────────────────────────────────────

const CEO_ESCALATION_TIMEOUTS = {
  // Days after reaching Tom's step before first reminder email
  reminderAfterDays: 2,

  // Days after reaching Tom's step before auto-delegating to Kelvin
  // (only activates if Tom has NOT manually set himself as unavailable)
  autoDelegateAfterDays: 5,

  // Once auto-delegated, how many days Kelvin has before the finance team
  // is notified that it's stuck
  delegateWarningAfterDays: 3,
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: CEO AND DELEGATE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const CEO = {
  name:       'Mr. Tom',
  email:      'tom@gratoengineering.com',
  role:       'CEO - Final Authority',
  department: 'CEO Office',
};

const DEFAULT_CEO_DELEGATE = {
  name:       'Mr. E.T Kelvin',
  email:      'kelvin.eyong@gratoglobal.com',
  role:       'Acting CEO (Delegate)',
  department: 'Business Development & Supply Chain',
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: CORE HELPER — requiresCEOApproval()
//
// Every approval chain builder calls this before deciding to add Tom's step.
// Returns: { required: true/false, reason: string }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decides whether a CEO approval step should be added to a request's chain.
 *
 * @param {string} requestType - key from CEO_THRESHOLDS (e.g. 'cash_request')
 * @param {number|null} amount  - the monetary value of the request (XAF), or null
 * @returns {{ required: boolean, reason: string }}
 */
const requiresCEOApproval = (requestType, amount = null) => {
  const config = CEO_THRESHOLDS[requestType];

  // Unknown request type → default to NOT requiring CEO (safe fallback)
  if (!config) {
    console.warn(`[ceoApprovalConfig] Unknown requestType: "${requestType}". Defaulting to no CEO step.`);
    return {
      required: false,
      reason:   `Unknown request type "${requestType}" — CEO step skipped by default`,
    };
  }

  // Explicitly never escalates
  if (config.neverEscalate) {
    return {
      required: false,
      reason:   `${config.description} never requires CEO approval`,
    };
  }

  // Explicitly always escalates (strategic decisions)
  if (config.alwaysEscalate) {
    return {
      required: true,
      reason:   `${config.description} always requires CEO approval (strategic)`,
    };
  }

  // Amount-based check
  if (config.minAmountForCEO !== undefined) {
    if (amount === null || amount === undefined) {
      // No amount provided — be conservative and require CEO
      console.warn(`[ceoApprovalConfig] No amount provided for "${requestType}". Requiring CEO approval as a precaution.`);
      return {
        required: true,
        reason:   `Amount not provided — CEO approval required as precaution`,
      };
    }

    const numericAmount = Number(amount) || 0;

    if (numericAmount >= config.minAmountForCEO) {
      return {
        required: true,
        reason:   `Amount ${numericAmount.toLocaleString()} XAF ≥ threshold ${config.minAmountForCEO.toLocaleString()} XAF`,
      };
    } else {
      return {
        required: false,
        reason:   `Amount ${numericAmount.toLocaleString()} XAF < threshold ${config.minAmountForCEO.toLocaleString()} XAF — stops at Kelvin/Finance`,
      };
    }
  }

  // Fallback
  return { required: false, reason: 'No escalation rule matched' };
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: DELEGATION HELPER — getEffectiveCEOApprover()
//
// Call this when BUILDING a chain to decide who the final approver actually is.
// If Tom is unavailable and has a live delegate, returns the delegate instead.
//
// NOTE: This requires a DB lookup (async). The User model must have the
//       availability fields described in User.js changes below.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the effective final approver — either Tom or his active delegate.
 *
 * @param {Object} User - the Mongoose User model
 * @returns {Promise<{ name, email, role, department, isDelegated: boolean }>}
 */
const getEffectiveCEOApprover = async (User) => {
  try {
    const ceoUser = await User.findOne({ email: CEO.email }).select(
      'fullName email ceoAvailability'
    );

    if (!ceoUser) {
      // CEO user not in DB yet — use default CEO object
      return { ...CEO, isDelegated: false };
    }

    const availability = ceoUser.ceoAvailability || {};
    const isUnavailable = availability.isUnavailable === true;
    const delegateEmail = availability.delegateEmail;

    // Check if unavailability period has expired
    if (isUnavailable && availability.unavailableUntil) {
      const now = new Date();
      if (new Date(availability.unavailableUntil) < now) {
        // Period expired — treat as available
        return { ...CEO, isDelegated: false };
      }
    }

    if (isUnavailable && delegateEmail) {
      const delegate = await User.findOne({ email: delegateEmail }).select('fullName email');
      if (delegate) {
        return {
          name:        delegate.fullName,
          email:       delegate.email,
          role:        'Acting CEO (Delegate)',
          department:  'Business Development & Supply Chain',
          isDelegated: true,
          delegatedBy: CEO.name,
        };
      }
    }

    // Tom is available
    return { ...CEO, isDelegated: false };

  } catch (err) {
    console.error('[ceoApprovalConfig] getEffectiveCEOApprover error:', err.message);
    return { ...CEO, isDelegated: false };
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: THRESHOLD DISPLAY HELPER
// Used by the frontend to show users why their request did/didn't reach CEO.
// ─────────────────────────────────────────────────────────────────────────────

const getThresholdInfo = (requestType) => {
  const config = CEO_THRESHOLDS[requestType];
  if (!config) return null;

  if (config.neverEscalate) {
    return { escalates: false, message: 'This request type does not require CEO approval.' };
  }
  if (config.alwaysEscalate) {
    return { escalates: true, threshold: null, message: 'This request always requires CEO approval.' };
  }
  return {
    escalates:  null, // depends on amount
    threshold:  config.minAmountForCEO,
    currency:   config.currency || 'XAF',
    message:    `Requests of ${config.minAmountForCEO.toLocaleString()} XAF and above require CEO approval.`,
  };
};


module.exports = {
  CEO_THRESHOLDS,
  CEO_ESCALATION_TIMEOUTS,
  CEO,
  DEFAULT_CEO_DELEGATE,
  requiresCEOApproval,
  getEffectiveCEOApprover,
  getThresholdInfo,
};