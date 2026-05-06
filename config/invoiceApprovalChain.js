// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/invoiceApprovalChain.js
// VERSION: 2.1 — Conditional CEO (threshold ≥ 1,000,000 XAF)
// ═══════════════════════════════════════════════════════════════════════════

const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');
const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

/**
 * ✅ VERSION 2.1: Get invoice approval chain with STRICT hierarchy:
 *
 *   Level 1: Immediate Supervisor (if not department head)
 *   Level 2: Department Head
 *   Level 3: Head of Business (President / Kelvin)
 *   Level 4: Finance Officer
 *   Level 5: CEO — Tom [only when invoiceAmount ≥ 1,000,000 XAF]
 *
 * @param {string}      employeeName
 * @param {string}      department
 * @param {number|null} amount       - invoiceAmount in XAF (null → CEO required as precaution)
 * @returns {Array} Approval chain steps
 */
const getInvoiceApprovalChain = (employeeName, department, amount = null) => {
  const chain      = [];
  const seenEmails = new Set();

  // ── CEO threshold check — done once, consumed at the end ─────────────────
  const ceoCheck = requiresCEOApproval('invoice', amount);

  console.log(`\n=== BUILDING INVOICE APPROVAL CHAIN (V2.1) ===`);
  console.log(`Employee:   ${employeeName}`);
  console.log(`Department: ${department}`);
  console.log(`Amount XAF: ${amount !== null ? Number(amount).toLocaleString() : 'NOT PROVIDED'}`);
  console.log(`CEO Step:   ${ceoCheck.required ? 'REQUIRED' : 'SKIPPED'} — ${ceoCheck.reason}`);

  // ── Find employee ─────────────────────────────────────────────────────────
  let employeeData          = null;
  let employeeDepartmentName = department;

  if (DEPARTMENT_STRUCTURE[department] && DEPARTMENT_STRUCTURE[department].head === employeeName) {
    employeeData = {
      name:       employeeName,
      email:      DEPARTMENT_STRUCTURE[department].headEmail,
      position:   'Department Head',
      supervisor: 'President',
      department,
    };
    console.log('✓ Employee is Department Head');
  } else {
    for (const [deptKey, deptData] of Object.entries(DEPARTMENT_STRUCTURE)) {
      if (deptData.head === employeeName) {
        employeeData = {
          name:       employeeName,
          email:      deptData.headEmail,
          position:   'Department Head',
          supervisor: 'President',
          department: deptKey,
        };
        employeeDepartmentName = deptKey;
        console.log(`✓ Employee is Department Head of ${deptKey}`);
        break;
      }

      if (deptData.positions) {
        for (const [pos, data] of Object.entries(deptData.positions)) {
          if (data.name === employeeName) {
            employeeData           = { ...data, position: pos };
            employeeDepartmentName = deptKey;
            console.log(`✓ Found: ${pos} in ${deptKey}`);
            break;
          }
        }
      }
      if (employeeData) break;
    }
  }

  if (!employeeData) {
    console.warn(`⚠ Employee "${employeeName}" not found. Using fallback.`);
    return getFallbackInvoiceApprovalChain(department, amount);
  }

  // ── Helper: add unique approver ───────────────────────────────────────────
  const addApprover = (approverData, role) => {
    if (seenEmails.has(approverData.email)) {
      console.log(`⊘ Skip duplicate: ${approverData.name} (${approverData.email})`);
      return false;
    }

    const level = chain.length + 1;
    chain.push({
      level,
      approver: {
        name:       approverData.name,
        email:      approverData.email,
        role,
        department: approverData.department || employeeDepartmentName,
      },
      status:       'pending',
      assignedDate: new Date(),
    });

    seenEmails.add(approverData.email);
    console.log(`✓ Level ${level}: ${approverData.name} (${role}) — ${approverData.email}`);
    return true;
  };

  // ── LEVEL 1: Immediate Supervisor (if not department head) ────────────────
  if (employeeData.position !== 'Department Head') {
    const supervisor = findSupervisor(employeeData, employeeDepartmentName);
    if (supervisor) {
      addApprover(supervisor, 'Supervisor');
    }
  }

  // ── LEVEL 2: Department Head ──────────────────────────────────────────────
  const deptHead = DEPARTMENT_STRUCTURE[employeeDepartmentName];
  if (deptHead && employeeData.name !== deptHead.head) {
    addApprover({
      name:       deptHead.head,
      email:      deptHead.headEmail,
      department: employeeDepartmentName,
    }, 'Departmental Head');
  }

  // ── LEVEL 3: Head of Business / President ────────────────────────────────
  const executive = DEPARTMENT_STRUCTURE['Executive'];
  if (executive) {
    addApprover({
      name:       executive.head,
      email:      executive.headEmail,
      department: 'Executive',
    }, 'Head of Business');
  }

  // ── LEVEL 4: Finance Officer ──────────────────────────────────────────────
  const financeEmail = 'ranibellmambo@gratoengineering.com';
  if (!seenEmails.has(financeEmail)) {
    const financeLevel = chain.length + 1;
    chain.push({
      level:        financeLevel,
      approver: {
        name:       'Ms. Ranibell Mambo',
        email:      financeEmail,
        role:       'Finance Officer',
        department: 'Business Development & Supply Chain',
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    seenEmails.add(financeEmail);
    console.log(`✓ Level ${financeLevel}: Ms. Ranibell Mambo (Finance Officer)`);
  }

  // ── LEVEL 5: CEO — conditional on amount threshold ────────────────────────
  const ceoEmailLower = CEO.email.toLowerCase();
  if (ceoCheck.required && !seenEmails.has(ceoEmailLower)) {
    const ceoLevel = chain.length + 1;
    chain.push({
      level:        ceoLevel,
      approver: {
        name:       CEO.name,
        email:      CEO.email,
        role:       CEO.role,
        department: CEO.department,
      },
      status:       'pending',
      assignedDate: new Date(),
      ceoThreshold: { required: true, reason: ceoCheck.reason },
    });
    seenEmails.add(ceoEmailLower);
    console.log(`✓ Level ${ceoLevel}: ${CEO.name} (${CEO.role})`);
  } else if (!ceoCheck.required) {
    console.log(`⏭️  CEO skipped — ${ceoCheck.reason}`);
  }
  // ── END CEO STEP ──────────────────────────────────────────────────────────

  // ── Renumber to ensure strictly sequential levels ─────────────────────────
  chain.forEach((step, index) => { step.level = index + 1; });

  const finalChain = chain
    .map(s => `L${s.level}: ${s.approver.name} (${s.approver.role})`)
    .join(' → ');
  console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
  console.log('=== END APPROVAL CHAIN ===\n');

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// SUPERVISOR LOOKUP
// ─────────────────────────────────────────────────────────────────────────────

const findSupervisor = (employeeData, departmentName) => {
  if (!employeeData.supervisor) return null;

  const department = DEPARTMENT_STRUCTURE[departmentName];
  if (!department) return null;

  // Check positions
  if (department.positions) {
    for (const [pos, data] of Object.entries(department.positions)) {
      if (pos === employeeData.supervisor || data.name === employeeData.supervisor) {
        return {
          ...data,
          position:   pos,
          department: departmentName,
        };
      }
    }
  }

  // Check if supervisor is department head
  if (
    department.head === employeeData.supervisor ||
    (employeeData.supervisor && employeeData.supervisor.includes('Head'))
  ) {
    return {
      name:       department.head,
      email:      department.headEmail,
      position:   'Department Head',
      department: departmentName,
    };
  }

  return null;
};


// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK CHAIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback chain when employee is not found in the org structure.
 * CEO step is still conditional on the amount threshold.
 *
 * @param {string}      department
 * @param {number|null} amount     - invoiceAmount in XAF
 */
const getFallbackInvoiceApprovalChain = (department, amount = null) => {
  const chain      = [];
  const seenEmails = new Set();
  let level        = 1;

  const ceoCheck = requiresCEOApproval('invoice', amount);

  console.warn('⚠️  Using fallback invoice approval chain');
  console.warn(`    CEO Step: ${ceoCheck.required ? 'REQUIRED' : 'SKIPPED'} — ${ceoCheck.reason}`);

  // Department Head
  if (DEPARTMENT_STRUCTURE[department]) {
    const email = DEPARTMENT_STRUCTURE[department].headEmail;
    if (!seenEmails.has(email)) {
      chain.push({
        level: level++,
        approver: {
          name:       DEPARTMENT_STRUCTURE[department].head,
          email,
          role:       'Departmental Head',
          department,
        },
        status:       'pending',
        assignedDate: new Date(),
      });
      seenEmails.add(email);
    }
  }

  // President / Head of Business
  const executive = DEPARTMENT_STRUCTURE['Executive'];
  if (executive && !seenEmails.has(executive.headEmail)) {
    chain.push({
      level: level++,
      approver: {
        name:       executive.head,
        email:      executive.headEmail,
        role:       'Head of Business',
        department: 'Executive',
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    seenEmails.add(executive.headEmail);
  }

  // Finance Officer
  const financeEmail = 'ranibellmambo@gratoengineering.com';
  if (!seenEmails.has(financeEmail)) {
    chain.push({
      level: level++,
      approver: {
        name:       'Ms. Ranibell Mambo',
        email:      financeEmail,
        role:       'Finance Officer',
        department: 'Business Development & Supply Chain',
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    seenEmails.add(financeEmail);
  }

  // CEO — conditional on amount threshold
  const ceoEmailLower = CEO.email.toLowerCase();
  if (ceoCheck.required && !seenEmails.has(ceoEmailLower)) {
    chain.push({
      level: level++,
      approver: {
        name:       CEO.name,
        email:      CEO.email,
        role:       CEO.role,
        department: CEO.department,
      },
      status:       'pending',
      assignedDate: new Date(),
      ceoThreshold: { required: true, reason: ceoCheck.reason },
    });
    seenEmails.add(ceoEmailLower);
    console.warn(`✅ Added CEO at level ${level - 1} — ${ceoCheck.reason}`);
  } else {
    console.warn(`⏭️  Skipped CEO — ${ceoCheck.reason}`);
  }
  // ── END CEO STEP ──────────────────────────────────────────────────────────

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// STATUS & PERMISSION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getNextInvoiceApprovalStatus = (currentLevel, totalLevels) => {
  if (currentLevel === totalLevels) return 'approved';
  return 'pending_department_approval';
};

const getUserInvoiceApprovalLevel = (userRole, userEmail) => {
  if (userEmail === CEO.email)     return 5;
  if (userRole === 'finance')      return 4;

  if (userRole === 'admin') {
    const executive = DEPARTMENT_STRUCTURE['Executive'];
    if (executive && executive.headEmail === userEmail) return 3;
    return 2;
  }

  if (userRole === 'supervisor')   return 1;

  return 0;
};

const canUserApproveInvoiceAtLevel = (user, approvalStep) => {
  if (!user || !approvalStep)                          return false;
  if (user.email !== approvalStep.approver.email)      return false;

  const userApprovalLevel = getUserInvoiceApprovalLevel(user.role, user.email);

  const stepLevelMap = {
    'Supervisor':            1,
    'Departmental Head':     2,
    'Head of Business':      3,
    'Finance Officer':       4,
    'CEO - Final Authority': 5,
  };

  const requiredLevel = stepLevelMap[approvalStep.approver.role];

  if (user.role === 'admin') {
    return requiredLevel === 2 || requiredLevel === 3;
  }

  return userApprovalLevel === requiredLevel;
};

const isCEOStep = (step) => {
  if (!step || !step.approver) return false;
  return (
    step.approver.role === 'CEO - Final Authority' ||
    String(step.approver.email || '').toLowerCase() === CEO.email.toLowerCase()
  );
};


module.exports = {
  getInvoiceApprovalChain,
  getNextInvoiceApprovalStatus,
  getUserInvoiceApprovalLevel,
  canUserApproveInvoiceAtLevel,
  findSupervisor,
  getFallbackInvoiceApprovalChain,
  isCEOStep,
};











// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get invoice approval chain with STRICT hierarchy:
//  * Level 1: Immediate Supervisor (if not department head)
//  * Level 2: Department Head
//  * Level 3: Head of Business (President)
//  * Level 4: Finance Officer
//  * Level 5: CEO - Final Authority
//  */
// const getInvoiceApprovalChain = (employeeName, department) => {
//   const chain = [];
//   const seenEmails = new Set();
  
//   console.log(`\n=== BUILDING INVOICE APPROVAL CHAIN ===`);
//   console.log(`Employee: ${employeeName}`);
//   console.log(`Department: ${department}`);

//   // Find employee
//   let employeeData = null;
//   let employeeDepartmentName = department;

//   if (DEPARTMENT_STRUCTURE[department] && DEPARTMENT_STRUCTURE[department].head === employeeName) {
//     employeeData = {
//       name: employeeName,
//       email: DEPARTMENT_STRUCTURE[department].headEmail,
//       position: 'Department Head',
//       supervisor: 'President',
//       department: department
//     };
//     console.log('✓ Employee is Department Head');
//   } else {
//     for (const [deptKey, deptData] of Object.entries(DEPARTMENT_STRUCTURE)) {
//       if (deptData.head === employeeName) {
//         employeeData = {
//           name: employeeName,
//           email: deptData.headEmail,
//           position: 'Department Head',
//           supervisor: 'President',
//           department: deptKey
//         };
//         employeeDepartmentName = deptKey;
//         console.log(`✓ Employee is Department Head of ${deptKey}`);
//         break;
//       }

//       if (deptData.positions) {
//         for (const [pos, data] of Object.entries(deptData.positions)) {
//           if (data.name === employeeName) {
//             employeeData = { ...data, position: pos };
//             employeeDepartmentName = deptKey;
//             console.log(`✓ Found: ${pos} in ${deptKey}`);
//             break;
//           }
//         }
//       }
//       if (employeeData) break;
//     }
//   }

//   if (!employeeData) {
//     console.warn(`⚠ Employee "${employeeName}" not found. Using fallback.`);
//     return getFallbackInvoiceApprovalChain(department);
//   }

//   // Helper to add unique approver
//   const addApprover = (approverData, role) => {
//     if (seenEmails.has(approverData.email)) {
//       console.log(`⊘ Skip duplicate: ${approverData.name} (${approverData.email})`);
//       return false;
//     }

//     const level = chain.length + 1;
//     chain.push({
//       level,
//       approver: {
//         name: approverData.name,
//         email: approverData.email,
//         role,
//         department: approverData.department || employeeDepartmentName
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });

//     seenEmails.add(approverData.email);
//     console.log(`✓ Level ${level}: ${approverData.name} (${role}) - ${approverData.email}`);
//     return true;
//   };

//   // LEVEL 1: Immediate Supervisor (if not department head)
//   if (employeeData.position !== 'Department Head') {
//     const supervisor = findSupervisor(employeeData, employeeDepartmentName);
//     if (supervisor) {
//       addApprover(supervisor, 'Supervisor');
//     }
//   }

//   // LEVEL 2: Department Head (if different from employee and supervisor)
//   const deptHead = DEPARTMENT_STRUCTURE[employeeDepartmentName];
//   if (deptHead && employeeData.name !== deptHead.head) {
//     addApprover({
//       name: deptHead.head,
//       email: deptHead.headEmail,
//       department: employeeDepartmentName
//     }, 'Departmental Head');
//   }

//   // LEVEL 3: Head of Business / President (if different from above)
//   const executive = DEPARTMENT_STRUCTURE['Executive'];
//   if (executive) {
//     addApprover({
//       name: executive.head,
//       email: executive.headEmail,
//       department: 'Executive'
//     }, 'Head of Business');
//   }

//   // LEVEL 4: Finance Officer
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
//   if (!seenEmails.has(financeEmail)) {
//     const financeLevel = chain.length + 1;
//     chain.push({
//       level: financeLevel,
//       approver: {
//         name:       'Ms. Ranibell Mambo',
//         email:      financeEmail,
//         role:       'Finance Officer',
//         department: 'Business Development & Supply Chain'
//       },
//       status:      'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(financeEmail);
//     console.log(`✓ Level ${financeLevel}: Ms. Ranibell Mambo (Finance Officer)`);
//   }

//   // LEVEL 5: CEO — absolute final
//   const ceoEmail = 'tom@gratoengineering.com';
//   if (!seenEmails.has(ceoEmail)) {
//     const ceoLevel = chain.length + 1;
//     chain.push({
//       level: ceoLevel,
//       approver: {
//         name:       'Mr. Tom',
//         email:      ceoEmail,
//         role:       'CEO - Final Authority',
//         department: 'CEO Office'
//       },
//       status:      'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(ceoEmail);
//     console.log(`✓ Level ${ceoLevel}: Mr. Tom (CEO - Final Authority)`);
//   }

//   // CRITICAL: Renumber to ensure sequential levels
//   chain.forEach((step, index) => {
//     step.level = index + 1;
//   });

//   const finalChain = chain.map(s => `L${s.level}: ${s.approver.name} (${s.approver.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
//   console.log('=== END APPROVAL CHAIN ===\n');

//   return chain;
// };

// const findSupervisor = (employeeData, departmentName) => {
//   if (!employeeData.supervisor) return null;

//   const department = DEPARTMENT_STRUCTURE[departmentName];
//   if (!department) return null;

//   // Check in positions
//   if (department.positions) {
//     for (const [pos, data] of Object.entries(department.positions)) {
//       if (pos === employeeData.supervisor || data.name === employeeData.supervisor) {
//         return {
//           ...data,
//           position: pos,
//           department: departmentName
//         };
//       }
//     }
//   }

//   // Check if supervisor is department head
//   if (department.head === employeeData.supervisor || employeeData.supervisor.includes('Head')) {
//     return {
//       name: department.head,
//       email: department.headEmail,
//       position: 'Department Head',
//       department: departmentName
//     };
//   }

//   return null;
// };

// const getFallbackInvoiceApprovalChain = (department) => {
//   const chain = [];
//   const seenEmails = new Set();
//   let level = 1;

//   // Department Head
//   if (DEPARTMENT_STRUCTURE[department]) {
//     const email = DEPARTMENT_STRUCTURE[department].headEmail;
//     if (!seenEmails.has(email)) {
//       chain.push({
//         level: level++,
//         approver: {
//           name: DEPARTMENT_STRUCTURE[department].head,
//           email,
//           role: 'Departmental Head',
//           department
//         },
//         status: 'pending',
//         assignedDate: new Date()
//       });
//       seenEmails.add(email);
//     }
//   }

//   // President
//   const executive = DEPARTMENT_STRUCTURE['Executive'];
//   if (executive && !seenEmails.has(executive.headEmail)) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: executive.head,
//         email: executive.headEmail,
//         role: 'Head of Business',
//         department: 'Executive'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(executive.headEmail);
//   }

//   // Finance
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
//   if (!seenEmails.has(financeEmail)) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Ms. Ranibell Mambo',
//         email: financeEmail,
//         role: 'Finance Officer',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(financeEmail);
//   }

//   // CEO — absolute final
//   const ceoEmail = 'tom@gratoengineering.com';
//   if (!seenEmails.has(ceoEmail)) {
//     chain.push({
//       level: level++,
//       approver: {
//         name:       'Mr. Tom',
//         email:      ceoEmail,
//         role:       'CEO - Final Authority',
//         department: 'CEO Office'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(ceoEmail);
//   }

//   return chain;
// };

// const getNextInvoiceApprovalStatus = (currentLevel, totalLevels) => {
//   if (currentLevel === totalLevels) {
//     return 'approved';
//   }
//   return 'pending_department_approval';
// };

// const getUserInvoiceApprovalLevel = (userRole, userEmail) => {
//   if (userEmail === 'tom@gratoengineering.com') return 5;
//   if (userRole === 'finance') return 4;
  
//   if (userRole === 'admin') {
//     const executive = DEPARTMENT_STRUCTURE['Executive'];
//     if (executive && executive.headEmail === userEmail) {
//       return 3;
//     }
//     return 2;
//   }
  
//   if (userRole === 'supervisor') return 1;
  
//   return 0;
// };

// const canUserApproveInvoiceAtLevel = (user, approvalStep) => {
//   if (!user || !approvalStep) return false;
//   if (user.email !== approvalStep.approver.email) return false;
  
//   const userApprovalLevel = getUserInvoiceApprovalLevel(user.role, user.email);
  
//   const stepLevelMap = {
//     'Supervisor': 1,
//     'Departmental Head': 2,
//     'Head of Business': 3,
//     'Finance Officer': 4,
//     'CEO - Final Authority': 5
//   };
  
//   const requiredLevel = stepLevelMap[approvalStep.approver.role];
  
//   if (user.role === 'admin') {
//     return requiredLevel === 2 || requiredLevel === 3;
//   }
  
//   return userApprovalLevel === requiredLevel;
// };

// const isCEOStep = (step) => {
//   if (!step || !step.approver) return false;
//   return (
//     step.approver.role === 'CEO - Final Authority' ||
//     String(step.approver.email || '').toLowerCase() === 'tom@gratoengineering.com'
//   );
// };

// module.exports = {
//   getInvoiceApprovalChain,
//   getNextInvoiceApprovalStatus,
//   getUserInvoiceApprovalLevel,
//   canUserApproveInvoiceAtLevel,
//   findSupervisor,
//   getFallbackInvoiceApprovalChain,
//   isCEOStep
// };







// const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

// /**
//  * Get invoice approval chain with STRICT hierarchy:
//  * Level 1: Immediate Supervisor (if not department head)
//  * Level 2: Department Head
//  * Level 3: Head of Business (President)
//  * Level 4: Finance Officer (ALWAYS LAST)
//  */
// const getInvoiceApprovalChain = (employeeName, department) => {
//   const chain = [];
//   const seenEmails = new Set();
  
//   console.log(`\n=== BUILDING INVOICE APPROVAL CHAIN ===`);
//   console.log(`Employee: ${employeeName}`);
//   console.log(`Department: ${department}`);

//   // Find employee
//   let employeeData = null;
//   let employeeDepartmentName = department;

//   if (DEPARTMENT_STRUCTURE[department] && DEPARTMENT_STRUCTURE[department].head === employeeName) {
//     employeeData = {
//       name: employeeName,
//       email: DEPARTMENT_STRUCTURE[department].headEmail,
//       position: 'Department Head',
//       supervisor: 'President',
//       department: department
//     };
//     console.log('✓ Employee is Department Head');
//   } else {
//     for (const [deptKey, deptData] of Object.entries(DEPARTMENT_STRUCTURE)) {
//       if (deptData.head === employeeName) {
//         employeeData = {
//           name: employeeName,
//           email: deptData.headEmail,
//           position: 'Department Head',
//           supervisor: 'President',
//           department: deptKey
//         };
//         employeeDepartmentName = deptKey;
//         console.log(`✓ Employee is Department Head of ${deptKey}`);
//         break;
//       }

//       if (deptData.positions) {
//         for (const [pos, data] of Object.entries(deptData.positions)) {
//           if (data.name === employeeName) {
//             employeeData = { ...data, position: pos };
//             employeeDepartmentName = deptKey;
//             console.log(`✓ Found: ${pos} in ${deptKey}`);
//             break;
//           }
//         }
//       }
//       if (employeeData) break;
//     }
//   }

//   if (!employeeData) {
//     console.warn(`⚠ Employee "${employeeName}" not found. Using fallback.`);
//     return getFallbackInvoiceApprovalChain(department);
//   }

//   // Helper to add unique approver
//   const addApprover = (approverData, role) => {
//     if (seenEmails.has(approverData.email)) {
//       console.log(`⊘ Skip duplicate: ${approverData.name} (${approverData.email})`);
//       return false;
//     }

//     const level = chain.length + 1;
//     chain.push({
//       level,
//       approver: {
//         name: approverData.name,
//         email: approverData.email,
//         role,
//         department: approverData.department || employeeDepartmentName
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });

//     seenEmails.add(approverData.email);
//     console.log(`✓ Level ${level}: ${approverData.name} (${role}) - ${approverData.email}`);
//     return true;
//   };

//   // LEVEL 1: Immediate Supervisor (if not department head)
//   if (employeeData.position !== 'Department Head') {
//     const supervisor = findSupervisor(employeeData, employeeDepartmentName);
//     if (supervisor) {
//       addApprover(supervisor, 'Supervisor');
//     }
//   }

//   // LEVEL 2: Department Head (if different from employee and supervisor)
//   const deptHead = DEPARTMENT_STRUCTURE[employeeDepartmentName];
//   if (deptHead && employeeData.name !== deptHead.head) {
//     addApprover({
//       name: deptHead.head,
//       email: deptHead.headEmail,
//       department: employeeDepartmentName
//     }, 'Departmental Head');
//   }

//   // LEVEL 3: Head of Business / President (if different from above)
//   const executive = DEPARTMENT_STRUCTURE['Executive'];
//   if (executive) {
//     addApprover({
//       name: executive.head,
//       email: executive.headEmail,
//       department: 'Executive'
//     }, 'Head of Business');
//   }

//   // LEVEL 4: Finance Officer (ALWAYS LAST - NEVER SKIP)
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
//   if (!seenEmails.has(financeEmail)) {
//     const finalLevel = chain.length + 1;
//     chain.push({
//       level: finalLevel,
//       approver: {
//         name: 'Ms. Ranibell Mambo',
//         email: financeEmail,
//         role: 'Finance Officer',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(financeEmail);
//     console.log(`✓ Level ${finalLevel}: Ms. Ranibell Mambo (Finance Officer) - ${financeEmail}`);
//   }

//   // CRITICAL: Renumber to ensure sequential levels
//   chain.forEach((step, index) => {
//     step.level = index + 1;
//   });

//   const finalChain = chain.map(s => `L${s.level}: ${s.approver.name} (${s.approver.role})`).join(' → ');
//   console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
//   console.log('=== END APPROVAL CHAIN ===\n');

//   return chain;
// };

// const findSupervisor = (employeeData, departmentName) => {
//   if (!employeeData.supervisor) return null;

//   const department = DEPARTMENT_STRUCTURE[departmentName];
//   if (!department) return null;

//   // Check in positions
//   if (department.positions) {
//     for (const [pos, data] of Object.entries(department.positions)) {
//       if (pos === employeeData.supervisor || data.name === employeeData.supervisor) {
//         return {
//           ...data,
//           position: pos,
//           department: departmentName
//         };
//       }
//     }
//   }

//   // Check if supervisor is department head
//   if (department.head === employeeData.supervisor || employeeData.supervisor.includes('Head')) {
//     return {
//       name: department.head,
//       email: department.headEmail,
//       position: 'Department Head',
//       department: departmentName
//     };
//   }

//   return null;
// };

// const getFallbackInvoiceApprovalChain = (department) => {
//   const chain = [];
//   const seenEmails = new Set();
//   let level = 1;

//   // Department Head
//   if (DEPARTMENT_STRUCTURE[department]) {
//     const email = DEPARTMENT_STRUCTURE[department].headEmail;
//     if (!seenEmails.has(email)) {
//       chain.push({
//         level: level++,
//         approver: {
//           name: DEPARTMENT_STRUCTURE[department].head,
//           email,
//           role: 'Departmental Head',
//           department
//         },
//         status: 'pending',
//         assignedDate: new Date()
//       });
//       seenEmails.add(email);
//     }
//   }

//   // President
//   const executive = DEPARTMENT_STRUCTURE['Executive'];
//   if (executive && !seenEmails.has(executive.headEmail)) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: executive.head,
//         email: executive.headEmail,
//         role: 'Head of Business',
//         department: 'Executive'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(executive.headEmail);
//   }

//   // Finance (ALWAYS LAST)
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
//   if (!seenEmails.has(financeEmail)) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Ms. Ranibell Mambo',
//         email: financeEmail,
//         role: 'Finance Officer',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//   }

//   return chain;
// };

// const getNextInvoiceApprovalStatus = (currentLevel, totalLevels) => {
//   // Map based on what level was just approved
//   if (currentLevel === totalLevels) {
//     return 'approved'; // All levels approved
//   }
  
//   // Always return pending_department_approval until all levels are done
//   return 'pending_department_approval';
// };

// const getUserInvoiceApprovalLevel = (userRole, userEmail) => {
//   if (userRole === 'finance') return 4;
  
//   if (userRole === 'admin') {
//     const executive = DEPARTMENT_STRUCTURE['Executive'];
//     if (executive && executive.headEmail === userEmail) {
//       return 3;
//     }
//     return 2;
//   }
  
//   if (userRole === 'supervisor') return 1;
  
//   return 0;
// };

// const canUserApproveInvoiceAtLevel = (user, approvalStep) => {
//   if (!user || !approvalStep) return false;
//   if (user.email !== approvalStep.approver.email) return false;
  
//   const userApprovalLevel = getUserInvoiceApprovalLevel(user.role, user.email);
  
//   const stepLevelMap = {
//     'Supervisor': 1,
//     'Departmental Head': 2,
//     'Head of Business': 3,
//     'Finance Officer': 4
//   };
  
//   const requiredLevel = stepLevelMap[approvalStep.approver.role];
  
//   if (user.role === 'admin') {
//     return requiredLevel === 2 || requiredLevel === 3;
//   }
  
//   return userApprovalLevel === requiredLevel;
// };

// module.exports = {
//   getInvoiceApprovalChain,
//   getNextInvoiceApprovalStatus,
//   getUserInvoiceApprovalLevel,
//   canUserApproveInvoiceAtLevel,
//   findSupervisor,
//   getFallbackInvoiceApprovalChain
// };