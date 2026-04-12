// server/controllers/projectPlanController.js

const ProjectPlan = require('../models/ProjectPlan');
const User = require('../models/User');
const mongoose = require('mongoose');
const {
  getProjectPlanApprovalChain,
  getProjectCoordinator,
  getHeadOfBusiness,
  canApproveProjectPlan,
  getCurrentApprover,
  updateApprovalStatus,
  isFullyApproved,
  getNextApprover
} = require('../config/projectPlanApprovalChain');
const accountingService = require('../services/accountingService');

// Get user's project plans
exports.getMyProjectPlans = async (req, res) => {
  try {
    const userId = req.user.id;

    const projectPlans = await ProjectPlan.find({ createdBy: userId })
      .populate('createdBy', 'fullName email department')
      .populate('rejectedBy', 'fullName email')
      .populate('approvalChain.approvedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: projectPlans
    });
  } catch (error) {
    console.error('Error fetching project plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project plans',
      error: error.message
    });
  }
};

// Get all project plans (for approvers/admin)
exports.getAllProjectPlans = async (req, res) => {
  try {
    const { status, department, approvalLevel } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (department) filter.department = department;

    const projectPlans = await ProjectPlan.find(filter)
      .populate('createdBy', 'fullName email department')
      .populate('rejectedBy', 'fullName email')
      .populate('approvalChain.approvedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: projectPlans
    });
  } catch (error) {
    console.error('Error fetching all project plans:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project plans',
      error: error.message
    });
  }
};

// Get pending approvals for current user
exports.getMyPendingApprovals = async (req, res) => {
  try {
    const userEmail = req.user.email;

    const pendingPlans = await ProjectPlan.find({
      'approvalChain.email': userEmail,
      'approvalChain.status': 'pending'
    })
      .populate('createdBy', 'fullName email department')
      .populate('approvalChain.approvedBy', 'fullName email')
      .sort({ submittedDate: 1 });

    // Filter to only include plans where current user is the active approver
    const myPendingPlans = pendingPlans.filter(plan => {
      const currentApprover = plan.getCurrentApprover();
      return currentApprover && currentApprover.email === userEmail;
    });

    res.json({
      success: true,
      data: myPendingPlans,
      count: myPendingPlans.length
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending approvals',
      error: error.message
    });
  }
};

// Create new project plan
exports.createProjectPlan = async (req, res) => {
  try {
    const userId = req.user.id;
    const planData = {
      ...req.body,
      createdBy: userId,
      status: 'Draft'
    };

    const projectPlan = new ProjectPlan(planData);
    
    // Add initial status history
    projectPlan.addStatusHistory('Draft', userId, 'Project plan created');
    
    await projectPlan.save();

    const populatedPlan = await ProjectPlan.findById(projectPlan._id)
      .populate('createdBy', 'fullName email');

    res.status(201).json({
      success: true,
      message: 'Project plan created successfully',
      data: populatedPlan
    });
  } catch (error) {
    console.error('Error creating project plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create project plan',
      error: error.message
    });
  }
};

// Submit project plan for approval
exports.submitProjectPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const projectPlan = await ProjectPlan.findById(id);

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    // Check ownership
    if (projectPlan.createdBy.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to submit this project plan'
      });
    }

    // Check if already submitted
    if (projectPlan.status !== 'Draft') {
      return res.status(400).json({
        success: false,
        message: 'Project plan has already been submitted'
      });
    }

    // Generate approval chain
    const approvalChain = getProjectPlanApprovalChain(projectPlan.department);
    
    projectPlan.approvalChain = approvalChain;
    projectPlan.status = 'Pending Project Coordinator Approval';
    projectPlan.currentApprovalLevel = 1;
    projectPlan.submittedDate = new Date();
    
    projectPlan.addStatusHistory(
      'Submitted',
      userId,
      'Project plan submitted for approval'
    );

    await projectPlan.save();

    const populatedPlan = await ProjectPlan.findById(id)
      .populate('createdBy', 'fullName email')
      .populate('approvalChain.approvedBy', 'fullName email');

    // TODO: Send email notification to Project Coordinator (Christabel)
    const projectCoordinator = getProjectCoordinator();
    console.log(`📧 Email notification should be sent to: ${projectCoordinator.email}`);

    res.json({
      success: true,
      message: 'Project plan submitted successfully for approval',
      data: populatedPlan,
      nextApprover: projectCoordinator
    });
  } catch (error) {
    console.error('Error submitting project plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit project plan',
      error: error.message
    });
  }
};

