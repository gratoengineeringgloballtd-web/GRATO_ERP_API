const { getApprovalChainFromStructure } = require('./departmentStructure');

/**
 * ✅ VERSION 2.1: Get cash request approval chain with CONDITIONAL HR
 * Mission requests: Supervisor → Dept Head → HR → Finance → HOB (6 levels)
 * Other requests: Supervisor → Dept Head → Finance → HOB (5 levels)
 * 
 * @param {string} employeeEmail - Email of employee requesting cash
 * @param {string} requestType - Type of request (e.g., 'missions', 'expense', 'travel')
 * @returns {array} - Approval chain with 5 or 6 levels
 */
const getCashRequestApprovalChain = (employeeEmail, requestType) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== BUILDING CASH REQUEST APPROVAL CHAIN (V2.1) ===`);
  console.log(`${'='.repeat(60)}`);
  console.log(`🔹 Employee Email: ${employeeEmail}`);
  console.log(`🔹 Request Type: ${requestType}`);
  console.log(`🔹 Version: 2.1 (Conditional HR for missions only)`);
  console.log(`🔹 Timestamp: ${new Date().toISOString()}`);

  // Validate input
  if (!employeeEmail || typeof employeeEmail !== 'string') {
    console.error('❌ Invalid employee email provided');
    return getFallbackApprovalChain(requestType);
  }

  console.log(`✓ Input validation passed`);

  // ✅ CHECK: Is this a missions request?
  const isMissionRequest = requestType && [
    'travel',
    'accommodation',
    'perdiem',
    'mission'
  ].includes(requestType.toLowerCase());
  
  console.log(`✓ Mission Request: ${isMissionRequest ? 'YES - HR will be included' : 'NO - HR will be skipped'}`);

  // STEP 1: Get base approval chain from structure (Supervisor → Dept Head)
  console.log(`\n--- STEP 1: Getting Base Approval Chain ---`);
  const baseApprovalChain = getApprovalChainFromStructure(employeeEmail);

  if (!baseApprovalChain || baseApprovalChain.length === 0) {
    console.warn(`⚠️ No approval chain found for ${employeeEmail}`);
    console.warn(`⚠️ Returning fallback chain`);
    return getFallbackApprovalChain(requestType);
  }

  console.log(`✓ Base approval chain retrieved: ${baseApprovalChain.length} levels`);
  baseApprovalChain.forEach((step, index) => {
    console.log(`  [${index}] Level ${step.level}: ${step.approver?.name} (${step.approver?.role})`);
  });

  // STEP 2: Define Fixed Approvers
  console.log(`\n--- STEP 2: Defining Fixed Approvers ---`);
  
  const HR_HEAD = {
    name: 'Mrs. Bruiline Tsitoh',
    email: 'bruiline.tsitoh@gratoglobal.com',
    role: 'HR Head',
    department: 'HR & Admin'
  };

  const FINANCE_OFFICER = {
    name: 'Ms. Ranibell Mambo',
    email: 'ranibellmambo@gratoengineering.com',
    role: 'Finance Officer',
    department: 'Finance'
  };

  const HEAD_OF_BUSINESS = {
    name: 'Mr. E.T Kelvin',
    email: 'kelvin.eyong@gratoglobal.com',
    role: 'Head of Business',
    department: 'Executive'
  };

  if (isMissionRequest) {
    console.log(`✅ HR Head: ${HR_HEAD.name} (WILL BE INCLUDED - Missions request)`);
  } else {
    console.log(`⏭️  HR Head: ${HR_HEAD.name} (WILL BE SKIPPED - Not a missions request)`);
  }
  console.log(`Finance Officer: ${FINANCE_OFFICER.name}`);
  console.log(`Head of Business: ${HEAD_OF_BUSINESS.name}`);

  // STEP 3: Build Approval Chain
  console.log(`\n--- STEP 3: Building ${isMissionRequest ? '6' : '5'}-Level Approval Chain ---`);
  

  let processedChain = [];
  let currentLevel = 1;
  const seenEmails = new Set();
  // Extract and save HOB if in base chain
  const ceoEmailLower = HEAD_OF_BUSINESS.email.toLowerCase();
  const baseChainWithoutCEO = baseApprovalChain.filter(step => {
    const emailLower = String(step.approver?.email || '').trim().toLowerCase();
    if (emailLower === ceoEmailLower) {
      console.log(`  🎯 Found CEO in base chain - will add as final approver`);
      return false;
    }
    return true;
  });

  // Add base chain (Supervisor → Dept Head, excluding CEO)
  console.log(`\n  Adding Base Chain (Supervisor → Dept Head):`);
  baseChainWithoutCEO.forEach((step) => {
    const approver = step.approver || {};
    const emailLower = String(approver.email || '').trim().toLowerCase();
    if (seenEmails.has(emailLower)) {
      console.log(`  ⚠️  Skipping duplicate: ${approver.name} (${emailLower})`);
      return;
    }
    seenEmails.add(emailLower);
    processedChain.push({
      level: currentLevel,
      approver: {
        name: String(approver.name || 'Unknown Approver').trim(),
        email: emailLower,
        role: mapRoleForCashApproval(approver.role || 'Approver', currentLevel, approver.email),
        department: String(approver.department || 'Unknown Department').trim()
      },
      status: 'pending',
      assignedDate: currentLevel === 1 ? new Date() : null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    console.log(`  ✓ [${currentLevel - 1}] L${currentLevel}: ${processedChain[processedChain.length - 1].approver.name} (${processedChain[processedChain.length - 1].approver.role})`);
    currentLevel++;
  });

  // Insert HR after Dept Head for mission requests
  if (isMissionRequest) {
    // Find Dept Head (should be level 2)
    const hrEmailLower = HR_HEAD.email.toLowerCase();
    // Only add if not already present
    const alreadyHasHR = processedChain.some(
      step => String(step.approver?.email || '').trim().toLowerCase() === hrEmailLower
    );
    if (!alreadyHasHR) {
      // Insert HR at level 3 (after Dept Head)
      const hrStep = {
        level: 3,
        approver: {
          name: HR_HEAD.name,
          email: HR_HEAD.email,
          role: HR_HEAD.role,
          department: HR_HEAD.department
        },
        status: 'pending',
        assignedDate: null,
        comments: '',
        actionDate: null,
        actionTime: null,
        decidedBy: null
      };
      // Insert at index 2 (after Dept Head)
      processedChain.splice(2, 0, hrStep);
      seenEmails.add(hrEmailLower);
      console.log(`  ✅ Inserted HR Head at level 3 (after Dept Head)`);
      // Re-number levels
      processedChain.forEach((step, idx) => step.level = idx + 1);
      currentLevel = processedChain.length + 1;
    } else {
      console.log(`  ⚠️  HR already in chain, skipping insert`);
    }
  } else {
    console.log(`  ⏭️  Skipping HR Head (Request type: "${requestType}" is not missions)`);
  }

  // Add Finance Officer (after HR if present, else after Dept Head)
  console.log(`\n  Adding Finance Officer:`);
  const financeEmailLower = FINANCE_OFFICER.email.toLowerCase();
  const alreadyHasFinance = processedChain.some(
    step => String(step.approver?.email || '').trim().toLowerCase() === financeEmailLower
  );
  if (!alreadyHasFinance) {
    processedChain.push({
      level: processedChain.length + 1,
      approver: {
        name: FINANCE_OFFICER.name,
        email: FINANCE_OFFICER.email,
        role: FINANCE_OFFICER.role,
        department: FINANCE_OFFICER.department
      },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    seenEmails.add(financeEmailLower);
    console.log(`  ✓ Added Finance Officer at level ${processedChain.length}`);
  } else {
    console.log(`  ⚠️  Skipping Finance (already in chain): ${FINANCE_OFFICER.name}`);
  }

  // ALWAYS ADD CEO AS FINAL APPROVER
  console.log(`\n  Adding Final Approver (CEO):`);
  if (!processedChain.some(step => String(step.approver?.email || '').trim().toLowerCase() === ceoEmailLower)) {
    processedChain.push({
      level: processedChain.length + 1,
      approver: {
        name: HEAD_OF_BUSINESS.name,
        email: HEAD_OF_BUSINESS.email,
        role: HEAD_OF_BUSINESS.role,
        department: HEAD_OF_BUSINESS.department
      },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    seenEmails.add(ceoEmailLower);
    console.log(`  ✓ Added Head of Business at level ${processedChain.length}`);
  } else {
    // Force add if somehow already in chain
    processedChain.push({
      level: processedChain.length + 1,
      approver: {
        name: HEAD_OF_BUSINESS.name,
        email: HEAD_OF_BUSINESS.email,
        role: HEAD_OF_BUSINESS.role,
        department: HEAD_OF_BUSINESS.department
      },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    console.log(`  ⚠️  Forced Head of Business as final approver`);
  }

  // STEP 4: Validate final chain
  console.log(`\n--- STEP 4: Validating Final Chain ---`);
  console.log(`Chain Length: ${processedChain.length}`);
  console.log(`Expected Length: ${isMissionRequest ? '6 levels (with HR)' : '5 levels (without HR)'}`);
  
  const validation = validateCashApprovalChain(processedChain);
  console.log(`Validation Result:`, validation);

  if (!validation.valid) {
    console.error('❌ VALIDATION FAILED:', validation.error);
    return getFallbackApprovalChain(requestType);
  }

  console.log(`✅ Validation PASSED`);

  // STEP 5: Final summary
  console.log(`\n--- FINAL SUMMARY ---`);
  console.log(`✅ Cash approval chain created with ${processedChain.length} levels`);
  console.log(`✅ Request Type: "${requestType}" ${isMissionRequest ? '(MISSIONS - includes HR)' : '(NON-MISSIONS - skips HR)'}`);
  
  const chainSummary = processedChain.map(s => 
    `L${s.level}: ${s.approver.name} (${s.approver.role})`
  ).join(' → ');
  console.log(`\n📋 Full Chain:\n   ${chainSummary}`);
  
  console.log(`\n🎯 Last approver check:`);
  const lastStep = processedChain[processedChain.length - 1];
  console.log(`  • Name: ${lastStep.approver.name}`);
  console.log(`  • Role: ${lastStep.approver.role}`);
  console.log(`  • Email: ${lastStep.approver.email}`);
  console.log(`  • Is Head of Business: ${lastStep.approver.role === 'Head of Business' ? '✅ YES' : '❌ NO'}`);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== END APPROVAL CHAIN BUILD ===`);
  console.log(`${'='.repeat(60)}\n`);

  return processedChain;
};

