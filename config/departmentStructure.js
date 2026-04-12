const DEPARTMENT_STRUCTURE = {
  // 'CEO Office': {
  //   name: 'CEO Office',
  //   head: {
  //     email: 'tom@gratoengineering.com',
  //     name: 'Mr. Tom',
  //     position: 'General Overseer',
  //     reportsTo: null, 
  //     hierarchyLevel: 6  
  //   },
  //   positions: {}
  // },

  'IT': {
    name: 'IT',
    head: {
      email: 'marcel.ngong@gratoglobal.com',
      name: 'Mr. Marcel Ngong',
      position: 'IT Manager',
      reportsTo: null,
      hierarchyLevel: 4
    },
    positions: {
      // Add IT-specific positions here if needed
    }
  },
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
      // ========================================
      // LEVEL 3 - Managers & Coordinators
      // ========================================
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

      // ========================================
      // LEVEL 2 - Coordinators & Supervisors
      // ========================================
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

      // Site Supervisors (Multiple Instances)
      'Site Supervisor - Joseph': {
        email: 'joseph.tayou@gratoglobal.com',
        name: 'Mr. Joseph TAYOU',
        position: 'Site Supervisor',
        reportsTo: 'pascal.rodrique@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: ['Field Technician'],
        approvalAuthority: 'supervisor',
        allowMultipleInstances: false
      },
      'Site Supervisor - Felix': {
        email: 'felix.tientcheu@gratoglobal.com',
        name: 'Mr. Felix Tientcheu',
        position: 'Site Supervisor',
        reportsTo: 'pascal.rodrique@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: ['Field Technician'],
        approvalAuthority: 'supervisor',
        allowMultipleInstances: false
      },

      // ========================================
      // LEVEL 1 - NOC Operators
      // ========================================
      'NOC Operator - Ervine': {
        email: 'ervine.mbezele@gratoglobal.com',
        name: 'Mr. Ervine Mbezele',
        position: 'NOC Operator',
        reportsTo: 'rodrigue.nono@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'NOC Operator - Yves': {
        email: 'yossa.yves@gratoglobal.com',
        name: 'Mr. Yves Yossa',
        position: 'NOC Operator',
        reportsTo: 'rodrigue.nono@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'NOC Operator - Wilfried': {
        email: 'kamegni.wilfried@gratoglobal.com',
        name: 'Mr. Wilfried Kamegni',
        position: 'NOC Operator',
        reportsTo: 'rodrigue.nono@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'NOC Operator - Junior': {
        email: 'junior.mukudi@gratoglobal.com',
        name: 'Mr. Junior Mukudi',
        position: 'NOC Operator',
        reportsTo: 'rodrigue.nono@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },

      // ========================================
      // LEVEL 1 - Field Technicians (Joseph's Team)
      // ========================================
      'Field Technician - Boris': {
        email: 'jules.mouna@gratoglobal.com',
        name: 'Mr. Jules Mouna',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Boris': {
        email: 'kamgang.junior@gratoglobal.com',
        name: 'Mr. Boris Kamgang',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Sunday': {
        email: 'sunday@gratoglobal.com',
        name: 'Mr. Sunday',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Ulrich': {
        email: 'ulrich.vitrand@gratoglobal.com',
        name: 'Mr. Ulrich MOUMI',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Abeeb': {
        email: 'abeeb@gratoglobal.com',
        name: 'Mr. Abeeb',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Paul': {
        email: 'paul.nyomb@gratoglobal.com',
        name: 'Mr. Paul EM Nyomb',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Edidie': {
        email: 'edidie.francois@gratoglobal.com',
        name: 'Mr. EDIDIE François',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Berthin': {
        email: 'mba.berthin@gratoglobal.com',
        name: 'Mr. Berthin DEFFO',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Allassane': {
        email: 'allassane@gratoglobal.com',
        name: 'Mr. Allassane',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Alioum': {
        email: 'alioum.moussa@gratoglobal.com',
        name: 'Mr. Alioum Moussa',
        position: 'Field Technician',
        reportsTo: 'joseph.tayou@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },

      // ========================================
      // LEVEL 1 - Field Technicians (Felix's Team)
      // ========================================
      'Field Technician - Kenfack': {
        email: 'kenfack.jacques@gratoglobal.com',
        name: 'Mr. Kenfack Jacques',
        position: 'Field Technician',
        reportsTo: 'felix.tientcheu@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Djackba': {
        email: 'djackba.marcel@gratoglobal.com',
        name: 'Mr. Djackba Marcel',
        position: 'Field Technician',
        reportsTo: 'felix.tientcheu@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
      },
      'Field Technician - Danick': {
        email: 'rodrigue.nono@gratoglobal.com',
        name: 'Mr. Danick Djiyap',
        position: 'Field Technician',
        reportsTo: 'felix.tientcheu@gratoglobal.com',
        hierarchyLevel: 1,
        canSupervise: [],
        approvalAuthority: 'staff',
        allowMultipleInstances: false
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
        canSupervise: ['Warehouse Coordinator/Buyer'], // UPDATED - removed Order Management Assistant/Buyer
        approvalAuthority: 'coordinator',
        specialRole: 'buyer',
        buyerConfig: {
          specializations: ['IT_Accessories', 'Office_Supplies', 'Equipment', 'Consumables', 'Software', 'Hardware', 'Furniture', 'Safety_Equipment', 'Maintenance_Supplies', 'General'],
          maxOrderValue: 10000000,
          canSelfBuy: true
        }
      },
      'Fleet Coordinator': {
        email: 'flora.kidzeven@gratoglobal.com',
        name: 'Ms Flora Kidzeven',
        reportsTo: 'lukong.lambert@gratoglobal.com',
        hierarchyLevel: 3,
        canSupervise: ['Warehouse Coordinator/Buyer'], 
        approvalAuthority: 'coordinator',
        specialRole: 'employee',
        buyerConfig: {
          specializations: ['IT_Accessories', 'Office_Supplies', 'Equipment', 'Consumables', 'Software', 'Hardware', 'Furniture', 'Safety_Equipment', 'Maintenance_Supplies', 'General'],
          maxOrderValue: 10000000,
          canSelfBuy: true
        }
      },
      // UPDATED - Christabel now reports to Kelvin
      'Order Management Assistant/Buyer': {
        email: 'christabel@gratoengineering.com',
        name: 'Ms. Christabel Mangwi',
        reportsTo: 'kelvin.eyong@gratoglobal.com', // CHANGED from lukong.lambert@gratoglobal.com
        hierarchyLevel: 3, // UPDATED from 2 to 3 since reporting to CEO
        canSupervise: [],
        approvalAuthority: 'buyer',
        specialRole: 'buyer',
        buyerConfig: {
          specializations: ['Office_Supplies', 'Consumables', 'General'],
          maxOrderValue: 2000000
        }
      },
      'Warehouse Coordinator/Buyer': {
        email: 'pryde.mua@gratoglobal.com',
        name: 'Mr. Pryde Mua',
        reportsTo: 'lukong.lambert@gratoglobal.com',
        hierarchyLevel: 2,
        canSupervise: ['Warehouse Assistant'],
        approvalAuthority: 'coordinator',
        specialRole: 'buyer',
        buyerConfig: {
          specializations: ['Equipment', 'Hardware', 'Maintenance_Supplies'],
          maxOrderValue: 5000000
        }
      },
      'Warehouse Assistant': {
        email: 'marie.shurinani@gratoglobal.com',
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
      },
      'Fleet Coordinator': {
        email: 'flora.kidzeven@gratoglobal.com',
        name: 'Ms Flora Kidzeven',
        reportsTo: 'lukong.lambert@gratoglobal.com',
        hierarchyLevel: 3,
        canSupervise: [],
        approvalAuthority: 'staff'
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
      hierarchyLevel: 4,
      canApprove: true,            
      approvalAuthority: 'hr_head'
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

  // NEW DEPARTMENT - IT (since Marcel still belongs to IT but reports to Kelvin)
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
      // UPDATED - Marcel now reports to Kelvin
      'IT Staff': {
        email: 'marcel.ngong@gratoglobal.com',
        name: 'Marcel Ngong',
        reportsTo: 'kelvin.eyong@gratoglobal.com', 
        hierarchyLevel: 3, 
        canSupervise: [],
        approvalAuthority: 'staff'
      }
    }
  }
};

/**
 * Find person details by email across all departments
 */
const findPersonByEmail = (email) => {
  for (const [deptKey, dept] of Object.entries(DEPARTMENT_STRUCTURE)) {
    if (dept.head.email === email) {
      return {
        ...dept.head,
        department: deptKey,
        isDepartmentHead: true
      };
    }

    for (const [position, person] of Object.entries(dept.positions)) {
      if (person.email === email) {
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

/**
 * Get all supervisable positions for a person
 */
const getSupevisablePositions = (email) => {
  const person = findPersonByEmail(email);
  if (!person || !person.canSupervise) return [];

  return person.canSupervise.map(positionTitle => ({
    position: positionTitle,
    department: person.department
  }));
};

/**
 * Get complete approval chain for an employee
 */
const getApprovalChainFromStructure = (employeeEmail) => {
  const chain = [];
  let currentPerson = findPersonByEmail(employeeEmail);
  
  if (!currentPerson) {
    console.error(`Employee ${employeeEmail} not found in structure`);
    return [];
  }

  let level = 1;
  const seenEmails = new Set([employeeEmail]);

  // Traverse up the hierarchy
  while (currentPerson && currentPerson.reportsTo) {
    const supervisor = findPersonByEmail(currentPerson.reportsTo);
    
    if (!supervisor || seenEmails.has(supervisor.email)) break;

    chain.push({
      level: level++,
      approver: {
        name: supervisor.name,
        email: supervisor.email,
        role: supervisor.isDepartmentHead ? 'Department Head' : supervisor.position,
        department: supervisor.department
      },
      status: 'pending',
      assignedDate: new Date()
    });

    seenEmails.add(supervisor.email);
    currentPerson = supervisor;
  }

  return chain;
};

/**
 * Get all positions that can be created
 */
const getAllAvailablePositions = () => {
  const positions = [];

  for (const [deptKey, dept] of Object.entries(DEPARTMENT_STRUCTURE)) {
    // Department head
    positions.push({
      key: `${deptKey}-head`,
      department: deptKey,
      position: dept.head.position,
      name: dept.head.name,
      email: dept.head.email,
      reportsTo: dept.head.reportsTo,
      hierarchyLevel: dept.head.hierarchyLevel,
      isDepartmentHead: true,
      allowMultiple: false
    });

    // All positions
    for (const [posTitle, posData] of Object.entries(dept.positions)) {
      positions.push({
        key: `${deptKey}-${posTitle}`,
        department: deptKey,
        position: posData.position || posTitle,
        name: posData.name,
        email: posData.email,
        reportsTo: posData.reportsTo,
        hierarchyLevel: posData.hierarchyLevel,
        canSupervise: posData.canSupervise || [],
        approvalAuthority: posData.approvalAuthority,
        specialRole: posData.specialRole,
        buyerConfig: posData.buyerConfig,
        allowMultiple: posData.allowMultipleInstances || false,
        dynamicSupervisor: posData.dynamicSupervisor || false
      });
    }
  }

  return positions;
};

/**
 * Get potential supervisors for a position (for dynamic assignment)
 */
const getPotentialSupervisors = (department, position) => {
  const supervisors = [];
  const dept = DEPARTMENT_STRUCTURE[department];
  
  if (!dept) return supervisors;

  // Check all positions in department
  for (const [posTitle, posData] of Object.entries(dept.positions)) {
    if (posData.canSupervise && posData.canSupervise.includes(position)) {
      supervisors.push({
        email: posData.email,
        name: posData.name,
        position: posData.position || posTitle
      });
    }
  }

  return supervisors;
};

module.exports = {
  DEPARTMENT_STRUCTURE,
  findPersonByEmail,
  getSupevisablePositions,
  getApprovalChainFromStructure,
  getAllAvailablePositions,
  getPotentialSupervisors
};


