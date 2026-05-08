// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/poApprovalChain.js
// VERSION: 2.1 — Conditional CEO (threshold ≥ 500,000 XAF)
// ═══════════════════════════════════════════════════════════════════════════

const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');
const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

/**
 * ✅ VERSION 2.1: Get PO approval chain with conditional CEO step:
 *
 *   Level 1: Department Head
 *   Level 2: Head of Business (President / Kelvin)
 *   Level 3: Finance Officer
 *   Level 4: CEO — Tom [only when totalAmount ≥ 500,000 XAF]
 *
 * @param {string}      department
 * @param {number|null} amount     - totalAmount in XAF (null → CEO required as precaution)
 * @returns {Array} Approval chain steps
 */
const getPOApprovalChain = (department, amount = null) => {
  // ── CEO threshold check — done once, consumed at the end ─────────────────
  const ceoCheck = requiresCEOApproval('purchase_order', amount);

  console.log(`\n=== BUILDING PO APPROVAL CHAIN (V2.1) ===`);
  console.log(`Department: ${department}`);
  console.log(`Amount XAF: ${amount !== null ? Number(amount).toLocaleString() : 'NOT PROVIDED'}`);
  console.log(`CEO Step:   ${ceoCheck.required ? 'REQUIRED' : 'SKIPPED'} — ${ceoCheck.reason}`);

  const chain = [];

  const departmentMapping = {
    'HR & Admin':           'HR & Admin',
    'HR/Admin':             'HR & Admin',
    'Technical':            'Technical',
    'IT':                   'IT',
    'Business Development': 'Business Development & Supply Chain',
    'Business Dev':         'Business Development & Supply Chain',
    'Supply Chain':         'Business Development & Supply Chain',
    'Finance':              'Business Development & Supply Chain',
  };

  const mappedDepartment = departmentMapping[department] || department;
  const deptData         = DEPARTMENT_STRUCTURE[mappedDepartment];

  if (!deptData) {
    console.error(`❌ Department not found: ${department}`);
    throw new Error(`Department configuration not found for: ${department}`);
  }

  // ── Level 1: Department Head ──────────────────────────────────────────────
  if (mappedDepartment === 'IT') {
    chain.push({
      level:       1,
      approver:    'Mr. Marcel Ngong',
      email:       'marcel.ngong@gratoglobal.com',
      role:        'Department Head',
      department:  'IT',
      status:      'pending',
      assignedDate: new Date(),
    });
    console.log('✓ Level 1: Mr. Marcel Ngong (Department Head) — marcel.ngong@gratoglobal.com');
  } else {
    chain.push({
      level:       1,
      approver:    deptData.head.name,
      email:       deptData.head.email,
      role:        'Department Head',
      department:  mappedDepartment,
      status:      'pending',
      assignedDate: new Date(),
    });
    console.log(`✓ Level 1: ${deptData.head.name} (Department Head) — ${deptData.head.email}`);
  }

  // ── Level 2: Head of Business (President — Kelvin) ────────────────────────
  const businessDept = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];

  if (!businessDept || !businessDept.head) {
    console.error('❌ Business Development & Supply Chain department not found');
    throw new Error('Business Development & Supply Chain configuration missing');
  }

  chain.push({
    level:       2,
    approver:    businessDept.head.name,
    email:       businessDept.head.email,
    role:        'Head of Business',
    department:  'Business Development & Supply Chain',
    status:      'pending',
    assignedDate: new Date(),
  });
  console.log(`✓ Level 2: ${businessDept.head.name} (Head of Business) — ${businessDept.head.email}`);

  // ── Level 3: Finance Officer ──────────────────────────────────────────────
  const financeOfficer = businessDept.positions['Finance Officer'];

  if (!financeOfficer) {
    console.error('❌ Finance Officer not found in Business Development & Supply Chain');
    throw new Error('Finance Officer configuration missing');
  }

  chain.push({
    level:       3,
    approver:    financeOfficer.name,
    email:       financeOfficer.email,
    role:        'Finance Officer',
    department:  'Business Development & Supply Chain',
    status:      'pending',
    assignedDate: new Date(),
  });
  console.log(`✓ Level 3: ${financeOfficer.name} (Finance Officer) — ${financeOfficer.email}`);

  // ── Level 4: CEO — conditional on amount threshold ────────────────────────
  if (ceoCheck.required) {
    chain.push({
      level:        4,
      approver:     CEO.name,
      email:        CEO.email,
      role:         CEO.role,
      department:   CEO.department,
      status:       'pending',
      assignedDate: new Date(),
      ceoThreshold: { required: true, reason: ceoCheck.reason },
    });
    console.log(`✓ Level 4: ${CEO.name} (${CEO.role})`);
  } else {
    console.log(`⏭️  CEO skipped — ${ceoCheck.reason}`);
  }
  // ── END CEO STEP ──────────────────────────────────────────────────────────

  const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
  console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
  console.log('=== END PO APPROVAL CHAIN ===\n');

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// UTILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getSupplyChainCoordinator = () => {
  const businessDept  = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  const coordinator   = businessDept?.positions['Supply Chain Coordinator'];

  return {
    name:  coordinator?.name  || 'Mr. Lukong Lambert',
    email: coordinator?.email || 'lukong.lambert@gratoglobal.com',
    role:  'Supply Chain Coordinator',
  };
};