/**
 * Map role from structure to cash approval role
 */
const mapRoleForCashApproval = (structureRole, level, email = '') => {
  const role = String(structureRole || '');
  const roleLower = role.toLowerCase();
  const emailLower = String(email || '').toLowerCase();
  
  // HR Head mapping
  if (emailLower === 'bruiline.tsitoh@gratoglobal.com') {
    return 'HR Head';
  }

  // Finance Officer role mapping
  if (emailLower === 'ranibellmambo@gratoengineering.com') {
    return 'Finance Officer';
  }

  // Head of Business
  if (emailLower === 'kelvin.eyong@gratoglobal.com') {
    return 'Head of Business';
  }

  // Finance role mapping by keyword
  if (roleLower.includes('finance')) {
    return 'Finance Officer';
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
  let mappedRole = role;
  if (level === 1) mappedRole = 'Supervisor';
  else if (level === 2) mappedRole = 'Departmental Head';
  else if (level >= 3) mappedRole = 'Approver';
  
  return mappedRole;
};

/**
 * ✅ UPDATED: Fallback approval chain with conditional HR (missions only)
 */
const getFallbackApprovalChain = (requestType) => {
  console.warn('\n⚠️⚠️⚠️ USING FALLBACK APPROVAL CHAIN (V2.1) ⚠️⚠️⚠️');
  console.warn('Employee not found in department structure');
  console.warn('This employee should be added to config/departmentStructure.js\n');
  
  const isMissionRequest = requestType && [
    'travel',
    'accommodation',
    'perdiem',
    'mission'
  ].includes(requestType.toLowerCase());
  
  console.log(`Request Type: "${requestType}"`);
  console.log(`Is Missions: ${isMissionRequest ? 'YES' : 'NO'}`);
  
  const fallbackChain = [
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
    }
  ];

  let nextLevel = 3;

  // ✅ CONDITIONAL: Add HR only for missions requests
  if (isMissionRequest) {
    fallbackChain.push({
      level: nextLevel,
      approver: {
        name: 'Mrs. Bruiline Tsitoh',
        email: 'bruiline.tsitoh@gratoglobal.com',
        role: 'HR Head',
        department: 'HR & Admin'
      },
      status: 'pending',
      assignedDate: null,
      comments: '',
      actionDate: null,
      actionTime: null,
      decidedBy: null
    });
    console.log(`✅ Added HR Head at level ${nextLevel} (Missions request)`);
    nextLevel++;
  } else {
    console.log(`⏭️  Skipped HR Head (Not a missions request)`);
  }

  // Add Finance
  fallbackChain.push({
    level: nextLevel,
    approver: {
      name: 'Ms. Ranibell Mambo',
      email: 'ranibellmambo@gratoengineering.com',
      role: 'Finance Officer',
      department: 'Finance'
    },
    status: 'pending',
    assignedDate: null,
    comments: '',
    actionDate: null,
    actionTime: null,
    decidedBy: null
  });
  console.log(`✅ Added Finance at level ${nextLevel}`);
  nextLevel++;

  // Add HOB
  fallbackChain.push({
    level: nextLevel,
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
  });
  console.log(`✅ Added HOB at level ${nextLevel}`);

  console.log(`\n✅ Fallback chain created with ${fallbackChain.length} levels`);
  console.log(`   Structure: ${isMissionRequest ? 'Supervisor → Dept Head → HR → Finance → HOB' : 'Supervisor → Dept Head → Finance → HOB'}`);
  
  return fallbackChain;
};

/**
 * ✅ UPDATED: Get next approval status (conditional HR for missions)
 */
