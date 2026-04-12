const mongoose = require('mongoose');
const User = require('../models/User');
const { DEPARTMENT_STRUCTURE } = require('../config/departmentStructure');

/**
 * HierarchyService - Manages employee organizational structure
 */
class HierarchyService {

  /**
   * Calculate and update hierarchy path for a user
   * @param {ObjectId|String} userId 
   */
  static async calculateHierarchyPath(userId) {
    try {
      const path = [];
      const visited = new Set();
      let currentUser = await User.findById(userId).populate('supervisor');

      if (!currentUser) {
        throw new Error(`User not found: ${userId}`);
      }

      // Add self
      path.push(currentUser._id.toString());
      visited.add(currentUser._id.toString());

      // Traverse up
      while (currentUser.supervisor) {
        const supervisorId = currentUser.supervisor._id || currentUser.supervisor;
        const supervisorIdStr = supervisorId.toString();

        // Prevent loops
        if (visited.has(supervisorIdStr)) {
          console.error(`Circular reference detected for user ${userId}`);
          break;
        }

        path.push(supervisorIdStr);
        visited.add(supervisorIdStr);

        currentUser = await User.findById(supervisorId).populate('supervisor');
        if (!currentUser) break;
      }

      // Update user
      await User.findByIdAndUpdate(userId, {
        hierarchyPath: path,
        lastHierarchyUpdate: new Date()
      });

      return path;

    } catch (error) {
      console.error('Calculate hierarchy path error:', error);
      throw error;
    }
  }

  /**
   * Recalculate hierarchy paths for all subordinates
   */
  static async recalculateSubordinatePaths(supervisorId) {
    try {
      const supervisor = await User.findById(supervisorId).populate('directReports');
      if (!supervisor) return;

      for (const report of supervisor.directReports) {
        await this.calculateHierarchyPath(report._id);
        // Recursively update their subordinates
        await this.recalculateSubordinatePaths(report._id);
      }

    } catch (error) {
      console.error('Recalculate subordinate paths error:', error);
      throw error;
    }
  }

  /**
   * Update user's supervisor with full validation
   */
  static async updateSupervisor(userId, newSupervisorId, updatedBy) {
    try {
      // Validate inputs
      if (!userId || !newSupervisorId) {
        throw new Error('User ID and Supervisor ID are required');
      }

      // Prevent self-supervision
      if (userId.toString() === newSupervisorId.toString()) {
        throw new Error('User cannot supervise themselves');
      }

      // Get user and new supervisor
      const user = await User.findById(userId);
      const newSupervisor = await User.findById(newSupervisorId);

      if (!user) throw new Error('User not found');
      if (!newSupervisor) throw new Error('New supervisor not found');
      if (!newSupervisor.isActive) throw new Error('New supervisor is not active');

      // Check for circular reference
      if (newSupervisor.hierarchyPath.includes(userId.toString())) {
        throw new Error('This would create a circular reporting structure');
      }

      const oldSupervisorId = user.supervisor;

      // Update user's supervisor
      user.supervisor = newSupervisorId;
      user.lastHierarchyUpdate = new Date();
      user.hierarchyUpdatedBy = updatedBy;
      await user.save();

      // Remove from old supervisor's directReports
      if (oldSupervisorId) {
        await User.findByIdAndUpdate(oldSupervisorId, {
          $pull: { directReports: userId }
        });
      }

      // Add to new supervisor's directReports
      await User.findByIdAndUpdate(newSupervisorId, {
        $addToSet: { directReports: userId }
      });

      // Recalculate hierarchy paths
      await this.calculateHierarchyPath(userId);
      await this.recalculateSubordinatePaths(userId);

      return {
        success: true,
        oldSupervisor: oldSupervisorId,
        newSupervisor: newSupervisorId,
        hierarchyPath: user.hierarchyPath
      };

    } catch (error) {
      console.error('Update supervisor error:', error);
      throw error;
    }
  }

  /**
   * Determine approval capacities based on position
   */
  static determineApprovalCapacities(position, department, isHead = false) {
    const capacities = [];

    // Business Head (Kelvin)
    if (position === 'President / Head of Business') {
      capacities.push('business_head', 'direct_supervisor');
      return capacities;
    }

    // Department Heads
    if (isHead || position.includes('Director') || position.includes('Head')) {
      capacities.push('department_head', 'direct_supervisor');
    }

    // Coordinators
    if (position.includes('Coordinator')) {
      capacities.push('direct_supervisor');
      
      if (position.includes('HSE')) capacities.push('hse_coordinator');
      if (position.includes('Supply Chain')) capacities.push('supply_chain_coordinator');
    }

    // Managers
    if (position.includes('Manager')) {
      capacities.push('direct_supervisor');
      
      if (position.includes('Project')) capacities.push('project_manager');
      if (position.includes('Operations')) capacities.push('operations_manager');
    }

    // Finance
    if (position === 'Finance Officer') {
      capacities.push('finance_officer');
    }

    // Technical Director
    if (position === 'Technical Director') {
      capacities.push('technical_director', 'department_head', 'direct_supervisor');
    }

    return capacities;
  }

