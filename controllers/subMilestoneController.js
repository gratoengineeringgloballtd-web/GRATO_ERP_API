const Project = require('../models/Project');
const User = require('../models/User');
const ActionItem = require('../models/ActionItem');
const QuarterlyKPI = require('../models/QuarterlyKPI');
const mongoose = require('mongoose');

// Helper function to find sub-milestone by ID recursively
function findSubMilestoneById(subMilestones, targetId) {
  for (const sm of subMilestones) {
    if (sm._id.toString() === targetId) {
      return sm;
    }
    if (sm.subMilestones && sm.subMilestones.length > 0) {
      const found = findSubMilestoneById(sm.subMilestones, targetId);
      if (found) return found;
    }
  }
  return null;
}

// Helper to flatten tasks from hierarchy
function flattenTasksFromHierarchy(node) {
  let tasks = [];
  
  if (node.tasks && Array.isArray(node.tasks)) {
    tasks = [...tasks, ...node.tasks];
  }
  
  if (node.subMilestones && node.subMilestones.length > 0) {
    node.subMilestones.forEach(subMilestone => {
      tasks = [...tasks, ...flattenTasksFromHierarchy(subMilestone)];
    });
  }
  
  return tasks;
}

// Helper to get current quarter
function getCurrentQuarter() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  
  return { year, quarter };
}

// Helper to update KPI contributions recursively
async function updateKPIContributions(subMilestone) {
  if (!subMilestone.linkedKPIs || subMilestone.linkedKPIs.length === 0) {
    return;
  }

  const QuarterlyKPI = require('../models/QuarterlyKPI');

  for (const kpiLink of subMilestone.linkedKPIs) {
    // Calculate contribution: (progress * contributionWeight) / 100
    const contribution = (subMilestone.progress * kpiLink.contributionWeight) / 100;
    kpiLink.currentContribution = Math.round(contribution * 100) / 100;

    // Update the actual KPI document
    try {
      const kpiDoc = await QuarterlyKPI.findById(kpiLink.kpiDocId);
      if (kpiDoc && kpiDoc.kpis[kpiLink.kpiIndex]) {
        const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
        
        // Add or update sub-milestone contribution
        const existingContribution = kpi.taskContributions.find(
          tc => tc.subMilestoneId && tc.subMilestoneId.toString() === subMilestone._id.toString()
        );

        if (existingContribution) {
          existingContribution.contributionScore = contribution;
          existingContribution.lastUpdated = new Date();
        } else {
          kpi.taskContributions.push({
            subMilestoneId: subMilestone._id,
            contributionScore: contribution,
            lastUpdated: new Date()
          });
        }

        // Recalculate KPI progress
        const totalContribution = kpi.taskContributions.reduce(
          (sum, tc) => sum + (tc.contributionScore || 0), 
          0
        );
        kpi.progress = Math.min(100, Math.round(totalContribution));

        // Update status
        if (kpi.progress === 0) {
          kpi.status = 'not_started';
        } else if (kpi.progress >= 100) {
          kpi.status = 'completed';
        } else {
          kpi.status = 'in_progress';
        }

        await kpiDoc.save();
        console.log(`✅ Updated KPI "${kpi.title}" progress to ${kpi.progress}%`);
      }
    } catch (error) {
      console.error(`Failed to update KPI ${kpiLink.kpiDocId}:`, error);
    }
  }
}


// Helper to update all parent KPIs recursively
async function updateParentKPIContributions(subMilestone, project, milestone) {
  // Update this sub-milestone's KPI contributions
  await updateKPIContributions(subMilestone);

  // Find parent sub-milestone recursively
  const findParent = (subMilestones, targetId, parent = null) => {
    for (const sm of subMilestones) {
      if (sm._id.toString() === targetId) {
        return parent;
      }
      const found = findParent(sm.subMilestones || [], targetId, sm);
      if (found !== null) return found;
    }
    return null;
  };

  const parentSubMilestone = findParent(milestone.subMilestones || [], subMilestone._id.toString());
  
  if (parentSubMilestone) {
    // Update parent's progress based on children
    const totalWeight = parentSubMilestone.subMilestones.reduce((sum, sm) => sum + (sm.weight || 0), 0);
    if (totalWeight > 0) {
      const weightedProgress = parentSubMilestone.subMilestones.reduce((sum, sm) => {
        return sum + ((sm.progress || 0) * (sm.weight || 0) / totalWeight);
      }, 0);
      parentSubMilestone.progress = Math.round(weightedProgress);
      
      // Update parent status
      if (parentSubMilestone.progress === 0) {
        parentSubMilestone.status = 'Not Started';
      } else if (parentSubMilestone.progress >= 100) {
        parentSubMilestone.status = 'Completed';
        if (!parentSubMilestone.completedDate) {
          parentSubMilestone.completedDate = new Date();
        }
      } else {
        parentSubMilestone.status = 'In Progress';
      }
      
      // Recursively update parent
      await updateParentKPIContributions(parentSubMilestone, project, milestone);
    }
  }
}

