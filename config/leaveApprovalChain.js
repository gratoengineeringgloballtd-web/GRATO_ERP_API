const { DEPARTMENT_STRUCTURE } = require('./departmentStructure');

/**
 * Get Leave Approval Chain with STRICT 4-level hierarchy:
 * Level 1: Immediate Supervisor
 * Level 2: Department Head
 * Level 3: Head of Business (President)
 * Level 4: HR Department (ALWAYS LAST - FINAL APPROVER)
 */
const getLeaveApprovalChain = (employeeName, department) => {
  const chain = [];
  const seenEmails = new Set();
  
  console.log(`\n=== BUILDING LEAVE APPROVAL CHAIN ===`);
  console.log(`Employee: ${employeeName}`);
  console.log(`Department: ${department}`);

  // Find employee
  let employeeData = null;
  let employeeDepartmentName = department;

  if (DEPARTMENT_STRUCTURE[department] && DEPARTMENT_STRUCTURE[department].head.name === employeeName) {
    employeeData = {
      name: employeeName,
      email: DEPARTMENT_STRUCTURE[department].head.email,
      position: 'Department Head',
      supervisor: 'President',
      department: department
    };
    console.log('✓ Employee is Department Head');
  } else {
    for (const [deptKey, deptData] of Object.entries(DEPARTMENT_STRUCTURE)) {
      if (deptData.head.name === employeeName) {
        employeeData = {
          name: employeeName,
          email: deptData.head.email,
          position: 'Department Head',
          supervisor: 'President',
          department: deptKey
        };
        employeeDepartmentName = deptKey;
        console.log(`✓ Employee is Department Head of ${deptKey}`);
        break;
      }

      if (deptData.positions) {
        for (const [pos, data] of Object.entries(deptData.positions)) {
          if (data.name === employeeName) {
            employeeData = { 
              name: data.name,
              email: data.email,
              position: pos,
              reportsTo: data.reportsTo,
              department: deptKey
            };
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
    return getFallbackLeaveApprovalChain(department);
  }

  // Helper to add unique approver - FIXED to ensure strings only
  const addApprover = (approverData, role) => {
    // Ensure we extract string values, not objects
    const approverName = typeof approverData.name === 'string' 
      ? approverData.name 
      : approverData.name?.name || 'Unknown';
    
    const approverEmail = typeof approverData.email === 'string'
      ? approverData.email
      : approverData.email?.email || '';

    if (!approverEmail || seenEmails.has(approverEmail)) {
      console.log(`⊘ Skip duplicate or invalid: ${approverName} (${approverEmail})`);
      return false;
    }

    const level = chain.length + 1;
    chain.push({
      level,
      approver: {
        name: approverName,  // Now guaranteed to be a string
        email: approverEmail,  // Now guaranteed to be a string
        role,
        department: approverData.department || employeeDepartmentName
      },
      status: 'pending',
      assignedDate: new Date()
    });

    seenEmails.add(approverEmail);
    console.log(`✓ Level ${level}: ${approverName} (${role}) - ${approverEmail}`);
    return true;
  };

  // LEVEL 1: Immediate Supervisor (if not department head)
  if (employeeData.position !== 'Department Head') {
    const supervisor = findSupervisor(employeeData, employeeDepartmentName);
    if (supervisor) {
      addApprover(supervisor, 'Supervisor');
    }
  }

  // LEVEL 2: Department Head
  const deptHead = DEPARTMENT_STRUCTURE[employeeDepartmentName];
  if (deptHead && employeeData.name !== deptHead.head.name) {
    addApprover({
      name: deptHead.head.name,
      email: deptHead.head.email,
      department: employeeDepartmentName
    }, 'Departmental Head');
  }

  // LEVEL 3: Head of Business / President
  const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  if (executive && employeeData.name !== executive.head.name) {
    addApprover({
      name: executive.head.name,
      email: executive.head.email,
      department: 'Business Development & Supply Chain'
    }, 'Head of Business');
  }

  // LEVEL 4: HR Department (ALWAYS LAST - FINAL APPROVER)
  const hrDepartment = DEPARTMENT_STRUCTURE['HR & Admin'];
  if (hrDepartment) {
    if (!seenEmails.has(hrDepartment.head.email)) {
      const finalLevel = chain.length + 1;
      chain.push({
        level: finalLevel,
        approver: {
          name: hrDepartment.head.name,  // Direct string access
          email: hrDepartment.head.email,  // Direct string access
          role: 'HR - Final Approval & Compliance',
          department: 'HR & Admin'
        },
        status: 'pending',
        assignedDate: new Date()
      });
      seenEmails.add(hrDepartment.head.email);
      console.log(`✓ Level ${finalLevel}: HR Department (Final Approval) - ${hrDepartment.head.email}`);
    }
  }

  // Ensure sequential levels
  chain.forEach((step, index) => {
    step.level = index + 1;
  });

  const finalChain = chain.map(s => `L${s.level}: ${s.approver.name} (${s.approver.role})`).join(' → ');
  console.log(`\n✅ Final Chain (${chain.length} levels): ${finalChain}`);
  console.log('=== END APPROVAL CHAIN ===\n');

  return chain;
};

const findSupervisor = (employeeData, departmentName) => {
  if (!employeeData.reportsTo) return null;

  const department = DEPARTMENT_STRUCTURE[departmentName];
  if (!department) return null;

  // Check in positions
  if (department.positions) {
    for (const [pos, data] of Object.entries(department.positions)) {
      if (data.email === employeeData.reportsTo) {
        return {
          name: data.name,
          email: data.email,
          position: pos,
          department: departmentName
        };
      }
    }
  }

  // Check if supervisor is department head
  if (department.head.email === employeeData.reportsTo) {
    return {
      name: department.head.name,
      email: department.head.email,
      position: 'Department Head',
      department: departmentName
    };
  }

  return null;
};

const getFallbackLeaveApprovalChain = (department) => {
  const chain = [];
  const seenEmails = new Set();
  let level = 1;

  // Department Head
  if (DEPARTMENT_STRUCTURE[department]) {
    const email = DEPARTMENT_STRUCTURE[department].head.email;
    if (!seenEmails.has(email)) {
      chain.push({
        level: level++,
        approver: {
          name: DEPARTMENT_STRUCTURE[department].head.name,
          email,
          role: 'Departmental Head',
          department
        },
        status: 'pending',
        assignedDate: new Date()
      });
      seenEmails.add(email);
    }
  }

  // President
  const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
  if (executive && !seenEmails.has(executive.head.email)) {
    chain.push({
      level: level++,
      approver: {
        name: executive.head.name,
        email: executive.head.email,
        role: 'Head of Business',
        department: 'Business Development & Supply Chain'
      },
      status: 'pending',
      assignedDate: new Date()
    });
    seenEmails.add(executive.head.email);
  }

  // HR (ALWAYS LAST)
  const hrDepartment = DEPARTMENT_STRUCTURE['HR & Admin'];
  if (hrDepartment && !seenEmails.has(hrDepartment.head.email)) {
    chain.push({
      level: level++,
      approver: {
        name: hrDepartment.head.name,
        email: hrDepartment.head.email,
        role: 'HR - Final Approval & Compliance',
        department: 'HR & Admin'
      },
      status: 'pending',
      assignedDate: new Date()
    });
  }

  return chain;
};

const getNextLeaveStatus = (currentLevel, totalLevels) => {
  if (currentLevel === totalLevels) {
    return 'approved';
  }
  
  const nextLevel = currentLevel + 1;
  
  const statusMap = {
    1: 'pending_supervisor',
    2: 'pending_departmental_head',
    3: 'pending_head_of_business',
    4: 'pending_hr_approval'
  };
  
  return statusMap[nextLevel] || 'pending_hr_approval';
};

const getUserLeaveApprovalLevel = (userRole, userEmail) => {
  if (userRole === 'hr') return 4;
  
  if (userRole === 'admin') {
    const executive = DEPARTMENT_STRUCTURE['Business Development & Supply Chain'];
    if (executive && executive.head.email === userEmail) {
      return 3;
    }
    return 2;
  }
  
  if (userRole === 'supervisor') return 1;
  
  return 0;
};

const canUserApproveLeave = (user, approvalStep) => {
  if (!user || !approvalStep) return false;
  if (user.email !== approvalStep.approver.email) return false;
  
  const userApprovalLevel = getUserLeaveApprovalLevel(user.role, user.email);
  
  const stepLevelMap = {
    'Supervisor': 1,
    'Departmental Head': 2,
    'Head of Business': 3,
    'HR - Final Approval & Compliance': 4
  };
  
  const requiredLevel = stepLevelMap[approvalStep.approver.role];
  
  if (user.role === 'admin') {
    return requiredLevel === 2 || requiredLevel === 3;
  }
  
  if (user.role === 'hr') {
    return requiredLevel === 4;
  }
  
  return userApprovalLevel === requiredLevel;
};

module.exports = {
  getLeaveApprovalChain,
  getNextLeaveStatus,
  getUserLeaveApprovalLevel,
  canUserApproveLeave,
  findSupervisor,
  getFallbackLeaveApprovalChain
};