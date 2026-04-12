const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * WorkflowService - Generates dynamic approval workflows with smart deduplication
 */
class WorkflowService {
  
  /**
   * Generate approval workflow for a user based on their hierarchy
   * @param {ObjectId|String} requestorId - User making the request
   * @param {String} workflowType - Type of workflow ('general', 'purchase', 'leave', 'performance', 'budget')
   * @param {Object} options - Additional options (requireFinance, maxLevels, etc.)
   * @returns {Array} Deduplicated approval chain
   */
  static async generateApprovalWorkflow(requestorId, workflowType = 'general', options = {}) {
    try {
      const {
        requireFinance = false,  // Force finance approval
        maxLevels = 10,          // Maximum approval levels
        skipLevels = 0           // Skip first N levels (for escalations)
      } = options;

      const chain = [];
      const seenApprovers = new Map(); // email -> {user, capacities, level}
      let currentLevel = 1;

      // Step 1: Get requestor
      let currentUser = await User.findById(requestorId)
        .populate('supervisor')
        .populate('departmentHead')
        .lean();

      if (!currentUser) {
        throw new Error(`Requestor not found: ${requestorId}`);
      }

      const visited = new Set([currentUser._id.toString()]);

      // Step 2: Traverse supervisor chain
      while (currentUser.supervisor && currentLevel <= maxLevels) {
        const supervisorId = currentUser.supervisor._id || currentUser.supervisor;
        
        // Prevent infinite loops
        if (visited.has(supervisorId.toString())) {
          console.warn(`Circular reference detected for user ${currentUser.email}`);
          break;
        }

        const supervisor = await User.findById(supervisorId)
          .populate('supervisor')
          .lean();

        if (!supervisor || !supervisor.isActive) {
          console.warn(`Supervisor not found or inactive: ${supervisorId}`);
          break;
        }

        const email = supervisor.email;

        // Track this approver
        if (!seenApprovers.has(email)) {
          seenApprovers.set(email, {
            user: supervisor,
            capacities: [],
            level: currentLevel
          });
        }

        // Add capacity
        seenApprovers.get(email).capacities.push('direct_supervisor');

        visited.add(supervisorId.toString());
        currentUser = supervisor;
        currentLevel++;
      }

      // Step 3: Add department head (if different from supervisor chain)
      if (currentUser.departmentHead) {
        const deptHeadId = currentUser.departmentHead._id || currentUser.departmentHead;
        const deptHead = await User.findById(deptHeadId).lean();

        if (deptHead && deptHead.isActive) {
          const email = deptHead.email;

          if (!seenApprovers.has(email)) {
            seenApprovers.set(email, {
              user: deptHead,
              capacities: ['department_head'],
              level: currentLevel++
            });
          } else {
            // Already in chain - just add capacity
            seenApprovers.get(email).capacities.push('department_head');
          }
        }
      }

      // Step 4: Add workflow-specific approvers
      if (workflowType === 'purchase' || workflowType === 'budget' || requireFinance) {
        const financeOfficer = await User.findOne({
          email: 'ranibellmambo@gratoengineering.com',
          isActive: true
        }).lean();

        if (financeOfficer) {
          const email = financeOfficer.email;
          if (!seenApprovers.has(email)) {
            seenApprovers.set(email, {
              user: financeOfficer,
              capacities: ['finance_officer'],
              level: currentLevel++
            });
          } else {
            seenApprovers.get(email).capacities.push('finance_officer');
          }
        }
      }

      // Step 5: Build final chain with deduplication
      for (const [email, data] of seenApprovers) {
        if (data.level <= skipLevels) continue; // Skip if requested

        const primaryCapacity = this.getPrimaryCapacity(data.capacities);

        chain.push({
          level: data.level - skipLevels,
          approver: {
            id: data.user._id,
            name: data.user.fullName,
            email: data.user.email,
            position: data.user.position,
            department: data.user.department
          },
          approvalCapacity: primaryCapacity,
          allCapacities: data.capacities,
          status: 'pending',
          assignedDate: new Date(),
          metadata: {
            hierarchyLevel: data.user.hierarchyLevel,
            approvalAuthority: data.user.approvalCapacities || []
          }
        });
      }

      // Sort by level
      chain.sort((a, b) => a.level - b.level);

      // Renumber levels after sorting
      chain.forEach((step, index) => {
        step.level = index + 1;
      });

      return chain;

    } catch (error) {
      console.error('Generate approval workflow error:', error);
      throw error;
    }
  }