const getNextApprovalStatus = (currentLevel, totalLevels, approvalChain = [], requestType = '') => {
  // const isMissionRequest = requestType && (
  //   requestType.toLowerCase() === 'missions' ||
  //   requestType.toLowerCase() === 'mission'
  // );

  const isMissionRequest = requestType && [
    requestType.toLowerCase() === 'travel',
    requestType.toLowerCase() === 'accommodation',
    requestType.toLowerCase() === 'perdiem',
    requestType.toLowerCase() === 'mission',
  ];
  
  // If at final level, approve
  if (currentLevel === totalLevels) {
    return 'approved';
  }
  
  const nextLevel = currentLevel + 1;
  
  // Find the step at nextLevel to determine status
  const nextStep = approvalChain.find(s => s.level === nextLevel);
  
  if (nextStep) {
    const role = nextStep.approver?.role;
    
    if (role === 'Supervisor') return 'pending_supervisor';
    if (role === 'Departmental Head') return 'pending_departmental_head';
    if (role === 'HR Head') return 'pending_hr';
    if (role === 'Finance Officer') return 'pending_finance';
    if (role === 'Head of Business') return 'pending_head_of_business';
  }
  
  // Fallback
  return 'approved';
};

/**
 * Validate cash approval chain
 */
const validateCashApprovalChain = (approvalChain) => {
  console.log(`\n   [VALIDATE] Starting validation...`);
  console.log(`   [VALIDATE] Chain length: ${approvalChain?.length || 0}`);

  if (!Array.isArray(approvalChain) || approvalChain.length === 0) {
    return { valid: false, error: 'Approval chain must be a non-empty array' };
  }

  // Check if Head of Business is the last step
  const lastStep = approvalChain[approvalChain.length - 1];
  console.log(`   [VALIDATE] Last step role: "${lastStep?.approver?.role}"`);

  if (!lastStep || !lastStep.approver) {
    return { valid: false, error: 'Last step is missing approver data' };
  }

  if (lastStep.approver.role !== 'Head of Business') {
    console.log(`   [VALIDATE] ❌ Head of Business check FAILED`);
    return { 
      valid: false, 
      error: `Head of Business must be the final approver. Found: ${lastStep.approver.role}`
    };
  }

  console.log(`   [VALIDATE] ✅ Head of Business is final approver`);

  // Validate each step
  for (let i = 0; i < approvalChain.length; i++) {
    const step = approvalChain[i];
    
    if (!step.level || step.level !== i + 1) {
      return { valid: false, error: `Step ${i + 1}: Level mismatch` };
    }

    if (!step.approver || !step.approver.name || !step.approver.email || !step.approver.role) {
      return { valid: false, error: `Step ${i + 1}: Missing approver data` };
    }
  }

  console.log(`   [VALIDATE] ✅ All steps validated successfully`);
  return { valid: true };
};

/**
 * Check if a step is Finance approval
 */
const isFinanceStep = (step) => {
  if (!step || !step.approver) return false;
  
  return step.approver.role === 'Finance Officer' || 
         step.approver.email?.toLowerCase() === 'ranibellmambo@gratoengineering.com';
};

/**
 * Check if a step is HR approval
 */
const isHRStep = (step) => {
  if (!step || !step.approver) return false;
  
  return step.approver.role === 'HR Head' || 
         step.approver.email?.toLowerCase() === 'bruiline.tsitoh@gratoglobal.com';
};

/**
 * Check if a step is Head of Business approval
 */
const isHeadOfBusinessStep = (step) => {
  if (!step || !step.approver) return false;
  
  return step.approver.role === 'Head of Business' || 
         step.approver.email?.toLowerCase() === 'kelvin.eyong@gratoglobal.com';
};

module.exports = {
  getCashRequestApprovalChain,
  getNextApprovalStatus,
  getFallbackApprovalChain,
  validateCashApprovalChain,
  isFinanceStep,
  isHRStep,
  isHeadOfBusinessStep
};









// const { getApprovalChainFromStructure } = require('./departmentStructure');

// /**
//  * ✅ VERSION 2: Get cash request approval chain with HR inserted
//  * NEW FLOW: Supervisor → Dept Head → HR → Finance → Head of Business ✅
//  * 
//  * @param {string} employeeEmail - Email of employee requesting cash
//  * @returns {array} - Approval chain with 6 levels (5 approvers)
//  */
// const getCashRequestApprovalChain = (employeeEmail) => {
//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`=== BUILDING CASH REQUEST APPROVAL CHAIN (V2) ===`);
//   console.log(`${'='.repeat(60)}`);
//   console.log(`🔹 Employee Email: ${employeeEmail}`);
//   console.log(`🔹 Version: 2 (6-level flow with HR)`);
//   console.log(`🔹 Timestamp: ${new Date().toISOString()}`);

//   // Validate input
//   if (!employeeEmail || typeof employeeEmail !== 'string') {
//     console.error('❌ Invalid employee email provided');
//     return getFallbackApprovalChain();
//   }

//   console.log(`✓ Input validation passed`);

//   // STEP 1: Get base approval chain from structure (Supervisor → Dept Head)
//   console.log(`\n--- STEP 1: Getting Base Approval Chain ---`);
//   const baseApprovalChain = getApprovalChainFromStructure(employeeEmail);

//   if (!baseApprovalChain || baseApprovalChain.length === 0) {
//     console.warn(`⚠️ No approval chain found for ${employeeEmail}`);
//     console.warn(`⚠️ Returning fallback chain`);
//     return getFallbackApprovalChain();
//   }

//   console.log(`✓ Base approval chain retrieved: ${baseApprovalChain.length} levels`);
//   baseApprovalChain.forEach((step, index) => {
//     console.log(`  [${index}] Level ${step.level}: ${step.approver?.name} (${step.approver?.role})`);
//   });

//   // STEP 2: Define Fixed Approvers (HR, Finance, Head of Business)
//   console.log(`\n--- STEP 2: Defining Fixed Approvers ---`);
  
//   const HR_HEAD = {
//     name: 'Mrs. Bruiline Tsitoh',
//     email: 'bruiline.tsitoh@gratoglobal.com',
//     role: 'HR Head',
//     department: 'HR & Admin'
//   };

//   const FINANCE_OFFICER = {
//     name: 'Ms. Ranibell Mambo',
//     email: 'ranibellmambo@gratoengineering.com',
//     role: 'Finance Officer',
//     department: 'Finance'
//   };

//   const HEAD_OF_BUSINESS = {
//     name: 'Mr. E.T Kelvin',
//     email: 'kelvin.eyong@gratoglobal.com',
//     role: 'Head of Business',
//     department: 'Executive'
//   };

//   console.log(`HR Head: ${HR_HEAD.name}`);
//   console.log(`Finance Officer: ${FINANCE_OFFICER.name}`);
//   console.log(`Head of Business: ${HEAD_OF_BUSINESS.name}`);

//   // STEP 3: Build New 6-Level Chain
//   console.log(`\n--- STEP 3: Building 6-Level Approval Chain ---`);
  
//   let processedChain = [];
//   let currentLevel = 1;
//   const seenEmails = new Set(); // Track emails to prevent duplicates
  
//   // ✅ SPECIAL CASE: If base chain contains CEO, extract and save for end
//   const ceoEmailLower = HEAD_OF_BUSINESS.email.toLowerCase();
//   const baseChainWithoutCEO = baseApprovalChain.filter(step => {
//     const emailLower = String(step.approver?.email || '').trim().toLowerCase();
//     if (emailLower === ceoEmailLower) {
//       console.log(`  🎯 Found CEO in base chain - will add as final approver`);
//       return false; // Remove from base chain
//     }
//     return true;
//   });

//   // Add base chain (Supervisor → Dept Head, excluding CEO if present)
//   baseChainWithoutCEO.forEach((step) => {
//     const approver = step.approver || {};
//     const emailLower = String(approver.email || '').trim().toLowerCase();
    