const createSubMilestone = async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;
    const {
      title,
      description,
      weight,
      dueDate,
      assignedSupervisor,
      parentSubMilestoneId,
      linkedKPIs // NEW
    } = req.body;

    console.log('=== CREATE SUB-MILESTONE WITH KPI LINKING ===');
    console.log('Creator:', req.user.userId);
    console.log('Linked KPIs:', linkedKPIs?.length || 0);

    // Validate required fields
    if (!title || !weight || !assignedSupervisor) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate KPI contributions sum to 100% if provided
    if (linkedKPIs && linkedKPIs.length > 0) {
      const totalContribution = linkedKPIs.reduce((sum, kpi) => sum + (kpi.contributionWeight || 0), 0);
      if (totalContribution !== 100) {
        return res.status(400).json({
          success: false,
          message: `KPI contribution weights must sum to 100%. Current total: ${totalContribution}%`
        });
      }
    }

    // Get project and milestone
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    // Verify assigned supervisor exists
    const supervisor = await User.findById(assignedSupervisor);
    if (!supervisor) {
      return res.status(400).json({
        success: false,
        message: 'Assigned supervisor not found'
      });
    }

    // Process and validate linked KPIs
    const processedKPIs = [];
    if (linkedKPIs && linkedKPIs.length > 0) {
      const currentQuarter = getCurrentQuarter();

      for (const kpiLink of linkedKPIs) {
        // Verify KPI belongs to creator and is approved for current quarter
        const kpiDoc = await QuarterlyKPI.findOne({
          _id: kpiLink.kpiDocId,
          employee: req.user.userId,
          approvalStatus: 'approved',
          year: currentQuarter.year,
          quarter: currentQuarter.quarter
        });

        if (!kpiDoc) {
          return res.status(400).json({
            success: false,
            message: `KPI not found or not approved for current quarter (Q${currentQuarter.quarter} ${currentQuarter.year})`
          });
        }

        const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
        if (!kpi) {
          return res.status(400).json({
            success: false,
            message: `KPI index ${kpiLink.kpiIndex} not found`
          });
        }

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

    // Create new sub-milestone
    const newSubMilestone = {
      title,
      description: description || '',
      weight,
      dueDate: dueDate ? new Date(dueDate) : null,
      assignedSupervisor,
      status: 'Not Started',
      progress: 0,
      linkedKPIs: processedKPIs,
      createdBy: req.user.userId,
      createdAt: new Date()
    };

    // Add to parent (either milestone or another sub-milestone)
    if (parentSubMilestoneId) {
      const parentSubMilestone = findSubMilestoneById(milestone.subMilestones, parentSubMilestoneId);
      if (!parentSubMilestone) {
        return res.status(404).json({
          success: false,
          message: 'Parent sub-milestone not found'
        });
      }
      
      if (!parentSubMilestone.subMilestones) {
        parentSubMilestone.subMilestones = [];
      }
      parentSubMilestone.subMilestones.push(newSubMilestone);
    } else {
      if (!milestone.subMilestones) {
        milestone.subMilestones = [];
      }
      milestone.subMilestones.push(newSubMilestone);
    }

    await project.save();

    console.log('✅ Sub-milestone created with', processedKPIs.length, 'KPI links');

    res.status(201).json({
      success: true,
      message: 'Sub-milestone created successfully',
      data: newSubMilestone
    });

  } catch (error) {
    console.error('Error creating sub-milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sub-milestone',
      error: error.message
    });
  }
};


// Get sub-milestone hierarchy (works for nested sub-milestones)
const getSubMilestoneHierarchy = async (req, res) => {
  try {
    const { projectId, milestoneId, subMilestoneId } = req.params;

    console.log('=== GET SUB-MILESTONE HIERARCHY ===');
    console.log('Project:', projectId);
    console.log('Milestone:', milestoneId);
    console.log('Sub-milestone:', subMilestoneId);

    if (!mongoose.Types.ObjectId.isValid(projectId) || 
        !mongoose.Types.ObjectId.isValid(milestoneId) ||
        !mongoose.Types.ObjectId.isValid(subMilestoneId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    // Fetch fresh project data
    const project = await Project.findById(projectId)
      .populate('projectManager', 'fullName email');

    if (!project || !project.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Parent milestone not found'
      });
    }

    console.log('Milestone found:', milestone.title);
    console.log('Sub-milestones count:', milestone.subMilestones?.length || 0);

    // Find the sub-milestone recursively
    const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
    if (!subMilestone) {
      console.error('Sub-milestone not found in hierarchy');
      return res.status(404).json({
        success: false,
        message: 'Sub-milestone not found'
      });
    }

    console.log('Sub-milestone found:', subMilestone.title);
    console.log('Nested sub-milestones:', subMilestone.subMilestones?.length || 0);

    // Verify user has access (is the assigned supervisor or admin)
    const user = await User.findById(req.user.userId);
    const isAssignedSupervisor = subMilestone.assignedSupervisor.equals(req.user.userId);
    const isAdmin = ['admin', 'supply_chain', 'project'].includes(user.role);

    if (!isAssignedSupervisor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this sub-milestone'
      });
    }

    // Build hierarchy with tasks recursively
    const buildHierarchyWithTasks = async (node) => {
      console.log(`Building hierarchy for: ${node.title}`);
      
      // Get tasks for this node
      const tasks = await ActionItem.find({ subMilestoneId: node._id })
        .populate('assignedTo.user', 'fullName email department')
        .populate('createdBy', 'fullName email')
        .populate('linkedKPIs.kpiDocId')
        .lean();

      console.log(`  Found ${tasks.length} tasks for ${node.title}`);

      // Populate assignedSupervisor
      let populatedSupervisor = null;
      if (node.assignedSupervisor) {
        try {
          const supervisor = await User.findById(node.assignedSupervisor)
            .select('fullName email department')
            .lean();
          if (supervisor) {
            populatedSupervisor = supervisor;
          }
        } catch (error) {
          console.error('Error populating supervisor:', error);
        }
      }

      const hierarchyNode = {
        _id: node._id,
        title: node.title,
        description: node.description || '',
        weight: node.weight || 0,
        progress: node.progress || 0,
        status: node.status || 'Not Started',
        dueDate: node.dueDate,
        assignedSupervisor: populatedSupervisor,
        linkedKPIs: node.linkedKPIs || [],
        createdBy: node.createdBy,
        taskCount: tasks.length,
        tasks: tasks,
        subMilestones: []
      };

      // Recursively build child sub-milestones
      if (node.subMilestones && node.subMilestones.length > 0) {
        console.log(`  Processing ${node.subMilestones.length} child sub-milestones...`);
        for (const child of node.subMilestones) {
          const childHierarchy = await buildHierarchyWithTasks(child);
          hierarchyNode.subMilestones.push(childHierarchy);
        }
      }

      return hierarchyNode;
    };

    const hierarchy = await buildHierarchyWithTasks(subMilestone);

    console.log('Final hierarchy built:', {
      title: hierarchy.title,
      taskCount: hierarchy.taskCount,
      subMilestoneCount: hierarchy.subMilestones.length
    });

    // Get all tasks (flattened)
    const allTasks = flattenTasksFromHierarchy(hierarchy);

    res.json({
      success: true,
      data: {
        project: {
          _id: project._id,
          name: project.name,
          code: project.code,
          status: project.status
        },
        parentMilestone: {
          _id: milestone._id,
          title: milestone.title
        },
        hierarchy,
        allTasks
      }
    });

  } catch (error) {
    console.error('Error fetching sub-milestone hierarchy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sub-milestone hierarchy',
      error: error.message
    });
  }
};


