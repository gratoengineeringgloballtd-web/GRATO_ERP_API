const { getApprovalChainFromStructure } = require('./departmentStructure');

/**
 * FIXED: Get IT support approval chain with IT Department ALWAYS as final step
 * 
 * @param {string} employeeEmail - Email of employee requesting IT support
 * @returns {array} - Approval chain with levels, IT Department always as final step
 */
const getITSupportApprovalChain = (employeeEmail) => {
  console.log(`\n=== BUILDING IT SUPPORT APPROVAL CHAIN ===`);
  console.log(`Employee Email: ${employeeEmail}`);

  // Validate input
  if (!employeeEmail || typeof employeeEmail !== 'string') {
    console.error('❌ Invalid employee email provided');
    return getFallbackITApprovalChain();
  }

  // Get base approval chain from structure (same as cash requests)
  const baseApprovalChain = getApprovalChainFromStructure(employeeEmail);

  if (!baseApprovalChain || baseApprovalChain.length === 0) {
    console.warn(`⚠️ No approval chain found for ${employeeEmail}`);
    return getFallbackITApprovalChain();
  }

  console.log(`✓ Base approval chain retrieved: ${baseApprovalChain.length} levels`);


  // Define HR & Admin Head details
  const HR_DEPARTMENT = {
    name: 'HR & Admin Head',
    email: 'bruiline.tsitoh@gratoglobal.com',
    role: 'HR & Admin Head',
    department: 'HR & Admin'
  };

  // Define IT Department details
  const IT_DEPARTMENT = {
    name: 'IT Department',
    email: 'marcel.ngong@gratoglobal.com',
    role: 'IT Department - Final Approval',
    department: 'HR & Admin'
  };

  // Check if IT is already in the chain
  const itIndex = baseApprovalChain.findIndex(step => 
    step.approver?.email?.toLowerCase() === IT_DEPARTMENT.email.toLowerCase()
  );

  const hasIT = itIndex !== -1;

  let itApprovalChain;

  if (hasIT) {
    // IT already in chain - just map it
    console.log(`✓ IT Department already in approval chain at position ${itIndex + 1}`);
    // Remove IT from base chain if present, so we can always add HR before IT
    const baseChainWithoutIT = baseApprovalChain.filter(
      step => step.approver?.email?.toLowerCase() !== IT_DEPARTMENT.email.toLowerCase()
    );
    // Map base chain
    let mappedChain = baseChainWithoutIT.map((step, index) => {
      const approver = step.approver || {};
      return {
        level: index + 1,
        approver: {
          name: String(approver.name || 'Unknown Approver').trim(),
          email: String(approver.email || '').trim().toLowerCase(),
          role: mapRoleForITApproval(approver.role || 'Approver', index + 1, approver.email),
          department: String(approver.department || 'Unknown Department').trim()
        },
        status: 'pending',
        assignedDate: index === 0 ? new Date() : null,
        comments: '',
        actionDate: null,
        actionTime: null,
        decidedBy: null
      };
    });
    // Insert HR as penultimate step
    mappedChain.push({
      level: mappedChain.length + 1,
      approver: { ...HR_DEPARTMENT },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    // Add IT as final step
    mappedChain.push({
      level: mappedChain.length + 1,
      approver: { ...IT_DEPARTMENT },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    // Re-number levels
    itApprovalChain = mappedChain.map((step, idx) => ({ ...step, level: idx + 1 }));
  } else {
    // IT NOT in chain - append HR then IT as final steps
    console.log('✓ Appending HR & Admin Head and IT Department as final approval steps');
    // Map existing chain
    let mappedBaseChain = baseApprovalChain.map((step, index) => {
      const approver = step.approver || {};
      return {
        level: index + 1,
        approver: {
          name: String(approver.name || 'Unknown Approver').trim(),
          email: String(approver.email || '').trim().toLowerCase(),
          role: mapRoleForITApproval(approver.role || 'Approver', index + 1, approver.email),
          department: String(approver.department || 'Unknown Department').trim()
        },
        status: 'pending',
        assignedDate: index === 0 ? new Date() : null,
        comments: '',
        actionDate: null,
        actionTime: null,
        decidedBy: null
      };
    });
    // Add HR as penultimate step
    mappedBaseChain.push({
      level: mappedBaseChain.length + 1,
      approver: { ...HR_DEPARTMENT },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    // Add IT as final step
    mappedBaseChain.push({
      level: mappedBaseChain.length + 1,
      approver: { ...IT_DEPARTMENT },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    // Re-number levels
    itApprovalChain = mappedBaseChain.map((step, idx) => ({ ...step, level: idx + 1 }));
  }

  // Validate final chain
  const validation = validateITApprovalChain(itApprovalChain);
  if (!validation.valid) {
    console.error('❌ Generated approval chain is invalid:', validation.error);
    return getFallbackITApprovalChain();
  }

  console.log(`✅ IT approval chain created with ${itApprovalChain.length} levels`);
  const chainSummary = itApprovalChain.map(s => 
    `L${s.level}: ${s.approver.name} (${s.approver.role})`
  ).join(' → ');
  console.log(`Chain: ${chainSummary}`);
  console.log('=== END APPROVAL CHAIN ===\n');

  return itApprovalChain;
};

/**
 * Map role from structure to IT approval role
 */
const mapRoleForITApproval = (structureRole, level, email = '') => {
  const role = String(structureRole || '');
  const roleLower = role.toLowerCase();
  const emailLower = String(email || '').toLowerCase();
  
  // CRITICAL: IT Department role mapping by email (most reliable)
  if (emailLower === 'marcel.ngong@gratoglobal.com') {
    return 'IT Department - Final Approval';
  }

  // IT role mapping by keyword
  if (roleLower.includes('it department') || roleLower.includes('it staff')) {
    return 'IT Department - Final Approval';
  }
  
  // President / Head of Business
  if (roleLower.includes('president') || roleLower === 'head of business') {
    return 'Head of Business';
  }
  
  // Department Heads and Directors
  if (roleLower.includes('head') || roleLower.includes('director')) {
    return 'Departmental Head';
  }

  // Supervisors and Managers
  if (roleLower.includes('supervisor') || roleLower.includes('manager') || roleLower.includes('coordinator')) {
    return 'Supervisor';
  }

  // Fallback to level-based mapping
  const levelRoleMap = {
    1: 'Supervisor',
    2: 'Departmental Head', 
    3: 'Head of Business',
    4: 'IT Department - Final Approval'
  };

  return levelRoleMap[level] || role;
};

/**
 * FIXED: Fallback IT approval chain with IT Department as final step
 * This should rarely be used - most employees should be in departmentStructure.js
 */
const getFallbackITApprovalChain = () => {
  console.warn('⚠️ Using fallback IT approval chain - Employee not found in department structure');
  console.warn('⚠️ This employee should be added to config/departmentStructure.js');
  
  return [
    {
      level: 1,
      approver: {
        name: 'Mrs. Bruiline Tsitoh',
        email: 'bruiline.tsitoh@gratoglobal.com',
        role: 'Supervisor',
        department: 'HR & Admin'
      },
      status: 'pending',
      assignedDate: new Date(),
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    },
    {
      level: 2,
      approver: {
        name: 'Mrs. Bruiline Tsitoh',
        email: 'bruiline.tsitoh@gratoglobal.com',
        role: 'Departmental Head',
        department: 'HR & Admin'
      },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    },
    {
      level: 3,
      approver: {
        name: 'Mr. E.T Kelvin',
        email: 'kelvin.eyong@gratoglobal.com',
        role: 'Head of Business',
        department: 'Executive'
      },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    },
    {
      level: 4,
      approver: {
        name: 'IT Department',
        email: 'marcel.ngong@gratoglobal.com',
        role: 'IT Department - Final Approval',
        department: 'HR & Admin'
      },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    }
  ];
};

/**
 * Get next approval status based on current level
 */
const getNextITApprovalStatus = (currentLevel, totalLevels, approvalChain = []) => {
  // Check if we're at the last level
  if (currentLevel === totalLevels) {
    return 'it_approved'; // IT approved = fully approved (no finance for IT requests)
  }
  
  const nextLevel = currentLevel + 1;
  
  // Check if next level is IT Department by examining the approval chain
  if (approvalChain && approvalChain.length > 0) {
    const nextStep = approvalChain.find(s => s.level === nextLevel);
    if (nextStep && nextStep.approver.role === 'IT Department - Final Approval') {
      return 'pending_it_approval';
    }
  }
  
  // Default status mapping
  const statusMap = {
    1: 'pending_supervisor',
    2: 'pending_departmental_head',
    3: 'pending_head_of_business',
    4: 'pending_it_approval'
  };
  
  return statusMap[nextLevel] || 'pending_it_approval';
};

/**
 * Check if user can approve IT request at specific level
 */
const canUserApproveITRequest = (user, approvalStep) => {
  if (!user || !approvalStep) return false;
  
  // Normalize emails for comparison
  const userEmail = String(user.email || '').toLowerCase().trim();
  const stepEmail = String(approvalStep.approver?.email || '').toLowerCase().trim();
  
  // Match by email (most reliable)
  if (userEmail !== stepEmail) return false;
  
  // Check step status is pending
  if (approvalStep.status !== 'pending') return false;
  
  // Admin can approve at levels 2 and 3
  if (user.role === 'admin') {
    return approvalStep.level === 2 || approvalStep.level === 3;
  }
  
  // IT department can approve at their level (final approval)
  if (user.role === 'it') {
    return approvalStep.approver.role === 'IT Department - Final Approval';
  }
  
  // Supervisors can approve at level 1
  if (user.role === 'supervisor') {
    return approvalStep.level === 1;
  }
  
  return false;
};

/**
 * Get user's IT approval level
 */
const getUserITApprovalLevel = (userRole, userEmail) => {
  const email = String(userEmail || '').toLowerCase().trim();
  
  // IT Department
  if (email === 'marcel.ngong@gratoglobal.com' || userRole === 'it') {
    return 4;
  }
  
  // Head of Business (President)
  if (email === 'kelvin.eyong@gratoglobal.com') {
    return 3;
  }
  
  // Department Heads and Admin
  if (userRole === 'admin') {
    return 2;
  }
  
  // Supervisors
  if (userRole === 'supervisor') {
    return 1;
  }
  
  return 0;
};

/**
 * Validate IT approval chain structure
 * Ensures all required fields are present and valid
 */
const validateITApprovalChain = (approvalChain) => {
  if (!Array.isArray(approvalChain) || approvalChain.length === 0) {
    return { valid: false, error: 'Approval chain must be a non-empty array' };
  }

  // Check if IT Department is the last step
  const lastStep = approvalChain[approvalChain.length - 1];
  if (lastStep.approver.role !== 'IT Department - Final Approval') {
    return { valid: false, error: 'IT Department must be the final approver' };
  }

  for (let i = 0; i < approvalChain.length; i++) {
    const step = approvalChain[i];
    
    if (!step.level || typeof step.level !== 'number') {
      return { valid: false, error: `Step ${i + 1}: Missing or invalid level` };
    }

    if (step.level !== i + 1) {
      return { valid: false, error: `Step ${i + 1}: Level mismatch (expected ${i + 1}, got ${step.level})` };
    }

    if (!step.approver || typeof step.approver !== 'object') {
      return { valid: false, error: `Step ${i + 1}: Missing or invalid approver object` };
    }

    const { name, email, role, department } = step.approver;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return { valid: false, error: `Step ${i + 1}: Approver name must be a non-empty string` };
    }

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      return { valid: false, error: `Step ${i + 1}: Approver email must be a non-empty string` };
    }

    if (!role || typeof role !== 'string' || role.trim().length === 0) {
      return { valid: false, error: `Step ${i + 1}: Approver role must be a non-empty string` };
    }

    if (!department || typeof department !== 'string' || department.trim().length === 0) {
      return { valid: false, error: `Step ${i + 1}: Approver department must be a non-empty string` };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { valid: false, error: `Step ${i + 1}: Invalid email format: ${email}` };
    }
  }

  return { valid: true };
};

/**
 * Check if a step is IT Department approval
 */
const isITStep = (step) => {
  if (!step || !step.approver) return false;
  
  return step.approver.role === 'IT Department - Final Approval' || 
         step.approver.email?.toLowerCase() === 'marcel.ngong@gratoglobal.com';
};

/**
 * Find supervisor in department structure
 * (Kept for backward compatibility but not used in new approach)
 */
const findSupervisor = (employeeData, departmentName) => {
  console.warn('⚠️ findSupervisor() is deprecated. Use getApprovalChainFromStructure() instead.');
  return null;
};

module.exports = {
  getITSupportApprovalChain,
  getNextITApprovalStatus,
  canUserApproveITRequest,
  getUserITApprovalLevel,
  getFallbackITApprovalChain,
  validateITApprovalChain,
  isITStep,
  findSupervisor 
};