//     if (seenEmails.has(emailLower)) {
//       console.log(`  ⚠️  Skipping duplicate: ${approver.name} (${emailLower})`);
//       return;
//     }
    
//     seenEmails.add(emailLower);
    
//     processedChain.push({
//       level: currentLevel,
//       approver: {
//         name: String(approver.name || 'Unknown Approver').trim(),
//         email: emailLower,
//         role: mapRoleForCashApproval(approver.role || 'Approver', currentLevel, approver.email),
//         department: String(approver.department || 'Unknown Department').trim()
//       },
//       status: 'pending',
//       assignedDate: currentLevel === 1 ? new Date() : null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     });
    
//     console.log(`  [${currentLevel - 1}] L${currentLevel}: ${processedChain[processedChain.length - 1].approver.name} (${processedChain[processedChain.length - 1].approver.role})`);
//     currentLevel++;
//   });

//   // ✅ LEVEL 3: Add HR Head
//   const hrEmailLower = HR_HEAD.email.toLowerCase();
//   if (!seenEmails.has(hrEmailLower)) {
//     seenEmails.add(hrEmailLower);
    
//     processedChain.push({
//       level: currentLevel,
//       approver: {
//         name: HR_HEAD.name,
//         email: HR_HEAD.email,
//         role: HR_HEAD.role,
//         department: HR_HEAD.department
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     });
//     console.log(`  [${currentLevel - 1}] L${currentLevel}: ${HR_HEAD.name} (${HR_HEAD.role}) ← HR INSERTED`);
//     currentLevel++;
//   } else {
//     console.log(`  ⚠️  Skipping HR (already in chain): ${HR_HEAD.name}`);
//   }

//   // ✅ LEVEL 4: Add Finance Officer
//   const financeEmailLower = FINANCE_OFFICER.email.toLowerCase();
//   if (!seenEmails.has(financeEmailLower)) {
//     seenEmails.add(financeEmailLower);
    
//     processedChain.push({
//       level: currentLevel,
//       approver: {
//         name: FINANCE_OFFICER.name,
//         email: FINANCE_OFFICER.email,
//         role: FINANCE_OFFICER.role,
//         department: FINANCE_OFFICER.department
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     });
//     console.log(`  [${currentLevel - 1}] L${currentLevel}: ${FINANCE_OFFICER.name} (${FINANCE_OFFICER.role})`);
//     currentLevel++;
//   } else {
//     console.log(`  ⚠️  Skipping Finance (already in chain): ${FINANCE_OFFICER.name}`);
//   }

//   // ✅ ALWAYS ADD CEO AS FINAL APPROVER (even if in base chain)
//   // This ensures CEO is ALWAYS last, regardless of reporting structure
//   if (!seenEmails.has(ceoEmailLower)) {
//     seenEmails.add(ceoEmailLower);
    
//     processedChain.push({
//       level: currentLevel,
//       approver: {
//         name: HEAD_OF_BUSINESS.name,
//         email: HEAD_OF_BUSINESS.email,
//         role: HEAD_OF_BUSINESS.role,
//         department: HEAD_OF_BUSINESS.department
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     });
//     console.log(`  [${currentLevel - 1}] L${currentLevel}: ${HEAD_OF_BUSINESS.name} (${HEAD_OF_BUSINESS.role}) ← FINAL APPROVER`);
//   } else {
//     // CEO already in chain from base - this shouldn't happen now, but log it
//     console.log(`  ⚠️  WARNING: CEO already in chain (this shouldn't happen)`);
    
//     // FORCE ADD CEO AT END anyway (safety measure)
//     processedChain.push({
//       level: currentLevel,
//       approver: {
//         name: HEAD_OF_BUSINESS.name,
//         email: HEAD_OF_BUSINESS.email,
//         role: HEAD_OF_BUSINESS.role,
//         department: HEAD_OF_BUSINESS.department
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     });
//     console.log(`  [${currentLevel - 1}] L${currentLevel}: ${HEAD_OF_BUSINESS.name} (${HEAD_OF_BUSINESS.role}) ← FINAL APPROVER (FORCED)`);
//   }

//   // STEP 4: Validate final chain
//   console.log(`\n--- STEP 4: Validating Final Chain ---`);
//   console.log(`Chain Length: ${processedChain.length}`);
  
//   const validation = validateCashApprovalChain(processedChain);
//   console.log(`Validation Result:`, validation);

//   if (!validation.valid) {
//     console.error('❌ VALIDATION FAILED:', validation.error);
//     return getFallbackApprovalChain();
//   }

//   console.log(`✅ Validation PASSED`);

//   // STEP 5: Final summary
//   console.log(`\n--- FINAL SUMMARY ---`);
//   console.log(`✅ Cash approval chain created with ${processedChain.length} levels`);
  
//   const chainSummary = processedChain.map(s => 
//     `L${s.level}: ${s.approver.name} (${s.approver.role})`
//   ).join(' → ');
//   console.log(`\nChain: ${chainSummary}`);
  
//   console.log(`\nLast approver check:`);
//   const lastStep = processedChain[processedChain.length - 1];
//   console.log(`  Name: ${lastStep.approver.name}`);
//   console.log(`  Role: ${lastStep.approver.role}`);
//   console.log(`  Email: ${lastStep.approver.email}`);
//   console.log(`  Is Head of Business: ${lastStep.approver.role === 'Head of Business'}`);
  
//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`=== END APPROVAL CHAIN BUILD ===`);
//   console.log(`${'='.repeat(60)}\n`);

//   return processedChain;
// };

// /**
//  * Map role from structure to cash approval role
//  */
// const mapRoleForCashApproval = (structureRole, level, email = '') => {
//   const role = String(structureRole || '');
//   const roleLower = role.toLowerCase();
//   const emailLower = String(email || '').toLowerCase();
  
//   console.log(`      Mapping role: "${role}" at level ${level} for email "${emailLower}"`);
  
//   // HR Head mapping
//   if (emailLower === 'bruiline.tsitoh@gratoglobal.com') {
//     console.log(`      ✓ Mapped to: HR Head (by email)`);
//     return 'HR Head';
//   }

//   // Finance Officer role mapping
//   if (emailLower === 'ranibellmambo@gratoengineering.com') {
//     console.log(`      ✓ Mapped to: Finance Officer (by email)`);
//     return 'Finance Officer';
//   }

//   // Head of Business
//   if (emailLower === 'kelvin.eyong@gratoglobal.com') {
//     console.log(`      ✓ Mapped to: Head of Business (by email)`);
//     return 'Head of Business';
//   }

//   // Finance role mapping by keyword
//   if (roleLower.includes('finance')) {
//     console.log(`      ✓ Mapped to: Finance Officer (by keyword)`);
//     return 'Finance Officer';
//   }
  
//   // President / Head of Business
//   if (roleLower.includes('president') || roleLower === 'head of business') {
//     console.log(`      ✓ Mapped to: Head of Business`);
//     return 'Head of Business';
//   }
  
//   // Department Heads and Directors
//   if (roleLower.includes('head') || roleLower.includes('director')) {
//     console.log(`      ✓ Mapped to: Departmental Head`);
//     return 'Departmental Head';
//   }

//   // Supervisors and Managers
//   if (roleLower.includes('supervisor') || roleLower.includes('manager') || roleLower.includes('coordinator')) {
//     console.log(`      ✓ Mapped to: Supervisor`);
//     return 'Supervisor';
//   }

