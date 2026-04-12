// config/poApprovalChain.js

const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

/**
 * Get PO approval chain (3 levels):
 * Level 1: Department Head
 * Level 2: Head of Business (President)
 * Level 3: Finance Officer
 */
const getPOApprovalChain = (department) => {
  console.log(`\n=== BUILDING PO APPROVAL CHAIN ===`);
  console.log(`Department: ${department}`);
  
  const chain = [];
  
  // Department mapping
  const departmentMapping = {
    'HR & Admin': 'HR & Admin',
    'HR/Admin': 'HR & Admin',
    'Technical': 'Technical',
    'IT': 'IT',
    'Business Development': 'Business Development & Supply Chain',
    'Business Dev': 'Business Development & Supply Chain',
    'Supply Chain': 'Business Development & Supply Chain',
    'Finance': 'Business Development & Supply Chain'
  };
  
  const mappedDepartment = departmentMapping[department] || department;
  const deptData = DEPARTMENT_STRUCTURE[mappedDepartment];
  
  if (!deptData) {
    console.error(`❌ Department not found: ${department}`);
    throw new Error(`Department configuration not found for: ${department}`);
  }
  
  // Level 1: Department Head
  if (mappedDepartment === 'IT') {
    chain.push({
      level: 1,
      approver: 'Mr. Marcel Ngong',
      email: 'marcel.ngong@gratoglobal.com',
      role: 'Department Head',
      department: 'IT'
    });
    console.log('✓ Level 1: Mr. Marcel Ngong (Department Head) - marcel.ngong@gratoglobal.com');
  } else {
    chain.push({
      level: 1,
      approver: deptData.head.name,
      email: deptData.head.email,
      role: 'Department Head',
      department: mappedDepartment
    });
    console.log(`✓ Level 1: ${deptData.head.name} (Department Head) - ${deptData.head.email}`);
  }
  
  // Level 2: Head of Business (President) - Mr. E.T Kelvin
  const businessDept = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  
  if (!businessDept || !businessDept.head) {
    console.error('❌ Business Development & Supply Chain department not found');
    throw new Error('Business Development & Supply Chain configuration missing');
  }
  
  chain.push({
    level: 2,
    approver: businessDept.head.name,
    email: businessDept.head.email,
    role: 'Head of Business',
    department: 'Business Development & Supply Chain'
  });
  
  console.log(`✓ Level 2: ${businessDept.head.name} (Head of Business) - ${businessDept.head.email}`);
  
  // Level 3: Finance Officer - Ms. Ranibell Mambo
  const financeOfficer = businessDept.positions['Finance Officer'];
  
  if (!financeOfficer) {
    console.error('❌ Finance Officer not found in Business Development & Supply Chain');
    throw new Error('Finance Officer configuration missing');
  }
  
  chain.push({
    level: 3,
    approver: financeOfficer.name,
    email: financeOfficer.email,
    role: 'Finance Officer',
    department: 'Business Development & Supply Chain'
  });
  
  console.log(`✓ Level 3: ${financeOfficer.name} (Finance Officer) - ${financeOfficer.email}`);
  
  const finalChain = chain.map(s => `L${s.level}: ${s.approver} (${s.role})`).join(' → ');
  console.log(`\n✅ Final Chain (3 levels): ${finalChain}`);
  console.log('=== END PO APPROVAL CHAIN ===\n');
  
  return chain;
};

/**
 * Get Supply Chain Coordinator details
 */
const getSupplyChainCoordinator = () => {
  const businessDept = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  const coordinator = businessDept?.positions['Supply Chain Coordinator'];
  
  return {
    name: coordinator?.name || 'Mr. Lukong Lambert',
    email: coordinator?.email || 'lukong.lambert@gratoglobal.com',
    role: 'Supply Chain Coordinator'
  };
};

module.exports = {
  getPOApprovalChain,
  getSupplyChainCoordinator
};


