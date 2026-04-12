
const { findPersonByEmail, DEPARTMENT_STRUCTURE } = require('./departmentStructure');

/**
 * Get immediate supervisor for an employee by EMAIL
 * @param {string} employeeEmail - Employee's email address
 * @param {string} department - Employee's department
 * @returns {Object|null} Supervisor details or null
 */
const getTaskSupervisor = (employeeEmail, department) => {
  console.log('=== FINDING IMMEDIATE SUPERVISOR ===');
  console.log('Employee:', employeeEmail);
  console.log('Department:', department);

  // Find employee in department structure using EMAIL
  const employee = findPersonByEmail(employeeEmail);
  
  if (!employee) {
    console.log(`⚠ Employee "${employeeEmail}" not found in department structure`);
    
    // Fallback: Use department head as supervisor
    const dept = DEPARTMENT_STRUCTURE[department];
    if (dept && dept.head) {
      console.log('Using department head as default supervisor:', dept.head.name);
      
      // ✅ FIX: Return properly structured object with individual string fields
      return {
        name: String(dept.head.name).trim(),
        email: String(dept.head.email).trim().toLowerCase(),
        position: String(dept.head.position || 'Department Head').trim(),
        department: String(department).trim(),
        hierarchyLevel: dept.head.hierarchyLevel || 4
      };
    }
    
    console.error('❌ Department head not found for:', department);
    return null;
  }

  console.log(`✓ Employee found: ${employee.name} (${employee.position || 'Staff'})`);

  // Find the employee's immediate supervisor
  if (!employee.reportsTo) {
    console.log('⚠ Employee has no reportsTo field - likely a department head');
    return null;
  }

  const supervisor = findPersonByEmail(employee.reportsTo);
  
  if (!supervisor) {
    console.error(`❌ Supervisor not found for email: ${employee.reportsTo}`);
    return null;
  }

  console.log(`✓ Immediate supervisor: ${supervisor.name} (${supervisor.position || supervisor.department + ' Head'})`);

  // ✅ FIX: Return properly structured object with individual string fields
  return {
    name: String(supervisor.name).trim(),
    email: String(supervisor.email).trim().toLowerCase(),
    position: String(supervisor.position || supervisor.department + ' Head').trim(),
    department: String(supervisor.department).trim(),
    hierarchyLevel: supervisor.hierarchyLevel || 3
  };
};


module.exports = {
  getTaskSupervisor
};


