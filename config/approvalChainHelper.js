const User = require('../models/User');
const Project = require('../models/Project');
const { findPersonByEmail } = require('./departmentStructure');

/**
 * Build three-level approval chain for an assignee
 * @param {ObjectId} assigneeUserId - The employee assigned to the task
 * @param {ObjectId} creatorUserId - The person who created the task
 * @param {ObjectId} projectId - Optional project ID for context
 * @returns {Array} Approval chain with 3 levels (may have skipped levels)
 */
const buildApprovalChain = async (assigneeUserId, creatorUserId, projectId = null) => {
  console.log('=== BUILDING APPROVAL CHAIN ===');
  
  const assignee = await User.findById(assigneeUserId);
  const creator = await User.findById(creatorUserId);
  let finalApprover = creator;

  if (projectId) {
    const project = await Project.findById(projectId).select('createdBy projectManager');
    if (project?.createdBy) {
      const projectCreator = await User.findById(project.createdBy);
      if (projectCreator) {
        finalApprover = projectCreator;
      }
    } else if (project?.projectManager) {
      const projectManager = await User.findById(project.projectManager);
      if (projectManager) {
        finalApprover = projectManager;
      }
    }
  }
  
  if (!assignee) {
    throw new Error('Assignee not found');
  }
  
  const chain = [];
  
  // LEVEL 1: Immediate Supervisor
  const immediateSupervisor = getImmediateSupervisor(assignee.email);
  
  if (immediateSupervisor) {
    const supervisor = await User.findOne({ email: immediateSupervisor.email });
    
    chain.push({
      level: 1,
      approver: {
        userId: supervisor ? supervisor._id : null,
        name: immediateSupervisor.name,
        email: immediateSupervisor.email,
        role: 'immediate_supervisor'
      },
      status: 'pending',
      grade: null,
      comments: null,
      reviewedAt: null
    });
    
    console.log(`L1: ${immediateSupervisor.name} (${immediateSupervisor.email})`);
    
    // LEVEL 2: Supervisor's Supervisor
    const supervisorsSupervisor = getImmediateSupervisor(immediateSupervisor.email);
    
    if (supervisorsSupervisor) {
      // Check if supervisor's supervisor is same as final approver
      const isSameAsCreator = finalApprover && supervisorsSupervisor.email === finalApprover.email;
      
      if (isSameAsCreator) {
        console.log('L2: Skipped (same as creator)');
        chain.push({
          level: 2,
          approver: {
            userId: finalApprover._id,
            name: supervisorsSupervisor.name,
            email: supervisorsSupervisor.email,
            role: 'supervisor_supervisor'
          },
          status: 'skipped',
          comments: 'Same as final approver - skipped to Level 3',
          reviewedAt: null
        });
      } else {
        const supervisor2 = await User.findOne({ email: supervisorsSupervisor.email });
        
        chain.push({
          level: 2,
          approver: {
            userId: supervisor2 ? supervisor2._id : null,
            name: supervisorsSupervisor.name,
            email: supervisorsSupervisor.email,
            role: 'supervisor_supervisor'
          },
          status: 'pending',
          comments: null,
          reviewedAt: null
        });
        
        console.log(`L2: ${supervisorsSupervisor.name} (${supervisorsSupervisor.email})`);
      }
    } else {
      console.log('L2: No supervisor\'s supervisor found - skipped');
      chain.push({
        level: 2,
        approver: {
          userId: null,
          name: 'N/A',
          email: null,
          role: 'supervisor_supervisor'
        },
        status: 'skipped',
        comments: 'No supervisor\'s supervisor in hierarchy',
        reviewedAt: null
      });
    }
  } else {
    console.log('L1: No immediate supervisor found (top-level employee)');
    // For top-level employees like Kelvin - skip L1 and L2
    chain.push({
      level: 1,
      approver: {
        userId: null,
        name: 'N/A',
        email: null,
        role: 'immediate_supervisor'
      },
      status: 'skipped',
      comments: 'Top-level employee - no supervisor to grade',
      reviewedAt: null
    });
    
    chain.push({
      level: 2,
      approver: {
        userId: null,
        name: 'N/A',
        email: null,
        role: 'supervisor_supervisor'
      },
      status: 'skipped',
      comments: 'Top-level employee - no supervisor hierarchy',
      reviewedAt: null
    });
  }
  
  // LEVEL 3: Project Creator / Task Creator
  if (finalApprover) {
    // Check if creator is same as L1 or L2
    const isSameAsL1 = chain[0] && chain[0].approver.email === finalApprover.email;
    const isSameAsL2 = chain[1] && chain[1].approver.email === finalApprover.email;
    
    if (isSameAsL1 || isSameAsL2) {
      console.log('L3: Skipped (same as L1 or L2)');
      chain.push({
        level: 3,
        approver: {
          userId: finalApprover._id,
          name: finalApprover.fullName,
          email: finalApprover.email,
          role: 'project_creator'
        },
        status: 'skipped',
        comments: 'Final approver is also supervisor - approval consolidated',
        reviewedAt: null
      });
    } else {
      chain.push({
        level: 3,
        approver: {
          userId: finalApprover._id,
          name: finalApprover.fullName,
          email: finalApprover.email,
          role: 'project_creator'
        },
        status: 'pending',
        comments: null,
        reviewedAt: null
      });
      
      console.log(`L3: ${finalApprover.fullName} (${finalApprover.email})`);
    }
  } else {
    console.log('L3: No creator found');
    chain.push({
      level: 3,
      approver: {
        userId: null,
        name: 'N/A',
        email: null,
        role: 'project_creator'
      },
      status: 'skipped',
      comments: 'No project creator assigned',
      reviewedAt: null
    });
  }
  
  console.log('=== APPROVAL CHAIN BUILT ===');
  return chain;
};

