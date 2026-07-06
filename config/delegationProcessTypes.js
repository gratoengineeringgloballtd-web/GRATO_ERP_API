// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/delegationProcessTypes.js  (NEW FILE)
//
// PURPOSE: Single source of truth for every process type that can be
//          delegated between users.  Both the backend service and the
//          frontend settings page import from here.
//
// ADDING A NEW TYPE: add one entry to DELEGATION_PROCESS_TYPES and one
//   entry to PROCESS_TYPE_MODEL_CONFIG.  Nothing else needs to change.
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — PROCESS TYPE REGISTRY
//
// Each key is the canonical process type identifier used throughout the system.
// ─────────────────────────────────────────────────────────────────────────────

const DELEGATION_PROCESS_TYPES = {

  // ── FINANCE ────────────────────────────────────────────────────────────────
  cash_request: {
    label:       'Cash Requests',
    description: 'Petty cash requests, advances, and reimbursements',
    category:    'Finance',
    icon:        'DollarOutlined',
  },
  invoice: {
    label:       'Invoices',
    description: 'Supplier and employee invoice submissions and approvals',
    category:    'Finance',
    icon:        'FileTextOutlined',
  },
  budget_code: {
    label:       'Budget Codes',
    description: 'Budget code creation, revisions, and approvals',
    category:    'Finance',
    icon:        'BankOutlined',
  },
  salary_payment: {
    label:       'Salary Payments',
    description: 'Bulk salary payment processing and approvals',
    category:    'Finance',
    icon:        'WalletOutlined',
  },

  // ── PROCUREMENT ────────────────────────────────────────────────────────────
  purchase_requisition: {
    label:       'Purchase Requisitions',
    description: 'Purchase requisition submission and approval workflow',
    category:    'Procurement',
    icon:        'ShoppingCartOutlined',
  },
  purchase_order: {
    label:       'Purchase Orders',
    description: 'Purchase order creation, approval, and management',
    category:    'Procurement',
    icon:        'SolutionOutlined',
  },
  debit_note: {
    label:       'Debit Notes',
    description: 'Debit notes for supplier disputes and adjustments',
    category:    'Procurement',
    icon:        'AuditOutlined',
  },

  // ── SUPPLIER ───────────────────────────────────────────────────────────────
  supplier: {
    label:       'Supplier Onboarding',
    description: 'New supplier registration and approval workflow',
    category:    'Procurement',
    icon:        'ContactsOutlined',
  },

  // ── HR ─────────────────────────────────────────────────────────────────────
  leave_request: {
    label:       'Leave Requests',
    description: 'Annual, sick, and special leave submissions and approvals',
    category:    'HR',
    icon:        'MedicineBoxOutlined',
  },
  suggestion: {
    label:       'Employee Suggestions',
    description: 'Employee feedback and suggestion submissions',
    category:    'HR',
    icon:        'BulbOutlined',
  },

  // ── HSE ────────────────────────────────────────────────────────────────────
  incident_report: {
    label:       'Incident Reports',
    description: 'Workplace incident and safety reports',
    category:    'HSE',
    icon:        'ExclamationCircleOutlined',
  },

  // ── IT ─────────────────────────────────────────────────────────────────────
  it_support: {
    label:       'IT Support Requests',
    description: 'IT material requests and issue reports',
    category:    'IT',
    icon:        'LaptopOutlined',
  },

  // ── PROJECTS ───────────────────────────────────────────────────────────────
  project_plan: {
    label:       'Project Plans',
    description: 'Weekly and monthly project plan submissions and approvals',
    category:    'Projects',
    icon:        'ScheduleOutlined',
  },
  action_item: {
    label:       'Action Items / Tasks',
    description: 'Task creation, assignment, and completion approvals',
    category:    'Projects',
    icon:        'CheckCircleOutlined',
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — MODEL CONFIG
//
// Maps each process type to its Mongoose model and how to:
//   - find the "principal" (the person the document belongs to)
//   - find the active pending approval step
//   - generate a display ID for notifications
//
// useCurrentLevel: true  → model has `currentApprovalLevel` integer field;
//                          step is active when step.level === currentApprovalLevel
// useCurrentLevel: false → active step = first pending entry in sorted chain
//
// employeeField: the field on the document that holds the submitting user's ID
// ─────────────────────────────────────────────────────────────────────────────

const PROCESS_TYPE_MODEL_CONFIG = {
  cash_request: {
    modelName:        'CashRequest',
    useCurrentLevel:  false,
    employeeField:    'employee',      // ObjectId ref User
    statusField:      'status',
    terminalStatuses: ['approved', 'denied', 'completed', 'fully_disbursed'],
  },
  purchase_requisition: {
    modelName:        'PurchaseRequisition',
    useCurrentLevel:  false,
    employeeField:    'employee',
    statusField:      'status',
    terminalStatuses: ['approved', 'rejected', 'completed', 'cancelled', 'delivered'],
  },
  invoice: {
    modelName:        'Invoice',
    useCurrentLevel:  true,
    employeeField:    'employee',
    statusField:      'approvalStatus',
    terminalStatuses: ['approved', 'rejected', 'processed'],
  },
  purchase_order: {
    modelName:        'PurchaseOrder',
    useCurrentLevel:  true,
    employeeField:    'createdBy',
    statusField:      'status',
    terminalStatuses: ['approved', 'rejected', 'completed', 'cancelled', 'delivered'],
  },
  debit_note: {
    modelName:        'DebitNote',
    useCurrentLevel:  true,
    employeeField:    'createdBy',
    statusField:      'status',
    terminalStatuses: ['approved', 'rejected'],
  },
  budget_code: {
    modelName:        'BudgetCode',
    useCurrentLevel:  false,
    employeeField:    'createdBy',
    statusField:      'status',
    terminalStatuses: ['active', 'rejected', 'expired'],
  },
  supplier: {
    modelName:        'User',
    useCurrentLevel:  true,
    employeeField:    null,            // supplier is the User document itself
    extraQuery:       { role: 'supplier' },
    statusField:      'supplierStatus.accountStatus',
    terminalStatuses: ['approved', 'rejected'],
  },
  // ── Models confirmed but needing model name verification ──────────────────
  leave_request: {
    modelName:        'SickLeave',     // adjust if model is named differently
    useCurrentLevel:  false,
    employeeField:    'employee',
    statusField:      'status',
    terminalStatuses: ['approved', 'rejected'],
  },
  incident_report: {
    modelName:        'IncidentReport',
    useCurrentLevel:  false,
    employeeField:    'reportedBy',
    statusField:      'status',
    terminalStatuses: ['closed', 'resolved'],
  },
  it_support: {
    modelName:        'ITRequest',
    useCurrentLevel:  false,
    employeeField:    'requestedBy',
    statusField:      'status',
    terminalStatuses: ['completed', 'rejected', 'closed'],
  },
  suggestion: {
    modelName:        'Suggestion',
    useCurrentLevel:  false,
    employeeField:    'submittedBy',
    statusField:      'status',
    terminalStatuses: ['implemented', 'rejected', 'closed'],
  },
  project_plan: {
    modelName:        'ProjectPlan',
    useCurrentLevel:  false,
    employeeField:    'createdBy',
    statusField:      'status',
    terminalStatuses: ['approved', 'rejected'],
  },
  action_item: {
    modelName:        'ActionItem',
    useCurrentLevel:  false,
    employeeField:    'createdBy',
    statusField:      'status',
    terminalStatuses: ['completed', 'cancelled'],
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — CATEGORY GROUPING (used by the settings UI)
// ─────────────────────────────────────────────────────────────────────────────

const PROCESS_TYPE_CATEGORIES = [
  'Finance',
  'Procurement',
  'HR',
  'HSE',
  'IT',
  'Projects',
];

/**
 * Returns all process types grouped by category, ready for the settings UI.
 * @returns {Array<{ category, types: [{ key, ...config }] }>}
 */
const getProcessTypesByCategory = () =>
  PROCESS_TYPE_CATEGORIES.map((category) => ({
    category,
    types: Object.entries(DELEGATION_PROCESS_TYPES)
      .filter(([, cfg]) => cfg.category === category)
      .map(([key, cfg]) => ({ key, ...cfg })),
  })).filter((g) => g.types.length > 0);


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if `processType` is a valid, known delegation type.
 */
const isValidProcessType = (processType) =>
  Object.prototype.hasOwnProperty.call(DELEGATION_PROCESS_TYPES, processType);

/**
 * Given an array of process type keys, returns only the valid ones.
 */
const filterValidProcessTypes = (types = []) =>
  types.filter(isValidProcessType);

/**
 * Returns all process type keys.
 */
const getAllProcessTypeKeys = () => Object.keys(DELEGATION_PROCESS_TYPES);


module.exports = {
  DELEGATION_PROCESS_TYPES,
  PROCESS_TYPE_MODEL_CONFIG,
  PROCESS_TYPE_CATEGORIES,
  getProcessTypesByCategory,
  isValidProcessType,
  filterValidProcessTypes,
  getAllProcessTypeKeys,
};