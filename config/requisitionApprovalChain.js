// ═══════════════════════════════════════════════════════════════════════════
// FILE: config/purchaseRequisitionApprovalChain.js
// VERSION: 2.1 — Conditional CEO (threshold ≥ 500,000 XAF)
// ═══════════════════════════════════════════════════════════════════════════

const { requiresCEOApproval, CEO } = require('./ceoApprovalConfig');

const DEPARTMENT_STRUCTURE = {
  'Technical': {
    name: 'Technical',
    head: {
      email: 'didier.oyong@gratoengineering.com',
      name: 'Mr. Didier Oyong',
      position: 'Technical Director',
      reportsTo: 'kelvin.eyong@gratoglobal.com',
      hierarchyLevel: 4
    },
    positions: {
      'HSE Coordinator': {
        email: 'bechem.mbu@gratoglobal.com',
        name: 'Mr. Ovo Bechem',
        reportsTo: 'didier.oyong@gratoengineering.com',
        hierarchyLevel: 3,
        canSupervise: [],
        approvalAuthority: 'coordinator'
      },
      'Head of Refurbishment': {
        email: 'verla.ivo@gratoengineering.com',
        name: 'Mr. Verla Ivo',
        reportsTo: 'didier.oyong@gratoengineering.com',
        hierarchyLevel: 3,
        canSupervise: [],
        approvalAuthority: 'head'
      },
      'Project Manager': {
        email: 'joel@gratoengineering.com',
        name: 'Mr. Joel Wamba',
        reportsTo: 'didier.oyong@gratoengineering.com',
        hierarchyLevel: 3,
        canSupervise: ['Site Supervisor'],
        approvalAuthority: 'manager'
      },
      'Operations Manager': {
        email: 'pascal.rodrique@gratoglobal.com',
        name: 'Mr. Pascal Assam',
        reportsTo: 'didier.oyong@gratoengineering.com',
        hierarchyLevel: 3,
        canSupervise: ['Data Collector', 'NOC Coordinator', 'Site Supervisor'],
        approvalAuthority: 'manager'
      },
      'Diesel Coordinator': {
        email: 'minka.kevin@gratoglobal.com',
        name: 'Mr. Kevin Minka',
        reportsTo: 'didier.oyong@gratoengineering.com',
        hierarchyLevel: 3,
        canSupervise: [],
        approvalAuthority: 'coordinator'
      },
      'Data Collector': {
        email: 'bemba.essack@gratoglobal.com',
        name: 'Mr. Bemba Essack',
        reportsTo: 'pascal.rodrique@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: [],
        approvalAuthority: 'staff'
      },
      'NOC Coordinator': {
        email: 'rodrigue.nono@gratoglobal.com',
        name: 'Mr. Rodrigue Nono',
        reportsTo: 'pascal.rodrique@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: ['NOC Operator'],
        approvalAuthority: 'coordinator'
      },
      'Site Supervisor - Joseph': {
        email: 'joseph.tayou@gratoglobal.com',
        name: 'Mr. Joseph TAYOU',
        position: 'Site Supervisor',
        reportsTo: 'pascal.rodrique@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: ['Field Technician'],
        approvalAuthority: 'supervisor'
      },
      'Site Supervisor - Felix': {
        email: 'felix.tientcheu@gratoglobal.com',
        name: 'Mr. Felix Tientcheu',
        position: 'Site Supervisor',
        reportsTo: 'pascal.rodrique@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: ['Field Technician'],
        approvalAuthority: 'supervisor'
      }
    }
  },

  'Business Development & Supply Chain': {
    name: 'Business Development & Supply Chain',
    head: {
      email: 'kelvin.eyong@gratoglobal.com',
      name: 'Mr. E.T Kelvin',
      position: 'President / Head of Business',
      reportsTo: null,
      hierarchyLevel: 5
    },
    positions: {
      'Supply Chain Coordinator': {
        email: 'lukong.lambert@gratoglobal.com',
        name: 'Mr. Lukong Lambert',
        reportsTo: 'kelvin.eyong@gratoglobal.com',
        hierarchyLevel: 3,
        canSupervise: ['Warehouse Coordinator/Buyer'],
        approvalAuthority: 'coordinator',
        specialRole: 'buyer'
      },
      'Order Management Assistant/Buyer': {
        email: 'christabel@gratoengineering.com',
        name: 'Ms. Christabel Mangwi',
        reportsTo: 'kelvin.eyong@gratoglobal.com',
        hierarchyLevel: 3,
        canSupervise: [],
        approvalAuthority: 'buyer',
        specialRole: 'buyer'
      },
      'Warehouse Coordinator/Buyer': {
        email: 'pryde.mua@gratoglobal.com',
        name: 'Mr. Pryde Mua',
        reportsTo: 'lukong.lambert@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: ['Warehouse Assistant'],
        approvalAuthority: 'coordinator',
        specialRole: 'buyer'
      },
      'Warehouse Assistant': {
        email: 'aghangu.marie@gratoengineering.com',
        name: 'Ms. Aghangu Marie',
        reportsTo: 'pryde.mua@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff'
      },
      'Finance Officer': {
        email: 'ranibellmambo@gratoengineering.com',
        name: 'Ms. Ranibell Mambo',
        reportsTo: 'kelvin.eyong@gratoglobal.com',
        hierarchyLevel: 3,
        canSupervise: [],
        approvalAuthority: 'finance',
        specialRole: 'finance'
      }
    }
  },

  'HR & Admin': {
    name: 'HR & Admin',
    head: {
      email: 'bruiline.tsitoh@gratoglobal.com',
      name: 'Mrs. Bruiline Tsitoh',
      position: 'HR & Admin Head',
      reportsTo: 'kelvin.eyong@gratoglobal.com',
      hierarchyLevel: 4
    },
    positions: {
      'Office Driver/Logistics Assistant': {
        email: 'che.earnest@gratoengineering.com',
        name: 'Mr. Che Earnest',
        reportsTo: 'bruiline.tsitoh@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: [],
        approvalAuthority: 'staff'
      },
      'House Maid': {
        email: 'ndi.belther@gratoengineering.com',
        name: 'Ms. Ndi Belther',
        reportsTo: 'bruiline.tsitoh@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: [],
        approvalAuthority: 'staff'
      },
      'HR Assistant': {
        email: 'carmel.dafny@gratoglobal.com',
        name: 'Ms. Carmel Dafny',
        reportsTo: 'bruiline.tsitoh@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: [],
        approvalAuthority: 'staff'
      },
      'Receptionist': {
        email: 'esther.lum@gratoglobal.com',
        name: 'Ms. Esther Lum',
        reportsTo: 'bruiline.tsitoh@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: [],
        approvalAuthority: 'staff'
      }
    }
  },

  'IT': {
    name: 'IT',
    head: {
      email: 'kelvin.eyong@gratoglobal.com',
      name: 'Mr. E.T Kelvin',
      position: 'President / Head of Business',
      reportsTo: null,
      hierarchyLevel: 5
    },
    positions: {
      'IT Staff': {
        email: 'marcel.ngong@gratoglobal.com',
        name: 'Marcel Yiosimbom',
        reportsTo: 'kelvin.eyong@gratoglobal.com',
        hierarchyLevel: 3,
        canSupervise: [],
        approvalAuthority: 'staff'
      }
    }
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPER
// ─────────────────────────────────────────────────────────────────────────────

const findPersonByEmail = (email) => {
  const normalizedEmail = String(email || '').toLowerCase().trim();

  for (const [deptKey, dept] of Object.entries(DEPARTMENT_STRUCTURE)) {
    if (dept.head.email.toLowerCase().trim() === normalizedEmail) {
      return {
        ...dept.head,
        department: deptKey,
        isDepartmentHead: true
      };
    }

    for (const [position, person] of Object.entries(dept.positions || {})) {
      if (person.email.toLowerCase().trim() === normalizedEmail) {
        return {
          ...person,
          position: person.position || position,
          department: deptKey,
          isDepartmentHead: false
        };
      }
    }
  }
  return null;
};


// ─────────────────────────────────────────────────────────────────────────────
// MAIN CHAIN BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ✅ VERSION 2.1: Get approval chain for Purchase Requisitions.
 *
 * Chain structure:
 *   Dept hierarchy → Finance Officer → Supply Chain Coordinator → President (Kelvin)
 *   → CEO (Tom) [only when totalBudget ≥ 500,000 XAF]
 *
 * @param {string}      employeeEmail
 * @param {number|null} amount        - totalBudget / estimatedCost in XAF
 *                                      (null → CEO required as precaution)
 * @returns {Array} Approval chain steps
 */
const getApprovalChainForRequisition = (employeeEmail, amount = null) => {
  const chain = [];
  let currentPerson = findPersonByEmail(employeeEmail);

  if (!currentPerson) {
    console.error(`Employee ${employeeEmail} not found in structure`);
    return createDefaultRequisitionApprovalChain(amount);
  }

  let level = 1;
  const seenEmails   = new Set([employeeEmail.toLowerCase().trim()]);
  const PRESIDENT_EMAIL = 'kelvin.eyong@gratoglobal.com';

  // ── CEO threshold check (done once, used at the end) ─────────────────────
  const ceoCheck = requiresCEOApproval('purchase_requisition', amount);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== BUILDING PURCHASE REQUISITION APPROVAL CHAIN (V2.1) ===`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Employee:    ${currentPerson.name} (${currentPerson.position || 'N/A'})`);
  console.log(`Department:  ${currentPerson.department}`);
  console.log(`Reports To:  ${currentPerson.reportsTo || 'None'}`);
  console.log(`Amount XAF:  ${amount !== null ? Number(amount).toLocaleString() : 'NOT PROVIDED'}`);
  console.log(`CEO Step:    ${ceoCheck.required ? 'REQUIRED' : 'SKIPPED'} — ${ceoCheck.reason}`);

  // ── STEP 1: DEPARTMENTAL HIERARCHY ───────────────────────────────────────
  const reportsDirectlyToPresident =
    currentPerson.reportsTo &&
    currentPerson.reportsTo.toLowerCase().trim() === PRESIDENT_EMAIL.toLowerCase();

  if (reportsDirectlyToPresident) {
    console.log(`\n✅ DIRECT REPORT TO PRESIDENT DETECTED`);
    console.log(`   ${currentPerson.name} → Kelvin Eyong (President)`);
    console.log(`   Skipping departmental chain — no intermediate supervisor needed`);
  } else {
    console.log(`\n📋 Building departmental approval chain...`);

    while (currentPerson && currentPerson.reportsTo) {
      const supervisorEmail = currentPerson.reportsTo.toLowerCase().trim();

      if (supervisorEmail === PRESIDENT_EMAIL.toLowerCase()) {
        console.log(`✓ Reached President — stopping departmental chain`);
        break;
      }

      if (seenEmails.has(supervisorEmail)) {
        console.log(`⚠️  Circular reference detected at ${supervisorEmail}, breaking loop`);
        break;
      }

      const supervisor = findPersonByEmail(supervisorEmail);

      if (!supervisor) {
        console.log(`⚠️  Supervisor ${supervisorEmail} not found — stopping hierarchy traversal`);
        break;
      }

      chain.push({
        level: level++,
        approver: {
          name:       supervisor.name,
          email:      supervisor.email,
          role:       supervisor.isDepartmentHead
                        ? 'Department Head'
                        : (supervisor.position || 'Supervisor'),
          department: supervisor.department,
        },
        status:       'pending',
        assignedDate: new Date(),
      });

      console.log(`✓ Added Level ${level - 1}: ${supervisor.name} (${supervisor.position || 'Supervisor'})`);

      seenEmails.add(supervisorEmail);
      currentPerson = supervisor;
    }
  }

  console.log(`\n✅ Departmental approvals: ${chain.length} level(s)`);

  // ── STEP 2: FINANCE OFFICER ───────────────────────────────────────────────
  console.log(`\n📋 Adding Finance Officer for budget verification`);
  const financeEmail = 'ranibellmambo@gratoengineering.com';

  if (!seenEmails.has(financeEmail.toLowerCase())) {
    chain.push({
      level: level++,
      approver: {
        name:       'Ms. Ranibell Mambo',
        email:      financeEmail,
        role:       'Finance Officer - Budget Verification',
        department: 'Business Development & Supply Chain',
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    seenEmails.add(financeEmail.toLowerCase());
    console.log(`✓ Added Level ${level - 1}: Finance Officer`);
  }

  // ── STEP 3: SUPPLY CHAIN COORDINATOR ─────────────────────────────────────
  console.log(`\n📋 Adding Supply Chain Coordinator for business decisions`);
  const supplyChainEmail = 'lukong.lambert@gratoglobal.com';

  if (!seenEmails.has(supplyChainEmail.toLowerCase())) {
    chain.push({
      level: level++,
      approver: {
        name:       'Mr. Lukong Lambert',
        email:      supplyChainEmail,
        role:       'Supply Chain Coordinator - Business Decisions',
        department: 'Business Development & Supply Chain',
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    seenEmails.add(supplyChainEmail.toLowerCase());
    console.log(`✓ Added Level ${level - 1}: Supply Chain Coordinator`);
  }

  // ── STEP 4: PRESIDENT (Kelvin) — penultimate ──────────────────────────────
  console.log(`\n📋 Adding President (Kelvin) for final departmental approval`);

  if (!seenEmails.has(PRESIDENT_EMAIL.toLowerCase())) {
    chain.push({
      level: level++,
      approver: {
        name:       'Mr. E.T Kelvin',
        email:      PRESIDENT_EMAIL,
        role:       'Head of Business Development & Supply Chain - Final Approval',
        department: 'Business Development & Supply Chain',
      },
      status:       'pending',
      assignedDate: new Date(),
    });
    seenEmails.add(PRESIDENT_EMAIL.toLowerCase());
    console.log(`✓ Added Level ${level - 1}: President (Kelvin)`);
  }

  // ── STEP 5: CEO — conditional on amount threshold ─────────────────────────
  console.log(`\n[PurchaseReq] CEO step: ${ceoCheck.required ? 'REQUIRED' : 'SKIPPED'} — ${ceoCheck.reason}`);

  const CEO_EMAIL_REQ = CEO.email.toLowerCase();
  if (ceoCheck.required && !seenEmails.has(CEO_EMAIL_REQ)) {
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
    seenEmails.add(CEO_EMAIL_REQ);
    console.log(`✓ Added CEO at level ${level - 1}`);
  }
  // ── END CEO STEP ──────────────────────────────────────────────────────────

  console.log(`\n✅ APPROVAL CHAIN COMPLETED: ${chain.length} levels total`);
  console.log(`${'='.repeat(41)}`);
  console.log(`FINAL CHAIN:`);
  chain.forEach((step) => {
    console.log(`   Level ${step.level}: ${step.approver.name} (${step.approver.role})`);
  });
  console.log(`${'='.repeat(41)}\n`);

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT / FALLBACK CHAIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback chain used when the requesting employee is not found in the structure.
 * CEO step is still conditional on amount threshold.
 *
 * @param {number|null} amount - XAF amount forwarded to requiresCEOApproval()
 */
const createDefaultRequisitionApprovalChain = (amount = null) => {
  const chain = [];
  let level = 1;

  const ceoCheck = requiresCEOApproval('purchase_requisition', amount);

  console.warn('⚠️  Creating default requisition approval chain');
  console.warn(`    CEO Step: ${ceoCheck.required ? 'REQUIRED' : 'SKIPPED'} — ${ceoCheck.reason}`);

  // Finance
  chain.push({
    level: level++,
    approver: {
      name:       'Ms. Ranibell Mambo',
      email:      'ranibellmambo@gratoengineering.com',
      role:       'Finance Officer - Budget Verification',
      department: 'Business Development & Supply Chain',
    },
    status:       'pending',
    assignedDate: new Date(),
  });

  // Supply Chain Coordinator
  chain.push({
    level: level++,
    approver: {
      name:       'Mr. Lukong Lambert',
      email:      'lukong.lambert@gratoglobal.com',
      role:       'Supply Chain Coordinator - Business Decisions',
      department: 'Business Development & Supply Chain',
    },
    status:       'pending',
    assignedDate: new Date(),
  });

  // President (Kelvin) — penultimate
  chain.push({
    level: level++,
    approver: {
      name:       'Mr. E.T Kelvin',
      email:      'kelvin.eyong@gratoglobal.com',
      role:       'Head of Business Development & Supply Chain - Final Approval',
      department: 'Business Development & Supply Chain',
    },
    status:       'pending',
    assignedDate: new Date(),
  });

  // CEO — conditional on amount threshold
  if (ceoCheck.required) {
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
    console.warn(`✅ Added CEO at level ${level - 1} — ${ceoCheck.reason}`);
  } else {
    console.warn(`⏭️  Skipped CEO — ${ceoCheck.reason}`);
  }

  return chain;
};


// ─────────────────────────────────────────────────────────────────────────────
// UTILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const getSupervisablePositions = (email) => {
  const person = findPersonByEmail(email);
  if (!person || !person.canSupervise) return [];

  return person.canSupervise.map(positionTitle => ({
    position:   positionTitle,
    department: person.department,
  }));
};

const getDepartmentList = () => {
  return Object.keys(DEPARTMENT_STRUCTURE).map(key => ({
    key,
    name: DEPARTMENT_STRUCTURE[key].name,
    head: DEPARTMENT_STRUCTURE[key].head?.name,
  }));
};

const getEmployeesInDepartment = (department) => {
  const dept = DEPARTMENT_STRUCTURE[department];
  if (!dept) return [];

  const employees = [];

  if (dept.head) {
    employees.push({
      name:       dept.head.name,
      email:      dept.head.email,
      position:   'Department Head',
      department,
    });
  }

  for (const [position, data] of Object.entries(dept.positions || {})) {
    employees.push({
      name:       data.name,
      email:      data.email,
      position,
      department,
      role:       data.specialRole || 'employee',
    });
  }

  return employees;
};

const isCEOStep = (step) => {
  if (!step || !step.approver) return false;
  return (
    step.approver.role === 'CEO - Final Authority' ||
    String(step.approver.email || '').toLowerCase() === 'tom@gratoengineering.com'
  );
};


module.exports = {
  DEPARTMENT_STRUCTURE,
  findPersonByEmail,
  getSupervisablePositions,
  getApprovalChainForRequisition,
  createDefaultRequisitionApprovalChain,
  getDepartmentList,
  getEmployeesInDepartment,
  isCEOStep,
};










// // config/purchaseRequisitionApprovalChain.js

// const DEPARTMENT_STRUCTURE = {
//   'Technical': {
//     name: 'Technical',
//     head: {
//       email: 'didier.oyong@gratoengineering.com',
//       name: 'Mr. Didier Oyong',
//       position: 'Technical Director',
//       reportsTo: 'kelvin.eyong@gratoglobal.com', 
//       hierarchyLevel: 4
//     },
//     positions: {
//       'HSE Coordinator': {
//         email: 'bechem.mbu@gratoglobal.com',
//         name: 'Mr. Ovo Bechem',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'coordinator'
//       },
//       'Head of Refurbishment': {
//         email: 'verla.ivo@gratoengineering.com',
//         name: 'Mr. Verla Ivo',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'head'
//       },
//       'Project Manager': {
//         email: 'joel@gratoengineering.com',
//         name: 'Mr. Joel Wamba',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: ['Site Supervisor'],
//         approvalAuthority: 'manager'
//       },
//       'Operations Manager': {
//         email: 'pascal.rodrique@gratoglobal.com',
//         name: 'Mr. Pascal Assam',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: ['Data Collector', 'NOC Coordinator', 'Site Supervisor'],
//         approvalAuthority: 'manager'
//       },
//       'Diesel Coordinator': {
//         email: 'minka.kevin@gratoglobal.com',
//         name: 'Mr. Kevin Minka',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'coordinator'
//       },
//       'Data Collector': {
//         email: 'bemba.essack@gratoglobal.com',
//         name: 'Mr. Bemba Essack',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'NOC Coordinator': {
//         email: 'rodrigue.nono@gratoglobal.com',
//         name: 'Mr. Rodrigue Nono',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['NOC Operator'],
//         approvalAuthority: 'coordinator'
//       },
//       'Site Supervisor - Joseph': {
//         email: 'joseph.tayou@gratoglobal.com',
//         name: 'Mr. Joseph TAYOU',
//         position: 'Site Supervisor',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['Field Technician'],
//         approvalAuthority: 'supervisor'
//       },
//       'Site Supervisor - Felix': {
//         email: 'felix.tientcheu@gratoglobal.com',
//         name: 'Mr. Felix Tientcheu',
//         position: 'Site Supervisor',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['Field Technician'],
//         approvalAuthority: 'supervisor'
//       }
//     }
//   },

//   'Business Development & Supply Chain': {
//     name: 'Business Development & Supply Chain',
//     head: {
//       email: 'kelvin.eyong@gratoglobal.com',
//       name: 'Mr. E.T Kelvin',
//       position: 'President / Head of Business',
//       reportsTo: null,
//       hierarchyLevel: 5
//     },
//     positions: {
//       'Supply Chain Coordinator': {
//         email: 'lukong.lambert@gratoglobal.com',
//         name: 'Mr. Lukong Lambert',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: ['Warehouse Coordinator/Buyer'],
//         approvalAuthority: 'coordinator',
//         specialRole: 'buyer'
//       },
//       'Order Management Assistant/Buyer': {
//         email: 'christabel@gratoengineering.com',
//         name: 'Ms. Christabel Mangwi',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'buyer',
//         specialRole: 'buyer'
//       },
//       'Warehouse Coordinator/Buyer': {
//         email: 'pryde.mua@gratoglobal.com',
//         name: 'Mr. Pryde Mua',
//         reportsTo: 'lukong.lambert@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['Warehouse Assistant'],
//         approvalAuthority: 'coordinator',
//         specialRole: 'buyer'
//       },
//       'Warehouse Assistant': {
//         email: 'aghangu.marie@gratoengineering.com',
//         name: 'Ms. Aghangu Marie',
//         reportsTo: 'pryde.mua@gratoglobal.com',
//         hierarchyLevel: 1,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'Finance Officer': {
//         email: 'ranibellmambo@gratoengineering.com',
//         name: 'Ms. Ranibell Mambo',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'finance',
//         specialRole: 'finance'
//       }
//     }
//   },

//   'HR & Admin': {
//     name: 'HR & Admin',
//     head: {
//       email: 'bruiline.tsitoh@gratoglobal.com',
//       name: 'Mrs. Bruiline Tsitoh',
//       position: 'HR & Admin Head',
//       reportsTo: 'kelvin.eyong@gratoglobal.com', 
//       hierarchyLevel: 4
//     },
//     positions: {
//       'Office Driver/Logistics Assistant': {
//         email: 'che.earnest@gratoengineering.com',
//         name: 'Mr. Che Earnest',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'House Maid': {
//         email: 'ndi.belther@gratoengineering.com',
//         name: 'Ms. Ndi Belther',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'HR Assistant': {
//         email: 'carmel.dafny@gratoglobal.com',
//         name: 'Ms. Carmel Dafny',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'Receptionist': {
//         email: 'esther.lum@gratoglobal.com',
//         name: 'Ms. Esther Lum',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       }
//     }
//   },

//   'IT': {
//     name: 'IT',
//     head: {
//       email: 'kelvin.eyong@gratoglobal.com', 
//       name: 'Mr. E.T Kelvin',
//       position: 'President / Head of Business',
//       reportsTo: null,
//       hierarchyLevel: 5
//     },
//     positions: {
//       'IT Staff': {
//         email: 'marcel.ngong@gratoglobal.com',
//         name: 'Marcel Yiosimbom',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       }
//     }
//   }
// };

// const findPersonByEmail = (email) => {
//   const normalizedEmail = String(email || '').toLowerCase().trim();
  
//   for (const [deptKey, dept] of Object.entries(DEPARTMENT_STRUCTURE)) {
//     if (dept.head.email.toLowerCase().trim() === normalizedEmail) {
//       return {
//         ...dept.head,
//         department: deptKey,
//         isDepartmentHead: true
//       };
//     }

//     for (const [position, person] of Object.entries(dept.positions || {})) {
//       if (person.email.toLowerCase().trim() === normalizedEmail) {
//         return {
//           ...person,
//           position: person.position || position,
//           department: deptKey,
//           isDepartmentHead: false
//         };
//       }
//     }
//   }
//   return null;
// };

// /**
//  * ✅ FIXED: Get approval chain for Purchase Requisitions
//  * Special handling for direct reports to CEO
//  */
// const getApprovalChainForRequisition = (employeeEmail) => {
//   const chain = [];
//   let currentPerson = findPersonByEmail(employeeEmail);
  
//   if (!currentPerson) {
//     console.error(`Employee ${employeeEmail} not found in structure`);
//     return createDefaultRequisitionApprovalChain();
//   }

//   let level = 1;
//   const seenEmails = new Set([employeeEmail.toLowerCase().trim()]);
//   const PRESIDENT_EMAIL = 'kelvin.eyong@gratoglobal.com';

//   console.log(`\n=== BUILDING PURCHASE REQUISITION APPROVAL CHAIN ===`);
//   console.log(`Employee: ${currentPerson.name} (${currentPerson.position || 'N/A'})`);
//   console.log(`Department: ${currentPerson.department}`);
//   console.log(`Reports To: ${currentPerson.reportsTo || 'None'}`);

//   // ── STEP 1: DEPARTMENTAL HIERARCHY ────────────────────────────────────────
//   const reportsDirectlyToPresident = currentPerson.reportsTo && 
//     currentPerson.reportsTo.toLowerCase().trim() === PRESIDENT_EMAIL.toLowerCase();

//   if (reportsDirectlyToPresident) {
//     console.log(`\n✅ DIRECT REPORT TO PRESIDENT DETECTED`);
//     console.log(`   ${currentPerson.name} → Kelvin Eyong (CEO)`);
//     console.log(`   Skipping departmental chain - no intermediate supervisor needed`);
//   } else {
//     console.log(`\n📋 Building departmental approval chain...`);
    
//     while (currentPerson && currentPerson.reportsTo) {
//       const supervisorEmail = currentPerson.reportsTo.toLowerCase().trim();
      
//       if (supervisorEmail === PRESIDENT_EMAIL.toLowerCase()) {
//         console.log(`✓ Reached President - stopping departmental chain`);
//         break;
//       }
      
//       if (seenEmails.has(supervisorEmail)) {
//         console.log(`⚠️ Circular reference detected at ${supervisorEmail}, breaking loop`);
//         break;
//       }

//       const supervisor = findPersonByEmail(supervisorEmail);
      
//       if (!supervisor) {
//         console.log(`⚠️ Supervisor ${supervisorEmail} not found, stopping hierarchy traversal`);
//         break;
//       }

//       chain.push({
//         level: level++,
//         approver: {
//           name: supervisor.name,
//           email: supervisor.email,
//           role: supervisor.isDepartmentHead ? 'Department Head' : (supervisor.position || 'Supervisor'),
//           department: supervisor.department
//         },
//         status: 'pending',
//         assignedDate: new Date()
//       });

//       console.log(`✓ Added Level ${level - 1}: ${supervisor.name} (${supervisor.position || 'Supervisor'})`);

//       seenEmails.add(supervisorEmail);
//       currentPerson = supervisor;
//     }
//   }

//   console.log(`\n✅ Departmental approvals: ${chain.length} level(s)`);

//   // ── STEP 2: FINANCE OFFICER ───────────────────────────────────────────────
//   console.log(`\n📋 Adding Finance Officer for budget verification`);
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
  
//   if (!seenEmails.has(financeEmail.toLowerCase())) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Ms. Ranibell Mambo',
//         email: financeEmail,
//         role: 'Finance Officer - Budget Verification',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(financeEmail.toLowerCase());
//     console.log(`✓ Added Level ${level - 1}: Finance Officer`);
//   }

//   // ── STEP 3: SUPPLY CHAIN COORDINATOR ─────────────────────────────────────
//   console.log(`📋 Adding Supply Chain Coordinator for business decisions`);
//   const supplyChainEmail = 'lukong.lambert@gratoglobal.com';
  
//   if (!seenEmails.has(supplyChainEmail.toLowerCase())) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Mr. Lukong Lambert',
//         email: supplyChainEmail,
//         role: 'Supply Chain Coordinator - Business Decisions',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(supplyChainEmail.toLowerCase());
//     console.log(`✓ Added Level ${level - 1}: Supply Chain Coordinator`);
//   }

//   // ── STEP 4: PRESIDENT ─────────────────────────────────────────────────────
//   console.log(`📋 Adding President for approval`);
  
//   if (!seenEmails.has(PRESIDENT_EMAIL.toLowerCase())) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Mr. E.T Kelvin',
//         email: PRESIDENT_EMAIL,
//         role: 'Head of Business Development & Supply Chain - Final Approval',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(PRESIDENT_EMAIL.toLowerCase());
//     console.log(`✓ Added Level ${level - 1}: President`);
//   }

//   // ── STEP 5: CEO — absolute final approval ──────────────────────────────
//   const CEO_EMAIL_PR = 'tom@gratoengineering.com';
//   if (!seenEmails.has(CEO_EMAIL_PR.toLowerCase())) {
//     chain.push({
//       level: level++,
//       approver: {
//         name:       'Mr. Tom',
//         email:      CEO_EMAIL_PR,
//         role:       'CEO - Final Authority',
//         department: 'CEO Office'
//       },
//       status:      'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(CEO_EMAIL_PR.toLowerCase());
//     console.log(`✓ Added Level ${level - 1}: CEO (Final Authority)`);
//   }

//   console.log(`\n✅ APPROVAL CHAIN COMPLETED: ${chain.length} levels total`);
//   console.log(`=========================================`);
//   console.log(`FINAL CHAIN:`);
//   chain.forEach((step) => {
//     console.log(`   Level ${step.level}: ${step.approver.name} (${step.approver.role})`);
//   });
//   console.log(`=========================================\n`);

//   return chain;
// };

// /**
//  * Create default approval chain when employee not found
//  */
// const createDefaultRequisitionApprovalChain = () => {
//   const chain = [];
//   let level = 1;

//   console.warn('⚠️ Creating default approval chain');

//   // Finance
//   chain.push({
//     level: level++,
//     approver: {
//       name: 'Ms. Ranibell Mambo',
//       email: 'ranibellmambo@gratoengineering.com',
//       role: 'Finance Officer - Budget Verification',
//       department: 'Business Development & Supply Chain'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   // Supply Chain Coordinator
//   chain.push({
//     level: level++,
//     approver: {
//       name: 'Mr. Lukong Lambert',
//       email: 'lukong.lambert@gratoglobal.com',
//       role: 'Supply Chain Coordinator - Business Decisions',
//       department: 'Business Development & Supply Chain'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   // Head of Business
//   chain.push({
//     level: level++,
//     approver: {
//       name: 'Mr. E.T Kelvin',
//       email: 'kelvin.eyong@gratoglobal.com',
//       role: 'Head of Business Development & Supply Chain - Final Approval',
//       department: 'Business Development & Supply Chain'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   // CEO — absolute final
//   chain.push({
//     level: level++,
//     approver: {
//       name:       'Mr. Tom',
//       email:      'tom@gratoengineering.com',
//       role:       'CEO - Final Authority',
//       department: 'CEO Office'
//     },
//     status:      'pending',
//     assignedDate: new Date()
//   });

//   return chain;
// };

// const getSupervisablePositions = (email) => {
//   const person = findPersonByEmail(email);
//   if (!person || !person.canSupervise) return [];

//   return person.canSupervise.map(positionTitle => ({
//     position: positionTitle,
//     department: person.department
//   }));
// };

// const getDepartmentList = () => {
//   return Object.keys(DEPARTMENT_STRUCTURE).map(key => ({
//     key,
//     name: DEPARTMENT_STRUCTURE[key].name,
//     head: DEPARTMENT_STRUCTURE[key].head?.name
//   }));
// };

// const getEmployeesInDepartment = (department) => {
//   const dept = DEPARTMENT_STRUCTURE[department];
//   if (!dept) return [];
  
//   const employees = [];
  
//   if (dept.head) {
//     employees.push({
//       name: dept.head.name,
//       email: dept.head.email,
//       position: 'Department Head',
//       department: department
//     });
//   }
  
//   for (const [position, data] of Object.entries(dept.positions || {})) {
//     employees.push({
//       name: data.name,
//       email: data.email,
//       position: position,
//       department: department,
//       role: data.specialRole || 'employee'
//     });
//   }
  
//   return employees;
// };

// const isCEOStep = (step) => {
//   if (!step || !step.approver) return false;
//   return (
//     step.approver.role === 'CEO - Final Authority' ||
//     String(step.approver.email || '').toLowerCase() === 'tom@gratoengineering.com'
//   );
// };

// module.exports = {
//   DEPARTMENT_STRUCTURE,
//   findPersonByEmail,
//   getSupervisablePositions,
//   getApprovalChainForRequisition,
//   createDefaultRequisitionApprovalChain,
//   getDepartmentList,
//   getEmployeesInDepartment,
//   isCEOStep
// };










// /**
//  * ✅ COMPLETE FIXED: Purchase Requisition Approval Chain Configuration
//  * - Special handling for direct reports to CEO
//  * - Removed duplicate approvers
//  * - Fixed hierarchy traversal
//  * - Proper status progression
//  */

// const DEPARTMENT_STRUCTURE = {
//   'Technical': {
//     name: 'Technical',
//     head: {
//       email: 'didier.oyong@gratoengineering.com',
//       name: 'Mr. Didier Oyong',
//       position: 'Technical Director',
//       reportsTo: 'kelvin.eyong@gratoglobal.com', 
//       hierarchyLevel: 4
//     },
//     positions: {
//       'HSE Coordinator': {
//         email: 'bechem.mbu@gratoglobal.com',
//         name: 'Mr. Ovo Bechem',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'coordinator'
//       },
//       'Head of Refurbishment': {
//         email: 'verla.ivo@gratoengineering.com',
//         name: 'Mr. Verla Ivo',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'head'
//       },
//       'Project Manager': {
//         email: 'joel@gratoengineering.com',
//         name: 'Mr. Joel Wamba',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: ['Site Supervisor'],
//         approvalAuthority: 'manager'
//       },
//       'Operations Manager': {
//         email: 'pascal.rodrique@gratoglobal.com',
//         name: 'Mr. Pascal Assam',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: ['Data Collector', 'NOC Coordinator', 'Site Supervisor'],
//         approvalAuthority: 'manager'
//       },
//       'Diesel Coordinator': {
//         email: 'minka.kevin@gratoglobal.com',
//         name: 'Mr. Kevin Minka',
//         reportsTo: 'didier.oyong@gratoengineering.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'coordinator'
//       },
//       'Data Collector': {
//         email: 'bemba.essack@gratoglobal.com',
//         name: 'Mr. Bemba Essack',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'NOC Coordinator': {
//         email: 'rodrigue.nono@gratoglobal.com',
//         name: 'Mr. Rodrigue Nono',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['NOC Operator'],
//         approvalAuthority: 'coordinator'
//       },
//       'Site Supervisor - Joseph': {
//         email: 'joseph.tayou@gratoglobal.com',
//         name: 'Mr. Joseph TAYOU',
//         position: 'Site Supervisor',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['Field Technician'],
//         approvalAuthority: 'supervisor'
//       },
//       'Site Supervisor - Felix': {
//         email: 'felix.tientcheu@gratoglobal.com',
//         name: 'Mr. Felix Tientcheu',
//         position: 'Site Supervisor',
//         reportsTo: 'pascal.rodrique@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['Field Technician'],
//         approvalAuthority: 'supervisor'
//       }
//     }
//   },

//   'Business Development & Supply Chain': {
//     name: 'Business Development & Supply Chain',
//     head: {
//       email: 'kelvin.eyong@gratoglobal.com',
//       name: 'Mr. E.T Kelvin',
//       position: 'President / Head of Business',
//       reportsTo: null,
//       hierarchyLevel: 5
//     },
//     positions: {
//       'Supply Chain Coordinator': {
//         email: 'lukong.lambert@gratoglobal.com',
//         name: 'Mr. Lukong Lambert',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: ['Warehouse Coordinator/Buyer'],
//         approvalAuthority: 'coordinator',
//         specialRole: 'buyer'
//       },
//       'Order Management Assistant/Buyer': {
//         email: 'christabel@gratoengineering.com',
//         name: 'Ms. Christabel Mangwi',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'buyer',
//         specialRole: 'buyer'
//       },
//       'Warehouse Coordinator/Buyer': {
//         email: 'pryde.mua@gratoglobal.com',
//         name: 'Mr. Pryde Mua',
//         reportsTo: 'lukong.lambert@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: ['Warehouse Assistant'],
//         approvalAuthority: 'coordinator',
//         specialRole: 'buyer'
//       },
//       'Warehouse Assistant': {
//         email: 'aghangu.marie@gratoengineering.com',
//         name: 'Ms. Aghangu Marie',
//         reportsTo: 'pryde.mua@gratoglobal.com',
//         hierarchyLevel: 1,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'Finance Officer': {
//         email: 'ranibellmambo@gratoengineering.com',
//         name: 'Ms. Ranibell Mambo',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'finance',
//         specialRole: 'finance'
//       }
//     }
//   },

//   'HR & Admin': {
//     name: 'HR & Admin',
//     head: {
//       email: 'bruiline.tsitoh@gratoglobal.com',
//       name: 'Mrs. Bruiline Tsitoh',
//       position: 'HR & Admin Head',
//       reportsTo: 'kelvin.eyong@gratoglobal.com', 
//       hierarchyLevel: 4
//     },
//     positions: {
//       'Office Driver/Logistics Assistant': {
//         email: 'che.earnest@gratoengineering.com',
//         name: 'Mr. Che Earnest',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'House Maid': {
//         email: 'ndi.belther@gratoengineering.com',
//         name: 'Ms. Ndi Belther',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'HR Assistant': {
//         email: 'carmel.dafny@gratoglobal.com',
//         name: 'Ms. Carmel Dafny',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       },
//       'Receptionist': {
//         email: 'esther.lum@gratoglobal.com',
//         name: 'Ms. Esther Lum',
//         reportsTo: 'bruiline.tsitoh@gratoglobal.com',
//         hierarchyLevel: 2,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       }
//     }
//   },

//   'IT': {
//     name: 'IT',
//     head: {
//       email: 'kelvin.eyong@gratoglobal.com', 
//       name: 'Mr. E.T Kelvin',
//       position: 'President / Head of Business',
//       reportsTo: null,
//       hierarchyLevel: 5
//     },
//     positions: {
//       'IT Staff': {
//         email: 'marcel.ngong@gratoglobal.com',
//         name: 'Marcel Yiosimbom',
//         reportsTo: 'kelvin.eyong@gratoglobal.com',
//         hierarchyLevel: 3,
//         canSupervise: [],
//         approvalAuthority: 'staff'
//       }
//     }
//   }
// };

// /**
//  * Find person details by email across all departments
//  */
// const findPersonByEmail = (email) => {
//   const normalizedEmail = String(email || '').toLowerCase().trim();
  
//   for (const [deptKey, dept] of Object.entries(DEPARTMENT_STRUCTURE)) {
//     if (dept.head.email.toLowerCase().trim() === normalizedEmail) {
//       return {
//         ...dept.head,
//         department: deptKey,
//         isDepartmentHead: true
//       };
//     }

//     for (const [position, person] of Object.entries(dept.positions || {})) {
//       if (person.email.toLowerCase().trim() === normalizedEmail) {
//         return {
//           ...person,
//           position: person.position || position,
//           department: deptKey,
//           isDepartmentHead: false
//         };
//       }
//     }
//   }
//   return null;
// };

// /**
//  * ✅ FIXED: Get approval chain for Purchase Requisitions
//  * Special handling for direct reports to CEO
//  */
// const getApprovalChainForRequisition = (employeeEmail) => {
//   const chain = [];
//   let currentPerson = findPersonByEmail(employeeEmail);
  
//   if (!currentPerson) {
//     console.error(`Employee ${employeeEmail} not found in structure`);
//     return createDefaultRequisitionApprovalChain();
//   }

//   let level = 1;
//   const seenEmails = new Set([employeeEmail.toLowerCase().trim()]);
//   const PRESIDENT_EMAIL = 'kelvin.eyong@gratoglobal.com';

//   console.log(`\n=== BUILDING PURCHASE REQUISITION APPROVAL CHAIN ===`);
//   console.log(`Employee: ${currentPerson.name} (${currentPerson.position || 'N/A'})`);
//   console.log(`Department: ${currentPerson.department}`);
//   console.log(`Reports To: ${currentPerson.reportsTo || 'None'}`);

//   // ============================================
//   // STEP 1: DEPARTMENTAL HIERARCHY (Supervisor → Department Head)
//   // ============================================
  
//   // ✅ CRITICAL FIX: Check if employee reports DIRECTLY to President
//   const reportsDirectlyToPresident = currentPerson.reportsTo && 
//     currentPerson.reportsTo.toLowerCase().trim() === PRESIDENT_EMAIL.toLowerCase();

//   if (reportsDirectlyToPresident) {
//     console.log(`\n✅ DIRECT REPORT TO PRESIDENT DETECTED`);
//     console.log(`   ${currentPerson.name} → Kelvin Eyong (CEO)`);
//     console.log(`   Skipping departmental chain - no intermediate supervisor needed`);
//   } else {
//     // Normal hierarchy traversal for employees who don't report directly to President
//     console.log(`\n📋 Building departmental approval chain...`);
    
//     while (currentPerson && currentPerson.reportsTo) {
//       const supervisorEmail = currentPerson.reportsTo.toLowerCase().trim();
      
//       // ✅ Stop if we reach the President
//       if (supervisorEmail === PRESIDENT_EMAIL.toLowerCase()) {
//         console.log(`✓ Reached President - stopping departmental chain`);
//         break;
//       }
      
//       // Prevent infinite loops
//       if (seenEmails.has(supervisorEmail)) {
//         console.log(`⚠️ Circular reference detected at ${supervisorEmail}, breaking loop`);
//         break;
//       }

//       const supervisor = findPersonByEmail(supervisorEmail);
      
//       if (!supervisor) {
//         console.log(`⚠️ Supervisor ${supervisorEmail} not found, stopping hierarchy traversal`);
//         break;
//       }

//       // Add supervisor/department head to chain
//       chain.push({
//         level: level++,
//         approver: {
//           name: supervisor.name,
//           email: supervisor.email,
//           role: supervisor.isDepartmentHead ? 'Department Head' : (supervisor.position || 'Supervisor'),
//           department: supervisor.department
//         },
//         status: 'pending',
//         assignedDate: new Date()
//       });

//       console.log(`✓ Added Level ${level - 1}: ${supervisor.name} (${supervisor.position || 'Supervisor'})`);

//       seenEmails.add(supervisorEmail);
//       currentPerson = supervisor;
//     }
//   }

//   console.log(`\n✅ Departmental approvals: ${chain.length} level(s)`);

//   // ============================================
//   // STEP 2: FINANCE OFFICER (Budget Verification)
//   // ============================================
//   console.log(`\n📋 Adding Finance Officer for budget verification`);
//   const financeEmail = 'ranibellmambo@gratoengineering.com';
  
//   if (!seenEmails.has(financeEmail.toLowerCase())) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Ms. Ranibell Mambo',
//         email: financeEmail,
//         role: 'Finance Officer - Budget Verification',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(financeEmail.toLowerCase());
//     console.log(`✓ Added Level ${level - 1}: Finance Officer`);
//   }

//   // ============================================
//   // STEP 3: SUPPLY CHAIN COORDINATOR (Business Decisions)
//   // ============================================
//   console.log(`📋 Adding Supply Chain Coordinator for business decisions`);
//   const supplyChainEmail = 'lukong.lambert@gratoglobal.com';
  
//   if (!seenEmails.has(supplyChainEmail.toLowerCase())) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Mr. Lukong Lambert',
//         email: supplyChainEmail,
//         role: 'Supply Chain Coordinator - Business Decisions',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(supplyChainEmail.toLowerCase());
//     console.log(`✓ Added Level ${level - 1}: Supply Chain Coordinator`);
//   }

//   // ============================================
//   // STEP 4: PRESIDENT (Final Approval)
//   // ============================================
//   console.log(`📋 Adding President for final approval`);
  
//   if (!seenEmails.has(PRESIDENT_EMAIL.toLowerCase())) {
//     chain.push({
//       level: level++,
//       approver: {
//         name: 'Mr. E.T Kelvin',
//         email: PRESIDENT_EMAIL,
//         role: 'Head of Business Development & Supply Chain - Final Approval',
//         department: 'Business Development & Supply Chain'
//       },
//       status: 'pending',
//       assignedDate: new Date()
//     });
//     seenEmails.add(PRESIDENT_EMAIL.toLowerCase());
//     console.log(`✓ Added Level ${level - 1}: President (Final Approval)`);
//   }

//   console.log(`\n✅ APPROVAL CHAIN COMPLETED: ${chain.length} levels total`);
//   console.log(`=========================================`);
//   console.log(`FINAL CHAIN:`);
//   chain.forEach((step) => {
//     console.log(`   Level ${step.level}: ${step.approver.name} (${step.approver.role})`);
//   });
//   console.log(`=========================================\n`);

//   return chain;
// };

// /**
//  * Create default approval chain when employee not found
//  */
// const createDefaultRequisitionApprovalChain = () => {
//   const chain = [];
//   let level = 1;

//   console.warn('⚠️ Creating default approval chain');

//   // Finance
//   chain.push({
//     level: level++,
//     approver: {
//       name: 'Ms. Ranibell Mambo',
//       email: 'ranibellmambo@gratoengineering.com',
//       role: 'Finance Officer - Budget Verification',
//       department: 'Business Development & Supply Chain'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   // Supply Chain Coordinator
//   chain.push({
//     level: level++,
//     approver: {
//       name: 'Mr. Lukong Lambert',
//       email: 'lukong.lambert@gratoglobal.com',
//       role: 'Supply Chain Coordinator - Business Decisions',
//       department: 'Business Development & Supply Chain'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   // Head of Business
//   chain.push({
//     level: level++,
//     approver: {
//       name: 'Mr. E.T Kelvin',
//       email: 'kelvin.eyong@gratoglobal.com',
//       role: 'Head of Business Development & Supply Chain - Final Approval',
//       department: 'Business Development & Supply Chain'
//     },
//     status: 'pending',
//     assignedDate: new Date()
//   });

//   return chain;
// };

// /**
//  * Get all supervisable positions for a person
//  */
// const getSupervisablePositions = (email) => {
//   const person = findPersonByEmail(email);
//   if (!person || !person.canSupervise) return [];

//   return person.canSupervise.map(positionTitle => ({
//     position: positionTitle,
//     department: person.department
//   }));
// };

// /**
//  * Get department list
//  */
// const getDepartmentList = () => {
//   return Object.keys(DEPARTMENT_STRUCTURE).map(key => ({
//     key,
//     name: DEPARTMENT_STRUCTURE[key].name,
//     head: DEPARTMENT_STRUCTURE[key].head?.name
//   }));
// };

// /**
//  * Get employees in a specific department
//  */
// const getEmployeesInDepartment = (department) => {
//   const dept = DEPARTMENT_STRUCTURE[department];
//   if (!dept) return [];
  
//   const employees = [];
  
//   if (dept.head) {
//     employees.push({
//       name: dept.head.name,
//       email: dept.head.email,
//       position: 'Department Head',
//       department: department
//     });
//   }
  
//   for (const [position, data] of Object.entries(dept.positions || {})) {
//     employees.push({
//       name: data.name,
//       email: data.email,
//       position: position,
//       department: department,
//       role: data.specialRole || 'employee'
//     });
//   }
  
//   return employees;
// };

// module.exports = {
//   DEPARTMENT_STRUCTURE,
//   findPersonByEmail,
//   getSupervisablePositions,
//   getApprovalChainForRequisition,
//   getDepartmentList,
//   getEmployeesInDepartment
// };