//   // Fallback to level-based mapping
//   let mappedRole = role;
//   if (level === 1) mappedRole = 'Supervisor';
//   else if (level === 2) mappedRole = 'Departmental Head';
//   else if (level === 3) mappedRole = 'HR Head';
//   else if (level === 4) mappedRole = 'Finance Officer';
//   else if (level === 5) mappedRole = 'Head of Business';
  
//   console.log(`      ✓ Mapped to: ${mappedRole} (by level fallback)`);
//   return mappedRole;
// };

// /**
//  * ✅ UPDATED: Fallback approval chain with 6 levels (HR included)
//  */
// const getFallbackApprovalChain = () => {
//   console.warn('\n⚠️⚠️⚠️ USING FALLBACK APPROVAL CHAIN (V2) ⚠️⚠️⚠️');
//   console.warn('Employee not found in department structure');
//   console.warn('This employee should be added to config/departmentStructure.js\n');
  
//   const fallbackChain = [
//     {
//       level: 1,
//       approver: {
//         name: 'Mrs. Bruiline Tsitoh',
//         email: 'bruiline.tsitoh@gratoglobal.com',
//         role: 'Supervisor',
//         department: 'HR & Admin'
//       },
//       status: 'pending',
//       assignedDate: new Date(),
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     },
//     {
//       level: 2,
//       approver: {
//         name: 'Mrs. Bruiline Tsitoh',
//         email: 'bruiline.tsitoh@gratoglobal.com',
//         role: 'Departmental Head',
//         department: 'HR & Admin'
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     },
//     {
//       level: 3,
//       approver: {
//         name: 'Mrs. Bruiline Tsitoh',
//         email: 'bruiline.tsitoh@gratoglobal.com',
//         role: 'HR Head',
//         department: 'HR & Admin'
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     },
//     {
//       level: 4,
//       approver: {
//         name: 'Ms. Ranibell Mambo',
//         email: 'ranibellmambo@gratoengineering.com',
//         role: 'Finance Officer',
//         department: 'Finance'
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     },
//     {
//       level: 5,
//       approver: {
//         name: 'Mr. E.T Kelvin',
//         email: 'kelvin.eyong@gratoglobal.com',
//         role: 'Head of Business',
//         department: 'Executive'
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     }
//   ];

//   console.log('Fallback chain created with 5 levels (6-level V2 flow)');
//   return fallbackChain;
// };

// /**
//  * ✅ UPDATED: Get next approval status based on current level (Version 2)
//  */
// // const getNextApprovalStatus = (currentLevel, totalLevels, approvalChain = []) => {
// //   // Version 2: 5-level flow
// //   // Level 1 → pending_supervisor
// //   // Level 2 → pending_departmental_head
// //   // Level 3 → pending_hr (NEW)
// //   // Level 4 → pending_finance
// //   // Level 5 → approved (Head of Business is final)
  
// //   if (currentLevel === totalLevels) {
// //     return 'approved'; // Head of Business approved = fully approved
// //   }
  
// //   const nextLevel = currentLevel + 1;
  
// //   // Status map for Version 2
// //   const statusMap = {
// //     1: 'pending_supervisor',
// //     2: 'pending_departmental_head',
// //     3: 'pending_hr',                    // ✅ NEW
// //     4: 'pending_finance',
// //     5: 'pending_head_of_business'       // ✅ CHANGED (was final, now penultimate)
// //   };
  
// //   return statusMap[nextLevel] || 'approved';
// // };


// /**
//  * ✅ V2 FIXED: Get next approval status based on current level
//  */
// const getNextApprovalStatus = (currentLevel, totalLevels, approvalChain = []) => {
//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`[GET_NEXT_STATUS] Determining next status...`);
//   console.log(`[GET_NEXT_STATUS] Current Level: ${currentLevel}`);
//   console.log(`[GET_NEXT_STATUS] Total Levels: ${totalLevels}`);
//   console.log(`${'='.repeat(60)}`);
  
//   // ✅ CRITICAL CHECK: Are we at the last level?
//   if (currentLevel === totalLevels) {
//     console.log(`[GET_NEXT_STATUS] ✅ LAST LEVEL APPROVED`);
//     console.log(`[GET_NEXT_STATUS] All approvers have approved`);
//     console.log(`[GET_NEXT_STATUS] Returning status: 'approved'`);
//     console.log(`${'='.repeat(60)}\n`);
//     return 'approved'; // Head of Business approved = fully approved
//   }
  
//   // We're NOT at the last level, so move to next level
//   const nextLevel = currentLevel + 1;
//   console.log(`[GET_NEXT_STATUS] ⏭️  Moving to next level: ${nextLevel}`);
  
//   // Find the next approver
//   const nextApprover = approvalChain.find(step => step.level === nextLevel);
  
//   if (!nextApprover) {
//     console.error(`[GET_NEXT_STATUS] ❌ ERROR: No approver found at level ${nextLevel}`);
//     console.error(`[GET_NEXT_STATUS] This should not happen!`);
//     console.log(`${'='.repeat(60)}\n`);
//     return 'approved'; // Fallback
//   }
  
//   const nextRole = nextApprover.approver?.role;
//   const nextName = nextApprover.approver?.name;
  
//   console.log(`[GET_NEXT_STATUS] Next approver: ${nextName}`);
//   console.log(`[GET_NEXT_STATUS] Next approver role: ${nextRole}`);
  
//   // ✅ V2 STATUS MAP - Map role to status
//   const roleToStatusMap = {
//     'Supervisor': 'pending_supervisor',
//     'Departmental Head': 'pending_departmental_head',
//     'HR Head': 'pending_hr',
//     'Finance Officer': 'pending_finance',
//     'Head of Business': 'pending_head_of_business'
//   };
  
//   const nextStatus = roleToStatusMap[nextRole];
  
//   if (!nextStatus) {
//     console.error(`[GET_NEXT_STATUS] ❌ Unknown role: ${nextRole}`);
//     console.error(`[GET_NEXT_STATUS] Defaulting to 'approved'`);
//     console.log(`${'='.repeat(60)}\n`);
//     return 'approved';
//   }
  
//   console.log(`[GET_NEXT_STATUS] ✅ Next status: ${nextStatus}`);
//   console.log(`${'='.repeat(60)}\n`);
  
//   return nextStatus;
// };

// /**
//  * ✅ UPDATED: Validate cash approval chain (Head of Business must be last)
//  */
// const validateCashApprovalChain = (approvalChain) => {
//   console.log(`\n   [VALIDATE] Starting validation...`);
//   console.log(`   [VALIDATE] Chain length: ${approvalChain?.length || 0}`);

//   if (!Array.isArray(approvalChain) || approvalChain.length === 0) {
//     return { valid: false, error: 'Approval chain must be a non-empty array' };
//   }

//   // ✅ CHANGED: Check if Head of Business is the last step
//   const lastStep = approvalChain[approvalChain.length - 1];
//   console.log(`   [VALIDATE] Last step role: "${lastStep?.approver?.role}"`);

//   if (!lastStep || !lastStep.approver) {
//     return { valid: false, error: 'Last step is missing approver data' };
//   }

