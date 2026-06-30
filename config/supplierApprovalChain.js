// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/supplierApprovalChain.js
// VERSION: 3.1 — Role-based approval matching added
// ═══════════════════════════════════════════════════════════════════════════

const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

// ─── Department Head Registry ─────────────────────────────────────────────
const SUPPLIER_DEPT_HEADS = {
  'Technical': {
    name:  'Mr. Didier Oyong',
    email: 'didier.oyong@gratoengineering.com',
    role:  'Technical Director'
  },
  'Technical Operations': {
    name:  'Mr. Pascal Assam',
    email: 'pascal.rodrique@gratoglobal.com',
    role:  'Operations Manager'
  },
  'Technical HSE': {
    name:  'Mr. Ovo Bechem',
    email: 'bechem.mbu@gratoglobal.com',
    role:  'HSE Coordinator'
  },
  'Business Development & Supply Chain': {
    name:  'Mr. E.T Kelvin',
    email: 'kelvin.eyong@gratoglobal.com',
    role:  'Head of Business'
  },
  'HR/Admin': {
    name:  'Mrs. Bruiline Tsitoh',
    email: 'bruiline.tsitoh@gratoglobal.com',
    role:  'HR & Admin Head'
  },
  'HR & Admin': {
    name:  'Mrs. Bruiline Tsitoh',
    email: 'bruiline.tsitoh@gratoglobal.com',
    role:  'HR & Admin Head'
  },
  'IT': {
    name:  'Mr. Marcel Ngong',
    email: 'marcel.ngong@gratoglobal.com',
    role:  'IT Manager'
  },
  'Finance': {
    name:  'Ms. Ranibell Mambo',
    email: 'ranibellmambo@gratoengineering.com',
    role:  'Finance Officer'
  },
  'HSE': {
    name:  'Mr. Ovo Bechem',
    email: 'bechem.mbu@gratoglobal.com',
    role:  'HSE Coordinator'
  },
  'Operations': {
    name:  'Mr. Pascal Assam',
    email: 'pascal.rodrique@gratoglobal.com',
    role:  'Operations Manager'
  },
  'Supply Chain': {
    name:  'Mr. Lukong Lambert',
    email: 'lukong.lambert@gratoglobal.com',
    role:  'Supply Chain Coordinator'
  },
  'External Suppliers': {
    name:  'Mr. Lukong Lambert',
    email: 'lukong.lambert@gratoglobal.com',
    role:  'Supply Chain Coordinator'
  },
  'General': {
    name:  'Mr. E.T Kelvin',
    email: 'kelvin.eyong@gratoglobal.com',
    role:  'Head of Business'
  }
};

const HEAD_OF_BUSINESS = {
  name:       'Mr. E.T Kelvin',
  email:      'kelvin.eyong@gratoglobal.com',
  role:       'Head of Business',
  department: 'Business Development & Supply Chain'
};

const FINANCE_OFFICER = {
  name:       'Ms. Ranibell Mambo',
  email:      'ranibellmambo@gratoengineering.com',
  role:       'Finance Officer',
  department: 'Finance'
};

// const getSupplierApprovalChain = (departmentName = 'General', serviceCategory = null) => {
//   const chain      = [];
//   const seenEmails = new Set();

//   console.log(`Getting supplier approval chain for department: ${departmentName}`);

//   const addStep = (approverInfo, department) => {
//     const emailKey = approverInfo.email.toLowerCase();
//     if (seenEmails.has(emailKey)) {
//       console.log(`  ⊘ Skipping duplicate: ${approverInfo.name}`);
//       return;
//     }
//     chain.push({
//       level:        chain.length + 1,
//       approver: {
//         name:       approverInfo.name,
//         email:      approverInfo.email,
//         role:       approverInfo.role,
//         department: department || departmentName,
//       },
//       status:       'pending',
//       assignedDate: new Date(),
//     });
//     seenEmails.add(emailKey);
//     console.log(`  Level ${chain.length}: ${approverInfo.name} (${approverInfo.role})`);
//   };

//   const deptHead = SUPPLIER_DEPT_HEADS[departmentName] || SUPPLIER_DEPT_HEADS['General'];
//   addStep(deptHead, departmentName);

//   addStep(HEAD_OF_BUSINESS, 'Business Development & Supply Chain');

//   addStep(FINANCE_OFFICER, 'Finance');

