// config/supplierApprovalChain.js

const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

/**
 * Get supplier approval chain with 3-level hierarchy:
 * 1. Department Head of assigned department
 * 2. Head of Business - executive approval
 * 3. Finance - final approval and activation
 */
const getSupplierApprovalChain = (departmentName = 'General') => {
  const chain = [];
  
  console.log(`Getting supplier approval chain for department: ${departmentName}`);

  // Level 1: Department Head of the assigned department
  // Normalize the department name to match the structure
  let dept = departmentName;
  if (departmentName === 'HR/Admin') {
    dept = 'HR & Admin';
  }

  const assignedDept = DEPARTMENT_STRUCTURE[dept];
  if (assignedDept && assignedDept.head) {
    const deptHead = assignedDept.head;
    chain.push({
      level: 1,
      approver: {
        name: deptHead.name,
        email: deptHead.email,
        role: `${dept} Head`,
        department: dept
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  // Level 2: Head of Business (President/Executive)
  const executive = DEPARTMENT_STRUCTURE['IT'];
  if (executive && executive.head) {
    const headOfBusiness = executive.head;
    chain.push({
      level: 2,
      approver: {
        name: headOfBusiness.name,
        email: headOfBusiness.email,
        role: 'Head of Business',
        department: 'IT'
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  // Level 3: Finance Officer (Final approval and activation)
  chain.push({
    level: 3,
    approver: {
      name: 'Ms. Rambell Mambo',
      email: 'ranibellmambo@gratoengineering.com',
      role: 'Finance Officer',
      department: 'Finance'
    },
    status: 'pending',
    assignedDate: new Date()
  });

  // Set only the first step as active initially
  chain.forEach((step, index) => {
    if (index === 0) {
      step.status = 'pending';
    } else {
      step.status = 'pending';
    }
  });

  console.log(`Supplier approval chain created with ${chain.length} levels:`,
    chain.map(step => `Level ${step.level}: ${step.approver.name} (${step.approver.role})`));

  return chain;
};

/**
 * Get the next status based on current approval level for suppliers
 */
const getNextSupplierStatus = (currentLevel, totalLevels) => {
  switch (currentLevel) {
    case 1:
      return 'pending_head_of_business';
    case 2:
      return 'pending_finance';
    case 3:
      return 'approved'; 
    default:
      return 'approved';
  }
};

/**
 * Map user roles to their approval authority levels for suppliers
 */
const getUserSupplierApprovalLevel = (userRole, userEmail) => {
  // Finance has final authority (Level 3) and can activate suppliers
  if (userRole === 'finance') return 3;
  
  // Check if user is Head of Business (President)
  const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  if (executive) {
    const executiveEmail = typeof executive.head === 'object' ? executive.head.email : executive.headEmail;
    if (executiveEmail === userEmail) {
      return 2; // Head of Business level
    }
  }
  
  // Check if user is Supply Chain Coordinator
  const supplyChain = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  if (supplyChain && supplyChain.positions['Supply Chain Coordinator']) {
    if (supplyChain.positions['Supply Chain Coordinator'].email === userEmail) {
      return 1; // Supply Chain Coordinator level
    }
  }
  
  // Admin can handle any level
  if (userRole === 'admin') return 3;
  
  return 0; // No approval authority
};

/**
 * Check if a user can approve a supplier at a specific level
 */
const canUserApproveSupplier = (user, approvalStep) => {
  if (!user || !approvalStep) return false;
  
  // Check if user email matches the approver email
  if (user.email !== approvalStep.approver.email) return false;
  
  // Check if user role matches the required role for this level
  const userApprovalLevel = getUserSupplierApprovalLevel(user.role, user.email);
  
  // Map approval step roles to levels
  const stepLevelMap = {
    'Supply Chain Coordinator': 1,
    'Head of Business': 2,
    'Finance Officer': 3
  };
  
  const requiredLevel = stepLevelMap[approvalStep.approver.role];
  
  // Check if user level matches or exceeds required level (admin can approve any level)
  return userApprovalLevel >= requiredLevel;
};

/**
 * Validate supplier approval permissions
 */
const validateSupplierApproval = (user, supplier) => {
  if (!user || !supplier) {
    return {
      canApprove: false,
      reason: 'Missing user or supplier information'
    };
  }

  // Find the current pending approval step
  const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
  
  if (!currentStep) {
    return {
      canApprove: false,
      reason: 'No pending approval step found'
    };
  }

  // Check if user can approve at this level
  const canApprove = canUserApproveSupplier(user, currentStep);
  
  if (!canApprove) {
    return {
      canApprove: false,
      reason: `Only ${currentStep.approver.role} (${currentStep.approver.name}) can approve at this level`
    };
  }

  return {
    canApprove: true,
    currentLevel: currentStep.level,
    approverRole: currentStep.approver.role
  };
};

/**
 * Get supplier statistics by approval status
 */
const getSupplierApprovalStats = (suppliers) => {
  const stats = {
    pending: 0,
    pending_supply_chain: 0,
    pending_head_of_business: 0,
    pending_finance: 0,
    approved: 0,
    rejected: 0,
    total: suppliers.length
  };

  suppliers.forEach(supplier => {
    const status = supplier.supplierStatus?.accountStatus;
    
    if (status === 'approved') {
      stats.approved++;
    } else if (status === 'rejected') {
      stats.rejected++;
    } else if (status === 'pending') {
      stats.pending++;
      
      // Find current approval level
      const currentStep = supplier.approvalChain?.find(step => step.status === 'pending');
      if (currentStep) {
        switch (currentStep.level) {
          case 1:
            stats.pending_supply_chain++;
            break;
          case 2:
            stats.pending_head_of_business++;
            break;
          case 3:
            stats.pending_finance++;
            break;
        }
      }
    }
  });

  return stats;
};

/**
 * Get Supply Chain Coordinator info
 */
const getSupplyChainCoordinator = () => {
  return {
    name: 'Mr. Lukong Lambert',
    email: 'lukong.lambert@gratoglobal.com',
    role: 'Supply Chain Coordinator',
    department: 'Business Development & Supply Chain'
  };
};

module.exports = {
  getSupplierApprovalChain,
  getNextSupplierStatus,
  getUserSupplierApprovalLevel,
  canUserApproveSupplier,
  validateSupplierApproval,
  getSupplierApprovalStats,
  getSupplyChainCoordinator
};









// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * UPDATED: Get 3-level supplier invoice approval chain
//  * Level 1: Department Head
//  * Level 2: Head of Business (President)
//  * Level 3: Finance Officer (ALWAYS LAST)
//  * 
//  * Note: Supply Chain Coordinator reviews BEFORE this chain starts
//  */
// const getSupplierApprovalChain = (department, serviceCategory) => {
//   const chain = [];
  
//   console.log(`\n=== BUILDING SUPPLIER APPROVAL CHAIN ===`);
//   console.log(`Department: ${department}`);
//   console.log(`Service Category: ${serviceCategory}`);

//   // LEVEL 1: Department Head
//   const deptHead = DEPARTMENT_STRUCTURE[department];
//   if (deptHead && deptHead.head) {
//     chain.push({
//       level: 1,
//       approver: deptHead.head.name,
//       email: deptHead.head.email,
//       role: 'Department Head',
//       department: department
//     });
//     console.log(`✓ Level 1: ${deptHead.head.name} (Department Head) - ${deptHead.head.email}`);
//   } else {
//     console.warn(`⚠ Department head not found for ${department}`);
//   }

//   // LEVEL 2: Head of Business / President
//   const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
//   if (executive && executive.head) {
//     chain.push({
//       level: 2,
//       approver: executive.head.name,
//       email: executive.head.email,
//       role: 'Head of Business',
//       department: 'Business Development & Supply Chain'
//     });
//     console.log(`✓ Level 2: ${executive.head.name} (Head of Business) - ${executive.head.email}`);
//   }

//   // LEVEL 3: Finance Officer (ALWAYS LAST)
//   chain.push({
//     level: 3,
//     approver: 'Ms. Ranibell Mambo',
//     email: 'ranibellmambo@gratoengineering.com',
//     role: 'Finance Officer',
//     department: 'Business Development & Supply Chain'
//   });
//   console.log(`✓ Level 3: Ms. Ranibell Mambo (Finance Officer) - ranibellmambo@gratoengineering.com`);

//   const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
//   console.log('=== END APPROVAL CHAIN ===\n');

//   return chain;
// };

// /**
//  * NEW: Get Supply Chain Coordinator info
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
//   getSupplyChainCoordinator
// };






