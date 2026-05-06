// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/debitNoteApprovalChain.js
// VERSION: 2.1 — Conditional CEO (threshold ≥ 100,000 XAF)
// ═══════════════════════════════════════════════════════════════════════════

const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');
const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

/**
 * ✅ VERSION 2.1: Get Debit Note approval chain with conditional CEO step:
 *
 *   Level 1: Department Head
 *   Level 2: Finance Officer
 *   Level 3: CEO — Tom [only when amount ≥ 100,000 XAF]
 *
 * @param {string}      department
 * @param {number|null} amount     - debit note amount in XAF (null → CEO required as precaution)
 * @returns {Array} Approval chain steps
 */
const getDebitNoteApprovalChain = (department, amount = null) => {
  // ── CEO threshold check — done once, consumed at the end ─────────────────
  const ceoCheck = requiresCEOApproval('debit_note', amount);

  console.log(`\n=== BUILDING DEBIT NOTE APPROVAL CHAIN (V2.1) ===`);
  console.log(`Department: ${department}`);
  console.log(`Amount XAF: ${amount !== null ? Number(amount).toLocaleString() : 'NOT PROVIDED'}`);
  console.log(`CEO Step:   ${ceoCheck.required ? 'REQUIRED' : 'SKIPPED'} — ${ceoCheck.reason}`);

  const chain = [];

  const departmentMapping = {
    'HR & Admin':           'HR & Admin',
    'HR/Admin':             'HR & Admin',
    'Technical':            'Technical',
    'Business Development': 'Business Development & Supply Chain',
    'Business Dev':         'Business Development & Supply Chain',
    'Supply Chain':         'Business Development & Supply Chain',
    'Finance':              'Business Development & Supply Chain',
    'IT':                   'IT',
  };

  const mappedDepartment = departmentMapping[department] || department;
  const deptData         = DEPARTMENT_STRUCTURE[mappedDepartment];

  if (!deptData) {
    console.error(`❌ Department not found: ${department}`);
    throw new Error(`Department configuration not found for: ${department}`);
  }

  // ── Level 1: Department Head ──────────────────────────────────────────────
  chain.push({
    level:       1,
    approver:    deptData.head.name,
    email:       deptData.head.email,
    role:        deptData.head.position || 'Department Head',
    department:  mappedDepartment,
    status:      'pending',
    assignedDate: new Date(),
  });
  console.log(`✓ Level 1: ${deptData.head.name} (${deptData.head.position}) — ${deptData.head.email}`);

  // ── Level 2: Finance Officer ──────────────────────────────────────────────
  const financeEmail = 'ranibellmambo@gratoengineering.com';
  chain.push({
    level:       2,
    approver:    'Ms. Ranibell Mambo',
    email:       financeEmail,
    role:        'Finance Officer',
    department:  'Business Development & Supply Chain',
    status:      'pending',
    assignedDate: new Date(),
  });
  console.log(`✓ Level 2: Ms. Ranibell Mambo (Finance Officer) — ${financeEmail}`);

  // ── Level 3: CEO — conditional on amount threshold ────────────────────────
  if (ceoCheck.required) {
    chain.push({
      level:        3,
      approver:     CEO.name,
      email:        CEO.email,
      role:         CEO.role,
      department:   CEO.department,
      status:       'pending',
      assignedDate: new Date(),
      ceoThreshold: { required: true, reason: ceoCheck.reason },
    });
    console.log(`✓ Level 3: ${CEO.name} (${CEO.role})`);
  } else {
    console.log(`⏭️  CEO skipped — ${ceoCheck.reason}`);
  }
  // ── END CEO STEP ──────────────────────────────────────────────────────────

  const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
  console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
  console.log('=== END DEBIT NOTE APPROVAL CHAIN ===\n');

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// UTILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NOTE: Debit note chain steps use a flat shape ({ approver, email, role })
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
  getDebitNoteApprovalChain,
  isCEOStep,
};









// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get Debit Note approval chain (3 levels):
//  * Level 1: Department Head
//  * Level 2: Finance Officer
//  * Level 3: CEO - Final Authority
//  */

// const getDebitNoteApprovalChain = (department) => {
//   console.log(`\n=== BUILDING DEBIT NOTE APPROVAL CHAIN ===`);
//   console.log(`Department: ${department}`);
  
//   const chain = [];
  
//   const departmentMapping = {
//     'HR & Admin': 'HR & Admin',
//     'HR/Admin': 'HR & Admin',
//     'Technical': 'Technical',
//     'Business Development': 'Business Development & Supply Chain',
//     'Business Dev': 'Business Development & Supply Chain',
//     'Supply Chain': 'Business Development & Supply Chain',
//     'Finance': 'Business Development & Supply Chain',
//     'IT': 'IT'
//   };
  
//   const mappedDepartment = departmentMapping[department] || department;
//   const deptData = DEPARTMENT_STRUCTURE[mappedDepartment];
  
//   if (!deptData) {
//     console.error(`❌ Department not found: ${department}`);
//     throw new Error(`Department configuration not found for: ${department}`);
//   }
  
//   // Level 1: Department Head
//   chain.push({
//     level: 1,
//     approver: deptData.head.name,
//     email: deptData.head.email,
//     role: deptData.head.position || 'Department Head',
//     department: mappedDepartment
//   });
//   console.log(`✓ Level 1: ${deptData.head.name} (${deptData.head.position}) - ${deptData.head.email}`);
  
//   // Level 2: Finance Officer
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
//   chain.push({
//     level: 2,
//     approver: 'Ms. Ranibell Mambo',
//     email: financeEmail,
//     role: 'Finance Officer',
//     department: 'Business Development & Supply Chain'
//   });
//   console.log(`✓ Level 2: Ms. Ranibell Mambo (Finance Officer) - ${financeEmail}`);

//   // Level 3: CEO — absolute final
//   chain.push({
//     level:      3,
//     approver:   'Mr. Tom',
//     email:      'tom@gratoengineering.com',
//     role:       'CEO - Final Authority',
//     department: 'CEO Office'
//   });
//   console.log(`✓ Level 3: Mr. Tom (CEO - Final Authority)`);
  
//   const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (3 levels): ${finalChain}`);
//   console.log('=== END DEBIT NOTE APPROVAL CHAIN ===\n');
  
//   return chain;
// };

// const isCEOStep = (step) => {
//   if (!step) return false;
//   return (
//     step.role === 'CEO - Final Authority' ||
//     String(step.email || '').toLowerCase() === 'tom@gratoengineering.com'
//   );
// };

// module.exports = {
//   getDebitNoteApprovalChain,
//   isCEOStep
// };