//   const ceoCheck = requiresCEOApproval('supplier', null);
//   if (ceoCheck.required) {
//     addStep({
//       name:  CEO.name,
//       email: CEO.email,
//       role:  CEO.role,
//     }, CEO.department || 'CEO Office');
//   }

//   chain.forEach((step, index) => { step.level = index + 1; });

//   console.log(
//     `Supplier approval chain created with ${chain.length} levels:`,
//     chain.map(s => `Level ${s.level}: ${s.approver.name} (${s.approver.role})`)
//   );

//   return chain;
// };


const getSupplierApprovalChain = (departmentName = 'General', serviceCategory = null) => {
  const chain      = [];
  const seenEmails = new Set();

  console.log(`Getting supplier approval chain for department: ${departmentName}`);

  const addStep = (approverInfo, department) => {
    const emailKey = approverInfo.email.toLowerCase();
    if (seenEmails.has(emailKey)) {
      console.log(`  ⊘ Skipping duplicate: ${approverInfo.name}`);
      return;
    }
    chain.push({
      level:        chain.length + 1,
      approver: {
        name:       approverInfo.name,
        email:      approverInfo.email,
        role:       approverInfo.role,
        department: department || departmentName,
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    seenEmails.add(emailKey);
    console.log(`  Level ${chain.length}: ${approverInfo.name} (${approverInfo.role})`);
  };

  // ── Level 1: Department Head ──────────────────────────────────────────────
  const deptHead = SUPPLIER_DEPT_HEADS[departmentName] || SUPPLIER_DEPT_HEADS['General'];
  addStep(deptHead, departmentName);

  // ── Level 2: Head of Business (Kelvin) — skip if he's already Level 1 ────
  addStep(HEAD_OF_BUSINESS, 'Business Development & Supply Chain');

  // ── Level 3: Finance Officer — skip if dept is Finance ───────────────────
  addStep(FINANCE_OFFICER, 'Finance');

  // CEO step removed — supplier *creation* approval stops at Finance.
  // CEO still approves supplier *invoices* via the separate PO/invoice
  // approval chain (poApprovalChain.js), which is untouched.

  // Renumber levels to be strictly sequential
  chain.forEach((step, index) => { step.level = index + 1; });

  console.log(
    `Supplier approval chain created with ${chain.length} levels:`,
    chain.map(s => `Level ${s.level}: ${s.approver.name} (${s.approver.role})`)
  );

  return chain;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATUS & PERMISSION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// const getNextSupplierStatus = (currentLevel, totalLevels) => {
//   if (currentLevel >= totalLevels) return 'approved';
//   switch (currentLevel) {
//     case 1:  return 'pending_head_of_business_approval';
//     case 2:  return 'pending_finance_approval';
//     case 3:  return 'pending_ceo_approval';
//     default: return 'approved';
//   }
// };

const getNextSupplierStatus = (currentLevel, totalLevels) => {
  if (currentLevel >= totalLevels) return 'approved';
  switch (currentLevel) {
    case 1:  return 'pending_head_of_business';
    case 2:  return 'pending_finance';
    default: return 'approved';
  }
};

// const getUserSupplierApprovalLevel = (userRole, userEmail) => {
//   if (userEmail?.toLowerCase() === CEO.email?.toLowerCase()) return 4;
//   if (userRole === 'finance') return 3;
//   if (userEmail === HEAD_OF_BUSINESS.email)                   return 2;
//   if (userRole === 'admin')                                   return 4;
//   return 1; // Department heads
// };

const getUserSupplierApprovalLevel = (userRole, userEmail) => {
  if (userRole === 'finance') return 3;
  if (userEmail === HEAD_OF_BUSINESS.email)                   return 2;
  if (userRole === 'admin')                                   return 3; // admin can act anywhere
  return 1; // Department heads
};

// // Map a user's role to the supplier accountStatus they're authorized to act on.
// // `true` means the role can act on any pending status (e.g. admin).
// const ROLE_TO_SUPPLIER_STATUS = {
//   'supply_chain': 'pending_supply_chain',
//   'finance':      'pending_finance',
//   'ceo':          'pending_ceo',
//   'admin':        true
// };

const ROLE_TO_SUPPLIER_STATUS = {
  'supply_chain': 'pending_supply_chain',
  'finance':      'pending_finance',
  'admin':        true
};

/**
 * Determines whether a user can act on the current pending approval step.
 * Two ways to qualify:
 *   1. Named-approver match — user.email exactly matches the step's approver email
 *   2. Role-based match — user.role maps to the supplier's current accountStatus
 *      (e.g. any 'supply_chain' user can act while status === 'pending_supply_chain')
 */
const canUserApproveSupplier = (user, approvalStep, supplier) => {
  if (!user || !approvalStep) return false;

  // Named-approver match (exact person in the chain)
  if (user.email === approvalStep.approver.email) return true;

  // Role-based match
  const roleMatch = ROLE_TO_SUPPLIER_STATUS[user.role];
  if (roleMatch === true) return true; // e.g. admin
  if (roleMatch && supplier?.supplierStatus?.accountStatus === roleMatch) return true;

  return false;
};

const validateSupplierApproval = (user, supplier) => {
  if (!user || !supplier) {
    return { canApprove: false, reason: 'Missing user or supplier information' };
  }
  const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
  if (!currentStep) {
    return { canApprove: false, reason: 'No pending approval step found' };
  }
  const canApprove = canUserApproveSupplier(user, currentStep, supplier);
  if (!canApprove) {
    return {
      canApprove: false,
      reason: `Only ${currentStep.approver.role} (${currentStep.approver.name}) can approve at this level`,
    };
  }
  return {
    canApprove:   true,
    currentLevel: currentStep.level,
    approverRole: currentStep.approver.role,
  };
};

const getSupplierApprovalStats = (suppliers) => {
  const stats = {
    pending:                        0,
    pending_supply_chain:           0,
    pending_head_of_business:       0,
    pending_finance:                0,
    pending_ceo:                    0,
    approved:                       0,
    rejected:                       0,
    total:                          suppliers.length,
  };
  suppliers.forEach(supplier => {
    const status = supplier.supplierStatus?.accountStatus;
    if      (status === 'approved') { stats.approved++; }
    else if (status === 'rejected') { stats.rejected++; }
    else if (status === 'pending')  {
      stats.pending++;
      const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
      if (currentStep) {
        switch (currentStep.level) {
          case 1: stats.pending_supply_chain++;     break;
          case 2: stats.pending_head_of_business++; break;
          case 3: stats.pending_finance++;           break;
          case 4: stats.pending_ceo++;              break;
        }
      }
    }
  });
  return stats;
};

const getSupplyChainCoordinator = () => ({
  name:       'Mr. Lukong Lambert',
  email:      'lukong.lambert@gratoglobal.com',
  role:       'Supply Chain Coordinator',
  department: 'Business Development & Supply Chain',
});

const isCEOStep = (step) => {
  if (!step?.approver) return false;
  return (
    step.approver.role === 'CEO - Final Authority' ||
    String(step.approver.email || '').toLowerCase() === CEO.email.toLowerCase()
  );
};

const getAvailableDepartments = () => Object.keys(SUPPLIER_DEPT_HEADS);

module.exports = {
  getSupplierApprovalChain,
  getNextSupplierStatus,
  getUserSupplierApprovalLevel,
  canUserApproveSupplier,
  validateSupplierApproval,
  getSupplierApprovalStats,
  getSupplyChainCoordinator,
  isCEOStep,
  getAvailableDepartments,
  SUPPLIER_DEPT_HEADS,
};








// // ═══════════════════════════════════════════════════════════════════════════
// // FILE: config/supplierApprovalChain.js
// // VERSION: 3.0 — All departments, flexible chain length
// // ═══════════════════════════════════════════════════════════════════════════

// const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

// // ─── Department Head Registry ─────────────────────────────────────────────
// // Single source of truth for supplier invoice approval chains.
// // Add new departments here without touching anything else.
// const SUPPLIER_DEPT_HEADS = {
//   'Technical': {
//     name:  'Mr. Didier Oyong',
//     email: 'didier.oyong@gratoengineering.com',
//     role:  'Technical Director'
//   },
//   'Technical Operations': {
//     name:  'Mr. Pascal Assam',
//     email: 'pascal.rodrique@gratoglobal.com',
//     role:  'Operations Manager'
//   },
//   'Technical HSE': {
//     name:  'Mr. Ovo Bechem',
//     email: 'bechem.mbu@gratoglobal.com',
//     role:  'HSE Coordinator'
//   },
//   'Business Development & Supply Chain': {
//     name:  'Mr. E.T Kelvin',
//     email: 'kelvin.eyong@gratoglobal.com',
//     role:  'Head of Business'
//   },
//   'HR/Admin': {
//     name:  'Mrs. Bruiline Tsitoh',
//     email: 'bruiline.tsitoh@gratoglobal.com',
//     role:  'HR & Admin Head'
//   },
//   'HR & Admin': {
//     name:  'Mrs. Bruiline Tsitoh',
//     email: 'bruiline.tsitoh@gratoglobal.com',
//     role:  'HR & Admin Head'
//   },
//   'IT': {
//     name:  'Mr. Marcel Ngong',
//     email: 'marcel.ngong@gratoglobal.com',
//     role:  'IT Manager'
//   },
//   'Finance': {
//     name:  'Ms. Ranibell Mambo',
//     email: 'ranibellmambo@gratoengineering.com',
//     role:  'Finance Officer'
//   },
//   'HSE': {
//     name:  'Mr. Ovo Bechem',
//     email: 'bechem.mbu@gratoglobal.com',
//     role:  'HSE Coordinator'
//   },
//   'Operations': {
//     name:  'Mr. Pascal Assam',
//     email: 'pascal.rodrique@gratoglobal.com',
//     role:  'Operations Manager'
//   },
//   'Supply Chain': {
//     name:  'Mr. Lukong Lambert',
//     email: 'lukong.lambert@gratoglobal.com',
//     role:  'Supply Chain Coordinator'
//   },
//   'General': {
//     name:  'Mr. E.T Kelvin',
//     email: 'kelvin.eyong@gratoglobal.com',
//     role:  'Head of Business'
//   }
// };

// // Fixed approvers always in the chain
// const HEAD_OF_BUSINESS = {
//   name:       'Mr. E.T Kelvin',
//   email:      'kelvin.eyong@gratoglobal.com',
//   role:       'Head of Business',
//   department: 'Business Development & Supply Chain'
// };

// const FINANCE_OFFICER = {
//   name:       'Ms. Ranibell Mambo',
//   email:      'ranibellmambo@gratoengineering.com',
//   role:       'Finance Officer',
//   department: 'Finance'
// };

// /**
//  * Get supplier invoice approval chain for a department.
//  *
//  * Chain structure:
//  *   Level 1: Department Head (specific to assigned department)
//  *   Level 2: Head of Business / Kelvin  [skipped if dept head IS Kelvin]
//  *   Level 3: Finance Officer            [skipped if dept is Finance]
//  *   Level 4: CEO — Tom (always, strategic)
//  *
//  * @param {string} departmentName
//  * @param {string} [serviceCategory]  - optional, reserved for future routing
//  * @returns {Array} Approval chain steps
//  */
// const getSupplierApprovalChain = (departmentName = 'General', serviceCategory = null) => {
//   const chain      = [];
//   const seenEmails = new Set();

//   console.log(`Getting supplier approval chain for department: ${departmentName}`);

//   const addStep = (approverInfo, department) => {
//     const emailKey = approverInfo.email.toLowerCase();
//     if (seenEmails.has(emailKey)) {
//       console.log(`  ⊘ Skipping duplicate: ${approverInfo.name}`);
//       return;
//     }
//     chain.push({
//       level:        chain.length + 1,
//       approver: {
//         name:       approverInfo.name,
//         email:      approverInfo.email,
//         role:       approverInfo.role,
//         department: department || departmentName,
//       },
//       status:       'pending',
//       assignedDate: new Date(),
//     });
//     seenEmails.add(emailKey);
//     console.log(`  Level ${chain.length}: ${approverInfo.name} (${approverInfo.role})`);
//   };

//   // ── Level 1: Department Head ──────────────────────────────────────────────
//   const deptHead = SUPPLIER_DEPT_HEADS[departmentName] || SUPPLIER_DEPT_HEADS['General'];
//   addStep(deptHead, departmentName);

//   // ── Level 2: Head of Business (Kelvin) — skip if he's already Level 1 ────
//   addStep(HEAD_OF_BUSINESS, 'Business Development & Supply Chain');

//   // ── Level 3: Finance Officer — skip if dept is Finance ───────────────────
//   addStep(FINANCE_OFFICER, 'Finance');

//   // ── Level 4: CEO — always required for supplier invoices ─────────────────
//   const ceoCheck = requiresCEOApproval('supplier', null);
//   if (ceoCheck.required) {
//     addStep({
//       name:  CEO.name,
//       email: CEO.email,
//       role:  CEO.role,
//     }, CEO.department || 'CEO Office');
//   }

//   // Renumber levels to be strictly sequential
//   chain.forEach((step, index) => { step.level = index + 1; });

//   console.log(
//     `Supplier approval chain created with ${chain.length} levels:`,
//     chain.map(s => `Level ${s.level}: ${s.approver.name} (${s.approver.role})`)
//   );

//   return chain;
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // STATUS & PERMISSION HELPERS
// // ─────────────────────────────────────────────────────────────────────────────

// const getNextSupplierStatus = (currentLevel, totalLevels) => {
//   if (currentLevel >= totalLevels) return 'approved';
//   switch (currentLevel) {
//     case 1:  return 'pending_head_of_business_approval';
//     case 2:  return 'pending_finance_approval';
//     case 3:  return 'pending_ceo_approval';
//     default: return 'approved';
//   }
// };

// const getUserSupplierApprovalLevel = (userRole, userEmail) => {
//   if (userEmail?.toLowerCase() === CEO.email?.toLowerCase()) return 4;
//   if (userRole === 'finance') return 3;
//   if (userEmail === HEAD_OF_BUSINESS.email)                   return 2;
//   if (userRole === 'admin')                                   return 4;
//   return 1; // Department heads
// };

// const canUserApproveSupplier = (user, approvalStep) => {
//   if (!user || !approvalStep)                     return false;
//   if (user.email !== approvalStep.approver.email) return false;
//   return true; // Email match is sufficient — chain order enforces sequence
// };

// const validateSupplierApproval = (user, supplier) => {
//   if (!user || !supplier) {
//     return { canApprove: false, reason: 'Missing user or supplier information' };
//   }
//   const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
//   if (!currentStep) {
//     return { canApprove: false, reason: 'No pending approval step found' };
//   }
//   const canApprove = canUserApproveSupplier(user, currentStep);
//   if (!canApprove) {
//     return {
//       canApprove: false,
//       reason: `Only ${currentStep.approver.role} (${currentStep.approver.name}) can approve at this level`,
//     };
//   }
//   return {
//     canApprove:   true,
//     currentLevel: currentStep.level,
//     approverRole: currentStep.approver.role,
//   };
// };

// const getSupplierApprovalStats = (suppliers) => {
//   const stats = {
//     pending:                        0,
//     pending_supply_chain:           0,
//     pending_head_of_business:       0,
//     pending_finance:                0,
//     pending_ceo:                    0,
//     approved:                       0,
//     rejected:                       0,
//     total:                          suppliers.length,
//   };
//   suppliers.forEach(supplier => {
//     const status = supplier.supplierStatus?.accountStatus;
//     if      (status === 'approved') { stats.approved++; }
//     else if (status === 'rejected') { stats.rejected++; }
//     else if (status === 'pending')  {
//       stats.pending++;
//       const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
//       if (currentStep) {
//         switch (currentStep.level) {
//           case 1: stats.pending_supply_chain++;     break;
//           case 2: stats.pending_head_of_business++; break;
//           case 3: stats.pending_finance++;           break;
//           case 4: stats.pending_ceo++;              break;
//         }
//       }
//     }
//   });
//   return stats;
// };

// const getSupplyChainCoordinator = () => ({
//   name:       'Mr. Lukong Lambert',
//   email:      'lukong.lambert@gratoglobal.com',
//   role:       'Supply Chain Coordinator',
//   department: 'Business Development & Supply Chain',
// });

// const isCEOStep = (step) => {
//   if (!step?.approver) return false;
//   return (
//     step.approver.role === 'CEO - Final Authority' ||
//     String(step.approver.email || '').toLowerCase() === CEO.email.toLowerCase()
//   );
// };

// // Expose registry for external use (e.g. frontend dropdowns)
// const getAvailableDepartments = () => Object.keys(SUPPLIER_DEPT_HEADS);

// module.exports = {
//   getSupplierApprovalChain,
//   getNextSupplierStatus,
//   getUserSupplierApprovalLevel,
//   canUserApproveSupplier,
//   validateSupplierApproval,
//   getSupplierApprovalStats,
//   getSupplyChainCoordinator,
//   isCEOStep,
//   getAvailableDepartments,
//   SUPPLIER_DEPT_HEADS,
// };