  /**
   * Determine user role based on position and structure
   */
  static determineUserRole(position, department, positionData) {
    // Admin role
    if (position === 'President / Head of Business') {
      return 'admin';
    }

    // Finance role
    if (position === 'Finance Officer') {
      return 'finance';
    }

    // Buyer role
    if (positionData?.specialRole === 'buyer') {
      return 'buyer';
    }

    // Department-specific roles
    if (department === 'HR & Admin') return 'hr';
    if (department === 'Business Development & Supply Chain') return 'supply_chain';
    if (department === 'Technical') return 'technical';

    // Default
    return 'employee';
  }

  /**
   * Validate position exists in department structure
   */
  static validatePosition(department, position) {
    const dept = DEPARTMENT_STRUCTURE[department];
    if (!dept) {
      throw new Error(`Department "${department}" not found in structure`);
    }

    // Check if it's the head position
    if (dept.head.position === position) {
      return {
        exists: true,
        data: dept.head,
        isHead: true
      };
    }

    // Check regular positions
    const positionData = dept.positions[position];
    if (!positionData) {
      throw new Error(`Position "${position}" not found in department "${department}"`);
    }

    return {
      exists: true,
      data: positionData,
      isHead: false
    };
  }

  /**
   * Get department head
   */
  static async getDepartmentHead(department) {
    const dept = DEPARTMENT_STRUCTURE[department];
    if (!dept) return null;

    const headEmail = dept.head.email;
    return await User.findOne({ email: headEmail, isActive: true });
  }

  /**
   * Find supervisor from structure
   */
  static async findSupervisorFromStructure(department, position) {
    const validation = this.validatePosition(department, position);
    const reportsToEmail = validation.data.reportsTo;

    if (!reportsToEmail) return null;

    return await User.findOne({ 
      email: reportsToEmail, 
      isActive: true 
    });
  }

  /**
   * Get all available positions for user creation
   */
  static getAvailablePositions() {
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
          position: posTitle,
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
  }

  /**
   * Check if position is already filled
   */
  static async isPositionFilled(department, position) {
    const validation = this.validatePosition(department, position);
    
    if (validation.data.allowMultipleInstances) {
      return { filled: false, canCreate: true };
    }

    if (!validation.data.email) {
      return { filled: false, canCreate: true };
    }

    const existing = await User.findOne({
      email: validation.data.email,
      isActive: true
    });

    return {
      filled: !!existing,
      canCreate: !existing,
      existingUser: existing
    };
  }

  /**
   * Get potential supervisors for dynamic positions
   */
  static async getPotentialSupervisors(department, position) {
    const validation = this.validatePosition(department, position);
    
    if (!validation.data.dynamicSupervisor) {
      return [];
    }

    // Get users who can supervise this position
    const dept = DEPARTMENT_STRUCTURE[department];
    const supervisors = [];

    for (const [posTitle, posData] of Object.entries(dept.positions)) {
      if (posData.canSupervise && posData.canSupervise.includes(position)) {
        const users = await User.find({
          department,
          position: posTitle,
          isActive: true
        }).select('fullName email position directReports');

        supervisors.push(...users);
      }
    }

    return supervisors;
  }

  /**
   * Validate hierarchy consistency
   */
  static async validateHierarchy(userId) {
    const user = await User.findById(userId).populate('supervisor directReports');
    if (!user) return { valid: false, errors: ['User not found'] };

    const errors = [];

    // Check circular references
    if (user.hierarchyPath.includes(userId.toString())) {
      errors.push('Circular reference in hierarchy path');
    }

    // Check supervisor exists
    if (user.supervisor) {
      const supervisor = await User.findById(user.supervisor);
      if (!supervisor || !supervisor.isActive) {
        errors.push('Supervisor not found or inactive');
      }
    }

    // Check direct reports
    for (const reportId of user.directReports) {
      const report = await User.findById(reportId);
      if (report && report.supervisor?.toString() !== userId.toString()) {
        errors.push(`Direct report ${report.fullName} has mismatched supervisor`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = HierarchyService;