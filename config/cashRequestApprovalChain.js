const { getApprovalChainFromStructure } = require('./departmentStructure');

/**
 * ✅ VERSION 2.1: Get cash request approval chain with CONDITIONAL HR
 * Mission requests: Supervisor → Dept Head → HR → Finance → HOB → CEO (7 levels)
 * Other requests: Supervisor → Dept Head → Finance → HOB → CEO (6 levels)
 * 
 * @param {string} employeeEmail - Email of employee requesting cash
 * @param {string} requestType - Type of request (e.g., 'missions', 'expense', 'travel')
 * @returns {array} - Approval chain with 6 or 7 levels
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

  // ── CHANGE 1 of 5: CEO_FINAL constant ────────────────────────────────────
  const CEO_FINAL = {
    name: 'Mr. Tom',
    email: 'tom@gratoengineering.com',
    role: 'CEO - Final Authority',
    department: 'CEO Office'
  };

  if (isMissionRequest) {
    console.log(`✅ HR Head: ${HR_HEAD.name} (WILL BE INCLUDED - Missions request)`);
  } else {
    console.log(`⏭️  HR Head: ${HR_HEAD.name} (WILL BE SKIPPED - Not a missions request)`);
  }
  console.log(`Finance Officer: ${FINANCE_OFFICER.name}`);
  console.log(`Head of Business: ${HEAD_OF_BUSINESS.name}`);
  console.log(`CEO (Final): ${CEO_FINAL.name}`);

  // STEP 3: Build Approval Chain
  console.log(`\n--- STEP 3: Building ${isMissionRequest ? '7' : '6'}-Level Approval Chain ---`);

  let processedChain = [];
  let currentLevel = 1;
  const seenEmails = new Set();

  // Extract and save HOB if in base chain
  const ceoEmailLower = HEAD_OF_BUSINESS.email.toLowerCase();
  const baseChainWithoutCEO = baseApprovalChain.filter(step => {
    const emailLower = String(step.approver?.email || '').trim().toLowerCase();
    if (emailLower === ceoEmailLower) {
      console.log(`  🎯 Found HOB in base chain - will add as penultimate approver`);
      return false;
    }
    return true;
  });

  // Add base chain (Supervisor → Dept Head, excluding HOB)
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
    const hrEmailLower = HR_HEAD.email.toLowerCase();
    const alreadyHasHR = processedChain.some(
      step => String(step.approver?.email || '').trim().toLowerCase() === hrEmailLower
    );
    if (!alreadyHasHR) {
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

  // ── CHANGE 2 of 5: HOB (penultimate) + CEO (absolute final) ──────────────

  // ── STEP 4a: HEAD OF BUSINESS — Kelvin (penultimate) ─────────────────────
  console.log(`\n  Adding Head of Business (Kelvin):`);
  if (!processedChain.some(step =>
    String(step.approver?.email || '').trim().toLowerCase() === ceoEmailLower   // ceoEmailLower is still Kelvin's email — keep as-is
  )) {
    processedChain.push({
      level: processedChain.length + 1,
      approver: {
        name:       HEAD_OF_BUSINESS.name,
        email:      HEAD_OF_BUSINESS.email,
        role:       HEAD_OF_BUSINESS.role,
        department: HEAD_OF_BUSINESS.department
      },
      status:       'pending',
      assignedDate: null,
      comments:     '',
      actionDate:   null,
      actionTime:   null,
      decidedBy:    null
    });
    console.log(`  ✓ Added Head of Business at level ${processedChain.length}`);
  } else {
    processedChain.push({
      level: processedChain.length + 1,
      approver: {
        name:       HEAD_OF_BUSINESS.name,
        email:      HEAD_OF_BUSINESS.email,
        role:       HEAD_OF_BUSINESS.role,
        department: HEAD_OF_BUSINESS.department
      },
      status:       'pending',
      assignedDate: null,
      comments:     '',
      actionDate:   null,
      actionTime:   null,
      decidedBy:    null
    });
    console.log(`  ⚠️  Forced Head of Business`);
  }

  // ── STEP 4b: CEO — Tom (absolute final) ──────────────────────────────────
  console.log(`\n  Adding CEO (Tom) as absolute final approver:`);
  const ceoFinalEmailLower = CEO_FINAL.email.toLowerCase();
  if (!processedChain.some(step =>
    String(step.approver?.email || '').trim().toLowerCase() === ceoFinalEmailLower
  )) {
    processedChain.push({
      level: processedChain.length + 1,
      approver: {
        name:       CEO_FINAL.name,
        email:      CEO_FINAL.email,
        role:       CEO_FINAL.role,
        department: CEO_FINAL.department
      },
      status:       'pending',
      assignedDate: null,
      comments:     '',
      actionDate:   null,
      actionTime:   null,
      decidedBy:    null
    });
    console.log(`  ✓ Added CEO at level ${processedChain.length}`);
  }

  // STEP 4: Validate final chain
  console.log(`\n--- STEP 4: Validating Final Chain ---`);
  console.log(`Chain Length: ${processedChain.length}`);
  console.log(`Expected Length: ${isMissionRequest ? '7 levels (with HR)' : '6 levels (without HR)'}`);
  
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
  console.log(`  • Is CEO (Final Authority): ${lastStep.approver.role === 'CEO - Final Authority' ? '✅ YES' : '❌ NO'}`);
  
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

  // CEO
  if (emailLower === 'tom@gratoengineering.com') {
    return 'CEO - Final Authority';
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

  // ── CHANGE 4 of 5: HOB (penultimate) + CEO (absolute final) in fallback ──

  // Add HOB (Kelvin) — penultimate
  fallbackChain.push({
    level: nextLevel,
    approver: {
      name:       'Mr. E.T Kelvin',
      email:      'kelvin.eyong@gratoglobal.com',
      role:       'Head of Business',
      department: 'Executive'
    },
    status:       'pending',
    assignedDate: null,
    comments:     '',
    actionDate:   null,
    actionTime:   null,
    decidedBy:    null
  });
  console.log(`✅ Added HOB at level ${nextLevel}`);
  nextLevel++;

  // Add CEO (Tom) — absolute final
  fallbackChain.push({
    level: nextLevel,
    approver: {
      name:       'Mr. Tom',
      email:      'tom@gratoengineering.com',
      role:       'CEO - Final Authority',
      department: 'CEO Office'
    },
    status:       'pending',
    assignedDate: null,
    comments:     '',
    actionDate:   null,
    actionTime:   null,
    decidedBy:    null
  });
  console.log(`✅ Added CEO at level ${nextLevel}`);

  console.log(`\n✅ Fallback chain created with ${fallbackChain.length} levels`);
  console.log(`   Structure: ${isMissionRequest ? 'Supervisor → Dept Head → HR → Finance → HOB → CEO' : 'Supervisor → Dept Head → Finance → HOB → CEO'}`);
  
  return fallbackChain;
};

/**
 * ✅ UPDATED: Get next approval status (conditional HR for missions)
 */
