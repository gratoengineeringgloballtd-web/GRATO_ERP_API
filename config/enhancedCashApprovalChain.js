const { getApprovalChainFromStructure } = require('./departmentStructure');

/**
 * Get cash request approval chain using enhanced structure
 * This replaces the old getCashRequestApprovalChain function
 * 
 * @param {string} employeeEmail - Email of employee requesting cash
 * @returns {array} - Approval chain with levels
 */
const getCashRequestApprovalChain = (employeeEmail) => {
  console.log(`\n=== BUILDING CASH REQUEST APPROVAL CHAIN ===`);
  console.log(`Employee: ${employeeEmail}`);

  // Use the enhanced structure to get approval chain
  const approvalChain = getApprovalChainFromStructure(employeeEmail);

  if (!approvalChain || approvalChain.length === 0) {
    console.warn(`⚠️ No approval chain found for ${employeeEmail}`);
    return getFallbackApprovalChain();
  }

  // Map the chain to cash request format
  const cashApprovalChain = approvalChain.map((step, index) => ({
    level: index + 1,
    approver: {
      name: step.approver.name,
      email: step.approver.email,
      role: mapRoleForCashApproval(step.approver.role, index + 1),
      department: step.approver.department
    },
    status: 'pending',
    assignedDate: new Date()
  }));

  console.log(`✅ Cash approval chain created with ${cashApprovalChain.length} levels`);
  const chainSummary = cashApprovalChain.map(s => 
    `L${s.level}: ${s.approver.name} (${s.approver.role})`
  ).join(' → ');
  console.log(`Chain: ${chainSummary}`);
  console.log('=== END APPROVAL CHAIN ===\n');

  return cashApprovalChain;
};

/**
 * Map role from structure to cash approval role
 */
const mapRoleForCashApproval = (structureRole, level) => {
  // Map based on level in chain
  const roleMap = {
    1: 'Supervisor',
    2: 'Departmental Head', 
    3: 'Head of Business',
    4: 'Finance Officer'
  };

  // Override for specific roles
  if (structureRole === 'Finance Officer') {
    return 'Finance Officer';
  }
  if (structureRole === 'President' || structureRole === 'Head of Business') {
    return 'Head of Business';
  }
  if (structureRole.includes('Head') || structureRole.includes('Director')) {
    return 'Departmental Head';
  }

  return roleMap[level] || structureRole;
};

/**
 * Fallback approval chain if structure lookup fails
 */
const getFallbackApprovalChain = () => {
  console.warn('⚠️ Using fallback approval chain');
  return [
    {
      level: 1,
      approver: {
        name: 'Department Head',
        email: '',
        role: 'Departmental Head',
        department: ''
      },
      status: 'pending',
      assignedDate: new Date()
    },
    {
      level: 2,
      approver: {
        name: 'Mr. E.T Kelvin',
        email: 'kelvin.eyong@gratoglobal.com',
        role: 'Head of Business',
        department: 'Executive'
      },
      status: 'pending',
      assignedDate: new Date()
    },
    {
      level: 3,
      approver: {
        name: 'Ms. Ranibell Mambo',
        email: 'ranibellmambo@gratoengineering.com',
        role: 'Finance Officer',
        department: 'Business Development & Supply Chain'
      },
      status: 'pending',
      assignedDate: new Date()
    }
  ];
};

/**
 * Get next approval status based on current level
 */
const getNextApprovalStatus = (currentLevel, totalLevels) => {
  if (currentLevel === totalLevels) {
    return 'approved';
  }
  
  const nextLevel = currentLevel + 1;
  
  const statusMap = {
    1: 'pending_supervisor',
    2: 'pending_departmental_head',
    3: 'pending_head_of_business',
    4: 'pending_finance'
  };
  
  return statusMap[nextLevel] || 'pending_finance';
};

/**
 * Check if user can approve at specific level
 */
const canUserApproveAtLevel = (user, approvalStep) => {
  if (!user || !approvalStep) return false;
  
  // Match by email (most reliable)
  if (user.email !== approvalStep.approver.email) return false;
  
  // Admin can approve at levels 2 and 3
  if (user.role === 'admin') {
    return approvalStep.level === 2 || approvalStep.level === 3;
  }
  
  // Finance can approve at level 4
  if (user.role === 'finance') {
    return approvalStep.level === 4;
  }
  
  // Supervisors can approve at level 1
  if (user.role === 'supervisor') {
    return approvalStep.level === 1;
  }
  
  return false;
};

/**
 * Get user's approval level
 */
const getUserApprovalLevel = (userRole, userEmail) => {
  if (userRole === 'finance') return 4;
  
  if (userRole === 'admin') {
    // Kelvin (President) is level 3
    if (userEmail === 'kelvin.eyong@gratoglobal.com') {
      return 3;
    }
    // Other department heads are level 2
    return 2;
  }
  
  if (userRole === 'supervisor') return 1;
  
  return 0;
};

module.exports = {
  getCashRequestApprovalChain,
  getNextApprovalStatus,
  canUserApproveAtLevel,
  getUserApprovalLevel,
  getFallbackApprovalChain
};




