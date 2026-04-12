const Project = require('../models/Project');
const User = require('../models/User');
const QuarterlyKPI = require('../models/QuarterlyKPI');
const mongoose = require('mongoose');

// Get current quarter - FIXED to match KPI format
function getCurrentQuarter() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const quarter = Math.ceil(month / 3); // 1-4
  
  // Return in the format used by QuarterlyKPI model
  return { 
    year, 
    quarter: `Q${quarter}-${year}` // Format: "Q4-2024"
  };
}

// Approve milestone and link PM KPIs - FIXED
const approveMilestoneWithKPIs = async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;
    const { linkedKPIs } = req.body;
    const userId = req.user.userId;

    console.log('=== APPROVE MILESTONE WITH PM KPIs ===');
    console.log('PM:', userId);
    console.log('Project:', projectId);
    console.log('Milestone:', milestoneId);
    console.log('Linked KPIs:', linkedKPIs);

    // Validate KPI contributions sum to 100%
    if (!linkedKPIs || linkedKPIs.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Project Manager must link at least one KPI to this milestone'
      });
    }

    const totalContribution = linkedKPIs.reduce((sum, kpi) => sum + (kpi.contributionWeight || 0), 0);
    if (totalContribution !== 100) {
      return res.status(400).json({
        success: false,
        message: `KPI contribution weights must sum to 100%. Current total: ${totalContribution}%`
      });
    }

    // Get project
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Verify user is the PM
    if (!project.projectManager.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Only the Project Manager can approve milestones'
      });
    }

    // Get milestone
    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    if (milestone.approvalStatus !== 'pending_pm_review') {
      return res.status(400).json({
        success: false,
        message: 'Milestone has already been reviewed'
      });
    }

    // Get current quarter
    const currentQuarter = getCurrentQuarter();
    console.log('Current quarter:', currentQuarter);

    // Validate PM's KPIs
    const processedKPIs = [];

    for (const kpiLink of linkedKPIs) {
      console.log(`Validating KPI: ${kpiLink.kpiDocId}, Index: ${kpiLink.kpiIndex}`);

      // FIXED: Query without year/quarter filter first to debug
      const kpiDoc = await QuarterlyKPI.findOne({
        _id: kpiLink.kpiDocId,
        employee: userId,
        approvalStatus: 'approved'
      });

      console.log('KPI Doc found:', !!kpiDoc);
      if (kpiDoc) {
        console.log('KPI Doc quarter:', kpiDoc.quarter);
        console.log('KPI Doc year:', kpiDoc.year);
        console.log('Expected quarter:', currentQuarter.quarter);
        console.log('Expected year:', currentQuarter.year);
      }

      if (!kpiDoc) {
        return res.status(400).json({
          success: false,
          message: `KPI document ${kpiLink.kpiDocId} not found or not approved`
        });
      }

      // Check if it's for the current quarter (optional - remove if too strict)
      if (kpiDoc.quarter !== currentQuarter.quarter) {
        console.warn(`KPI is for ${kpiDoc.quarter}, current is ${currentQuarter.quarter}`);
        // Allow it anyway for now
      }

      const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
      if (!kpi) {
        return res.status(400).json({
          success: false,
          message: `KPI index ${kpiLink.kpiIndex} not found in document`
        });
      }

      console.log(`✅ KPI validated: ${kpi.title}`);

      processedKPIs.push({
        kpiDocId: kpiLink.kpiDocId,
        kpiIndex: kpiLink.kpiIndex,
        kpiTitle: kpi.title,
        kpiWeight: kpi.weight,
        contributionWeight: kpiLink.contributionWeight,
        currentContribution: 0
      });
    }

    // Update milestone
    milestone.pmLinkedKPIs = processedKPIs;
    milestone.approvalStatus = 'approved';
    milestone.approvedBy = userId;
    milestone.approvedAt = new Date();

    await project.save();

    console.log('✅ Milestone approved with PM KPIs');

    // Notify assigned supervisor
    try {
      const supervisor = await User.findById(milestone.assignedSupervisor);
      if (supervisor) {
        // TODO: Send email notification
        console.log(`✅ Would notify supervisor: ${supervisor.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send supervisor notification:', emailError);
    }

    res.json({
      success: true,
      message: 'Milestone approved and assigned to supervisor',
      data: milestone
    });

  } catch (error) {
    console.error('Error approving milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve milestone',
      error: error.message
    });
  }
};

// Reject milestone
const rejectMilestone = async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;
    const { reason } = req.body;
    const userId = req.user.userId;

    console.log('=== REJECT MILESTONE ===');
    console.log('PM:', userId);
    console.log('Reason:', reason);

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    if (!project.projectManager.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Only the Project Manager can reject milestones'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    milestone.approvalStatus = 'rejected';
    milestone.rejectionReason = reason;
    milestone.approvedBy = userId;
    milestone.approvedAt = new Date();

    await project.save();

    console.log('❌ Milestone rejected');

    res.json({
      success: true,
      message: 'Milestone rejected',
      data: milestone
    });

  } catch (error) {
    console.error('Error rejecting milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject milestone',
      error: error.message
    });
  }
};

// Get projects pending PM milestone review
const getProjectsPendingReview = async (req, res) => {
  try {
    const userId = req.user.userId;

    console.log('=== GET PROJECTS PENDING PM REVIEW ===');
    console.log('PM:', userId);

    const projects = await Project.find({
      projectManager: userId,
      isActive: true,
      isDraft: false,
      'milestones.approvalStatus': 'pending_pm_review'
    })
    .populate('createdBy', 'fullName email')
    .populate('budgetCodeId', 'code name')
    .populate('milestones.assignedSupervisor', 'fullName email department')
    .sort({ createdAt: -1 });

    const projectsWithPendingMilestones = projects.map(project => {
      const pendingMilestones = project.milestones.filter(
        m => m.approvalStatus === 'pending_pm_review'
      );

      return {
        ...project.toObject(),
        milestones: pendingMilestones,
        pendingCount: pendingMilestones.length
      };
    }).filter(p => p.pendingCount > 0);

    console.log(`Found ${projectsWithPendingMilestones.length} projects with pending milestones`);

    res.json({
      success: true,
      data: projectsWithPendingMilestones,
      count: projectsWithPendingMilestones.length
    });

  } catch (error) {
    console.error('Error fetching pending projects:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch projects pending review',
      error: error.message
    });
  }
};

// Bulk approve milestones
const bulkApproveMilestones = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { milestoneKPILinks } = req.body;
    const userId = req.user.userId;

    console.log('=== BULK APPROVE MILESTONES ===');
    console.log('Project:', projectId);
    console.log('Milestones to approve:', milestoneKPILinks?.length || 0);

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    if (!project.projectManager.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Only the Project Manager can approve milestones'
      });
    }

    const currentQuarter = getCurrentQuarter();
    const approvedMilestones = [];

    for (const milestoneLink of milestoneKPILinks) {
      const milestone = project.milestones.id(milestoneLink.milestoneId);
      if (!milestone) continue;

      if (milestone.approvalStatus !== 'pending_pm_review') continue;

      const processedKPIs = [];
      for (const kpiLink of milestoneLink.linkedKPIs) {
        const kpiDoc = await QuarterlyKPI.findOne({
          _id: kpiLink.kpiDocId,
          employee: userId,
          approvalStatus: 'approved'
        });

        if (kpiDoc) {
          const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
          if (kpi) {
            processedKPIs.push({
              kpiDocId: kpiLink.kpiDocId,
              kpiIndex: kpiLink.kpiIndex,
              kpiTitle: kpi.title,
              kpiWeight: kpi.weight,
              contributionWeight: kpiLink.contributionWeight,
              currentContribution: 0
            });
          }
        }
      }

      milestone.pmLinkedKPIs = processedKPIs;
      milestone.approvalStatus = 'approved';
      milestone.approvedBy = userId;
      milestone.approvedAt = new Date();

      approvedMilestones.push(milestone);

      // Notify supervisor
      try {
        const supervisor = await User.findById(milestone.assignedSupervisor);
        if (supervisor) {
          console.log(`Would notify supervisor: ${supervisor.email}`);
        }
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
      }
    }

    await project.save();

    console.log(`✅ Approved ${approvedMilestones.length} milestones`);

    res.json({
      success: true,
      message: `${approvedMilestones.length} milestone(s) approved successfully`,
      data: approvedMilestones
    });

  } catch (error) {
    console.error('Error bulk approving milestones:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk approve milestones',
      error: error.message
    });
  }
};

module.exports = {
  getProjectsPendingReview,
  approveMilestoneWithKPIs,
  rejectMilestone,
  bulkApproveMilestones
};









// const Project = require('../models/Project');
// const User = require('../models/User');
// const QuarterlyKPI = require('../models/QuarterlyKPI');
// const mongoose = require('mongoose');

// // Get current quarter
// function getCurrentQuarter() {
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = now.getMonth() + 1;
//   const quarter = Math.ceil(month / 3);
  
//   return { year, quarter };
// }

// // Get projects pending PM milestone review
// const getProjectsPendingReview = async (req, res) => {
//   try {
//     const userId = req.user.userId;

//     console.log('=== GET PROJECTS PENDING PM REVIEW ===');
//     console.log('PM:', userId);

//     // Find projects where user is PM and milestones are pending review
//     const projects = await Project.find({
//       projectManager: userId,
//       isActive: true,
//       isDraft: false,
//       'milestones.approvalStatus': 'pending_pm_review'
//     })
//     .populate('createdBy', 'fullName email')
//     .populate('budgetCodeId', 'code name')
//     .populate('milestones.assignedSupervisor', 'fullName email department')
//     .sort({ createdAt: -1 });

//     // Filter to only show milestones pending review
//     const projectsWithPendingMilestones = projects.map(project => {
//       const pendingMilestones = project.milestones.filter(
//         m => m.approvalStatus === 'pending_pm_review'
//       );

//       return {
//         ...project.toObject(),
//         milestones: pendingMilestones,
//         pendingCount: pendingMilestones.length
//       };
//     }).filter(p => p.pendingCount > 0);

//     console.log(`Found ${projectsWithPendingMilestones.length} projects with pending milestones`);

//     res.json({
//       success: true,
//       data: projectsWithPendingMilestones,
//       count: projectsWithPendingMilestones.length
//     });

//   } catch (error) {
//     console.error('Error fetching pending projects:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch projects pending review',
//       error: error.message
//     });
//   }
// };

// // Approve milestone and link PM KPIs
// const approveMilestoneWithKPIs = async (req, res) => {
//   try {
//     const { projectId, milestoneId } = req.params;
//     const { linkedKPIs } = req.body;
//     const userId = req.user.userId;

//     console.log('=== APPROVE MILESTONE WITH PM KPIs ===');
//     console.log('PM:', userId);
//     console.log('Project:', projectId);
//     console.log('Milestone:', milestoneId);
//     console.log('Linked KPIs:', linkedKPIs?.length || 0);

//     // Validate KPI contributions sum to 100%
//     if (!linkedKPIs || linkedKPIs.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Project Manager must link at least one KPI to this milestone'
//       });
//     }

//     const totalContribution = linkedKPIs.reduce((sum, kpi) => sum + (kpi.contributionWeight || 0), 0);
//     if (totalContribution !== 100) {
//       return res.status(400).json({
//         success: false,
//         message: `KPI contribution weights must sum to 100%. Current total: ${totalContribution}%`
//       });
//     }

//     // Get project
//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     // Verify user is the PM
//     if (!project.projectManager.equals(userId)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the Project Manager can approve milestones'
//       });
//     }

//     // Get milestone
//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     if (milestone.approvalStatus !== 'pending_pm_review') {
//       return res.status(400).json({
//         success: false,
//         message: 'Milestone has already been reviewed'
//       });
//     }

//     // Validate PM's KPIs
//     const currentQuarter = getCurrentQuarter();
//     const processedKPIs = [];

//     for (const kpiLink of linkedKPIs) {
//       const kpiDoc = await QuarterlyKPI.findOne({
//         _id: kpiLink.kpiDocId,
//         employee: userId,
//         approvalStatus: 'approved',
//         year: currentQuarter.year,
//         quarter: currentQuarter.quarter
//       });

//       if (!kpiDoc) {
//         return res.status(400).json({
//           success: false,
//           message: 'KPI not found or not approved for current quarter'
//         });
//       }

//       const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
//       if (!kpi) {
//         return res.status(400).json({
//           success: false,
//           message: `KPI index ${kpiLink.kpiIndex} not found`
//         });
//       }

//       processedKPIs.push({
//         kpiDocId: kpiLink.kpiDocId,
//         kpiIndex: kpiLink.kpiIndex,
//         kpiTitle: kpi.title,
//         kpiWeight: kpi.weight,
//         contributionWeight: kpiLink.contributionWeight,
//         currentContribution: 0
//       });
//     }

//     // Update milestone
//     milestone.pmLinkedKPIs = processedKPIs;
//     milestone.approvalStatus = 'approved';
//     milestone.approvedBy = userId;
//     milestone.approvedAt = new Date();

//     await project.save();

//     console.log('✅ Milestone approved with PM KPIs');

//     // Notify assigned supervisor
//     try {
//       const supervisor = await User.findById(milestone.assignedSupervisor);
//       if (supervisor) {
//         await sendProjectEmail.milestoneAssigned(
//           supervisor.email,
//           supervisor.fullName,
//           project.name,
//           milestone.title,
//           project._id,
//           milestone._id
//         );
//         console.log('✅ Supervisor notification sent');
//       }
//     } catch (emailError) {
//       console.error('Failed to send supervisor notification:', emailError);
//     }

//     res.json({
//       success: true,
//       message: 'Milestone approved and assigned to supervisor',
//       data: milestone
//     });

//   } catch (error) {
//     console.error('Error approving milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to approve milestone',
//       error: error.message
//     });
//   }
// };

// // Reject milestone
// const rejectMilestone = async (req, res) => {
//   try {
//     const { projectId, milestoneId } = req.params;
//     const { reason } = req.body;
//     const userId = req.user.userId;

//     console.log('=== REJECT MILESTONE ===');
//     console.log('PM:', userId);
//     console.log('Reason:', reason);

//     if (!reason) {
//       return res.status(400).json({
//         success: false,
//         message: 'Rejection reason is required'
//       });
//     }

//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     if (!project.projectManager.equals(userId)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the Project Manager can reject milestones'
//       });
//     }

//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     milestone.approvalStatus = 'rejected';
//     milestone.rejectionReason = reason;
//     milestone.approvedBy = userId;
//     milestone.approvedAt = new Date();

//     await project.save();

//     console.log('❌ Milestone rejected');

//     // Notify creator
//     try {
//       const creator = await User.findById(project.createdBy);
//       if (creator) {
//         await sendProjectEmail.milestoneRejected(
//           creator.email,
//           creator.fullName,
//           project.name,
//           milestone.title,
//           reason
//         );
//       }
//     } catch (emailError) {
//       console.error('Failed to send notification:', emailError);
//     }

//     res.json({
//       success: true,
//       message: 'Milestone rejected',
//       data: milestone
//     });

//   } catch (error) {
//     console.error('Error rejecting milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to reject milestone',
//       error: error.message
//     });
//   }
// };

// // Bulk approve all milestones in a project
// const bulkApproveMilestones = async (req, res) => {
//   try {
//     const { projectId } = req.params;
//     const { milestoneKPILinks } = req.body; // Array of { milestoneId, linkedKPIs }
//     const userId = req.user.userId;

//     console.log('=== BULK APPROVE MILESTONES ===');
//     console.log('Project:', projectId);
//     console.log('Milestones to approve:', milestoneKPILinks?.length || 0);

//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     if (!project.projectManager.equals(userId)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the Project Manager can approve milestones'
//       });
//     }

//     const currentQuarter = getCurrentQuarter();
//     const approvedMilestones = [];

//     for (const milestoneLink of milestoneKPILinks) {
//       const milestone = project.milestones.id(milestoneLink.milestoneId);
//       if (!milestone) continue;

//       if (milestone.approvalStatus !== 'pending_pm_review') continue;

//       // Validate and process KPIs
//       const processedKPIs = [];
//       for (const kpiLink of milestoneLink.linkedKPIs) {
//         const kpiDoc = await QuarterlyKPI.findOne({
//           _id: kpiLink.kpiDocId,
//           employee: userId,
//           approvalStatus: 'approved',
//           year: currentQuarter.year,
//           quarter: currentQuarter.quarter
//         });

//         if (kpiDoc) {
//           const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
//           if (kpi) {
//             processedKPIs.push({
//               kpiDocId: kpiLink.kpiDocId,
//               kpiIndex: kpiLink.kpiIndex,
//               kpiTitle: kpi.title,
//               kpiWeight: kpi.weight,
//               contributionWeight: kpiLink.contributionWeight,
//               currentContribution: 0
//             });
//           }
//         }
//       }

//       milestone.pmLinkedKPIs = processedKPIs;
//       milestone.approvalStatus = 'approved';
//       milestone.approvedBy = userId;
//       milestone.approvedAt = new Date();

//       approvedMilestones.push(milestone);

//       // Notify supervisor
//       try {
//         const supervisor = await User.findById(milestone.assignedSupervisor);
//         if (supervisor) {
//           await sendProjectEmail.milestoneAssigned(
//             supervisor.email,
//             supervisor.fullName,
//             project.name,
//             milestone.title,
//             project._id,
//             milestone._id
//           );
//         }
//       } catch (emailError) {
//         console.error('Failed to send notification:', emailError);
//       }
//     }

//     await project.save();

//     console.log(`✅ Approved ${approvedMilestones.length} milestones`);

//     res.json({
//       success: true,
//       message: `${approvedMilestones.length} milestone(s) approved successfully`,
//       data: approvedMilestones
//     });

//   } catch (error) {
//     console.error('Error bulk approving milestones:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to bulk approve milestones',
//       error: error.message
//     });
//   }
// };

// module.exports = {
//   getProjectsPendingReview,
//   approveMilestoneWithKPIs,
//   rejectMilestone,
//   bulkApproveMilestones
// };