// Update project plan
exports.updateProjectPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const projectPlan = await ProjectPlan.findById(id);

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    // Check ownership or admin access
    if (projectPlan.createdBy.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this project plan'
      });
    }

    // Prevent editing if in approval process or approved
    const editableStatuses = ['Draft', 'Rejected'];
    if (!editableStatuses.includes(projectPlan.status) && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: `Cannot edit project plan with status: ${projectPlan.status}`
      });
    }

    // Update fields
    Object.assign(projectPlan, req.body);
    
    projectPlan.addStatusHistory(
      projectPlan.status,
      userId,
      'Project plan updated'
    );

    await projectPlan.save();

    const updatedPlan = await ProjectPlan.findById(id)
      .populate('createdBy', 'fullName email')
      .populate('approvalChain.approvedBy', 'fullName email');

    res.json({
      success: true,
      message: 'Project plan updated successfully',
      data: updatedPlan
    });
  } catch (error) {
    console.error('Error updating project plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update project plan',
      error: error.message
    });
  }
};

// Delete project plan
exports.deleteProjectPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const projectPlan = await ProjectPlan.findById(id);

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    // Check ownership or admin access
    if (projectPlan.createdBy.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this project plan'
      });
    }

    // Prevent deletion if approved or in progress
    const deletableStatuses = ['Draft', 'Rejected'];
    if (!deletableStatuses.includes(projectPlan.status) && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete project plan with status: ${projectPlan.status}`
      });
    }

    await projectPlan.deleteOne();

    res.json({
      success: true,
      message: 'Project plan deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting project plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete project plan',
      error: error.message
    });
  }
};

// Approve project plan
exports.approveProjectPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    const projectPlan = await ProjectPlan.findById(id)
      .populate('createdBy', 'fullName email');

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    // Check if user can approve at current level
    const currentApprover = projectPlan.getCurrentApprover();
    
    if (!currentApprover) {
      return res.status(400).json({
        success: false,
        message: 'No pending approvals for this project plan'
      });
    }

    if (currentApprover.email !== userEmail) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to approve at this level'
      });
    }

    // Update current approval level
    const currentLevel = currentApprover.level;
    const approvalItem = projectPlan.approvalChain.find(item => item.level === currentLevel);
    
    approvalItem.status = 'approved';
    approvalItem.approvalDate = new Date();
    approvalItem.comments = comments || '';
    approvalItem.approvedBy = userId;

    // Check if this was the final approval
    const isFullyApprovedNow = projectPlan.isFullyApproved();
    
    if (isFullyApprovedNow) {
      projectPlan.status = 'Approved';
      projectPlan.finalApprovalDate = new Date();
      projectPlan.currentApprovalLevel = projectPlan.approvalChain.length;
      
      projectPlan.addStatusHistory(
        'Approved',
        userId,
        `Final approval by ${currentApprover.role}: ${comments || 'Approved'}`
      );

      await projectPlan.save();

      const updatedPlan = await ProjectPlan.findById(id)
        .populate('createdBy', 'fullName email')
        .populate('approvalChain.approvedBy', 'fullName email');

      // TODO: Send email notification to project creator
      console.log(`📧 Email notification should be sent to: ${projectPlan.createdBy.email}`);

      return res.json({
        success: true,
        message: 'Project plan fully approved!',
        data: updatedPlan,
        fullyApproved: true
      });
    } else {
      // Move to next approval level
      projectPlan.currentApprovalLevel = currentLevel + 1;
      const nextApprover = getNextApprover(projectPlan.approvalChain, currentLevel);
      
      if (nextApprover) {
        if (nextApprover.level === 2) {
          projectPlan.status = 'Pending Supply Chain Coordinator Approval';
        }

        if (nextApprover.level === 3) {
          projectPlan.status = 'Pending Head of Business Approval';
        }
        
        projectPlan.addStatusHistory(
          projectPlan.status,
          userId,
          `Approved by ${currentApprover.role}: ${comments || 'Approved'}`
        );

        await projectPlan.save();

        const updatedPlan = await ProjectPlan.findById(id)
          .populate('createdBy', 'fullName email')
          .populate('approvalChain.approvedBy', 'fullName email');

        // TODO: Send email notification to next approver
        console.log(`📧 Email notification should be sent to: ${nextApprover.email}`);

        return res.json({
          success: true,
          message: `Approved at level ${currentLevel}. Forwarded to ${nextApprover.role}`,
          data: updatedPlan,
          nextApprover: nextApprover,
          fullyApproved: false
        });
      }
    }

  } catch (error) {
    console.error('Error approving project plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve project plan',
      error: error.message
    });
  }
};

// Reject project plan
exports.rejectProjectPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!comments) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const projectPlan = await ProjectPlan.findById(id)
      .populate('createdBy', 'fullName email');

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    // Check if user can reject at current level
    const currentApprover = projectPlan.getCurrentApprover();
    
    if (!currentApprover) {
      return res.status(400).json({
        success: false,
        message: 'No pending approvals for this project plan'
      });
    }

    if (currentApprover.email !== userEmail) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to reject at this level'
      });
    }

    // Update rejection details
    const currentLevel = currentApprover.level;
    const approvalItem = projectPlan.approvalChain.find(item => item.level === currentLevel);
    
    approvalItem.status = 'rejected';
    approvalItem.approvalDate = new Date();
    approvalItem.comments = comments;
    approvalItem.approvedBy = userId;

    projectPlan.status = 'Rejected';
    projectPlan.rejectedBy = userId;
    projectPlan.rejectedDate = new Date();
    projectPlan.rejectionReason = comments;
    projectPlan.rejectionLevel = currentLevel;
    
    projectPlan.addStatusHistory(
      'Rejected',
      userId,
      `Rejected by ${currentApprover.role}: ${comments}`
    );

    await projectPlan.save();

    const updatedPlan = await ProjectPlan.findById(id)
      .populate('createdBy', 'fullName email')
      .populate('rejectedBy', 'fullName email')
      .populate('approvalChain.approvedBy', 'fullName email');

    // TODO: Send email notification to project creator
    console.log(`📧 Rejection notification should be sent to: ${projectPlan.createdBy.email}`);

    res.json({
      success: true,
      message: 'Project plan rejected',
      data: updatedPlan
    });
  } catch (error) {
    console.error('Error rejecting project plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject project plan',
      error: error.message
    });
  }
};

// Get statistics
exports.getStatistics = async (req, res) => {
  try {
    const userId = req.user.id;

    const [myStats, approvalStats] = await Promise.all([
      // My project plans stats
      ProjectPlan.aggregate([
        { $match: { createdBy: mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // My pending approvals count
      ProjectPlan.countDocuments({
        'approvalChain.email': req.user.email,
        'approvalChain.status': 'pending'
      })
    ]);

    const result = {
      total: 0,
      draft: 0,
      submitted: 0,
      approved: 0,
      inProgress: 0,
      rejected: 0,
      pendingApprovals: approvalStats
    };

    myStats.forEach(stat => {
      result.total += stat.count;
      if (stat._id === 'Draft') result.draft = stat.count;
      if (stat._id.includes('Pending')) result.submitted += stat.count;
      if (stat._id === 'Approved') result.approved = stat.count;
      if (stat._id === 'In Progress') result.inProgress = stat.count;
      if (stat._id === 'Rejected') result.rejected = stat.count;
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};

// Get project plan details
exports.getProjectPlanById = async (req, res) => {
  try {
    const { id } = req.params;

    const projectPlan = await ProjectPlan.findById(id)
      .populate('createdBy', 'fullName email department')
      .populate('rejectedBy', 'fullName email')
      .populate('approvalChain.approvedBy', 'fullName email')
      .populate('statusHistory.changedBy', 'fullName email');

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    res.json({
      success: true,
      data: projectPlan
    });
  } catch (error) {
    console.error('Error fetching project plan:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project plan',
      error: error.message
    });
  }
};

// Mark completion item as complete
exports.markCompletionItemComplete = async (req, res) => {
  try {
    const { planId, itemId } = req.params;
    const { notes } = req.body;
    const userId = req.user?.id;

    const projectPlan = await ProjectPlan.findById(planId);

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    // Check if user is Christabel (project coordinator) or supply chain coordinator
    const userEmail = req.user?.email || '';
    const isProjectCoordinator = userEmail === 'christabel@gratoengineering.com';
    const isSupplyChainCoordinator = userEmail === 'lukong.lambert@gratoglobal.com';

    if (!isProjectCoordinator && !isSupplyChainCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Only project coordinator or supply chain coordinator can mark items complete'
      });
    }

    const item = projectPlan.completionItems.id(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Completion item not found'
      });
    }

    item.isCompleted = true;
    item.completedBy = userId;
    item.completedDate = new Date();
    item.notes = notes || '';

    await projectPlan.save();

    res.json({
      success: true,
      message: 'Item marked as complete successfully',
      data: projectPlan
    });

    try {
      await accountingService.postCompletionItemRecognized(
        req.params.planId,
        req.params.itemId,
        req.user.userId
      );
    } catch (accountingError) {
      console.warn('Accounting post failed for completion item (non-blocking):', accountingError.message);
    }
  } catch (error) {
    console.error('Error marking completion item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark item complete',
      error: error.message
    });
  }
};

// Unmark completion item
exports.unmarkCompletionItemComplete = async (req, res) => {
  try {
    const { planId, itemId } = req.params;
    const userId = req.user?.id;

    const projectPlan = await ProjectPlan.findById(planId);

    if (!projectPlan) {
      return res.status(404).json({
        success: false,
        message: 'Project plan not found'
      });
    }

    // Check if user is Christabel (project coordinator)
    const userEmail = req.user?.email || '';
    const isProjectCoordinator = userEmail === 'christabel@gratoengineering.com';

    if (!isProjectCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'Only project coordinator can unmark items'
      });
    }

    const item = projectPlan.completionItems.id(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Completion item not found'
      });
    }

    item.isCompleted = false;
    item.completedBy = null;
    item.completedDate = null;
    item.notes = '';

    await projectPlan.save();

    res.json({
      success: true,
      message: 'Item unmarked successfully',
      data: projectPlan
    });
  } catch (error) {
    console.error('Error unmarking completion item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unmark item',
      error: error.message
    });
  }
};









// const ProjectPlan = require('../models/ProjectPlan');
// const User = require('../models/User');

// // Get user's project plans
// exports.getMyProjectPlans = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const projectPlans = await ProjectPlan.find({ createdBy: userId })
//       .populate('createdBy', 'fullName email')
//       .populate('approvedBy', 'fullName email')
//       .sort({ createdAt: -1 });

//     res.json({
//       success: true,
//       data: projectPlans
//     });
//   } catch (error) {
//     console.error('Error fetching project plans:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch project plans',
//       error: error.message
//     });
//   }
// };

// // Get all project plans (for supervisors/admin)
// exports.getAllProjectPlans = async (req, res) => {
//   try {
//     const { status, department } = req.query;
//     const filter = {};

//     if (status) filter.status = status;
//     if (department) filter.department = department;

//     const projectPlans = await ProjectPlan.find(filter)
//       .populate('createdBy', 'fullName email department')
//       .populate('approvedBy', 'fullName email')
//       .sort({ createdAt: -1 });

//     res.json({
//       success: true,
//       data: projectPlans
//     });
//   } catch (error) {
//     console.error('Error fetching all project plans:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch project plans',
//       error: error.message
//     });
//   }
// };

// // Create new project plan
// exports.createProjectPlan = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const planData = {
//       ...req.body,
//       createdBy: userId
//     };

//     const projectPlan = new ProjectPlan(planData);
//     await projectPlan.save();

//     const populatedPlan = await ProjectPlan.findById(projectPlan._id)
//       .populate('createdBy', 'fullName email');

//     res.status(201).json({
//       success: true,
//       message: 'Project plan created successfully',
//       data: populatedPlan
//     });
//   } catch (error) {
//     console.error('Error creating project plan:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create project plan',
//       error: error.message
//     });
//   }
// };

// // Update project plan
// exports.updateProjectPlan = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.id;

//     const projectPlan = await ProjectPlan.findById(id);

//     if (!projectPlan) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project plan not found'
//       });
//     }

//     // Check ownership or admin access
//     if (projectPlan.createdBy.toString() !== userId && req.user.role !== 'admin') {
//       return res.status(403).json({
//         success: false,
//         message: 'Not authorized to update this project plan'
//       });
//     }

//     // Prevent editing if already approved
//     if (projectPlan.status === 'Approved' && req.user.role !== 'admin') {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot edit approved project plans'
//       });
//     }

//     Object.assign(projectPlan, req.body);
//     await projectPlan.save();

//     const updatedPlan = await ProjectPlan.findById(id)
//       .populate('createdBy', 'fullName email')
//       .populate('approvedBy', 'fullName email');

//     res.json({
//       success: true,
//       message: 'Project plan updated successfully',
//       data: updatedPlan
//     });
//   } catch (error) {
//     console.error('Error updating project plan:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update project plan',
//       error: error.message
//     });
//   }
// };

// // Delete project plan
// exports.deleteProjectPlan = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.id;

//     const projectPlan = await ProjectPlan.findById(id);

//     if (!projectPlan) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project plan not found'
//       });
//     }

//     // Check ownership or admin access
//     if (projectPlan.createdBy.toString() !== userId && req.user.role !== 'admin') {
//       return res.status(403).json({
//         success: false,
//         message: 'Not authorized to delete this project plan'
//       });
//     }

//     // Prevent deletion if approved or in progress
//     if (['Approved', 'In Progress'].includes(projectPlan.status) && req.user.role !== 'admin') {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot delete approved or in-progress project plans'
//       });
//     }

//     await projectPlan.deleteOne();

//     res.json({
//       success: true,
//       message: 'Project plan deleted successfully'
//     });
//   } catch (error) {
//     console.error('Error deleting project plan:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete project plan',
//       error: error.message
//     });
//   }
// };

// // Get statistics
// exports.getStatistics = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const stats = await ProjectPlan.aggregate([
//       { $match: { createdBy: mongoose.Types.ObjectId(userId) } },
//       {
//         $group: {
//           _id: '$status',
//           count: { $sum: 1 }
//         }
//       }
//     ]);

//     const result = {
//       total: 0,
//       draft: 0,
//       submitted: 0,
//       approved: 0,
//       inProgress: 0
//     };

//     stats.forEach(stat => {
//       result.total += stat.count;
//       if (stat._id === 'Draft') result.draft = stat.count;
//       if (stat._id === 'Submitted') result.submitted = stat.count;
//       if (stat._id === 'Approved') result.approved = stat.count;
//       if (stat._id === 'In Progress') result.inProgress = stat.count;
//     });

//     res.json({
//       success: true,
//       data: result
//     });
//   } catch (error) {
//     console.error('Error fetching statistics:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch statistics',
//       error: error.message
//     });
//   }
// };

// // Approve project plan (for supervisors/admin)
// exports.approveProjectPlan = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { comments } = req.body;
//     const userId = req.user.id;

//     const projectPlan = await ProjectPlan.findById(id);

//     if (!projectPlan) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project plan not found'
//       });
//     }

//     projectPlan.status = 'Approved';
//     projectPlan.approvedBy = userId;
//     projectPlan.approvalDate = new Date();
//     projectPlan.approvalComments = comments;

//     await projectPlan.save();

//     const updatedPlan = await ProjectPlan.findById(id)
//       .populate('createdBy', 'fullName email')
//       .populate('approvedBy', 'fullName email');

//     res.json({
//       success: true,
//       message: 'Project plan approved successfully',
//       data: updatedPlan
//     });
//   } catch (error) {
//     console.error('Error approving project plan:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to approve project plan',
//       error: error.message
//     });
//   }
// };

// // Reject project plan (for supervisors/admin)
// exports.rejectProjectPlan = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { comments } = req.body;

//     const projectPlan = await ProjectPlan.findById(id);

//     if (!projectPlan) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project plan not found'
//       });
//     }

//     projectPlan.status = 'Draft';
//     projectPlan.approvalComments = comments;

//     await projectPlan.save();

//     const updatedPlan = await ProjectPlan.findById(id)
//       .populate('createdBy', 'fullName email');

//     res.json({
//       success: true,
//       message: 'Project plan rejected',
//       data: updatedPlan
//     });
//   } catch (error) {
//     console.error('Error rejecting project plan:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to reject project plan',
//       error: error.message
//     });
//   }
// };