// Get milestone hierarchy with all sub-milestones
const getMilestoneHierarchy = async (req, res) => {
  try {
    const { projectId, milestoneId } = req.params;
    const userId = req.user.userId;

    console.log('=== GET MILESTONE HIERARCHY ===');
    console.log('Project:', projectId);
    console.log('Milestone:', milestoneId);

    const project = await Project.findById(projectId)
      .populate('milestones.assignedSupervisor', 'fullName email department')
      .populate('milestones.subMilestones.assignedSupervisor', 'fullName email department');

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    // Get tasks for all sub-milestones at all levels
    const allSubMilestoneIds = getAllSubMilestoneIds(milestone.subMilestones);
    
    const tasks = await ActionItem.find({
      $or: [
        { milestoneId: milestoneId },
        { subMilestoneId: { $in: allSubMilestoneIds } }
      ]
    })
    .populate('assignedTo.user', 'fullName email department')
    .populate('createdBy', 'fullName email');

    // Build hierarchy with task counts
    const hierarchy = buildMilestoneHierarchy(milestone, tasks);

    res.json({
      success: true,
      data: {
        project: {
          _id: project._id,
          name: project.name,
          code: project.code
        },
        hierarchy
      }
    });

  } catch (error) {
    console.error('Error fetching milestone hierarchy:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch milestone hierarchy',
      error: error.message
    });
  }
};

// Update sub-milestone
const updateSubMilestone = async (req, res) => {
  try {
    const { projectId, milestoneId, subMilestoneId } = req.params;
    const {
      title,
      description,
      weight,
      dueDate,
      assignedSupervisor,
      status
    } = req.body;

    const userId = req.user.userId;

    console.log('=== UPDATE SUB-MILESTONE ===');
    console.log('Sub-Milestone:', subMilestoneId);

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
    if (!subMilestone) {
      return res.status(404).json({
        success: false,
        message: 'Sub-milestone not found'
      });
    }

    // Check permissions
    const user = await User.findById(userId);
    const canEdit = subMilestone.assignedSupervisor.equals(userId) || 
                    ['admin', 'supply_chain', 'project'].includes(user.role);

    if (!canEdit) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this sub-milestone'
      });
    }

    // Update fields
    if (title) subMilestone.title = title;
    if (description !== undefined) subMilestone.description = description;
    if (dueDate) subMilestone.dueDate = new Date(dueDate);
    if (assignedSupervisor) {
      const supervisor = await User.findById(assignedSupervisor);
      if (!supervisor) {
        return res.status(400).json({
          success: false,
          message: 'Assigned supervisor not found'
        });
      }
      subMilestone.assignedSupervisor = assignedSupervisor;
    }
    if (status) subMilestone.status = status;

    // Handle weight change
    if (weight && weight !== subMilestone.weight) {
      const parent = findParentOfSubMilestone(milestone.subMilestones, subMilestoneId);
      const siblings = parent ? parent.subMilestones : milestone.subMilestones;
      
      const usedWeight = siblings
        .filter(sm => sm._id.toString() !== subMilestoneId)
        .reduce((sum, sm) => sum + (sm.weight || 0), 0);
      
      const availableWeight = 100 - usedWeight;

      if (weight > availableWeight) {
        return res.status(400).json({
          success: false,
          message: `Insufficient weight capacity. Available: ${availableWeight}%, Requested: ${weight}%`
        });
      }

      subMilestone.weight = weight;
    }

    subMilestone.updatedBy = userId;
    subMilestone.updatedAt = new Date();

    await project.save();

    console.log('✅ Sub-milestone updated');

    res.json({
      success: true,
      message: 'Sub-milestone updated successfully',
      data: subMilestone
    });

  } catch (error) {
    console.error('Error updating sub-milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update sub-milestone',
      error: error.message
    });
  }
};