//   if (lastStep.approver.role !== 'Head of Business') {
//     console.log(`   [VALIDATE] ❌ Head of Business check FAILED`);
//     return { 
//       valid: false, 
//       error: `Head of Business must be the final approver. Found: ${lastStep.approver.role}`
//     };
//   }

//   console.log(`   [VALIDATE] ✅ Head of Business is final approver`);

//   // Validate each step
//   for (let i = 0; i < approvalChain.length; i++) {
//     const step = approvalChain[i];
    
//     if (!step.level || step.level !== i + 1) {
//       return { valid: false, error: `Step ${i + 1}: Level mismatch` };
//     }

//     if (!step.approver || !step.approver.name || !step.approver.email || !step.approver.role) {
//       return { valid: false, error: `Step ${i + 1}: Missing approver data` };
//     }
//   }

//   console.log(`   [VALIDATE] ✅ All steps validated successfully`);
//   return { valid: true };
// };

// /**
//  * Check if a step is Finance approval
//  */
// const isFinanceStep = (step) => {
//   if (!step || !step.approver) return false;
  
//   return step.approver.role === 'Finance Officer' || 
//          step.approver.email?.toLowerCase() === 'ranibellmambo@gratoengineering.com';
// };

// /**
//  * ✅ NEW: Check if a step is HR approval
//  */
// const isHRStep = (step) => {
//   if (!step || !step.approver) return false;
  
//   return step.approver.role === 'HR Head' || 
//          step.approver.email?.toLowerCase() === 'bruiline.tsitoh@gratoglobal.com';
// };

// /**
//  * ✅ NEW: Check if a step is Head of Business approval
//  */
// const isHeadOfBusinessStep = (step) => {
//   if (!step || !step.approver) return false;
  
//   return step.approver.role === 'Head of Business' || 
//          step.approver.email?.toLowerCase() === 'kelvin.eyong@gratoglobal.com';
// };

// module.exports = {
//   getCashRequestApprovalChain,
//   getNextApprovalStatus,
//   getFallbackApprovalChain,
//   validateCashApprovalChain,
//   isFinanceStep,
//   isHRStep,              // ✅ NEW
//   isHeadOfBusinessStep   // ✅ NEW
// };












// const { getApprovalChainFromStructure } = require('./departmentStructure');

// /**
//  * FIXED: Get cash request approval chain with Finance ALWAYS as final step
//  * 
//  * @param {string} employeeEmail - Email of employee requesting cash
//  * @returns {array} - Approval chain with levels, Finance always as final step
//  */
// const getCashRequestApprovalChain = (employeeEmail) => {
//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`=== BUILDING CASH REQUEST APPROVAL CHAIN ===`);
//   console.log(`${'='.repeat(60)}`);
//   console.log(`🔹 Employee Email: ${employeeEmail}`);
//   console.log(`🔹 Timestamp: ${new Date().toISOString()}`);

//   // Validate input
//   if (!employeeEmail || typeof employeeEmail !== 'string') {
//     console.error('❌ Invalid employee email provided');
//     console.error(`   Type: ${typeof employeeEmail}`);
//     console.error(`   Value: ${employeeEmail}`);
//     return getFallbackApprovalChain();
//   }

//   console.log(`✓ Input validation passed`);

//   // STEP 1: Get base approval chain from structure
//   console.log(`\n--- STEP 1: Getting Base Approval Chain ---`);
//   const baseApprovalChain = getApprovalChainFromStructure(employeeEmail);

//   console.log(`Base chain result type: ${typeof baseApprovalChain}`);
//   console.log(`Base chain is array: ${Array.isArray(baseApprovalChain)}`);
//   console.log(`Base chain length: ${baseApprovalChain?.length || 0}`);

//   if (!baseApprovalChain || baseApprovalChain.length === 0) {
//     console.warn(`⚠️ No approval chain found for ${employeeEmail}`);
//     console.warn(`⚠️ Returning fallback chain`);
//     return getFallbackApprovalChain();
//   }

//   console.log(`✓ Base approval chain retrieved: ${baseApprovalChain.length} levels`);
//   console.log(`\nBase chain details:`);
//   baseApprovalChain.forEach((step, index) => {
//     console.log(`  [${index}] Level ${step.level}: ${step.approver?.name} (${step.approver?.email}) - ${step.approver?.role}`);
//   });

//   // STEP 2: Define Finance Officer constant
//   console.log(`\n--- STEP 2: Defining Finance Officer ---`);
//   const FINANCE_OFFICER = {
//     name: 'Ms. Ranibell Mambo',
//     email: 'ranibellmambo@gratoengineering.com',
//     role: 'Finance Officer',
//     department: 'Finance'
//   };
//   console.log(`Finance Officer defined:`, FINANCE_OFFICER);

//   // STEP 3: Check if Finance is already in the base chain
//   console.log(`\n--- STEP 3: Checking for Existing Finance Officer ---`);
//   const financeIndex = baseApprovalChain.findIndex(step => {
//     const stepEmail = step.approver?.email?.toLowerCase();
//     const financeEmail = FINANCE_OFFICER.email.toLowerCase();
//     console.log(`  Comparing: "${stepEmail}" === "${financeEmail}" ? ${stepEmail === financeEmail}`);
//     return stepEmail === financeEmail;
//   });

//   const hasFinance = financeIndex !== -1;
//   console.log(`Finance Officer found in base chain: ${hasFinance}`);
//   if (hasFinance) {
//     console.log(`  Position: ${financeIndex + 1}`);
//   }

//   // STEP 4: Process the chain
//   console.log(`\n--- STEP 4: Processing Approval Chain ---`);
//   let processedChain;

//   if (hasFinance) {
//     console.log(`⚠️ Finance already exists at position ${financeIndex + 1}`);
//     console.log(`   Action: Remove from current position and append at end`);
    
//     // Remove Finance from current position
//     const financeStep = baseApprovalChain.splice(financeIndex, 1)[0];
//     console.log(`   Removed Finance step:`, financeStep);
//     console.log(`   Remaining base chain length: ${baseApprovalChain.length}`);
    
//     // Process remaining chain
//     console.log(`\n   Processing remaining ${baseApprovalChain.length} step(s):`);
//     processedChain = baseApprovalChain.map((step, index) => {
//       const approver = step.approver || {};
//       const newLevel = index + 1;
      
//       const processed = {
//         level: newLevel,
//         approver: {
//           name: String(approver.name || 'Unknown Approver').trim(),
//           email: String(approver.email || '').trim().toLowerCase(),
//           role: mapRoleForCashApproval(approver.role || 'Approver', newLevel, approver.email),
//           department: String(approver.department || 'Unknown Department').trim()
//         },
//         status: 'pending',
//         assignedDate: index === 0 ? new Date() : null,
//         comments: '',
//         actionDate: null,
//         actionTime: null,
//         decidedBy: null
//       };
      
//       console.log(`     [${index}] L${newLevel}: ${processed.approver.name} (${processed.approver.role})`);
//       return processed;
//     });

//     // Add Finance at the end
//     const finalLevel = processedChain.length + 1;
//     const financeStepFinal = {
//       level: finalLevel,
//       approver: {
//         name: FINANCE_OFFICER.name,
//         email: FINANCE_OFFICER.email,
//         role: FINANCE_OFFICER.role,
//         department: FINANCE_OFFICER.department
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     };

//     processedChain.push(financeStepFinal);
//     console.log(`\n   ✅ Finance Officer appended as Level ${finalLevel}`);
//     console.log(`   Final processed chain length: ${processedChain.length}`);