const getNextApprovalStatus = (currentLevel, totalLevels, approvalChain = [], requestType = '') => {
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
    if (role === 'CEO - Final Authority') return 'pending_ceo';
  }
  
  // Fallback
  return 'approved';
};

// ── CHANGE 3 of 5: validateCashApprovalChain — accepts CEO or HOB as final ─
/**
 * Validate cash approval chain
 */
const validateCashApprovalChain = (approvalChain) => {
  console.log(`\n   [VALIDATE] Starting validation...`);
  console.log(`   [VALIDATE] Chain length: ${approvalChain?.length || 0}`);

  if (!Array.isArray(approvalChain) || approvalChain.length === 0) {
    return { valid: false, error: 'Approval chain must be a non-empty array' };
  }

  const lastStep = approvalChain[approvalChain.length - 1];
  if (!lastStep || !lastStep.approver) {
    return { valid: false, error: 'Last step is missing approver data' };
  }

  console.log(`   [VALIDATE] Last step role: "${lastStep?.approver?.role}"`);

  // Accept CEO as final approver (new) OR Head of Business (legacy requests)
  const validFinalRoles = ['CEO - Final Authority', 'Head of Business'];
  if (!validFinalRoles.includes(lastStep.approver.role)) {
    console.log(`   [VALIDATE] ❌ Final approver check FAILED`);
    return {
      valid: false,
      error: `Final approver must be CEO or Head of Business. Found: ${lastStep.approver.role}`
    };
  }

  console.log(`   [VALIDATE] ✅ Final approver is valid: ${lastStep.approver.role}`);

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

// ── CHANGE 5 of 5: isCEOStep helper ──────────────────────────────────────
/**
 * Check if a step is CEO (Final Authority) approval
 */
const isCEOStep = (step) => {
  if (!step || !step.approver) return false;
  return step.approver.role === 'CEO - Final Authority' ||
         step.approver.email?.toLowerCase() === 'tom@gratoengineering.com';
};

module.exports = {
  getCashRequestApprovalChain,
  getNextApprovalStatus,
  getFallbackApprovalChain,
  validateCashApprovalChain,
  isFinanceStep,
  isHRStep,
  isHeadOfBusinessStep,
  isCEOStep
};









// const { getApprovalChainFromStructure } = require('./departmentStructure');

// /**
//  * ✅ VERSION 2.1: Get cash request approval chain with CONDITIONAL HR
//  * Mission requests: Supervisor → Dept Head → HR → Finance → HOB (6 levels)
//  * Other requests: Supervisor → Dept Head → Finance → HOB (5 levels)
//  * 
//  * @param {string} employeeEmail - Email of employee requesting cash
//  * @param {string} requestType - Type of request (e.g., 'missions', 'expense', 'travel')
//  * @returns {array} - Approval chain with 5 or 6 levels
//  */
// const getCashRequestApprovalChain = (employeeEmail, requestType) => {
//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`=== BUILDING CASH REQUEST APPROVAL CHAIN (V2.1) ===`);
//   console.log(`${'='.repeat(60)}`);
//   console.log(`🔹 Employee Email: ${employeeEmail}`);
//   console.log(`🔹 Request Type: ${requestType}`);
//   console.log(`🔹 Version: 2.1 (Conditional HR for missions only)`);
//   console.log(`🔹 Timestamp: ${new Date().toISOString()}`);

//   // Validate input
//   if (!employeeEmail || typeof employeeEmail !== 'string') {
//     console.error('❌ Invalid employee email provided');
//     return getFallbackApprovalChain(requestType);
//   }

//   console.log(`✓ Input validation passed`);

//   // ✅ CHECK: Is this a missions request?
//   const isMissionRequest = requestType && [
//     'travel',
//     'accommodation',
//     'perdiem',
//     'mission'
//   ].includes(requestType.toLowerCase());
  
//   console.log(`✓ Mission Request: ${isMissionRequest ? 'YES - HR will be included' : 'NO - HR will be skipped'}`);

//   // STEP 1: Get base approval chain from structure (Supervisor → Dept Head)
//   console.log(`\n--- STEP 1: Getting Base Approval Chain ---`);
//   const baseApprovalChain = getApprovalChainFromStructure(employeeEmail);

//   if (!baseApprovalChain || baseApprovalChain.length === 0) {
//     console.warn(`⚠️ No approval chain found for ${employeeEmail}`);
//     console.warn(`⚠️ Returning fallback chain`);
//     return getFallbackApprovalChain(requestType);
//   }

//   console.log(`✓ Base approval chain retrieved: ${baseApprovalChain.length} levels`);
//   baseApprovalChain.forEach((step, index) => {
//     console.log(`  [${index}] Level ${step.level}: ${step.approver?.name} (${step.approver?.role})`);
//   });

//   // STEP 2: Define Fixed Approvers
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

//   if (isMissionRequest) {
//     console.log(`✅ HR Head: ${HR_HEAD.name} (WILL BE INCLUDED - Missions request)`);
//   } else {
//     console.log(`⏭️  HR Head: ${HR_HEAD.name} (WILL BE SKIPPED - Not a missions request)`);
//   }
//   console.log(`Finance Officer: ${FINANCE_OFFICER.name}`);
//   console.log(`Head of Business: ${HEAD_OF_BUSINESS.name}`);

//   // STEP 3: Build Approval Chain
//   console.log(`\n--- STEP 3: Building ${isMissionRequest ? '6' : '5'}-Level Approval Chain ---`);
  

//   let processedChain = [];
//   let currentLevel = 1;
//   const seenEmails = new Set();
//   // Extract and save HOB if in base chain
//   const ceoEmailLower = HEAD_OF_BUSINESS.email.toLowerCase();
//   const baseChainWithoutCEO = baseApprovalChain.filter(step => {
//     const emailLower = String(step.approver?.email || '').trim().toLowerCase();
//     if (emailLower === ceoEmailLower) {
//       console.log(`  🎯 Found CEO in base chain - will add as final approver`);
//       return false;
//     }
//     return true;
//   });

//   // Add base chain (Supervisor → Dept Head, excluding CEO)
//   console.log(`\n  Adding Base Chain (Supervisor → Dept Head):`);
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
//     console.log(`  ✓ [${currentLevel - 1}] L${currentLevel}: ${processedChain[processedChain.length - 1].approver.name} (${processedChain[processedChain.length - 1].approver.role})`);
//     currentLevel++;
//   });

//   // Insert HR after Dept Head for mission requests
//   if (isMissionRequest) {
//     // Find Dept Head (should be level 2)
//     const hrEmailLower = HR_HEAD.email.toLowerCase();
//     // Only add if not already present
//     const alreadyHasHR = processedChain.some(
//       step => String(step.approver?.email || '').trim().toLowerCase() === hrEmailLower
//     );
//     if (!alreadyHasHR) {
//       // Insert HR at level 3 (after Dept Head)
//       const hrStep = {
//         level: 3,
//         approver: {
//           name: HR_HEAD.name,
//           email: HR_HEAD.email,
//           role: HR_HEAD.role,
//           department: HR_HEAD.department
//         },
//         status: 'pending',
//         assignedDate: null,
//         comments: '',
//         actionDate: null,
//         actionTime: null,
//         decidedBy: null
//       };
//       // Insert at index 2 (after Dept Head)
//       processedChain.splice(2, 0, hrStep);
//       seenEmails.add(hrEmailLower);
//       console.log(`  ✅ Inserted HR Head at level 3 (after Dept Head)`);
//       // Re-number levels
//       processedChain.forEach((step, idx) => step.level = idx + 1);
//       currentLevel = processedChain.length + 1;
//     } else {
//       console.log(`  ⚠️  HR already in chain, skipping insert`);
//     }
//   } else {
//     console.log(`  ⏭️  Skipping HR Head (Request type: "${requestType}" is not missions)`);
//   }

//   // Add Finance Officer (after HR if present, else after Dept Head)
//   console.log(`\n  Adding Finance Officer:`);
//   const financeEmailLower = FINANCE_OFFICER.email.toLowerCase();
//   const alreadyHasFinance = processedChain.some(
//     step => String(step.approver?.email || '').trim().toLowerCase() === financeEmailLower
//   );
//   if (!alreadyHasFinance) {
//     processedChain.push({
//       level: processedChain.length + 1,
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
//     seenEmails.add(financeEmailLower);
//     console.log(`  ✓ Added Finance Officer at level ${processedChain.length}`);
//   } else {
//     console.log(`  ⚠️  Skipping Finance (already in chain): ${FINANCE_OFFICER.name}`);
//   }

//   // ALWAYS ADD CEO AS FINAL APPROVER
//   console.log(`\n  Adding Final Approver (CEO):`);
//   if (!processedChain.some(step => String(step.approver?.email || '').trim().toLowerCase() === ceoEmailLower)) {
//     processedChain.push({
//       level: processedChain.length + 1,
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
//     seenEmails.add(ceoEmailLower);
//     console.log(`  ✓ Added Head of Business at level ${processedChain.length}`);
//   } else {
//     // Force add if somehow already in chain
//     processedChain.push({
//       level: processedChain.length + 1,
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
//     console.log(`  ⚠️  Forced Head of Business as final approver`);
//   }

//   // STEP 4: Validate final chain
//   console.log(`\n--- STEP 4: Validating Final Chain ---`);
//   console.log(`Chain Length: ${processedChain.length}`);
//   console.log(`Expected Length: ${isMissionRequest ? '6 levels (with HR)' : '5 levels (without HR)'}`);
  
//   const validation = validateCashApprovalChain(processedChain);
//   console.log(`Validation Result:`, validation);

//   if (!validation.valid) {
//     console.error('❌ VALIDATION FAILED:', validation.error);
//     return getFallbackApprovalChain(requestType);
//   }

//   console.log(`✅ Validation PASSED`);

//   // STEP 5: Final summary
//   console.log(`\n--- FINAL SUMMARY ---`);
//   console.log(`✅ Cash approval chain created with ${processedChain.length} levels`);
//   console.log(`✅ Request Type: "${requestType}" ${isMissionRequest ? '(MISSIONS - includes HR)' : '(NON-MISSIONS - skips HR)'}`);
  
//   const chainSummary = processedChain.map(s => 
//     `L${s.level}: ${s.approver.name} (${s.approver.role})`
//   ).join(' → ');
//   console.log(`\n📋 Full Chain:\n   ${chainSummary}`);
  
//   console.log(`\n🎯 Last approver check:`);
//   const lastStep = processedChain[processedChain.length - 1];
//   console.log(`  • Name: ${lastStep.approver.name}`);
//   console.log(`  • Role: ${lastStep.approver.role}`);
//   console.log(`  • Email: ${lastStep.approver.email}`);
//   console.log(`  • Is Head of Business: ${lastStep.approver.role === 'Head of Business' ? '✅ YES' : '❌ NO'}`);
  
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
  
//   // HR Head mapping
//   if (emailLower === 'bruiline.tsitoh@gratoglobal.com') {
//     return 'HR Head';
//   }

//   // Finance Officer role mapping
//   if (emailLower === 'ranibellmambo@gratoengineering.com') {
//     return 'Finance Officer';
//   }

//   // Head of Business
//   if (emailLower === 'kelvin.eyong@gratoglobal.com') {
//     return 'Head of Business';
//   }

//   // Finance role mapping by keyword
//   if (roleLower.includes('finance')) {
//     return 'Finance Officer';
//   }
  
//   // President / Head of Business
//   if (roleLower.includes('president') || roleLower === 'head of business') {
//     return 'Head of Business';
//   }
  
//   // Department Heads and Directors
//   if (roleLower.includes('head') || roleLower.includes('director')) {
//     return 'Departmental Head';
//   }

//   // Supervisors and Managers
//   if (roleLower.includes('supervisor') || roleLower.includes('manager') || roleLower.includes('coordinator')) {
//     return 'Supervisor';
//   }

//   // Fallback to level-based mapping
//   let mappedRole = role;
//   if (level === 1) mappedRole = 'Supervisor';
//   else if (level === 2) mappedRole = 'Departmental Head';
//   else if (level >= 3) mappedRole = 'Approver';
  
//   return mappedRole;
// };

// /**
//  * ✅ UPDATED: Fallback approval chain with conditional HR (missions only)
//  */
// const getFallbackApprovalChain = (requestType) => {
//   console.warn('\n⚠️⚠️⚠️ USING FALLBACK APPROVAL CHAIN (V2.1) ⚠️⚠️⚠️');
//   console.warn('Employee not found in department structure');
//   console.warn('This employee should be added to config/departmentStructure.js\n');
  
//   const isMissionRequest = requestType && [
//     'travel',
//     'accommodation',
//     'perdiem',
//     'mission'
//   ].includes(requestType.toLowerCase());
  
//   console.log(`Request Type: "${requestType}"`);
//   console.log(`Is Missions: ${isMissionRequest ? 'YES' : 'NO'}`);
  
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
//     }
//   ];

//   let nextLevel = 3;

//   // ✅ CONDITIONAL: Add HR only for missions requests
//   if (isMissionRequest) {
//     fallbackChain.push({
//       level: nextLevel,
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
//     });
//     console.log(`✅ Added HR Head at level ${nextLevel} (Missions request)`);
//     nextLevel++;
//   } else {
//     console.log(`⏭️  Skipped HR Head (Not a missions request)`);
//   }

//   // Add Finance
//   fallbackChain.push({
//     level: nextLevel,
//     approver: {
//       name: 'Ms. Ranibell Mambo',
//       email: 'ranibellmambo@gratoengineering.com',
//       role: 'Finance Officer',
//       department: 'Finance'
//     },
//     status: 'pending',
//     assignedDate: null,
//     comments: '',
//     actionDate: null,
//     actionTime: null,
//     decidedBy: null
//   });
//   console.log(`✅ Added Finance at level ${nextLevel}`);
//   nextLevel++;

//   // Add HOB
//   fallbackChain.push({
//     level: nextLevel,
//     approver: {
//       name: 'Mr. E.T Kelvin',
//       email: 'kelvin.eyong@gratoglobal.com',
//       role: 'Head of Business',
//       department: 'Executive'
//     },
//     status: 'pending',
//     assignedDate: null,
//     comments: '',
//     actionDate: null,
//     actionTime: null,
//     decidedBy: null
//   });
//   console.log(`✅ Added HOB at level ${nextLevel}`);

//   console.log(`\n✅ Fallback chain created with ${fallbackChain.length} levels`);
//   console.log(`   Structure: ${isMissionRequest ? 'Supervisor → Dept Head → HR → Finance → HOB' : 'Supervisor → Dept Head → Finance → HOB'}`);
  
//   return fallbackChain;
// };

// /**
//  * ✅ UPDATED: Get next approval status (conditional HR for missions)
//  */
// const getNextApprovalStatus = (currentLevel, totalLevels, approvalChain = [], requestType = '') => {
//   // const isMissionRequest = requestType && (
//   //   requestType.toLowerCase() === 'missions' ||
//   //   requestType.toLowerCase() === 'mission'
//   // );

//   const isMissionRequest = requestType && [
//     requestType.toLowerCase() === 'travel',
//     requestType.toLowerCase() === 'accommodation',
//     requestType.toLowerCase() === 'perdiem',
//     requestType.toLowerCase() === 'mission',
//   ];
  
//   // If at final level, approve
//   if (currentLevel === totalLevels) {
//     return 'approved';
//   }
  
//   const nextLevel = currentLevel + 1;
  
//   // Find the step at nextLevel to determine status
//   const nextStep = approvalChain.find(s => s.level === nextLevel);
  
//   if (nextStep) {
//     const role = nextStep.approver?.role;
    
//     if (role === 'Supervisor') return 'pending_supervisor';
//     if (role === 'Departmental Head') return 'pending_departmental_head';
//     if (role === 'HR Head') return 'pending_hr';
//     if (role === 'Finance Officer') return 'pending_finance';
//     if (role === 'Head of Business') return 'pending_head_of_business';
//   }
  
//   // Fallback
//   return 'approved';
// };

// /**
//  * Validate cash approval chain
//  */
// const validateCashApprovalChain = (approvalChain) => {
//   console.log(`\n   [VALIDATE] Starting validation...`);
//   console.log(`   [VALIDATE] Chain length: ${approvalChain?.length || 0}`);

//   if (!Array.isArray(approvalChain) || approvalChain.length === 0) {
//     return { valid: false, error: 'Approval chain must be a non-empty array' };
//   }

//   // Check if Head of Business is the last step
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
//  * Check if a step is HR approval
//  */
// const isHRStep = (step) => {
//   if (!step || !step.approver) return false;
  
//   return step.approver.role === 'HR Head' || 
//          step.approver.email?.toLowerCase() === 'bruiline.tsitoh@gratoglobal.com';
// };

// /**
//  * Check if a step is Head of Business approval
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
//   isHRStep,
//   isHeadOfBusinessStep
// };