  /**
   * Determine primary approval capacity when person has multiple roles
   * Priority: direct_supervisor > department_head > business_head > finance_officer
   */
  static getPrimaryCapacity(capacities) {
    const priority = [
      'direct_supervisor',
      'department_head',
      'technical_director',
      'business_head',
      'finance_officer',
      'hse_coordinator',
      'project_manager',
      'supply_chain_coordinator',
      'operations_manager'
    ];

    for (const cap of priority) {
      if (capacities.includes(cap)) return cap;
    }

    return capacities[0] || 'direct_supervisor';
  }

  /**
   * Preview workflow before submission
   */
  static async previewWorkflow(requestorId, workflowType = 'general', options = {}) {
    const chain = await this.generateApprovalWorkflow(requestorId, workflowType, options);

    return {
      totalSteps: chain.length,
      estimatedTime: this.estimateWorkflowTime(chain),
      steps: chain.map(step => ({
        level: step.level,
        approver: step.approver.name,
        position: step.approver.position,
        capacity: step.approvalCapacity,
        allRoles: step.allCapacities
      }))
    };
  }

  /**
   * Estimate workflow completion time based on chain length
   */
  static estimateWorkflowTime(chain) {
    const avgTimePerLevel = 24; // hours
    const totalHours = chain.length * avgTimePerLevel;
    const businessDays = Math.ceil(totalHours / 8);

    return {
      hours: totalHours,
      businessDays: businessDays,
      displayText: `${businessDays}-${businessDays + 2} business days`
    };
  }

  /**
   * Validate if user can approve at specific step
   */
  static async canUserApproveStep(userId, step) {
    const user = await User.findById(userId);
    if (!user || !user.isActive) return false;

    // Check if user is the designated approver
    if (user._id.toString() === step.approver.id.toString()) {
      return true;
    }

    // Check if user can act in the required capacity
    if (user.approvalCapacities.includes(step.approvalCapacity)) {
      return true;
    }

    return false;
  }

  /**
   * Get next pending approver in chain
   */
  static getNextPendingApprover(approvalChain) {
    return approvalChain.find(step => step.status === 'pending');
  }

  /**
   * Check if workflow is complete
   */
  static isWorkflowComplete(approvalChain) {
    return approvalChain.every(step => 
      step.status === 'approved' || step.status === 'skipped'
    );
  }

  /**
   * Check if workflow is rejected
   */
  static isWorkflowRejected(approvalChain) {
    return approvalChain.some(step => step.status === 'rejected');
  }

  /**
   * Get workflow status summary
   */
  static getWorkflowStatus(approvalChain) {
    const total = approvalChain.length;
    const approved = approvalChain.filter(s => s.status === 'approved').length;
    const pending = approvalChain.filter(s => s.status === 'pending').length;
    const rejected = approvalChain.filter(s => s.status === 'rejected').length;

    let status = 'in_progress';
    if (rejected > 0) status = 'rejected';
    else if (approved === total) status = 'approved';
    else if (pending === total) status = 'pending';

    return {
      status,
      progress: Math.round((approved / total) * 100),
      approved,
      pending,
      rejected,
      total,
      currentLevel: approved + 1
    };
  }

  /**
   * Advance workflow to next step after approval
   */
  static async advanceWorkflow(approvalChain, approverId, decision, comments = '') {
    const currentStep = this.getNextPendingApprover(approvalChain);
    
    if (!currentStep) {
      throw new Error('No pending approvals in workflow');
    }

    // Verify approver
    const canApprove = await this.canUserApproveStep(approverId, currentStep);
    if (!canApprove) {
      throw new Error('User not authorized to approve this step');
    }

    // Update step
    currentStep.status = decision; // 'approved' or 'rejected'
    currentStep.actionDate = new Date();
    currentStep.actionBy = approverId;
    currentStep.comments = comments;

    return {
      updated: true,
      step: currentStep,
      workflowStatus: this.getWorkflowStatus(approvalChain),
      isComplete: this.isWorkflowComplete(approvalChain),
      isRejected: this.isWorkflowRejected(approvalChain)
    };
  }
}

module.exports = WorkflowService;