// Delete sub-milestone
const deleteSubMilestone = async (req, res) => {
  try {
    const { projectId, milestoneId, subMilestoneId } = req.params;
    const userId = req.user.userId;

    console.log('=== DELETE SUB-MILESTONE ===');
    console.log('Sub-Milestone:', subMilestoneId);

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
    if (!subMilestone) {
      return res.status(404).json({
        success: false,
        message: 'Sub-milestone not found'
      });
    }

    // Check permissions
    const user = await User.findById(userId);
    const canDelete = milestone.assignedSupervisor.equals(userId) || 
                      ['admin', 'supply_chain', 'project'].includes(user.role);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'Only the milestone supervisor or admin can delete sub-milestones'
      });
    }

    // Check if sub-milestone has nested sub-milestones
    if (subMilestone.subMilestones && subMilestone.subMilestones.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete sub-milestone with nested sub-milestones. Delete nested items first.'
      });
    }

    // Check if sub-milestone has tasks
    const taskCount = await ActionItem.countDocuments({ subMilestoneId: subMilestoneId });
    if (taskCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete sub-milestone with ${taskCount} associated task(s). Delete or reassign tasks first.`
      });
    }

    // Remove sub-milestone
    removeSubMilestoneById(milestone.subMilestones, subMilestoneId);
    await project.save();

    console.log('✅ Sub-milestone deleted');

    res.json({
      success: true,
      message: 'Sub-milestone deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting sub-milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sub-milestone',
      error: error.message
    });
  }
};

// UPDATE EXISTING updateSubMilestoneProgress function
const updateSubMilestoneProgress = async (req, res) => {
  try {
    const { projectId, milestoneId, subMilestoneId } = req.params;
    const { progress, notes } = req.body;

    console.log('=== UPDATE SUB-MILESTONE PROGRESS ===');
    console.log('Sub-milestone:', subMilestoneId);
    console.log('New progress:', progress);

    if (progress < 0 || progress > 100) {
      return res.status(400).json({
        success: false,
        message: 'Progress must be between 0 and 100'
      });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
    if (!subMilestone) {
      return res.status(404).json({
        success: false,
        message: 'Sub-milestone not found'
      });
    }

    // Update progress
    const oldProgress = subMilestone.progress;
    subMilestone.progress = progress;
    subMilestone.updatedBy = req.user.userId;
    subMilestone.updatedAt = new Date();

    if (progress === 100 && oldProgress < 100) {
      subMilestone.status = 'Completed';
      subMilestone.completedDate = new Date();
      subMilestone.completedBy = req.user.userId;
    } else if (progress > 0 && progress < 100) {
      subMilestone.status = 'In Progress';
    }

    await project.save();

    // Update KPI contributions (this sub-milestone and all parents)
    console.log('Updating KPI contributions...');
    await updateParentKPIContributions(subMilestone, project, milestone);
    
    // Re-save project after KPI updates
    await project.save();

    console.log('✅ Sub-milestone progress updated, KPIs recalculated');

    res.json({
      success: true,
      message: 'Progress updated successfully',
      data: subMilestone
    });

  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update progress',
      error: error.message
    });
  }
};


// Mark sub-milestone as complete
const completeSubMilestone = async (req, res) => {
  try {
    const { projectId, milestoneId, subMilestoneId } = req.params;
    const userId = req.user.userId;

    console.log('=== COMPLETE SUB-MILESTONE ===');
    console.log('Sub-Milestone:', subMilestoneId);

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const milestone = project.milestones.id(milestoneId);
    if (!milestone) {
      return res.status(404).json({
        success: false,
        message: 'Milestone not found'
      });
    }

    const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
    if (!subMilestone) {
      return res.status(404).json({
        success: false,
        message: 'Sub-milestone not found'
      });
    }

    // Check permissions
    const user = await User.findById(userId);
    if (!subMilestone.assignedSupervisor.equals(userId) && 
        !['admin', 'supply_chain', 'project'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned supervisor can complete this sub-milestone'
      });
    }

    // Check if progress is 100%
    if (subMilestone.progress < 100) {
      return res.status(400).json({
        success: false,
        message: `Sub-milestone progress must be 100% to complete. Current: ${subMilestone.progress}%`
      });
    }

    // Mark as completed
    subMilestone.status = 'Completed';
    subMilestone.completedDate = new Date();
    subMilestone.completedBy = userId;

    await project.save();

    // Recalculate parent progress
    await recalculateMilestoneProgressFromSubMilestones(milestone);
    await project.save();

    console.log('✅ Sub-milestone marked as completed');

    res.json({
      success: true,
      message: 'Sub-milestone completed successfully',
      data: subMilestone
    });

  } catch (error) {
    console.error('Error completing sub-milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete sub-milestone',
      error: error.message
    });
  }
};

// ========== HELPER FUNCTIONS ==========

// Recursively find sub-milestone by ID
function findSubMilestoneById(subMilestones, targetId) {
  for (const sm of subMilestones) {
    if (sm._id.toString() === targetId) {
      return sm;
    }
    if (sm.subMilestones && sm.subMilestones.length > 0) {
      const found = findSubMilestoneById(sm.subMilestones, targetId);
      if (found) return found;
    }
  }
  return null;
}

// Find parent of a sub-milestone
function findParentOfSubMilestone(subMilestones, targetId, parent = null) {
  for (const sm of subMilestones) {
    if (sm._id.toString() === targetId) {
      return parent;
    }
    if (sm.subMilestones && sm.subMilestones.length > 0) {
      const found = findParentOfSubMilestone(sm.subMilestones, targetId, sm);
      if (found !== null) return found;
    }
  }
  return null;
}

// Remove sub-milestone by ID
function removeSubMilestoneById(subMilestones, targetId) {
  for (let i = 0; i < subMilestones.length; i++) {
    if (subMilestones[i]._id.toString() === targetId) {
      subMilestones.splice(i, 1);
      return true;
    }
    if (subMilestones[i].subMilestones && subMilestones[i].subMilestones.length > 0) {
      if (removeSubMilestoneById(subMilestones[i].subMilestones, targetId)) {
        return true;
      }
    }
  }
  return false;
}

// Get all sub-milestone IDs recursively
function getAllSubMilestoneIds(subMilestones) {
  const ids = [];
  for (const sm of subMilestones) {
    ids.push(sm._id.toString());
    if (sm.subMilestones && sm.subMilestones.length > 0) {
      ids.push(...getAllSubMilestoneIds(sm.subMilestones));
    }
  }
  return ids;
}

// Build hierarchy with task counts
function buildMilestoneHierarchy(milestone, tasks) {
  const milestoneData = {
    _id: milestone._id,
    title: milestone.title,
    description: milestone.description,
    weight: milestone.weight,
    progress: milestone.progress,
    status: milestone.status,
    dueDate: milestone.dueDate,
    assignedSupervisor: milestone.assignedSupervisor,
    taskCount: tasks.filter(t => t.milestoneId && t.milestoneId.equals(milestone._id)).length,
    subMilestones: []
  };

  if (milestone.subMilestones && milestone.subMilestones.length > 0) {
    milestoneData.subMilestones = buildSubMilestoneHierarchy(milestone.subMilestones, tasks);
  }

  return milestoneData;
}

// Build sub-milestone hierarchy recursively
function buildSubMilestoneHierarchy(subMilestones, tasks) {
  return subMilestones.map(sm => ({
    _id: sm._id,
    title: sm.title,
    description: sm.description,
    weight: sm.weight,
    progress: sm.progress,
    status: sm.status,
    dueDate: sm.dueDate,
    assignedSupervisor: sm.assignedSupervisor,
    taskCount: tasks.filter(t => t.subMilestoneId && t.subMilestoneId.equals(sm._id)).length,
    subMilestones: sm.subMilestones && sm.subMilestones.length > 0 
      ? buildSubMilestoneHierarchy(sm.subMilestones, tasks)
      : []
  }));
}

// Recalculate sub-milestone progress from tasks
async function recalculateSubMilestoneProgress(subMilestone, subMilestoneId) {
  const completedTasks = await ActionItem.find({
    subMilestoneId: subMilestoneId,
    status: 'Completed'
  });

  if (completedTasks.length === 0) {
    subMilestone.progress = 0;
    subMilestone.status = 'Not Started';
    return;
  }

  let totalProgress = 0;
  completedTasks.forEach(task => {
    if (task.completionGrade && task.completionGrade.score) {
      const effectiveScore = (task.completionGrade.score / 5) * task.taskWeight;
      totalProgress += effectiveScore;
    }
  });

  subMilestone.progress = Math.min(100, Math.round(totalProgress));

  if (subMilestone.progress === 0) {
    subMilestone.status = 'Not Started';
  } else if (subMilestone.progress >= 100) {
    subMilestone.status = 'Completed';
    if (!subMilestone.completedDate) {
      subMilestone.completedDate = new Date();
    }
  } else {
    subMilestone.status = 'In Progress';
  }
}

// Recalculate milestone progress from sub-milestones
async function recalculateMilestoneProgressFromSubMilestones(milestone) {
  if (!milestone.subMilestones || milestone.subMilestones.length === 0) {
    return;
  }

  const totalWeight = milestone.subMilestones.reduce((sum, sm) => sum + (sm.weight || 0), 0);
  if (totalWeight === 0) return;

  const weightedProgress = milestone.subMilestones.reduce((sum, sm) => {
    return sum + ((sm.progress || 0) * (sm.weight || 0) / 100);
  }, 0);

  milestone.progress = Math.round(weightedProgress);

  if (milestone.progress === 0) {
    milestone.status = 'Not Started';
  } else if (milestone.progress >= 100) {
    milestone.status = 'Completed';
  } else {
    milestone.status = 'In Progress';
  }
}

module.exports = {
  createSubMilestone,
  getMilestoneHierarchy,
  updateSubMilestone,
  deleteSubMilestone,
  updateSubMilestoneProgress,
  completeSubMilestone,
  getSubMilestoneHierarchy
};










// const Project = require('../models/Project');
// const User = require('../models/User');
// const ActionItem = require('../models/ActionItem');
// const mongoose = require('mongoose');

// // Create sub-milestone under milestone or another sub-milestone
// const createSubMilestone = async (req, res) => {
//   try {
//     const { projectId, milestoneId } = req.params;
//     const {
//       title,
//       description,
//       weight,
//       dueDate,
//       assignedSupervisor,
//       parentSubMilestoneId // Optional: if creating nested sub-milestone
//     } = req.body;

//     const userId = req.user.userId;

//     console.log('=== CREATE SUB-MILESTONE ===');
//     console.log('Project:', projectId);
//     console.log('Milestone:', milestoneId);
//     console.log('Parent Sub-Milestone:', parentSubMilestoneId || 'none');
//     console.log('Creator:', userId);

//     // Validate required fields
//     if (!title || !weight || weight <= 0 || weight > 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Title and valid weight (1-100) are required'
//       });
//     }

//     // Get project and milestone
//     const project = await Project.findById(projectId)
//       .populate('milestones.assignedSupervisor', 'fullName email department')
//       .populate('milestones.subMilestones.assignedSupervisor', 'fullName email department');

//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     // Get current user
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     // Check permissions
//     const isAssignedSupervisor = milestone.assignedSupervisor._id.equals(userId);
//     const isAdmin = ['admin', 'supply_chain', 'project'].includes(user.role);

//     if (!isAssignedSupervisor && !isAdmin) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the assigned supervisor can create sub-milestones'
//       });
//     }

//     let parentSubMilestone = null;
//     let targetArray = milestone.subMilestones;
//     let parentPath = 'milestone';

//     // If creating nested sub-milestone
//     if (parentSubMilestoneId) {
//       parentSubMilestone = findSubMilestoneById(milestone.subMilestones, parentSubMilestoneId);
      
//       if (!parentSubMilestone) {
//         return res.status(404).json({
//           success: false,
//           message: 'Parent sub-milestone not found'
//         });
//       }

//       // Check if user can create under this parent
//       if (!parentSubMilestone.assignedSupervisor.equals(userId) && !isAdmin) {
//         return res.status(403).json({
//           success: false,
//           message: 'Only the assigned supervisor of the parent can create nested sub-milestones'
//         });
//       }

//       targetArray = parentSubMilestone.subMilestones;
//       parentPath = `sub-milestone: ${parentSubMilestone.title}`;
//     }

//     // Calculate available weight
//     const usedWeight = targetArray.reduce((sum, sm) => sum + (sm.weight || 0), 0);
//     const availableWeight = 100 - usedWeight;

//     if (weight > availableWeight) {
//       return res.status(400).json({
//         success: false,
//         message: `Insufficient weight capacity. Available: ${availableWeight}%, Requested: ${weight}%`
//       });
//     }

//     // Validate assigned supervisor
//     if (assignedSupervisor) {
//       const supervisor = await User.findById(assignedSupervisor);
//       if (!supervisor) {
//         return res.status(400).json({
//           success: false,
//           message: 'Assigned supervisor not found'
//         });
//       }
//     }

//     // Create sub-milestone
//     const subMilestone = {
//       title,
//       description: description || '',
//       weight,
//       dueDate: dueDate ? new Date(dueDate) : null,
//       assignedSupervisor: assignedSupervisor || userId,
//       status: 'Not Started',
//       progress: 0,
//       subMilestones: [], // Can contain further sub-milestones
//       createdBy: userId,
//       createdAt: new Date()
//     };

//     targetArray.push(subMilestone);

//     await project.save();

//     // Get the created sub-milestone with populated data
//     const updatedProject = await Project.findById(projectId)
//       .populate('milestones.assignedSupervisor', 'fullName email department')
//       .populate('milestones.subMilestones.assignedSupervisor', 'fullName email department');

//     const updatedMilestone = updatedProject.milestones.id(milestoneId);

//     console.log(`✅ Sub-milestone created under ${parentPath}`);

//     res.status(201).json({
//       success: true,
//       message: 'Sub-milestone created successfully',
//       data: {
//         project: {
//           _id: project._id,
//           name: project.name,
//           code: project.code
//         },
//         milestone: {
//           _id: updatedMilestone._id,
//           title: updatedMilestone.title,
//           weight: updatedMilestone.weight
//         },
//         subMilestone: targetArray[targetArray.length - 1]
//       }
//     });

//   } catch (error) {
//     console.error('Error creating sub-milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create sub-milestone',
//       error: error.message
//     });
//   }
// };

// // Get milestone hierarchy with all sub-milestones
// const getMilestoneHierarchy = async (req, res) => {
//   try {
//     const { projectId, milestoneId } = req.params;
//     const userId = req.user.userId;

//     console.log('=== GET MILESTONE HIERARCHY ===');
//     console.log('Project:', projectId);
//     console.log('Milestone:', milestoneId);

//     const project = await Project.findById(projectId)
//       .populate('milestones.assignedSupervisor', 'fullName email department')
//       .populate('milestones.subMilestones.assignedSupervisor', 'fullName email department');

//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     // Get tasks for all sub-milestones at all levels
//     const allSubMilestoneIds = getAllSubMilestoneIds(milestone.subMilestones);
    
//     const tasks = await ActionItem.find({
//       $or: [
//         { milestoneId: milestoneId },
//         { subMilestoneId: { $in: allSubMilestoneIds } }
//       ]
//     })
//     .populate('assignedTo.user', 'fullName email department')
//     .populate('createdBy', 'fullName email');

//     // Build hierarchy with task counts
//     const hierarchy = buildMilestoneHierarchy(milestone, tasks);

//     res.json({
//       success: true,
//       data: {
//         project: {
//           _id: project._id,
//           name: project.name,
//           code: project.code
//         },
//         hierarchy
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching milestone hierarchy:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch milestone hierarchy',
//       error: error.message
//     });
//   }
// };

// // Update sub-milestone
// const updateSubMilestone = async (req, res) => {
//   try {
//     const { projectId, milestoneId, subMilestoneId } = req.params;
//     const {
//       title,
//       description,
//       weight,
//       dueDate,
//       assignedSupervisor,
//       status
//     } = req.body;

//     const userId = req.user.userId;

//     console.log('=== UPDATE SUB-MILESTONE ===');
//     console.log('Sub-Milestone:', subMilestoneId);

//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
//     if (!subMilestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Sub-milestone not found'
//       });
//     }

//     // Check permissions
//     const user = await User.findById(userId);
//     const canEdit = subMilestone.assignedSupervisor.equals(userId) || 
//                     ['admin', 'supply_chain', 'project'].includes(user.role);

//     if (!canEdit) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to update this sub-milestone'
//       });
//     }

//     // Update fields
//     if (title) subMilestone.title = title;
//     if (description !== undefined) subMilestone.description = description;
//     if (dueDate) subMilestone.dueDate = new Date(dueDate);
//     if (assignedSupervisor) {
//       const supervisor = await User.findById(assignedSupervisor);
//       if (!supervisor) {
//         return res.status(400).json({
//           success: false,
//           message: 'Assigned supervisor not found'
//         });
//       }
//       subMilestone.assignedSupervisor = assignedSupervisor;
//     }
//     if (status) subMilestone.status = status;

//     // Handle weight change
//     if (weight && weight !== subMilestone.weight) {
//       const parent = findParentOfSubMilestone(milestone.subMilestones, subMilestoneId);
//       const siblings = parent ? parent.subMilestones : milestone.subMilestones;
      
//       const usedWeight = siblings
//         .filter(sm => sm._id.toString() !== subMilestoneId)
//         .reduce((sum, sm) => sum + (sm.weight || 0), 0);
      
//       const availableWeight = 100 - usedWeight;

//       if (weight > availableWeight) {
//         return res.status(400).json({
//           success: false,
//           message: `Insufficient weight capacity. Available: ${availableWeight}%, Requested: ${weight}%`
//         });
//       }

//       subMilestone.weight = weight;
//     }

//     subMilestone.updatedBy = userId;
//     subMilestone.updatedAt = new Date();

//     await project.save();

//     console.log('✅ Sub-milestone updated');

//     res.json({
//       success: true,
//       message: 'Sub-milestone updated successfully',
//       data: subMilestone
//     });

//   } catch (error) {
//     console.error('Error updating sub-milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update sub-milestone',
//       error: error.message
//     });
//   }
// };

// // Delete sub-milestone
// const deleteSubMilestone = async (req, res) => {
//   try {
//     const { projectId, milestoneId, subMilestoneId } = req.params;
//     const userId = req.user.userId;

//     console.log('=== DELETE SUB-MILESTONE ===');
//     console.log('Sub-Milestone:', subMilestoneId);

//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
//     if (!subMilestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Sub-milestone not found'
//       });
//     }

//     // Check permissions
//     const user = await User.findById(userId);
//     const canDelete = milestone.assignedSupervisor.equals(userId) || 
//                       ['admin', 'supply_chain', 'project'].includes(user.role);

//     if (!canDelete) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the milestone supervisor or admin can delete sub-milestones'
//       });
//     }

//     // Check if sub-milestone has nested sub-milestones
//     if (subMilestone.subMilestones && subMilestone.subMilestones.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot delete sub-milestone with nested sub-milestones. Delete nested items first.'
//       });
//     }

//     // Check if sub-milestone has tasks
//     const taskCount = await ActionItem.countDocuments({ subMilestoneId: subMilestoneId });
//     if (taskCount > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Cannot delete sub-milestone with ${taskCount} associated task(s). Delete or reassign tasks first.`
//       });
//     }

//     // Remove sub-milestone
//     removeSubMilestoneById(milestone.subMilestones, subMilestoneId);
//     await project.save();

//     console.log('✅ Sub-milestone deleted');

//     res.json({
//       success: true,
//       message: 'Sub-milestone deleted successfully'
//     });

//   } catch (error) {
//     console.error('Error deleting sub-milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete sub-milestone',
//       error: error.message
//     });
//   }
// };

// // Update sub-milestone progress based on tasks
// const updateSubMilestoneProgress = async (req, res) => {
//   try {
//     const { projectId, milestoneId, subMilestoneId } = req.params;

//     console.log('=== UPDATE SUB-MILESTONE PROGRESS ===');
//     console.log('Sub-Milestone:', subMilestoneId);

//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
//     if (!subMilestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Sub-milestone not found'
//       });
//     }

//     // Recalculate progress
//     await recalculateSubMilestoneProgress(subMilestone, subMilestoneId);
//     await project.save();

//     console.log('✅ Sub-milestone progress updated');

//     res.json({
//       success: true,
//       message: 'Sub-milestone progress recalculated',
//       data: {
//         progress: subMilestone.progress,
//         status: subMilestone.status
//       }
//     });

//   } catch (error) {
//     console.error('Error updating sub-milestone progress:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update sub-milestone progress',
//       error: error.message
//     });
//   }
// };

// // Mark sub-milestone as complete
// const completeSubMilestone = async (req, res) => {
//   try {
//     const { projectId, milestoneId, subMilestoneId } = req.params;
//     const userId = req.user.userId;

//     console.log('=== COMPLETE SUB-MILESTONE ===');
//     console.log('Sub-Milestone:', subMilestoneId);

//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         success: false,
//         message: 'Project not found'
//       });
//     }

//     const milestone = project.milestones.id(milestoneId);
//     if (!milestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Milestone not found'
//       });
//     }

//     const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
//     if (!subMilestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Sub-milestone not found'
//       });
//     }

//     // Check permissions
//     const user = await User.findById(userId);
//     if (!subMilestone.assignedSupervisor.equals(userId) && 
//         !['admin', 'supply_chain', 'project'].includes(user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the assigned supervisor can complete this sub-milestone'
//       });
//     }

//     // Check if progress is 100%
//     if (subMilestone.progress < 100) {
//       return res.status(400).json({
//         success: false,
//         message: `Sub-milestone progress must be 100% to complete. Current: ${subMilestone.progress}%`
//       });
//     }

//     // Mark as completed
//     subMilestone.status = 'Completed';
//     subMilestone.completedDate = new Date();
//     subMilestone.completedBy = userId;

//     await project.save();

//     // Recalculate parent progress
//     await recalculateMilestoneProgressFromSubMilestones(milestone);
//     await project.save();

//     console.log('✅ Sub-milestone marked as completed');

//     res.json({
//       success: true,
//       message: 'Sub-milestone completed successfully',
//       data: subMilestone
//     });

//   } catch (error) {
//     console.error('Error completing sub-milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to complete sub-milestone',
//       error: error.message
//     });
//   }
// };

// // ========== HELPER FUNCTIONS ==========

// // Recursively find sub-milestone by ID
// function findSubMilestoneById(subMilestones, targetId) {
//   for (const sm of subMilestones) {
//     if (sm._id.toString() === targetId) {
//       return sm;
//     }
//     if (sm.subMilestones && sm.subMilestones.length > 0) {
//       const found = findSubMilestoneById(sm.subMilestones, targetId);
//       if (found) return found;
//     }
//   }
//   return null;
// }

// // Find parent of a sub-milestone
// function findParentOfSubMilestone(subMilestones, targetId, parent = null) {
//   for (const sm of subMilestones) {
//     if (sm._id.toString() === targetId) {
//       return parent;
//     }
//     if (sm.subMilestones && sm.subMilestones.length > 0) {
//       const found = findParentOfSubMilestone(sm.subMilestones, targetId, sm);
//       if (found !== null) return found;
//     }
//   }
//   return null;
// }

// // Remove sub-milestone by ID
// function removeSubMilestoneById(subMilestones, targetId) {
//   for (let i = 0; i < subMilestones.length; i++) {
//     if (subMilestones[i]._id.toString() === targetId) {
//       subMilestones.splice(i, 1);
//       return true;
//     }
//     if (subMilestones[i].subMilestones && subMilestones[i].subMilestones.length > 0) {
//       if (removeSubMilestoneById(subMilestones[i].subMilestones, targetId)) {
//         return true;
//       }
//     }
//   }
//   return false;
// }

// // Get all sub-milestone IDs recursively
// function getAllSubMilestoneIds(subMilestones) {
//   const ids = [];
//   for (const sm of subMilestones) {
//     ids.push(sm._id.toString());
//     if (sm.subMilestones && sm.subMilestones.length > 0) {
//       ids.push(...getAllSubMilestoneIds(sm.subMilestones));
//     }
//   }
//   return ids;
// }

// // Build hierarchy with task counts
// function buildMilestoneHierarchy(milestone, tasks) {
//   const milestoneData = {
//     _id: milestone._id,
//     title: milestone.title,
//     description: milestone.description,
//     weight: milestone.weight,
//     progress: milestone.progress,
//     status: milestone.status,
//     dueDate: milestone.dueDate,
//     assignedSupervisor: milestone.assignedSupervisor,
//     taskCount: tasks.filter(t => t.milestoneId && t.milestoneId.equals(milestone._id)).length,
//     subMilestones: []
//   };

//   if (milestone.subMilestones && milestone.subMilestones.length > 0) {
//     milestoneData.subMilestones = buildSubMilestoneHierarchy(milestone.subMilestones, tasks);
//   }

//   return milestoneData;
// }

// // Build sub-milestone hierarchy recursively
// function buildSubMilestoneHierarchy(subMilestones, tasks) {
//   return subMilestones.map(sm => ({
//     _id: sm._id,
//     title: sm.title,
//     description: sm.description,
//     weight: sm.weight,
//     progress: sm.progress,
//     status: sm.status,
//     dueDate: sm.dueDate,
//     assignedSupervisor: sm.assignedSupervisor,
//     taskCount: tasks.filter(t => t.subMilestoneId && t.subMilestoneId.equals(sm._id)).length,
//     subMilestones: sm.subMilestones && sm.subMilestones.length > 0 
//       ? buildSubMilestoneHierarchy(sm.subMilestones, tasks)
//       : []
//   }));
// }

// // Recalculate sub-milestone progress from tasks
// async function recalculateSubMilestoneProgress(subMilestone, subMilestoneId) {
//   const completedTasks = await ActionItem.find({
//     subMilestoneId: subMilestoneId,
//     status: 'Completed'
//   });

//   if (completedTasks.length === 0) {
//     subMilestone.progress = 0;
//     subMilestone.status = 'Not Started';
//     return;
//   }

//   let totalProgress = 0;
//   completedTasks.forEach(task => {
//     if (task.completionGrade && task.completionGrade.score) {
//       const effectiveScore = (task.completionGrade.score / 5) * task.taskWeight;
//       totalProgress += effectiveScore;
//     }
//   });

//   subMilestone.progress = Math.min(100, Math.round(totalProgress));

//   if (subMilestone.progress === 0) {
//     subMilestone.status = 'Not Started';
//   } else if (subMilestone.progress >= 100) {
//     subMilestone.status = 'Completed';
//     if (!subMilestone.completedDate) {
//       subMilestone.completedDate = new Date();
//     }
//   } else {
//     subMilestone.status = 'In Progress';
//   }
// }

// // Recalculate milestone progress from sub-milestones
// async function recalculateMilestoneProgressFromSubMilestones(milestone) {
//   if (!milestone.subMilestones || milestone.subMilestones.length === 0) {
//     return;
//   }

//   const totalWeight = milestone.subMilestones.reduce((sum, sm) => sum + (sm.weight || 0), 0);
//   if (totalWeight === 0) return;

//   const weightedProgress = milestone.subMilestones.reduce((sum, sm) => {
//     return sum + ((sm.progress || 0) * (sm.weight || 0) / 100);
//   }, 0);

//   milestone.progress = Math.round(weightedProgress);

//   if (milestone.progress === 0) {
//     milestone.status = 'Not Started';
//   } else if (milestone.progress >= 100) {
//     milestone.status = 'Completed';
//   } else {
//     milestone.status = 'In Progress';
//   }
// }

// module.exports = {
//   createSubMilestone,
//   getMilestoneHierarchy,
//   updateSubMilestone,
//   deleteSubMilestone,
//   updateSubMilestoneProgress,
//   completeSubMilestone
// };