/**
 * NOTE: PO chain steps use a flat shape ({ approver, email, role })
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
  getPOApprovalChain,
  getSupplyChainCoordinator,
  isCEOStep,
};










// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get PO approval chain (4 levels):
//  * Level 1: Department Head
//  * Level 2: Head of Business (President)
//  * Level 3: Finance Officer
//  * Level 4: CEO - Final Authority
//  */
// const getPOApprovalChain = (department) => {
//   console.log(`\n=== BUILDING PO APPROVAL CHAIN ===`);
//   console.log(`Department: ${department}`);
  
//   const chain = [];
  
//   const departmentMapping = {
//     'HR & Admin': 'HR & Admin',
//     'HR/Admin': 'HR & Admin',
//     'Technical': 'Technical',
//     'IT': 'IT',
//     'Business Development': 'Business Development & Supply Chain',
//     'Business Dev': 'Business Development & Supply Chain',
//     'Supply Chain': 'Business Development & Supply Chain',
//     'Finance': 'Business Development & Supply Chain'
//   };
  
//   const mappedDepartment = departmentMapping[department] || department;
//   const deptData = DEPARTMENT_STRUCTURE[mappedDepartment];
  
//   if (!deptData) {
//     console.error(`❌ Department not found: ${department}`);
//     throw new Error(`Department configuration not found for: ${department}`);
//   }
  
//   // Level 1: Department Head
//   if (mappedDepartment === 'IT') {
//     chain.push({
//       level: 1,
//       approver: 'Mr. Marcel Ngong',
//       email: 'marcel.ngong@gratoglobal.com',
//       role: 'Department Head',
//       department: 'IT'
//     });
//     console.log('✓ Level 1: Mr. Marcel Ngong (Department Head) - marcel.ngong@gratoglobal.com');
//   } else {
//     chain.push({
//       level: 1,
//       approver: deptData.head.name,
//       email: deptData.head.email,
//       role: 'Department Head',
//       department: mappedDepartment
//     });
//     console.log(`✓ Level 1: ${deptData.head.name} (Department Head) - ${deptData.head.email}`);
//   }
  
//   // Level 2: Head of Business (President) - Mr. E.T Kelvin
//   const businessDept = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  
//   if (!businessDept || !businessDept.head) {
//     console.error('❌ Business Development & Supply Chain department not found');
//     throw new Error('Business Development & Supply Chain configuration missing');
//   }
  
//   chain.push({
//     level: 2,
//     approver: businessDept.head.name,
//     email: businessDept.head.email,
//     role: 'Head of Business',
//     department: 'Business Development & Supply Chain'
//   });
//   console.log(`✓ Level 2: ${businessDept.head.name} (Head of Business) - ${businessDept.head.email}`);
  
//   // Level 3: Finance Officer - Ms. Ranibell Mambo
//   const financeOfficer = businessDept.positions['Finance Officer'];
  
//   if (!financeOfficer) {
//     console.error('❌ Finance Officer not found in Business Development & Supply Chain');
//     throw new Error('Finance Officer configuration missing');
//   }
  
//   chain.push({
//     level: 3,
//     approver: financeOfficer.name,
//     email: financeOfficer.email,
//     role: 'Finance Officer',
//     department: 'Business Development & Supply Chain'
//   });
//   console.log(`✓ Level 3: ${financeOfficer.name} (Finance Officer) - ${financeOfficer.email}`);

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
//   console.log(`✓ Level 4: Mr. Tom (CEO - Final Authority)`);
  
//   const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (4 levels): ${finalChain}`);
//   console.log('=== END PO APPROVAL CHAIN ===\n');
  
//   return chain;
// };

// const getSupplyChainCoordinator = () => {
//   const businessDept = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
//   const coordinator = businessDept?.positions['Supply Chain Coordinator'];
  
//   return {
//     name: coordinator?.name || 'Mr. Lukong Lambert',
//     email: coordinator?.email || 'lukong.lambert@gratoglobal.com',
//     role: 'Supply Chain Coordinator'
//   };
// };

// const isCEOStep = (step) => {
//   if (!step || !step.approver) return false;
//   return (
//     step.role === 'CEO - Final Authority' ||
//     String(step.email || '').toLowerCase() === 'tom@gratoengineering.com'
//   );
// };

// module.exports = {
//   getPOApprovalChain,
//   getSupplyChainCoordinator,
//   isCEOStep
// };