/**
 * Get immediate supervisor for an employee
 * @param {string} employeeEmail
 * @returns {Object|null} Supervisor details
 */
const getImmediateSupervisor = (employeeEmail) => {
  const employee = findPersonByEmail(employeeEmail);
  
  if (!employee || !employee.reportsTo) {
    return null;
  }
  
  const supervisor = findPersonByEmail(employee.reportsTo);
  
  if (!supervisor) {
    return null;
  }
  
  return {
    name: supervisor.name,
    email: supervisor.email,
    position: supervisor.position || supervisor.department + ' Head',
    department: supervisor.department
  };
};

/**
 * Get next pending approver in chain
 * @param {Array} approvalChain
 * @returns {Object|null} Next approver or null if all done
 */
const getNextPendingApprover = (approvalChain) => {
  if (!approvalChain || approvalChain.length === 0) {
    return null;
  }
  
  for (const approval of approvalChain) {
    if (approval.status === 'pending') {
      return approval;
    }
  }
  
  return null;
};

/**
 * Check if all approvals are complete
 * @param {Array} approvalChain
 * @returns {boolean}
 */
const isApprovalChainComplete = (approvalChain) => {
  if (!approvalChain || approvalChain.length === 0) {
    return false;
  }
  
  return approvalChain.every(approval => 
    approval.status === 'approved' || approval.status === 'skipped'
  );
};

/**
 * Check if user can approve at specific level
 * @param {ObjectId} userId
 * @param {Array} approvalChain
 * @param {Number} level
 * @returns {boolean}
 */
const canUserApproveAtLevel = (userId, approvalChain, level) => {
  const approval = approvalChain.find(a => a.level === level);
  
  if (!approval) return false;
  if (approval.status !== 'pending') return false;
  if (!approval.approver.userId) return false;
  
  return approval.approver.userId.equals(userId);
};

/**
 * Get approval status summary
 * @param {Array} approvalChain
 * @returns {Object} Summary of approval progress
 */
const getApprovalChainSummary = (approvalChain) => {
  const total = approvalChain.length;
  const approved = approvalChain.filter(a => a.status === 'approved').length;
  const skipped = approvalChain.filter(a => a.status === 'skipped').length;
  const pending = approvalChain.filter(a => a.status === 'pending').length;
  const rejected = approvalChain.filter(a => a.status === 'rejected').length;
  
  const effectiveTotal = total - skipped;
  const progress = effectiveTotal > 0 ? Math.round((approved / effectiveTotal) * 100) : 0;
  
  return {
    total,
    approved,
    skipped,
    pending,
    rejected,
    effectiveTotal,
    progress,
    isComplete: pending === 0 && rejected === 0,
    currentLevel: approvalChain.find(a => a.status === 'pending')?.level || null
  };
};

module.exports = {
  buildApprovalChain,
  getImmediateSupervisor,
  getNextPendingApprover,
  isApprovalChainComplete,
  canUserApproveAtLevel,
  getApprovalChainSummary
};