//   } else {
//     console.log(`✅ Finance NOT in base chain - will append as final step`);
    
//     // Process base chain
//     console.log(`\n   Processing ${baseApprovalChain.length} base step(s):`);
//     processedChain = baseApprovalChain.map((step, index) => {
//       const approver = step.approver || {};
//       const newLevel = index + 1;
      
//       const processed = {
//         level: newLevel,
//         approver: {
//           name: String(approver.name || 'Unknown Approver').trim(),
//           email: String(approver.email || '').trim().toLowerCase(),
//           role: mapRoleForCashApproval(approver.role || 'Approver', newLevel, approver.email),
//           department: String(approver.department || 'Unknown Department').trim()
//         },
//         status: 'pending',
//         assignedDate: index === 0 ? new Date() : null,
//         comments: '',
//         actionDate: null,
//         actionTime: null,
//         decidedBy: null
//       };
      
//       console.log(`     [${index}] L${newLevel}: ${processed.approver.name} (${processed.approver.role})`);
//       return processed;
//     });

//     console.log(`\n   Processed chain length BEFORE Finance: ${processedChain.length}`);

//     // CRITICAL: Append Finance Officer as final step
//     const finalLevel = processedChain.length + 1;
//     console.log(`   Calculating final level: ${processedChain.length} + 1 = ${finalLevel}`);
    
//     const financeStepFinal = {
//       level: finalLevel,
//       approver: {
//         name: FINANCE_OFFICER.name,
//         email: FINANCE_OFFICER.email,
//         role: FINANCE_OFFICER.role,
//         department: FINANCE_OFFICER.department
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     };

//     console.log(`\n   Creating Finance step:`, JSON.stringify(financeStepFinal, null, 2));
//     console.log(`   Pushing Finance step to array...`);
    
//     processedChain.push(financeStepFinal);
    
//     console.log(`   ✅ Finance Officer pushed to array`);
//     console.log(`   Final processed chain length AFTER Finance: ${processedChain.length}`);
//   }

//   // STEP 5: Validate final chain
//   console.log(`\n--- STEP 5: Validating Final Chain ---`);
//   console.log(`Chain to validate - Length: ${processedChain.length}`);
//   console.log(`Chain to validate - Is Array: ${Array.isArray(processedChain)}`);
  
//   console.log(`\nFull chain before validation:`);
//   processedChain.forEach((step, index) => {
//     console.log(`  [${index}] L${step.level}: ${step.approver.name} (${step.approver.role}) - ${step.approver.email}`);
//   });

//   const validation = validateCashApprovalChain(processedChain);
//   console.log(`\nValidation result:`, validation);

//   if (!validation.valid) {
//     console.error('❌ VALIDATION FAILED');
//     console.error(`   Error: ${validation.error}`);
//     console.error(`\n   Chain that failed:`);
//     console.error(JSON.stringify(processedChain, null, 2));
//     console.error(`\n   Returning fallback chain instead`);
//     return getFallbackApprovalChain();
//   }

//   console.log(`✅ Validation PASSED`);

//   // STEP 6: Final summary
//   console.log(`\n--- FINAL SUMMARY ---`);
//   console.log(`✅ Cash approval chain created with ${processedChain.length} levels`);
  
//   const chainSummary = processedChain.map(s => 
//     `L${s.level}: ${s.approver.name} (${s.approver.role})`
//   ).join(' → ');
//   console.log(`\nChain: ${chainSummary}`);
  
//   console.log(`\nLast approver check:`);
//   const lastStep = processedChain[processedChain.length - 1];
//   console.log(`  Name: ${lastStep.approver.name}`);
//   console.log(`  Role: ${lastStep.approver.role}`);
//   console.log(`  Email: ${lastStep.approver.email}`);
//   console.log(`  Is Finance: ${lastStep.approver.role === 'Finance Officer'}`);
  
//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`=== END APPROVAL CHAIN BUILD ===`);
//   console.log(`${'='.repeat(60)}\n`);

//   return processedChain;
// };

// /**
//  * Map role from structure to cash approval role
//  */
// const mapRoleForCashApproval = (structureRole, level, email = '') => {
//   const role = String(structureRole || '');
//   const roleLower = role.toLowerCase();
//   const emailLower = String(email || '').toLowerCase();
  
//   console.log(`      Mapping role: "${role}" at level ${level} for email "${emailLower}"`);
  
//   // CRITICAL: Finance Officer role mapping by email (most reliable)
//   if (emailLower === 'ranibellmambo@gratoengineering.com') {
//     console.log(`      ✓ Mapped to: Finance Officer (by email)`);
//     return 'Finance Officer';
//   }

//   // Finance role mapping by keyword
//   if (roleLower.includes('finance')) {
//     console.log(`      ✓ Mapped to: Finance Officer (by keyword)`);
//     return 'Finance Officer';
//   }
  
//   // President / Head of Business
//   if (roleLower.includes('president') || roleLower === 'head of business') {
//     console.log(`      ✓ Mapped to: Head of Business`);
//     return 'Head of Business';
//   }
  
//   // Department Heads and Directors
//   if (roleLower.includes('head') || roleLower.includes('director')) {
//     console.log(`      ✓ Mapped to: Departmental Head`);
//     return 'Departmental Head';
//   }

//   // Supervisors and Managers
//   if (roleLower.includes('supervisor') || roleLower.includes('manager') || roleLower.includes('coordinator')) {
//     console.log(`      ✓ Mapped to: Supervisor`);
//     return 'Supervisor';
//   }

//   // Fallback to level-based mapping (dynamic)
//   let mappedRole = role;
//   if (level === 1) mappedRole = 'Supervisor';
//   else if (level === 2) mappedRole = 'Departmental Head';
//   else if (level === 3) mappedRole = 'Head of Business';
  
//   console.log(`      ✓ Mapped to: ${mappedRole} (by level fallback)`);
//   return mappedRole;
// };

// /**
//  * FIXED: Fallback cash approval chain with Finance as final step
//  */
// const getFallbackApprovalChain = () => {
//   console.warn('\n⚠️⚠️⚠️ USING FALLBACK APPROVAL CHAIN ⚠️⚠️⚠️');
//   console.warn('Employee not found in department structure');
//   console.warn('This employee should be added to config/departmentStructure.js\n');
  
//   const fallbackChain = [
//     {
//       level: 1,
//       approver: {
//         name: 'Mrs. Bruiline Tsitoh',
//         email: 'bruiline.tsitoh@gratoglobal.com',
//         role: 'Supervisor',
//         department: 'HR & Admin'
//       },
//       status: 'pending',
//       assignedDate: new Date(),
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     },
//     {
//       level: 2,
//       approver: {
//         name: 'Mrs. Bruiline Tsitoh',
//         email: 'bruiline.tsitoh@gratoglobal.com',
//         role: 'Departmental Head',
//         department: 'HR & Admin'
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     },
//     {
//       level: 3,
//       approver: {
//         name: 'Mr. E.T Kelvin',
//         email: 'kelvin.eyong@gratoglobal.com',
//         role: 'Head of Business',
//         department: 'Executive'
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     },
//     {
//       level: 4,
//       approver: {
//         name: 'Ms. Ranibell Mambo',
//         email: 'ranibellmambo@gratoengineering.com',
//         role: 'Finance Officer',
//         department: 'Finance'
//       },
//       status: 'pending',
//       assignedDate: null,
//       comments: '',
//       actionDate: null,
//       actionTime: null,
//       decidedBy: null
//     }
//   ];

