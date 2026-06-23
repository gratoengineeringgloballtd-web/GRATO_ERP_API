'use strict';
// config/engineeringIncidentApprovalChain.js
// ─────────────────────────────────────────────────────────────────────────────
// Fixed 3-level approval chain for Engineering Incident Reports.
// Level 1 (Reviewed By)  → Pascal Assam  (Operations Manager)
// Level 2 (Approved By)  → Didier Oyong  (Technical Director)
// Level 3 (HSE)          → Ovo Bechem    (HSE Coordinator)
//
// The submitter's "Prepared By" block is auto-filled from the logged-in user
// and requires no approval — it is captured as metadata only.
// ─────────────────────────────────────────────────────────────────────────────

const ENGINEERING_APPROVERS = {
  pascal: {
    name:        'Mr. Pascal Assam',
    email:       'pascal.rodrique@gratoglobal.com',
    designation: 'Operations Manager',
    role:        'reviewed_by',
    label:       'Reviewed By',
    level:       1
  },
  didier: {
    name:        'Mr. Didier Oyong',
    email:       'didier.oyong@gratoengineering.com',
    designation: 'Technical Director',
    role:        'approved_by',
    label:       'Approved By',
    level:       2
  }
};

/**
 * Build the initial approval chain for a new Engineering Incident Report.
 * @returns {Array}  Three approval step objects ready to embed in the report.
 */
const getEngineeringApprovalChain = () => {
  const now = new Date();
  return [
    {
      level:        ENGINEERING_APPROVERS.pascal.level,
      role:         ENGINEERING_APPROVERS.pascal.role,
      label:        ENGINEERING_APPROVERS.pascal.label,
      approver: {
        name:        ENGINEERING_APPROVERS.pascal.name,
        email:       ENGINEERING_APPROVERS.pascal.email,
        designation: ENGINEERING_APPROVERS.pascal.designation,
        userId:      null
      },
      status:       'pending',
      comments:     '',
      actionDate:   null,
      actionTime:   '',
      signatureUrl: '',
      assignedDate: now    // Level 1 is active immediately on submission
    },
    {
      level:        ENGINEERING_APPROVERS.didier.level,
      role:         ENGINEERING_APPROVERS.didier.role,
      label:        ENGINEERING_APPROVERS.didier.label,
      approver: {
        name:        ENGINEERING_APPROVERS.didier.name,
        email:       ENGINEERING_APPROVERS.didier.email,
        designation: ENGINEERING_APPROVERS.didier.designation,
        userId:      null
      },
      status:       'pending',
      comments:     '',
      actionDate:   null,
      actionTime:   '',
      signatureUrl: '',
      assignedDate: null   // Assigned after Pascal approves
    }
  ];
};

/**
 * Map currentApprovalLevel → overallStatus string.
 */
const getStatusAfterApproval = (level, totalLevels) => {
  if (level >= totalLevels) return 'approved';
  const nextLevel = level + 1;
  const map = { 1: 'pending_review', 2: 'pending_approval' };
  return map[nextLevel] || 'pending_review';
};

/**
 * Return the email that should receive a notification when a given level becomes active.
 */
const getNotificationEmailForLevel = (level) => {
  const map = {
    1: ENGINEERING_APPROVERS.pascal.email,
    2: ENGINEERING_APPROVERS.didier.email
  };
  return map[level] || null;
};

/**
 * Check whether a given user (by email) is an approver in this chain.
 */
const isEngineeringApprover = (email) => {
  return Object.values(ENGINEERING_APPROVERS).some(
    a => a.email.toLowerCase() === (email || '').toLowerCase()
  );
};

/**
 * Check whether Pascal or Didier (dashboard viewers) can see all Technical reports.
 */
const canViewAllTechnicalReports = (email) => {
  const viewers = [
    ENGINEERING_APPROVERS.pascal.email,
    ENGINEERING_APPROVERS.didier.email
  ].map(e => e.toLowerCase());
  return viewers.includes((email || '').toLowerCase());
};

module.exports = {
  ENGINEERING_APPROVERS,
  getEngineeringApprovalChain,
  getStatusAfterApproval,
  getNotificationEmailForLevel,
  isEngineeringApprover,
  canViewAllTechnicalReports
};

