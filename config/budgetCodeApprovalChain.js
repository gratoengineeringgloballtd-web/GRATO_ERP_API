const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

/**
 * Get budget code approval chain with 3-level hierarchy:
 * 1. Departmental Head - department head approval
 * 2. Head of Business - executive approval  
 * 3. Finance - final approval and activation
 */
const getBudgetCodeApprovalChain = (creatorName, department, budgetType = 'departmental') => {
  const chain = [];
  
  console.log(`Getting budget code approval chain for: ${creatorName} in ${department}, type: ${budgetType}`);

  // Find the creator in the department structure
  let creatorData = null;
  let creatorDepartmentName = department;

  // First check if the creator is a department head
  if (DEPARTMENT_STRUCTURE[department] && DEPARTMENT_STRUCTURE[department].head === creatorName) {
    creatorData = {
      name: creatorName,
      email: DEPARTMENT_STRUCTURE[department].headEmail,
      position: 'Department Head',
      department: department
    };
  } else {
    // Search for creator in all departments
    for (const [deptKey, deptData] of Object.entries(DEPARTMENT_STRUCTURE)) {
      if (deptData.head === creatorName) {
        creatorData = {
          name: creatorName,
          email: deptData.headEmail,
          position: 'Department Head',
          department: deptKey
        };
        creatorDepartmentName = deptKey;
        break;
      }

      if (deptData.positions) {
        for (const [pos, data] of Object.entries(deptData.positions)) {
          if (data.name === creatorName) {
            creatorData = { ...data, position: pos };
            creatorDepartmentName = deptKey;
            break;
          }
        }
      }

      if (creatorData) break;
    }
  }

  if (!creatorData) {
    console.warn(`Creator "${creatorName}" not found. Using fallback approval chain.`);
    return getFallbackBudgetCodeApprovalChain(department);
  }

  // Level 1: Departmental Head (if creator is not already the department head)
  const deptHead = DEPARTMENT_STRUCTURE[creatorDepartmentName];
  if (deptHead) {
    // Extract string values - handle both object and string formats
    let headName, headEmail;
    
    if (typeof deptHead.head === 'object' && deptHead.head !== null) {
      // Head is an object
      headName = deptHead.head.name;
      headEmail = deptHead.head.email;
    } else {
      // Head is a string
      headName = deptHead.head;
      headEmail = deptHead.headEmail;
    }
    
    // Only add if creator is not the department head
    if (creatorData.name !== headName) {
      chain.push({
        level: 1,
        approver: {
          name: headName,
          email: headEmail,
          role: 'Departmental Head',
          department: creatorDepartmentName
        },
        status: 'pending',
        assignedDate: new Date()
      });
    }
  }

  // Level 2: Head of Business (President/Executive)
  const executive = DEPARTMENT_STRUCTURE['Executive'];
  if (executive) {
    // Extract the actual string values from the executive object
    let executiveHead, executiveEmail;
    
    if (typeof executive.head === 'object' && executive.head !== null) {
      // Head is an object
      executiveHead = executive.head.name;
      executiveEmail = executive.head.email;
    } else {
      // Head is a string
      executiveHead = executive.head;
      executiveEmail = executive.headEmail;
    }
    
    // Only add if not already in chain
    if (!chain.find(step => step.approver.email === executiveEmail)) {
      chain.push({
        level: chain.length + 1,
        approver: {
          name: executiveHead,
          email: executiveEmail,
          role: 'Head of Business',
          department: 'Executive'
        },
        status: 'pending',
        assignedDate: new Date()
      });
    }
  }

  // Level 3: Finance Officer (Final approval and budget code activation)
  chain.push({
    level: chain.length + 1,
    approver: {
      name: 'Ms. Rambell Mambo',
      email: 'ranibellmambo@gratoengineering.com',
      role: 'Finance Officer',
      department: 'Business Development & Supply Chain'
    },
    status: 'pending',
    assignedDate: new Date()
  });

  // Set only the first step as active initially
  chain.forEach((step, index) => {
    if (index === 0) {
      step.status = 'pending';
    } else {
      step.status = 'pending'; // All steps are created as pending but only first is active
    }
  });

  console.log(`Budget code approval chain created with ${chain.length} levels:`,
    chain.map(step => `Level ${step.level}: ${step.approver.name} (${step.approver.role})`));

  return chain;
};