//   console.log('Fallback chain created with 4 levels');
//   return fallbackChain;
// };

// /**
//  * Get next approval status based on current level
//  */
// const getNextApprovalStatus = (currentLevel, totalLevels, approvalChain = []) => {
//   // Check if we're at the last level
//   if (currentLevel === totalLevels) {
//     return 'approved'; // Finance approved = fully approved
//   }
  
//   const nextLevel = currentLevel + 1;
  
//   // Check if next level is Finance by examining the approval chain
//   if (approvalChain && approvalChain.length > 0) {
//     const nextStep = approvalChain.find(s => s.level === nextLevel);
//     if (nextStep && nextStep.approver.role === 'Finance Officer') {
//       return 'pending_finance';
//     }
//   }
  
//   // Default status mapping
//   const statusMap = {
//     1: 'pending_supervisor',
//     2: 'pending_departmental_head',
//     3: 'pending_head_of_business',
//     4: 'pending_finance'
//   };
  
//   return statusMap[nextLevel] || 'pending_finance';
// };

// /**
//  * Check if user can approve cash request at specific level
//  */
// const canUserApproveAtLevel = (user, approvalStep) => {
//   if (!user || !approvalStep) return false;
  
//   // Normalize emails for comparison
//   const userEmail = String(user.email || '').toLowerCase().trim();
//   const stepEmail = String(approvalStep.approver?.email || '').toLowerCase().trim();
  
//   // Match by email (most reliable)
//   if (userEmail !== stepEmail) return false;
  
//   // Check step status is pending
//   if (approvalStep.status !== 'pending') return false;
  
//   // Admin can approve at levels 2 and 3
//   if (user.role === 'admin') {
//     return approvalStep.level === 2 || approvalStep.level === 3;
//   }
  
//   // Finance can approve at their level (final approval)
//   if (user.role === 'finance') {
//     return approvalStep.approver.role === 'Finance Officer';
//   }
  
//   // Supervisors can approve at level 1
//   if (user.role === 'supervisor') {
//     return approvalStep.level === 1;
//   }
  
//   return false;
// };

// /**
//  * Get user's cash approval level
//  */
// const getUserApprovalLevel = (userRole, userEmail) => {
//   const email = String(userEmail || '').toLowerCase().trim();
  
//   // Finance Officer - final approval (dynamic level)
//   if (email === 'ranibellmambo@gratoengineering.com' || userRole === 'finance') {
//     return 99; // High number to indicate final level
//   }
  
//   // Head of Business (President)
//   if (email === 'kelvin.eyong@gratoglobal.com') {
//     return 3;
//   }
  
//   // Department Heads and Admin
//   if (userRole === 'admin') {
//     return 2;
//   }
  
//   // Supervisors
//   if (userRole === 'supervisor') {
//     return 1;
//   }
  
//   return 0;
// };

// /**
//  * Validate cash approval chain structure
//  * Ensures Finance is the final step
//  */
// const validateCashApprovalChain = (approvalChain) => {
//   console.log(`\n   [VALIDATE] Starting validation...`);
//   console.log(`   [VALIDATE] Chain type: ${typeof approvalChain}`);
//   console.log(`   [VALIDATE] Is array: ${Array.isArray(approvalChain)}`);
//   console.log(`   [VALIDATE] Length: ${approvalChain?.length || 0}`);

//   if (!Array.isArray(approvalChain) || approvalChain.length === 0) {
//     return { valid: false, error: 'Approval chain must be a non-empty array' };
//   }

//   // Check if Finance Officer is the last step
//   const lastStep = approvalChain[approvalChain.length - 1];
//   console.log(`   [VALIDATE] Last step exists: ${!!lastStep}`);
//   console.log(`   [VALIDATE] Last step has approver: ${!!lastStep?.approver}`);
//   console.log(`   [VALIDATE] Last step role: "${lastStep?.approver?.role}"`);
//   console.log(`   [VALIDATE] Last step email: "${lastStep?.approver?.email}"`);

//   if (!lastStep || !lastStep.approver) {
//     return { valid: false, error: 'Last step is missing approver data' };
//   }

//   if (lastStep.approver.role !== 'Finance Officer') {
//     console.log(`   [VALIDATE] ❌ Finance Officer check FAILED`);
//     console.log(`   [VALIDATE]    Expected: "Finance Officer"`);
//     console.log(`   [VALIDATE]    Got: "${lastStep.approver.role}"`);
    
//     return { 
//       valid: false, 
//       error: `Finance Officer must be the final approver. Found: ${lastStep.approver.role} (${lastStep.approver.email})`
//     };
//   }

//   console.log(`   [VALIDATE] ✅ Finance Officer is final approver`);

//   // Validate each step
//   console.log(`   [VALIDATE] Validating ${approvalChain.length} steps...`);
//   for (let i = 0; i < approvalChain.length; i++) {
//     const step = approvalChain[i];
    
//     if (!step.level || typeof step.level !== 'number') {
//       return { valid: false, error: `Step ${i + 1}: Missing or invalid level` };
//     }

//     if (step.level !== i + 1) {
//       return { valid: false, error: `Step ${i + 1}: Level mismatch (expected ${i + 1}, got ${step.level})` };
//     }

//     if (!step.approver || typeof step.approver !== 'object') {
//       return { valid: false, error: `Step ${i + 1}: Missing or invalid approver object` };
//     }

//     const { name, email, role, department } = step.approver;

//     if (!name || typeof name !== 'string' || name.trim().length === 0) {
//       return { valid: false, error: `Step ${i + 1}: Approver name must be a non-empty string` };
//     }

//     if (!email || typeof email !== 'string' || email.trim().length === 0) {
//       return { valid: false, error: `Step ${i + 1}: Approver email must be a non-empty string` };
//     }

//     if (!role || typeof role !== 'string' || role.trim().length === 0) {
//       return { valid: false, error: `Step ${i + 1}: Approver role must be a non-empty string` };
//     }

//     if (!department || typeof department !== 'string' || department.trim().length === 0) {
//       return { valid: false, error: `Step ${i + 1}: Approver department must be a non-empty string` };
//     }

//     // Validate email format
//     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//     if (!emailRegex.test(email)) {
//       return { valid: false, error: `Step ${i + 1}: Invalid email format: ${email}` };
//     }

//     console.log(`   [VALIDATE]   Step ${i + 1}: ✓ ${name} (${role})`);
//   }

//   console.log(`   [VALIDATE] ✅ All steps validated successfully`);
//   return { valid: true };
// };

// /**
//  * Check if a step is Finance approval
//  */
// const isFinanceStep = (step) => {
//   if (!step || !step.approver) return false;
  
//   return step.approver.role === 'Finance Officer' || 
//          step.approver.email?.toLowerCase() === 'ranibellmambo@gratoengineering.com';
// };

// module.exports = {
//   getCashRequestApprovalChain,
//   getNextApprovalStatus,
//   canUserApproveAtLevel,
//   getUserApprovalLevel,
//   getFallbackApprovalChain,
//   validateCashApprovalChain,
//   validateApprovalChain: validateCashApprovalChain, 
//   isFinanceStep
// };


