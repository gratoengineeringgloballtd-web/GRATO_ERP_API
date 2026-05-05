const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

/**
 * Get Debit Note approval chain (3 levels):
 * Level 1: Department Head
 * Level 2: Finance Officer
 * Level 3: CEO - Final Authority
 */

const getDebitNoteApprovalChain = (department) => {
  console.log(`\n=== BUILDING DEBIT NOTE APPROVAL CHAIN ===`);
  console.log(`Department: ${department}`);
  
  const chain = [];
  
  const departmentMapping = {
    'HR & Admin': 'HR & Admin',
    'HR/Admin': 'HR & Admin',
    'Technical': 'Technical',
    'Business Development': 'Business Development & Supply Chain',
    'Business Dev': 'Business Development & Supply Chain',
    'Supply Chain': 'Business Development & Supply Chain',
    'Finance': 'Business Development & Supply Chain',
    'IT': 'IT'
  };
  
  const mappedDepartment = departmentMapping[department] || department;
  const deptData = DEPARTMENT_STRUCTURE[mappedDepartment];
  
  if (!deptData) {
    console.error(`❌ Department not found: ${department}`);
    throw new Error(`Department configuration not found for: ${department}`);
  }
  
  // Level 1: Department Head
  chain.push({
    level: 1,
    approver: deptData.head.name,
    email: deptData.head.email,
    role: deptData.head.position || 'Department Head',
    department: mappedDepartment
  });
  console.log(`✓ Level 1: ${deptData.head.name} (${deptData.head.position}) - ${deptData.head.email}`);
  
  // Level 2: Finance Officer
  const financeEmail = 'ranibellmambo@gratoengineering.com';
  chain.push({
    level: 2,
    approver: 'Ms. Ranibell Mambo',
    email: financeEmail,
    role: 'Finance Officer',
    department: 'Business Development & Supply Chain'
  });
  console.log(`✓ Level 2: Ms. Ranibell Mambo (Finance Officer) - ${financeEmail}`);

  // Level 3: CEO — absolute final
  chain.push({
    level:      3,
    approver:   'Mr. Tom',
    email:      'tom@gratoengineering.com',
    role:       'CEO - Final Authority',
    department: 'CEO Office'
  });
  console.log(`✓ Level 3: Mr. Tom (CEO - Final Authority)`);
  
  const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
  console.log(`\n✅ Final Chain (3 levels): ${finalChain}`);
  console.log('=== END DEBIT NOTE APPROVAL CHAIN ===\n');
  
  return chain;
};

const isCEOStep = (step) => {
  if (!step) return false;
  return (
    step.role === 'CEO - Final Authority' ||
    String(step.email || '').toLowerCase() === 'tom@gratoengineering.com'
  );
};

module.exports = {
  getDebitNoteApprovalChain,
  isCEOStep
};












// // config/debitNoteApprovalChain.js

// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get Debit Note approval chain (2 levels):
//  * Level 1: Department Head
//  * Level 2: Finance Officer
//  */
// const getDebitNoteApprovalChain = (department) => {
//   console.log(`\n=== BUILDING DEBIT NOTE APPROVAL CHAIN ===`);
//   console.log(`Department: ${department}`);
  
//   const chain = [];
  
//   // Department mapping
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
  
//   // Level 2: Finance Officer (ALWAYS LAST)
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
//   chain.push({
//     level: 2,
//     approver: 'Ms. Ranibell Mambo',
//     email: financeEmail,
//     role: 'Finance Officer',
//     department: 'Business Development & Supply Chain'
//   });
  
//   console.log(`✓ Level 2: Ms. Ranibell Mambo (Finance Officer) - ${financeEmail}`);
  
//   const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (2 levels): ${finalChain}`);
//   console.log('=== END DEBIT NOTE APPROVAL CHAIN ===\n');
  
//   return chain;
// };

// module.exports = {
//   getDebitNoteApprovalChain
// };