/**
 * Fallback approval chain when creator is not found
 */
const getFallbackBudgetCodeApprovalChain = (department) => {
  const chain = [];
  let level = 1;

  // Level 1: Department Head (if exists)
  if (DEPARTMENT_STRUCTURE[department]) {
    const deptHead = DEPARTMENT_STRUCTURE[department];
    let headName, headEmail;
    
    if (typeof deptHead.head === 'object' && deptHead.head !== null) {
      // Head is an object
      headName = deptHead.head.name;
      headEmail = deptHead.head.email;
    } else {
      // Head is a string
      headName = deptHead.head;
      headEmail = deptHead.headEmail;
    }
    
    chain.push({
      level: level++,
      approver: {
        name: headName,
        email: headEmail,
        role: 'Departmental Head',
        department: department
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  // Level 2: Head of Business
  const executive = DEPARTMENT_STRUCTURE['Executive'];
  if (executive) {
    let executiveHead, executiveEmail;
    
    if (typeof executive.head === 'object' && executive.head !== null) {
      // Head is an object
      executiveHead = executive.head.name;
      executiveEmail = executive.head.email;
    } else {
      // Head is a string
      executiveHead = executive.head;
      executiveEmail = executive.headEmail;
    }
    
    chain.push({
      level: level++,
      approver: {
        name: executiveHead,
        email: executiveEmail,
        role: 'Head of Business',
        department: 'Executive'
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  // Level 3: Finance
  chain.push({
    level: level++,
    approver: {
      name: 'Ms. Rambell Mambo',
      email: 'ranibellmambo@gratoengineering.com',
      role: 'Finance Officer',
      department: 'Business Development & Supply Chain'
    },
    status: 'pending',
    assignedDate: new Date()
  });

  return chain;
};

/**
 * Get the next status based on current approval level for budget codes
 */
const getNextBudgetCodeStatus = (currentLevel, totalLevels) => {
  switch (currentLevel) {
    case 1:
      return 'pending_head_of_business';
    case 2:
      return 'pending_finance';
    case 3:
      return 'active'; 
    default:
      return 'active';
  }
};

/**
 * Map user roles to their approval authority levels for budget codes
 */
const getUserBudgetCodeApprovalLevel = (userRole, userEmail) => {
  // Finance has final authority (Level 3) and can activate budget codes
  if (userRole === 'finance') return 3;
  
  // Admin can handle both departmental head (Level 1) and head of business (Level 2)
  if (userRole === 'admin') {
    // Check if this admin is the head of business (President)
    const executive = DEPARTMENT_STRUCTURE['Executive'];
    if (executive) {
      const executiveEmail = typeof executive.head === 'object' ? executive.head.email : executive.headEmail;
      if (executiveEmail === userEmail) {
        return 2; // Head of Business level
      }
    }
    return 1; // Departmental Head level
  }
  
  return 0; // No approval authority
};

/**
 * Check if a user can approve a budget code at a specific level
 */
const canUserApproveBudgetCode = (user, approvalStep) => {
  if (!user || !approvalStep) return false;
  
  // Check if user email matches the approver email
  if (user.email !== approvalStep.approver.email) return false;
  
  // Check if user role matches the required role for this level
  const userApprovalLevel = getUserBudgetCodeApprovalLevel(user.role, user.email);
  
  // Map approval step roles to levels
  const stepLevelMap = {
    'Departmental Head': 1,
    'Head of Business': 2,
    'Finance Officer': 3
  };
  
  const requiredLevel = stepLevelMap[approvalStep.approver.role];
  
  // For admin users, check if they can handle this specific level
  if (user.role === 'admin') {
    // Admin can handle Level 1 (Departmental Head) and Level 2 (Head of Business)
    return requiredLevel === 1 || requiredLevel === 2;
  }
  
  // For other roles, check if user level matches required level
  return userApprovalLevel === requiredLevel;
};

/**
 * Validate budget code approval permissions
 */
const validateBudgetCodeApproval = (user, budgetCode) => {
  if (!user || !budgetCode) {
    return {
      canApprove: false,
      reason: 'Missing user or budget code information'
    };
  }

  // Find the current pending approval step
  const currentStep = budgetCode.approvalChain?.find(step => step.status === 'pending');
  
  if (!currentStep) {
    return {
      canApprove: false,
      reason: 'No pending approval step found'
    };
  }

  // Check if user can approve at this level
  const canApprove = canUserApproveBudgetCode(user, currentStep);
  
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
 * Get budget code statistics by approval status
 */
const getBudgetCodeApprovalStats = (budgetCodes) => {
  const stats = {
    pending: 0,
    pending_departmental_head: 0,
    pending_head_of_business: 0,
    pending_finance: 0,
    active: 0,
    rejected: 0,
    total: budgetCodes.length
  };

  budgetCodes.forEach(code => {
    if (code.status === 'active') {
      stats.active++;
    } else if (code.status === 'rejected') {
      stats.rejected++;
    } else {
      stats.pending++;
      
      // Find current approval level
      const currentStep = code.approvalChain?.find(step => step.status === 'pending');
      if (currentStep) {
        switch (currentStep.level) {
          case 1:
            stats.pending_departmental_head++;
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
 * Get approval chain for budget transfers
 * Requires approval from both budget owners + finance + HOB
 */
const getBudgetTransferApprovalChain = (requester, fromBudgetCode, toBudgetCode) => {
  const chain = [];
  let level = 1;

  console.log(`Generating transfer approval chain from ${fromBudgetCode.code} to ${toBudgetCode.code}`);

  // Level 1: Source Budget Owner (if not the requester)
  if (fromBudgetCode.budgetOwner && 
      fromBudgetCode.budgetOwner.toString() !== requester._id.toString()) {
    const User = require('../models/User');
    // Note: In production, you'd populate budgetOwner properly
    chain.push({
      level: level++,
      approver: {
        name: 'Source Budget Owner',
        email: fromBudgetCode.budgetOwner.email || 'owner@company.com',
        role: 'Budget Owner'
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  // Level 2: Destination Budget Owner (if different from source)
  if (toBudgetCode.budgetOwner && 
      toBudgetCode.budgetOwner.toString() !== fromBudgetCode.budgetOwner?.toString() &&
      toBudgetCode.budgetOwner.toString() !== requester._id.toString()) {
    chain.push({
      level: level++,
      approver: {
        name: 'Destination Budget Owner',
        email: toBudgetCode.budgetOwner.email || 'owner@company.com',
        role: 'Budget Owner'
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  // Level 3: Finance Officer
  chain.push({
    level: level++,
    approver: {
      name: 'Ms. Rambell Mambo',
      email: 'ranibellmambo@gratoengineering.com',
      role: 'Finance Officer'
    },
    status: 'pending',
    assignedDate: new Date()
  });

  // Level 4: Head of Business (for large transfers > 5M)
  const executive = DEPARTMENT_STRUCTURE['Executive'];
  if (fromBudgetCode.budget > 5000000 && executive) {
    const executiveHead = typeof executive.head === 'object' ? executive.head.name : executive.head;
    const executiveEmail = typeof executive.head === 'object' ? executive.head.email : executive.headEmail;
    
    chain.push({
      level: level++,
      approver: {
        name: executiveHead,
        email: executiveEmail,
        role: 'Head of Business'
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  console.log(`Transfer approval chain created with ${chain.length} levels`);

  return chain;
};

module.exports = {
  getBudgetCodeApprovalChain,
  getNextBudgetCodeStatus,
  getUserBudgetCodeApprovalLevel,
  canUserApproveBudgetCode,
  validateBudgetCodeApproval,
  getBudgetCodeApprovalStats,
  getFallbackBudgetCodeApprovalChain,
  getBudgetTransferApprovalChain
};