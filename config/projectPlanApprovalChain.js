// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/projectPlanApprovalChain.js
// VERSION: 2.1 — CEO via ceoApprovalConfig (project_plan = alwaysEscalate)
// ═══════════════════════════════════════════════════════════════════════════

const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');
const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

/**
 * ✅ VERSION 2.1: Get Project Plan approval chain.
 *
 * Project plans are marked `alwaysEscalate` in ceoApprovalConfig,
 * so CEO is always added regardless of any amount.
 *
 *   Level 1: Project Coordinator  (Christabel Mangwi)
 *   Level 2: Supply Chain Coordinator (Lukong Lambert)
 *   Level 3: Head of Business (Kelvin Eyong)
 *   Level 4: CEO — Tom (always, strategic decision)
 *
 * @param {string} department
 * @returns {Array} Approval chain steps
 */
const getProjectPlanApprovalChain = (department) => {
  console.log(`\n=== BUILDING PROJECT PLAN APPROVAL CHAIN (V2.1) ===`);
  console.log(`Department: ${department}`);

  const chain = [];

  // ── Level 1: Project Coordinator (Christabel Mangwi) ─────────────────────
  const projectCoordinator = {
    name:       'Ms. Christabel Mangwi',
    email:      'christabel@gratoengineering.com',
    role:       'Order Management Assistant/Buyer',
    position:   'Project Coordinator',
    department: 'Business Development & Supply Chain',
  };

  chain.push({
    level:        1,
    approver:     projectCoordinator.name,
    email:        projectCoordinator.email,
    role:         'Project Coordinator',
    department:   projectCoordinator.department,
    status:       'pending',
    assignedDate: new Date(),
  });
  console.log(`✓ Level 1: ${projectCoordinator.name} (Project Coordinator) — ${projectCoordinator.email}`);

  // ── Level 2: Supply Chain Coordinator (Lukong Lambert) ───────────────────
  const supplyChainCoordinator =
    DEPARTMENT_STRUCTURE['Business Development & Supply Chain']?.positions?.['Supply Chain Coordinator'] || {
      name:       'Mr. Lukong Lambert',
      email:      'lukong.lambert@gratoglobal.com',
      department: 'Business Development & Supply Chain',
    };

  chain.push({
    level:        2,
    approver:     supplyChainCoordinator.name,
    email:        supplyChainCoordinator.email,
    role:         'Supply Chain Coordinator',
    department:   supplyChainCoordinator.department || 'Business Development & Supply Chain',
    status:       'pending',
    assignedDate: new Date(),
  });
  console.log(`✓ Level 2: ${supplyChainCoordinator.name} (Supply Chain Coordinator) — ${supplyChainCoordinator.email}`);

  // ── Level 3: Head of Business (Kelvin Eyong) ─────────────────────────────
  const headOfBusiness = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'].head;

  chain.push({
    level:        3,
    approver:     headOfBusiness.name,
    email:        headOfBusiness.email,
    role:         'Head of Business',
    department:   'Business Development & Supply Chain',
    status:       'pending',
    assignedDate: new Date(),
  });
  console.log(`✓ Level 3: ${headOfBusiness.name} (Head of Business) — ${headOfBusiness.email}`);

  // ── Level 4: CEO — always required for project plans (alwaysEscalate) ────
  const ceoCheckPP = requiresCEOApproval('project_plan', null);
  if (ceoCheckPP.required) {
    chain.push({
      level:        4,
      approver:     CEO.name,
      email:        CEO.email,
      role:         CEO.role,
      department:   CEO.department,
      status:       'pending',
      assignedDate: new Date(),
    });
    console.log(`✓ Level 4: ${CEO.name} (${CEO.role}) — ${CEO.email}`);
  }
  // ── END CEO STEP ──────────────────────────────────────────────────────────

  const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
  console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
  console.log('=== END PROJECT PLAN APPROVAL CHAIN ===\n');

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getProjectCoordinator = () => {
  return {
    name:       'Ms. Christabel Mangwi',
    email:      'christabel@gratoengineering.com',
    role:       'Project Coordinator',
    department: 'Business Development & Supply Chain',
  };
};

const getSupplyChainCoordinator = () => {
  const coordinator =
    DEPARTMENT_STRUCTURE['Business Development & Supply Chain']?.positions?.['Supply Chain Coordinator'];

  if (coordinator) {
    return {
      name:       coordinator.name,
      email:      coordinator.email,
      role:       'Supply Chain Coordinator',
      department: 'Business Development & Supply Chain',
    };
  }

  return {
    name:       'Mr. Lukong Lambert',
    email:      'lukong.lambert@gratoglobal.com',
    role:       'Supply Chain Coordinator',
    department: 'Business Development & Supply Chain',
  };
};

const getHeadOfBusiness = () => {
  const headOfBusiness = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'].head;
  return {
    name:       headOfBusiness.name,
    email:      headOfBusiness.email,
    role:       'Head of Business',
    department: 'Business Development & Supply Chain',
  };
};


// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL LOGIC HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a user can approve project plans at a specific level.
 */
const canApproveProjectPlan = (userEmail, level) => {
  if (level === 1) return userEmail === getProjectCoordinator().email;
  if (level === 2) return userEmail === getSupplyChainCoordinator().email;
  if (level === 3) return userEmail === getHeadOfBusiness().email;
  if (level === 4) return userEmail === CEO.email;
  return false;
};

const getCurrentApprover = (approvalChain) => {
  if (!approvalChain || approvalChain.length === 0) return null;

  const pendingApproval = approvalChain.find(item => item.status === 'pending');
  if (pendingApproval) {
    return {
      level:    pendingApproval.level,
      approver: pendingApproval.approver,
      email:    pendingApproval.email,
      role:     pendingApproval.role,
    };
  }

  const allApproved = approvalChain.every(item => item.status === 'approved');
  if (allApproved) return null;

  return approvalChain.find(item => item.status !== 'approved');
};

const updateApprovalStatus = (approvalChain, level, status, comments = '', approvedBy = null) => {
  const chainItem = approvalChain.find(item => item.level === level);
  if (!chainItem) throw new Error(`Approval level ${level} not found in chain`);

  chainItem.status      = status;
  chainItem.approvalDate = new Date();
  chainItem.comments    = comments;
  chainItem.approvedBy  = approvedBy;

  return approvalChain;
};

const isFullyApproved = (approvalChain) => {
  if (!approvalChain || approvalChain.length === 0) return false;
  return approvalChain.every(item => item.status === 'approved');
};

const getNextApprover = (approvalChain, currentLevel) => {
  const nextLevel = currentLevel + 1;
  return approvalChain.find(item => item.level === nextLevel) || null;
};

const getApprovalProgress = (approvalChain) => {
  if (!approvalChain || approvalChain.length === 0) return 0;
  const approvedCount = approvalChain.filter(item => item.status === 'approved').length;
  return Math.round((approvedCount / approvalChain.length) * 100);
};

/**
 * NOTE: Project plan chain steps use a flat shape ({ approver, email, role })
 * rather than the nested { approver: { email } } shape used in other chains.
 * This predicate matches that flat shape.
 */
const isCEOStep = (step) => {
  if (!step) return false;
  return (
    step.role  === 'CEO - Final Authority' ||
    String(step.email || '').toLowerCase() === CEO.email.toLowerCase()
  );
};


module.exports = {
  getProjectPlanApprovalChain,
  getProjectCoordinator,
  getSupplyChainCoordinator,
  getHeadOfBusiness,
  canApproveProjectPlan,
  getCurrentApprover,
  updateApprovalStatus,
  isFullyApproved,
  getNextApprover,
  getApprovalProgress,
  isCEOStep,
};










// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get Project Plan approval chain (4 levels):
//  * Level 1: Project Coordinator (Christabel Mangwi)
//  * Level 2: Supply Chain Coordinator (Lukong Lambert)
//  * Level 3: Head of Business (Kelvin Eyong)
//  * Level 4: CEO - Final Authority (Mr. Tom)
//  */
// const getProjectPlanApprovalChain = (department) => {
//   console.log(`\n=== BUILDING PROJECT PLAN APPROVAL CHAIN ===`);
//   console.log(`Department: ${department}`);
  
//   const chain = [];
  
//   // Level 1: Project Coordinator (Christabel Mangwi)
//   const projectCoordinator = {
//     name: 'Ms. Christabel Mangwi',
//     email: 'christabel@gratoengineering.com',
//     role: 'Order Management Assistant/Buyer',
//     position: 'Project Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
  
//   chain.push({
//     level: 1,
//     approver: projectCoordinator.name,
//     email: projectCoordinator.email,
//     role: 'Project Coordinator',
//     department: projectCoordinator.department,
//     status: 'pending',
//     assignedDate: new Date()
//   });
//   console.log(`✓ Level 1: ${projectCoordinator.name} (Project Coordinator) - ${projectCoordinator.email}`);
  
//   // Level 2: Supply Chain Coordinator (Lukong Lambert)
//   const supplyChainCoordinator = DEPARTMENT_STRUCTURE['Business Development & Supply Chain']?.positions?.['Supply Chain Coordinator'] || {
//     name: 'Mr. Lukong Lambert',
//     email: 'lukong.lambert@gratoglobal.com',
//     department: 'Business Development & Supply Chain'
//   };

//   chain.push({
//     level: 2,
//     approver: supplyChainCoordinator.name,
//     email: supplyChainCoordinator.email,
//     role: 'Supply Chain Coordinator',
//     department: supplyChainCoordinator.department || 'Business Development & Supply Chain',
//     status: 'pending',
//     assignedDate: new Date()
//   });
//   console.log(`✓ Level 2: ${supplyChainCoordinator.name} (Supply Chain Coordinator) - ${supplyChainCoordinator.email}`);

//   // Level 3: Head of Business (Kelvin Eyong)
//   const headOfBusiness = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'].head;

//   chain.push({
//     level: 3,
//     approver: headOfBusiness.name,
//     email: headOfBusiness.email,
//     role: 'Head of Business',
//     department: 'Business Development & Supply Chain',
//     status: 'pending',
//     assignedDate: new Date()
//   });
//   console.log(`✓ Level 3: ${headOfBusiness.name} (Head of Business) - ${headOfBusiness.email}`);

//   // Level 4: CEO — absolute final approval
//   chain.push({
//     level:      4,
//     approver:   'Mr. Tom',
//     email:      'tom@gratoengineering.com',
//     role:       'CEO - Final Authority',
//     department: 'CEO Office',
//     status:     'pending',
//     assignedDate: new Date()
//   });
//   console.log(`✓ Level 4: Mr. Tom (CEO - Final Authority) - tom@gratoengineering.com`);
  
//   const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (4 levels): ${finalChain}`);
//   console.log('=== END PROJECT PLAN APPROVAL CHAIN ===\n');
  
//   return chain;
// };

// const getProjectCoordinator = () => {
//   return {
//     name: 'Ms. Christabel Mangwi',
//     email: 'christabel@gratoengineering.com',
//     role: 'Project Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
// };

// const getSupplyChainCoordinator = () => {
//   const coordinator = DEPARTMENT_STRUCTURE['Business Development & Supply Chain']?.positions?.['Supply Chain Coordinator'];
//   if (coordinator) {
//     return {
//       name: coordinator.name,
//       email: coordinator.email,
//       role: 'Supply Chain Coordinator',
//       department: 'Business Development & Supply Chain'
//     };
//   }
//   return {
//     name: 'Mr. Lukong Lambert',
//     email: 'lukong.lambert@gratoglobal.com',
//     role: 'Supply Chain Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
// };

// const getHeadOfBusiness = () => {
//   const headOfBusiness = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'].head;
//   return {
//     name: headOfBusiness.name,
//     email: headOfBusiness.email,
//     role: 'Head of Business',
//     department: 'Business Development & Supply Chain'
//   };
// };

// /**
//  * Check if user can approve project plans at a specific level
//  * Level 4 added for CEO
//  */
// const canApproveProjectPlan = (userEmail, level) => {
//   const projectCoordinator  = getProjectCoordinator();
//   const supplyChainCoordinator = getSupplyChainCoordinator();
//   const headOfBusiness      = getHeadOfBusiness();

//   if (level === 1) return userEmail === projectCoordinator.email;
//   if (level === 2) return userEmail === supplyChainCoordinator.email;
//   if (level === 3) return userEmail === headOfBusiness.email;
//   if (level === 4) return userEmail === 'tom@gratoengineering.com';
//   return false;
// };

// const getCurrentApprover = (approvalChain) => {
//   if (!approvalChain || approvalChain.length === 0) return null;
  
//   const pendingApproval = approvalChain.find(item => item.status === 'pending');
//   if (pendingApproval) {
//     return {
//       level: pendingApproval.level,
//       approver: pendingApproval.approver,
//       email: pendingApproval.email,
//       role: pendingApproval.role
//     };
//   }
  
//   const allApproved = approvalChain.every(item => item.status === 'approved');
//   if (allApproved) return null;
  
//   return approvalChain.find(item => item.status !== 'approved');
// };

// const updateApprovalStatus = (approvalChain, level, status, comments = '', approvedBy = null) => {
//   const chainItem = approvalChain.find(item => item.level === level);
//   if (!chainItem) throw new Error(`Approval level ${level} not found in chain`);
  
//   chainItem.status = status;
//   chainItem.approvalDate = new Date();
//   chainItem.comments = comments;
//   chainItem.approvedBy = approvedBy;
  
//   return approvalChain;
// };

// const isFullyApproved = (approvalChain) => {
//   if (!approvalChain || approvalChain.length === 0) return false;
//   return approvalChain.every(item => item.status === 'approved');
// };

// const getNextApprover = (approvalChain, currentLevel) => {
//   const nextLevel = currentLevel + 1;
//   return approvalChain.find(item => item.level === nextLevel) || null;
// };

// const getApprovalProgress = (approvalChain) => {
//   if (!approvalChain || approvalChain.length === 0) return 0;
//   const approvedCount = approvalChain.filter(item => item.status === 'approved').length;
//   return Math.round((approvedCount / approvalChain.length) * 100);
// };

// const isCEOStep = (step) => {
//   if (!step) return false;
//   return (
//     step.role === 'CEO - Final Authority' ||
//     String(step.email || '').toLowerCase() === 'tom@gratoengineering.com'
//   );
// };

// module.exports = {
//   getProjectPlanApprovalChain,
//   getProjectCoordinator,
//   getSupplyChainCoordinator,
//   getHeadOfBusiness,
//   canApproveProjectPlan,
//   getCurrentApprover,
//   updateApprovalStatus,
//   isFullyApproved,
//   getNextApprover,
//   getApprovalProgress,
//   isCEOStep
// };















// // config/projectPlanApprovalChain.js

// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get Project Plan approval chain (3 levels):
//  * Level 1: Project Coordinator (Christabel Mangwi)
//  * Level 2: Supply Chain Coordinator (Lukong Lambert)
//  * Level 3: Head of Business (Kelvin Eyong)
//  */
// const getProjectPlanApprovalChain = (department) => {
//   console.log(`\n=== BUILDING PROJECT PLAN APPROVAL CHAIN ===`);
//   console.log(`Department: ${department}`);
  
//   const chain = [];
  
//   // Level 1: Project Coordinator (Christabel Mangwi)
//   const projectCoordinator = {
//     name: 'Ms. Christabel Mangwi',
//     email: 'christabel@gratoengineering.com',
//     role: 'Order Management Assistant/Buyer',
//     position: 'Project Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
  
//   chain.push({
//     level: 1,
//     approver: projectCoordinator.name,
//     email: projectCoordinator.email,
//     role: 'Project Coordinator',
//     department: projectCoordinator.department,
//     status: 'pending',
//     assignedDate: new Date()
//   });
  
//   console.log(`✓ Level 1: ${projectCoordinator.name} (Project Coordinator) - ${projectCoordinator.email}`);
  
//   // Level 2: Supply Chain Coordinator (Lukong Lambert)
//   const supplyChainCoordinator = DEPARTMENT_STRUCTURE['Business Development & Supply Chain']?.positions?.['Supply Chain Coordinator'] || {
//     name: 'Mr. Lukong Lambert',
//     email: 'lukong.lambert@gratoglobal.com',
//     department: 'Business Development & Supply Chain'
//   };

//   chain.push({
//     level: 2,
//     approver: supplyChainCoordinator.name,
//     email: supplyChainCoordinator.email,
//     role: 'Supply Chain Coordinator',
//     department: supplyChainCoordinator.department || 'Business Development & Supply Chain',
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   console.log(`✓ Level 2: ${supplyChainCoordinator.name} (Supply Chain Coordinator) - ${supplyChainCoordinator.email}`);

//   // Level 3: Head of Business (Kelvin Eyong) - ALWAYS LAST
//   const headOfBusiness = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'].head;

//   chain.push({
//     level: 3,
//     approver: headOfBusiness.name,
//     email: headOfBusiness.email,
//     role: 'Head of Business',
//     department: 'Business Development & Supply Chain',
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   console.log(`✓ Level 3: ${headOfBusiness.name} (Head of Business) - ${headOfBusiness.email}`);
  
//   const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (3 levels): ${finalChain}`);
//   console.log('=== END PROJECT PLAN APPROVAL CHAIN ===\n');
  
//   return chain;
// };

// /**
//  * Get Project Coordinator details
//  */
// const getProjectCoordinator = () => {
//   return {
//     name: 'Ms. Christabel Mangwi',
//     email: 'christabel@gratoengineering.com',
//     role: 'Project Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
// };

// /**
//  * Get Supply Chain Coordinator details
//  */
// const getSupplyChainCoordinator = () => {
//   const coordinator = DEPARTMENT_STRUCTURE['Business Development & Supply Chain']?.positions?.['Supply Chain Coordinator'];
//   if (coordinator) {
//     return {
//       name: coordinator.name,
//       email: coordinator.email,
//       role: 'Supply Chain Coordinator',
//       department: 'Business Development & Supply Chain'
//     };
//   }

//   return {
//     name: 'Mr. Lukong Lambert',
//     email: 'lukong.lambert@gratoglobal.com',
//     role: 'Supply Chain Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
// };

// /**
//  * Get Head of Business details
//  */
// const getHeadOfBusiness = () => {
//   const headOfBusiness = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'].head;
//   return {
//     name: headOfBusiness.name,
//     email: headOfBusiness.email,
//     role: 'Head of Business',
//     department: 'Business Development & Supply Chain'
//   };
// };

// /**
//  * Check if user can approve project plans at a specific level
//  */
// const canApproveProjectPlan = (userEmail, level) => {
//   const projectCoordinator = getProjectCoordinator();
//   const supplyChainCoordinator = getSupplyChainCoordinator();
//   const headOfBusiness = getHeadOfBusiness();
  
//   if (level === 1) {
//     return userEmail === projectCoordinator.email;
//   }
  
//   if (level === 2) {
//     return userEmail === supplyChainCoordinator.email;
//   }

//   if (level === 3) {
//     return userEmail === headOfBusiness.email;
//   }
  
//   return false;
// };

// /**
//  * Get current approver for a project plan based on status
//  */
// const getCurrentApprover = (approvalChain) => {
//   if (!approvalChain || approvalChain.length === 0) {
//     return null;
//   }
  
//   // Find the first pending approval
//   const pendingApproval = approvalChain.find(item => item.status === 'pending');
  
//   if (pendingApproval) {
//     return {
//       level: pendingApproval.level,
//       approver: pendingApproval.approver,
//       email: pendingApproval.email,
//       role: pendingApproval.role
//     };
//   }
  
//   // If no pending approvals, check if all are approved
//   const allApproved = approvalChain.every(item => item.status === 'approved');
  
//   if (allApproved) {
//     return null; // Fully approved
//   }
  
//   // Otherwise, return the first non-approved item
//   return approvalChain.find(item => item.status !== 'approved');
// };

// /**
//  * Update approval status
//  */
// const updateApprovalStatus = (approvalChain, level, status, comments = '', approvedBy = null) => {
//   const chainItem = approvalChain.find(item => item.level === level);
  
//   if (!chainItem) {
//     throw new Error(`Approval level ${level} not found in chain`);
//   }
  
//   chainItem.status = status;
//   chainItem.approvalDate = new Date();
//   chainItem.comments = comments;
//   chainItem.approvedBy = approvedBy;
  
//   return approvalChain;
// };

// /**
//  * Check if project plan is fully approved
//  */
// const isFullyApproved = (approvalChain) => {
//   if (!approvalChain || approvalChain.length === 0) {
//     return false;
//   }
  
//   return approvalChain.every(item => item.status === 'approved');
// };

// /**
//  * Get next approver after current level is approved
//  */
// const getNextApprover = (approvalChain, currentLevel) => {
//   const nextLevel = currentLevel + 1;
//   const nextApprover = approvalChain.find(item => item.level === nextLevel);
  
//   return nextApprover || null;
// };

// /**
//  * Get approval progress percentage
//  */
// const getApprovalProgress = (approvalChain) => {
//   if (!approvalChain || approvalChain.length === 0) {
//     return 0;
//   }
  
//   const approvedCount = approvalChain.filter(item => item.status === 'approved').length;
//   const totalLevels = approvalChain.length;
  
//   return Math.round((approvedCount / totalLevels) * 100);
// };

// module.exports = {
//   getProjectPlanApprovalChain,
//   getProjectCoordinator,
//   getSupplyChainCoordinator,
//   getHeadOfBusiness,
//   canApproveProjectPlan,
//   getCurrentApprover,
//   updateApprovalStatus,
//   isFullyApproved,
//   getNextApprover,
//   getApprovalProgress
// };