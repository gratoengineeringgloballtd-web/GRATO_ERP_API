// // ═══════════════════════════════════════════════════════════════════════════
// FILE: config/supplierApprovalChain.js
// VERSION: 2.1 — CEO via ceoApprovalConfig (supplier = alwaysEscalate)
// ═══════════════════════════════════════════════════════════════════════════

const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');
const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

/**
 * ✅ VERSION 2.1: Get supplier approval chain.
 *
 * Supplier onboarding is marked `alwaysEscalate` in ceoApprovalConfig,
 * so CEO is always added regardless of any amount.
 *
 *   Level 1: Department Head of the assigned department
 *   Level 2: Head of Business (President / Kelvin)
 *   Level 3: Finance Officer
 *   Level 4: CEO — Tom (always, strategic decision)
 *
 * @param {string} departmentName - Department the supplier is assigned to
 * @returns {Array} Approval chain steps
 */
const getSupplierApprovalChain = (departmentName = 'General') => {
  const chain = [];

  console.log(`Getting supplier approval chain for department: ${departmentName}`);

  // ── Level 1: Department Head of the assigned department ──────────────────
  let dept = departmentName === 'HR/Admin' ? 'HR & Admin' : departmentName;

  const assignedDept = DEPARTMENT_STRUCTURE[dept];
  if (assignedDept && assignedDept.head) {
    const deptHead = assignedDept.head;
    chain.push({
      level:        1,
      approver: {
        name:       deptHead.name,
        email:      deptHead.email,
        role:       `${dept} Head`,
        department: dept,
      },
      status:       'pending',
      assignedDate: new Date(),
    });
  }

  // ── Level 2: Head of Business (President / Kelvin) ───────────────────────
  const executive = DEPARTMENT_STRUCTURE['IT'];
  if (executive && executive.head) {
    const headOfBusiness = executive.head;
    chain.push({
      level:        2,
      approver: {
        name:       headOfBusiness.name,
        email:      headOfBusiness.email,
        role:       'Head of Business',
        department: 'IT',
      },
      status:       'pending',
      assignedDate: new Date(),
    });
  }

  // ── Level 3: Finance Officer ──────────────────────────────────────────────
  chain.push({
    level:        3,
    approver: {
      name:       'Ms. Ranibell Mambo',
      email:      'ranibellmambo@gratoengineering.com',
      role:       'Finance Officer',
      department: 'Finance',
    },
    status:       'pending',
    assignedDate: new Date(),
  });

  // ── Level 4: CEO — always required for supplier onboarding (alwaysEscalate)
  const ceoCheckSup = requiresCEOApproval('supplier', null);
  if (ceoCheckSup.required) {
    chain.push({
      level:        chain.length + 1,
      approver: {
        name:       CEO.name,
        email:      CEO.email,
        role:       CEO.role,
        department: CEO.department,
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    console.log(`Level ${chain.length}: ${CEO.name} (${CEO.role})`);
  }
  // ── END CEO STEP ──────────────────────────────────────────────────────────

  console.log(
    `Supplier approval chain created with ${chain.length} levels:`,
    chain.map(step => `Level ${step.level}: ${step.approver.name} (${step.approver.role})`)
  );

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// STATUS & PERMISSION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the next workflow status after a given level is approved.
 */
const getNextSupplierStatus = (currentLevel, totalLevels) => {
  switch (currentLevel) {
    case 1:  return 'pending_head_of_business';
    case 2:  return 'pending_finance';
    case 3:  return 'pending_ceo';
    case 4:  return 'approved';
    default: return 'approved';
  }
};

const getUserSupplierApprovalLevel = (userRole, userEmail) => {
  if (userEmail === CEO.email) return 4;
  if (userRole === 'finance')  return 3;

  const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  if (executive) {
    const executiveEmail = typeof executive.head === 'object'
      ? executive.head.email
      : executive.headEmail;
    if (executiveEmail === userEmail) return 2;
  }

  const supplyChain = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  if (supplyChain?.positions['Supply Chain Coordinator']?.email === userEmail) {
    return 1;
  }

  if (userRole === 'admin') return 4;

  return 0;
};

const canUserApproveSupplier = (user, approvalStep) => {
  if (!user || !approvalStep)                          return false;
  if (user.email !== approvalStep.approver.email)      return false;

  const userApprovalLevel = getUserSupplierApprovalLevel(user.role, user.email);

  const stepLevelMap = {
    'Supply Chain Coordinator': 1,
    'Head of Business':         2,
    'Finance Officer':          3,
    'CEO - Final Authority':    4,
  };

  const requiredLevel = stepLevelMap[approvalStep.approver.role];
  return userApprovalLevel >= requiredLevel;
};

const validateSupplierApproval = (user, supplier) => {
  if (!user || !supplier) {
    return { canApprove: false, reason: 'Missing user or supplier information' };
  }

  const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');

  if (!currentStep) {
    return { canApprove: false, reason: 'No pending approval step found' };
  }

  const canApprove = canUserApproveSupplier(user, currentStep);

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
    pending:                   0,
    pending_supply_chain:      0,
    pending_head_of_business:  0,
    pending_finance:           0,
    pending_ceo:               0,
    approved:                  0,
    rejected:                  0,
    total:                     suppliers.length,
  };

  suppliers.forEach(supplier => {
    const status = supplier.supplierStatus?.accountStatus;

    if (status === 'approved') {
      stats.approved++;
    } else if (status === 'rejected') {
      stats.rejected++;
    } else if (status === 'pending') {
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

const getSupplyChainCoordinator = () => {
  return {
    name:       'Mr. Lukong Lambert',
    email:      'lukong.lambert@gratoglobal.com',
    role:       'Supply Chain Coordinator',
    department: 'Business Development & Supply Chain',
  };
};

const isCEOStep = (step) => {
  if (!step || !step.approver) return false;
  return (
    step.approver.role  === 'CEO - Final Authority' ||
    String(step.approver.email || '').toLowerCase() === CEO.email.toLowerCase()
  );
};


module.exports = {
  getSupplierApprovalChain,
  getNextSupplierStatus,
  getUserSupplierApprovalLevel,
  canUserApproveSupplier,
  validateSupplierApproval,
  getSupplierApprovalStats,
  getSupplyChainCoordinator,
  isCEOStep,
};





// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get supplier approval chain with 4-level hierarchy:
//  * 1. Department Head of assigned department
//  * 2. Head of Business - executive approval
//  * 3. Finance - approval
//  * 4. CEO - absolute final approval and activation
//  */
// const getSupplierApprovalChain = (departmentName = 'General') => {
//   const chain = [];
  
//   console.log(`Getting supplier approval chain for department: ${departmentName}`);

//   // Level 1: Department Head of the assigned department
//   let dept = departmentName;
//   if (departmentName === 'HR/Admin') {
//     dept = 'HR & Admin';
//   }

//   const assignedDept = DEPARTMENT_STRUCTURE[dept];
//   if (assignedDept && assignedDept.head) {
//     const deptHead = assignedDept.head;
//     chain.push({
//       level: 1,
//       approver: {
//         name: deptHead.name,
//         email: deptHead.email,
//         role: `${dept} Head`,
//         department: dept
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//   }

//   // Level 2: Head of Business (President/Executive)
//   const executive = DEPARTMENT_STRUCTURE['IT'];
//   if (executive && executive.head) {
//     const headOfBusiness = executive.head;
//     chain.push({
//       level: 2,
//       approver: {
//         name: headOfBusiness.name,
//         email: headOfBusiness.email,
//         role: 'Head of Business',
//         department: 'IT'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//   }

//   // Level 3: Finance Officer
//   chain.push({
//     level: 3,
//     approver: {
//       name: 'Ms. Rambell Mambo',
//       email: 'ranibellmambo@gratoengineering.com',
//       role: 'Finance Officer',
//       department: 'Finance'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   // Level 4: CEO — absolute final
//   chain.push({
//     level: 4,
//     approver: {
//       name:       'Mr. Tom',
//       email:      'tom@gratoengineering.com',
//       role:       'CEO - Final Authority',
//       department: 'CEO Office'
//     },
//     status:      'pending',
//     assignedDate: new Date()
//   });
//   console.log(`Level 4: Mr. Tom (CEO - Final Authority)`);

//   console.log(`Supplier approval chain created with ${chain.length} levels:`,
//     chain.map(step => `Level ${step.level}: ${step.approver.name} (${step.approver.role})`));

//   return chain;
// };

// /**
//  * Get the next status based on current approval level for suppliers
//  */
// const getNextSupplierStatus = (currentLevel, totalLevels) => {
//   switch (currentLevel) {
//     case 1:  return 'pending_head_of_business';
//     case 2:  return 'pending_finance';
//     case 3:  return 'pending_ceo';
//     case 4:  return 'approved';
//     default: return 'approved';
//   }
// };

// const getUserSupplierApprovalLevel = (userRole, userEmail) => {
//   if (userEmail === 'tom@gratoengineering.com') return 4;
//   if (userRole === 'finance') return 3;
  
//   const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
//   if (executive) {
//     const executiveEmail = typeof executive.head === 'object' ? executive.head.email : executive.headEmail;
//     if (executiveEmail === userEmail) {
//       return 2;
//     }
//   }
  
//   const supplyChain = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
//   if (supplyChain && supplyChain.positions['Supply Chain Coordinator']) {
//     if (supplyChain.positions['Supply Chain Coordinator'].email === userEmail) {
//       return 1;
//     }
//   }
  
//   if (userRole === 'admin') return 4;
  
//   return 0;
// };

// const canUserApproveSupplier = (user, approvalStep) => {
//   if (!user || !approvalStep) return false;
//   if (user.email !== approvalStep.approver.email) return false;
  
//   const userApprovalLevel = getUserSupplierApprovalLevel(user.role, user.email);
  
//   const stepLevelMap = {
//     'Supply Chain Coordinator': 1,
//     'Head of Business': 2,
//     'Finance Officer': 3,
//     'CEO - Final Authority': 4
//   };
  
//   const requiredLevel = stepLevelMap[approvalStep.approver.role];
//   return userApprovalLevel >= requiredLevel;
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
//       reason: `Only ${currentStep.approver.role} (${currentStep.approver.name}) can approve at this level`
//     };
//   }

//   return {
//     canApprove: true,
//     currentLevel: currentStep.level,
//     approverRole: currentStep.approver.role
//   };
// };

// const getSupplierApprovalStats = (suppliers) => {
//   const stats = {
//     pending: 0,
//     pending_supply_chain: 0,
//     pending_head_of_business: 0,
//     pending_finance: 0,
//     pending_ceo: 0,
//     approved: 0,
//     rejected: 0,
//     total: suppliers.length
//   };

//   suppliers.forEach(supplier => {
//     const status = supplier.supplierStatus?.accountStatus;
    
//     if (status === 'approved') {
//       stats.approved++;
//     } else if (status === 'rejected') {
//       stats.rejected++;
//     } else if (status === 'pending') {
//       stats.pending++;
      
//       const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
//       if (currentStep) {
//         switch (currentStep.level) {
//           case 1: stats.pending_supply_chain++;    break;
//           case 2: stats.pending_head_of_business++; break;
//           case 3: stats.pending_finance++;          break;
//           case 4: stats.pending_ceo++;              break;
//         }
//       }
//     }
//   });

//   return stats;
// };

// const getSupplyChainCoordinator = () => {
//   return {
//     name: 'Mr. Lukong Lambert',
//     email: 'lukong.lambert@gratoglobal.com',
//     role: 'Supply Chain Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
// };

// const isCEOStep = (step) => {
//   if (!step || !step.approver) return false;
//   return (
//     step.approver.role === 'CEO - Final Authority' ||
//     String(step.approver.email || '').toLowerCase() === 'tom@gratoengineering.com'
//   );
// };

// module.exports = {
//   getSupplierApprovalChain,
//   getNextSupplierStatus,
//   getUserSupplierApprovalLevel,
//   canUserApproveSupplier,
//   validateSupplierApproval,
//   getSupplierApprovalStats,
//   getSupplyChainCoordinator,
//   isCEOStep
// };










// // config/supplierApprovalChain.js

// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get supplier approval chain with 3-level hierarchy:
//  * 1. Department Head of assigned department
//  * 2. Head of Business - executive approval
//  * 3. Finance - final approval and activation
//  */
// const getSupplierApprovalChain = (departmentName = 'General') => {
//   const chain = [];
  
//   console.log(`Getting supplier approval chain for department: ${departmentName}`);

//   // Level 1: Department Head of the assigned department
//   // Normalize the department name to match the structure
//   let dept = departmentName;
//   if (departmentName === 'HR/Admin') {
//     dept = 'HR & Admin';
//   }

//   const assignedDept = DEPARTMENT_STRUCTURE[dept];
//   if (assignedDept && assignedDept.head) {
//     const deptHead = assignedDept.head;
//     chain.push({
//       level: 1,
//       approver: {
//         name: deptHead.name,
//         email: deptHead.email,
//         role: `${dept} Head`,
//         department: dept
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//   }

//   // Level 2: Head of Business (President/Executive)
//   const executive = DEPARTMENT_STRUCTURE['IT'];
//   if (executive && executive.head) {
//     const headOfBusiness = executive.head;
//     chain.push({
//       level: 2,
//       approver: {
//         name: headOfBusiness.name,
//         email: headOfBusiness.email,
//         role: 'Head of Business',
//         department: 'IT'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//   }

//   // Level 3: Finance Officer (Final approval and activation)
//   chain.push({
//     level: 3,
//     approver: {
//       name: 'Ms. Rambell Mambo',
//       email: 'ranibellmambo@gratoengineering.com',
//       role: 'Finance Officer',
//       department: 'Finance'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   // Set only the first step as active initially
//   chain.forEach((step, index) => {
//     if (index === 0) {
//       step.status = 'pending';
//     } else {
//       step.status = 'pending';
//     }
//   });

//   console.log(`Supplier approval chain created with ${chain.length} levels:`,
//     chain.map(step => `Level ${step.level}: ${step.approver.name} (${step.approver.role})`));

//   return chain;
// };

// /**
//  * Get the next status based on current approval level for suppliers
//  */
// const getNextSupplierStatus = (currentLevel, totalLevels) => {
//   switch (currentLevel) {
//     case 1:
//       return 'pending_head_of_business';
//     case 2:
//       return 'pending_finance';
//     case 3:
//       return 'approved'; 
//     default:
//       return 'approved';
//   }
// };

// /**
//  * Map user roles to their approval authority levels for suppliers
//  */
// const getUserSupplierApprovalLevel = (userRole, userEmail) => {
//   // Finance has final authority (Level 3) and can activate suppliers
//   if (userRole === 'finance') return 3;
  
//   // Check if user is Head of Business (President)
//   const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
//   if (executive) {
//     const executiveEmail = typeof executive.head === 'object' ? executive.head.email : executive.headEmail;
//     if (executiveEmail === userEmail) {
//       return 2; // Head of Business level
//     }
//   }
  
//   // Check if user is Supply Chain Coordinator
//   const supplyChain = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
//   if (supplyChain && supplyChain.positions['Supply Chain Coordinator']) {
//     if (supplyChain.positions['Supply Chain Coordinator'].email === userEmail) {
//       return 1; // Supply Chain Coordinator level
//     }
//   }
  
//   // Admin can handle any level
//   if (userRole === 'admin') return 3;
  
//   return 0; // No approval authority
// };

// /**
//  * Check if a user can approve a supplier at a specific level
//  */
// const canUserApproveSupplier = (user, approvalStep) => {
//   if (!user || !approvalStep) return false;
  
//   // Check if user email matches the approver email
//   if (user.email !== approvalStep.approver.email) return false;
  
//   // Check if user role matches the required role for this level
//   const userApprovalLevel = getUserSupplierApprovalLevel(user.role, user.email);
  
//   // Map approval step roles to levels
//   const stepLevelMap = {
//     'Supply Chain Coordinator': 1,
//     'Head of Business': 2,
//     'Finance Officer': 3
//   };
  
//   const requiredLevel = stepLevelMap[approvalStep.approver.role];
  
//   // Check if user level matches or exceeds required level (admin can approve any level)
//   return userApprovalLevel >= requiredLevel;
// };

// /**
//  * Validate supplier approval permissions
//  */
// const validateSupplierApproval = (user, supplier) => {
//   if (!user || !supplier) {
//     return {
//       canApprove: false,
//       reason: 'Missing user or supplier information'
//     };
//   }

//   // Find the current pending approval step
//   const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
  
//   if (!currentStep) {
//     return {
//       canApprove: false,
//       reason: 'No pending approval step found'
//     };
//   }

//   // Check if user can approve at this level
//   const canApprove = canUserApproveSupplier(user, currentStep);
  
//   if (!canApprove) {
//     return {
//       canApprove: false,
//       reason: `Only ${currentStep.approver.role} (${currentStep.approver.name}) can approve at this level`
//     };
//   }

//   return {
//     canApprove: true,
//     currentLevel: currentStep.level,
//     approverRole: currentStep.approver.role
//   };
// };

// /**
//  * Get supplier statistics by approval status
//  */
// const getSupplierApprovalStats = (suppliers) => {
//   const stats = {
//     pending: 0,
//     pending_supply_chain: 0,
//     pending_head_of_business: 0,
//     pending_finance: 0,
//     approved: 0,
//     rejected: 0,
//     total: suppliers.length
//   };

//   suppliers.forEach(supplier => {
//     const status = supplier.supplierStatus?.accountStatus;
    
//     if (status === 'approved') {
//       stats.approved++;
//     } else if (status === 'rejected') {
//       stats.rejected++;
//     } else if (status === 'pending') {
//       stats.pending++;
      
//       // Find current approval level
//       const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
//       if (currentStep) {
//         switch (currentStep.level) {
//           case 1:
//             stats.pending_supply_chain++;
//             break;
//           case 2:
//             stats.pending_head_of_business++;
//             break;
//           case 3:
//             stats.pending_finance++;
//             break;
//         }
//       }
//     }
//   });

//   return stats;
// };

// /**
//  * Get Supply Chain Coordinator info
//  */
// const getSupplyChainCoordinator = () => {
//   return {
//     name: 'Mr. Lukong Lambert',
//     email: 'lukong.lambert@gratoglobal.com',
//     role: 'Supply Chain Coordinator',
//     department: 'Business Development & Supply Chain'
//   };
// };

// module.exports = {
//   getSupplierApprovalChain,
//   getNextSupplierStatus,
//   getUserSupplierApprovalLevel,
//   canUserApproveSupplier,
//   validateSupplierApproval,
//   getSupplierApprovalStats,
//   getSupplyChainCoordinator
// };






