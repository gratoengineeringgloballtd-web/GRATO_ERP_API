const ActionItem = require('../models/ActionItem');
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const QuarterlyKPI = require('../models/QuarterlyKPI');
const { sendActionItemEmail } = require('../services/emailService');
const { getTaskSupervisor } = require('../config/actionItemApprovalChain');
const path = require('path');
const fs = require('fs');
const { 
  saveFile, 
  deleteFile,
  deleteFiles,
  STORAGE_CATEGORIES 
} = require('../utils/localFileStorage');
const fsSync = require('fs');

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


// // Create task under milestone
// const createTaskUnderMilestone = async (req, res) => {
//   try {
//     const {
//       projectId,
//       milestoneId,
//       title,
//       description,
//       priority,
//       dueDate,
//       taskWeight,
//       assignedTo,
//       linkedKPIs,
//       notes
//     } = req.body;

//     console.log('=== CREATE TASK UNDER MILESTONE ===');
//     console.log('Creator:', req.user.userId);
//     console.log('Assignees:', assignedTo?.length || 0);

//     // Validate required fields
//     if (!projectId || !milestoneId || !title || !description || !priority || !dueDate || !taskWeight) {
//       return res.status(400).json({
//         success: false,
//         message: 'Missing required fields'
//       });
//     }

//     // Get project and milestone
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

//     // Get creator user
//     const creator = await User.findById(req.user.userId);
//     if (!creator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Creator user not found'
//       });
//     }

//     // Validate task weight
//     const existingTasks = await ActionItem.find({ milestoneId: milestoneId });
//     const totalExistingWeight = existingTasks.reduce((sum, t) => sum + t.taskWeight, 0);
    
//     if (totalExistingWeight + taskWeight > 100) {
//       return res.status(400).json({
//         success: false,
//         message: `Task weight exceeds available capacity. Available: ${100 - totalExistingWeight}%, Requested: ${taskWeight}%`,
//         availableWeight: 100 - totalExistingWeight
//       });
//     }

//     // Handle assignment
//     let assignees = [];
//     let taskStatus = 'Not Started';
//     let supervisor = null;

//     if (!assignedTo || assignedTo.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'At least one assignee is required'
//       });
//     }

//     // CRITICAL FIX: When assigning to others, creator becomes supervisor
//     // Validate assignees and their KPIs
//     for (const assigneeId of assignedTo) {
//       const assignee = await User.findById(assigneeId);
//       if (!assignee) {
//         return res.status(400).json({
//           success: false,
//           message: `Assignee ${assigneeId} not found`
//         });
//       }

//       assignees.push({
//         user: assigneeId,
//         completionStatus: 'pending'
//       });
//     }

//     // NEW: Creator becomes the supervisor for this task
//     supervisor = {
//       name: creator.fullName,
//       email: creator.email,
//       department: creator.department
//     };

//     console.log(`✅ Task assigned to ${assignees.length} user(s)`);
//     console.log(`   Supervisor (creator): ${supervisor.name} (${supervisor.email})`);

//     // Process linked KPIs
//     const processedKPIs = [];
//     if (linkedKPIs && linkedKPIs.length > 0) {
//       for (const kpiLink of linkedKPIs) {
//         const kpiDoc = await QuarterlyKPI.findOne({
//           _id: kpiLink.kpiDocId,
//           // Don't validate employee here - could be creator's or assignee's KPIs
//           approvalStatus: 'approved'
//         });

//         if (!kpiDoc) {
//           return res.status(400).json({
//             success: false,
//             message: `No approved KPI found for KPI document ${kpiLink.kpiDocId}`
//           });
//         }

//         const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
//         if (!kpi) {
//           return res.status(400).json({
//             success: false,
//             message: `KPI index ${kpiLink.kpiIndex} not found`
//           });
//         }

//         processedKPIs.push({
//           kpiDocId: kpiLink.kpiDocId,
//           kpiIndex: kpiLink.kpiIndex,
//           kpiTitle: kpi.title,
//           kpiWeight: kpi.weight,
//           contributionToKPI: 0
//         });
//       }
//     }

//     // Create task
//     const task = new ActionItem({
//       title,
//       description,
//       priority,
//       dueDate: new Date(dueDate),
//       taskWeight,
//       assignedTo: assignees,
//       linkedKPIs: processedKPIs,
//       projectId,
//       milestoneId,
//       createdBy: req.user.userId,
//       supervisor, // Creator is the supervisor
//       status: 'Not Started', // Direct assignment - no approval needed
//       notes: notes || '',
//       creationApproval: {
//         status: 'approved',
//         approvedBy: req.user.userId,
//         approvalDate: new Date()
//       }
//     });

//     task.logActivity('created', req.user.userId, 
//       `Task created and assigned by ${creator.fullName} with weight ${taskWeight}%`);

//     await task.save();

//     // Update milestone's total task weight
//     milestone.totalTaskWeightAssigned = totalExistingWeight + taskWeight;
//     await project.save();

//     // Populate task
//     await task.populate([
//       { path: 'assignedTo.user', select: 'fullName email department' },
//       { path: 'createdBy', select: 'fullName email' },
//       { path: 'projectId', select: 'name code' },
//       { path: 'linkedKPIs.kpiDocId' }
//     ]);

//     console.log('✅ Task created - creator will grade upon completion');

//     // Send notifications to assignees
//     if (assignedTo && assignedTo.length > 0) {
//       for (const assigneeId of assignedTo) {
//         const assignee = await User.findById(assigneeId);
//         if (assignee) {
//           try {
//             await sendActionItemEmail.taskAssigned(
//               assignee.email,
//               assignee.fullName,
//               creator.fullName,
//               title,
//               description,
//               priority,
//               dueDate,
//               task._id,
//               project.name
//             );
//           } catch (emailError) {
//             console.error('Failed to send notification:', emailError);
//           }
//         }
//       }
//     }

//     res.status(201).json({
//       success: true,
//       message: 'Task created and assigned successfully',
//       data: task
//     });

//   } catch (error) {
//     console.error('Error creating task under milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create task',
//       error: error.message
//     });
//   }
// };


const createTaskUnderMilestone = async (req, res) => {
  try {
    const {
      projectId,
      milestoneId,
      title,
      description,
      priority,
      dueDate,
      taskWeight,
      assignedTo,
      linkedKPIs,
      notes
    } = req.body;

    console.log('=== CREATE TASK UNDER MILESTONE ===');
    console.log('Creator:', req.user.userId);
    console.log('Assignees:', assignedTo?.length || 0);

    // Validate required fields
    if (!projectId || !milestoneId || !title || !description || !priority || !dueDate || !taskWeight) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
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

    // Get creator user
    const creator = await User.findById(req.user.userId);
    if (!creator) {
      return res.status(404).json({
        success: false,
        message: 'Creator user not found'
      });
    }

    // Validate task weight
    const existingTasks = await ActionItem.find({ milestoneId: milestoneId });
    const totalExistingWeight = existingTasks.reduce((sum, t) => sum + t.taskWeight, 0);
    
    if (totalExistingWeight + taskWeight > 100) {
      return res.status(400).json({
        success: false,
        message: `Task weight exceeds available capacity. Available: ${100 - totalExistingWeight}%, Requested: ${taskWeight}%`,
        availableWeight: 100 - totalExistingWeight
      });
    }

    // Handle assignment
    let assignees = [];
    let supervisor = null;

    if (!assignedTo || assignedTo.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one assignee is required'
      });
    }

    // ✅ CRITICAL FIX: Validate assignees and determine supervisor
    for (const assigneeId of assignedTo) {
      const assignee = await User.findById(assigneeId);
      if (!assignee) {
        return res.status(400).json({
          success: false,
          message: `Assignee ${assigneeId} not found`
        });
      }

      assignees.push({
        user: assigneeId,
        completionStatus: 'pending'
      });
    }

    // ✅ NEW: Get supervisor based on ASSIGNEE (not creator)
    // If assigning to self, get MY supervisor
    // If assigning to others, I become the supervisor
    const firstAssigneeId = assignedTo[0];
    const firstAssignee = await User.findById(firstAssigneeId);

    if (firstAssigneeId === req.user.userId) {
      // ✅ Assigning to self - get MY supervisor from department structure
      const { getTaskSupervisor } = require('../config/actionItemApprovalChain');
      supervisor = getTaskSupervisor(firstAssignee.email, firstAssignee.department);
      
      if (!supervisor) {
        return res.status(400).json({
          success: false,
          message: 'Unable to determine your supervisor. Please contact HR.'
        });
      }
      
      console.log(`✅ Task assigned to self - supervisor: ${supervisor.name} (${supervisor.email})`);
    } else {
      // ✅ Assigning to others - creator becomes supervisor
      supervisor = {
        name: creator.fullName,
        email: creator.email,
        department: creator.department
      };
      
      console.log(`✅ Task assigned to others - creator is supervisor: ${supervisor.name}`);
    }

    console.log(`✅ Task assigned to ${assignees.length} user(s)`);
    console.log(`   Supervisor: ${supervisor.name} (${supervisor.email})`);

    // Process linked KPIs
    const processedKPIs = [];
    if (linkedKPIs && linkedKPIs.length > 0) {
      for (const kpiLink of linkedKPIs) {
        const kpiDoc = await QuarterlyKPI.findOne({
          _id: kpiLink.kpiDocId,
          approvalStatus: 'approved'
        });

        if (!kpiDoc) {
          return res.status(400).json({
            success: false,
            message: `No approved KPI found for KPI document ${kpiLink.kpiDocId}`
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
          contributionToKPI: 0
        });
      }
    }

    // Create task
    const task = new ActionItem({
      title,
      description,
      priority,
      dueDate: new Date(dueDate),
      taskWeight,
      assignedTo: assignees,
      linkedKPIs: processedKPIs,
      projectId,
      milestoneId,
      createdBy: req.user.userId,
      supervisor,
      status: 'Not Started',
      notes: notes || '',
      creationApproval: {
        status: 'approved',
        approvedBy: req.user.userId,
        approvalDate: new Date()
      }
    });

    task.logActivity('created', req.user.userId, 
      `Task created and assigned by ${creator.fullName} with weight ${taskWeight}%`);

    await task.save();

    // Update milestone's total task weight
    milestone.totalTaskWeightAssigned = totalExistingWeight + taskWeight;
    await project.save();

    // Populate task
    await task.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' },
      { path: 'projectId', select: 'name code' },
      { path: 'linkedKPIs.kpiDocId' }
    ]);

    console.log('✅ Task created - supervisor will grade upon completion');

    // Send notifications to assignees
    if (assignedTo && assignedTo.length > 0) {
      for (const assigneeId of assignedTo) {
        const assignee = await User.findById(assigneeId);
        if (assignee) {
          try {
            await sendActionItemEmail.taskAssigned(
              assignee.email,
              assignee.fullName,
              creator.fullName,
              title,
              description,
              priority,
              dueDate,
              task._id,
              project.name
            );
          } catch (emailError) {
            console.error('Failed to send notification:', emailError);
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Task created and assigned successfully',
      data: task
    });

  } catch (error) {
    console.error('Error creating task under milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create task',
      error: error.message
    });
  }
};


// Create personal task (employee creates their own task)
const createPersonalTask = async (req, res) => {
  try {
    const {
      title,
      description,
      priority,
      dueDate,
      linkedKPIs,
      notes,
      milestoneId,
      taskWeight
    } = req.body;

    console.log('=== CREATE PERSONAL TASK ===');
    console.log('User:', req.user.userId);
    console.log('Linked KPIs:', linkedKPIs?.length || 0);

    // Validate required fields
    if (!title || !description || !priority || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    if (!linkedKPIs || linkedKPIs.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Personal tasks must be linked to at least one KPI'
      });
    }

    const user = await User.findById(req.user.userId);
    const userObjectId = new mongoose.Types.ObjectId(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate milestone if provided
    let milestone = null;
    let projectId = null;
    
    if (milestoneId) {
      const Project = require('../models/Project');
      const project = await Project.findOne({ 'milestones._id': milestoneId });
      
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Milestone not found'
        });
      }

      milestone = project.milestones.id(milestoneId);
      projectId = project._id;
      
      if (!milestone) {
        return res.status(404).json({
          success: false,
          message: 'Milestone not found'
        });
      }

      if (!taskWeight || taskWeight <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Task weight is required when milestone is selected'
        });
      }

      // Check remaining weight capacity
      const existingTasks = await ActionItem.find({ milestoneId: milestoneId });
      const totalExistingWeight = existingTasks.reduce((sum, t) => sum + t.taskWeight, 0);
      
      if (totalExistingWeight + taskWeight > 100) {
        return res.status(400).json({
          success: false,
          message: `Task weight exceeds available capacity. Available: ${100 - totalExistingWeight}%, Requested: ${taskWeight}%`,
          availableWeight: 100 - totalExistingWeight
        });
      }
    }

    // Process linked KPIs
    const processedKPIs = [];
    for (const kpiLink of linkedKPIs) {
      const kpiDoc = await QuarterlyKPI.findOne({
        _id: kpiLink.kpiDocId,
        employee: req.user.userId,
        approvalStatus: 'approved'
      });

      if (!kpiDoc) {
        return res.status(400).json({
          success: false,
          message: 'You can only link to your own approved KPIs'
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
        contributionToKPI: 0
      });
    }

    // CRITICAL FIX: Get supervisor - must be different from creator
    const supervisor = getTaskSupervisor(user.fullName, user.department);
    
    if (!supervisor) {
      return res.status(400).json({
        success: false,
        message: 'Unable to determine your supervisor. Please contact HR.'
      });
    }

    // NEW: Verify supervisor is not the same as the creator
    if (supervisor.email === user.email) {
      return res.status(400).json({
        success: false,
        message: 'Personal tasks require supervisor approval. As a top-level supervisor, you cannot create personal tasks for yourself. Please create a milestone-based task instead or contact HR.'
      });
    }

    console.log(`✅ Task will be supervised by: ${supervisor.name} (${supervisor.email})`);
    console.log(`   Employee: ${user.fullName} (${user.email})`);

    // Create personal task
    const task = new ActionItem({
      title,
      description,
      priority,
      dueDate: new Date(dueDate),
      taskWeight: milestoneId ? taskWeight : 0,
      assignedTo: [{
        user: req.user.userId,
        completionStatus: 'pending'
      }],
      linkedKPIs: processedKPIs,
      projectId: projectId,
      milestoneId: milestoneId || null,
      createdBy: req.user.userId,
      supervisor: {
        name: supervisor.name,
        email: supervisor.email,
        department: supervisor.department
      },
      status: 'Pending Approval',
      notes: notes || '',
      creationApproval: {
        status: 'pending'
      }
    });

    task.logActivity('created', req.user.userId, 
      `Personal task created${milestoneId ? ' with milestone' : ''} - pending supervisor approval from ${supervisor.name}`);

    await task.save();

    // Update milestone weight if applicable
    if (milestoneId) {
      const Project = require('../models/Project');
      const project = await Project.findOne({ 'milestones._id': milestoneId });
      const milestone = project.milestones.id(milestoneId);
      milestone.totalTaskWeightAssigned = (milestone.totalTaskWeightAssigned || 0) + taskWeight;
      await project.save();
    }

    await task.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' },
      { path: 'linkedKPIs.kpiDocId' }
    ]);

    console.log('✅ Personal task created - supervisor will approve and grade');

    // Send notification to supervisor
    try {
      await sendActionItemEmail.taskCreationApproval(
        supervisor.email,
        supervisor.name,
        user.fullName,
        title,
        description,
        priority,
        dueDate,
        task._id,
        null
      );
    } catch (emailError) {
      console.error('Failed to send supervisor notification:', emailError);
    }

    res.status(201).json({
      success: true,
      message: `Personal task created and sent to ${supervisor.name} for approval`,
      data: task
    });

  } catch (error) {
    console.error('Error creating personal task:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create personal task',
      error: error.message
    });
  }
};




const submitCompletionForAssignee = async (req, res) => {
  try {
    const { id } = req.params;
    const { completionNotes } = req.body;
    const userId = req.user.userId;

    console.log('=== SUBMIT COMPLETION FOR ASSIGNEE ===');
    console.log('Task ID:', id);
    console.log('User ID:', userId);
    console.log('Files:', req.files?.length || 0);

    const task = await ActionItem.findById(id)
      .populate('assignedTo.user', 'fullName email department')
      .populate('createdBy', 'fullName email');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check if user is an assignee
    const assignee = task.assignedTo.find(a => a.user._id.equals(userId));
    if (!assignee) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this task'
      });
    }

    // Check if task is in valid state
    if (task.status === 'Pending Approval') {
      return res.status(400).json({
        success: false,
        message: 'Task must be approved by supervisor before you can work on it'
      });
    }

    if (assignee.completionStatus === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Your completion has already been approved'
      });
    }

    // ✅ UPDATED: Process uploaded documents using local storage
    let documents = [];
    if (req.files && req.files.length > 0) {
      console.log(`📎 Processing ${req.files.length} completion document(s)...`);

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        
        try {
          console.log(`   Processing file ${i + 1}/${req.files.length}: ${file.originalname}`);
          
          // ✅ Save file using local storage utility
          const fileMetadata = await saveFile(
            file,
            STORAGE_CATEGORIES.ACTION_ITEMS, // You'll need to add this category
            'completion-docs', // subfolder
            null // auto-generate filename
          );

          documents.push({
            name: file.originalname,
            url: fileMetadata.url,
            publicId: fileMetadata.publicId,
            localPath: fileMetadata.localPath, // ✅ Store local path
            size: file.size,
            mimetype: file.mimetype,
            uploadedAt: new Date()
          });

          console.log(`   ✅ Saved: ${fileMetadata.publicId}`);

        } catch (fileError) {
          console.error(`   ❌ Error processing ${file.originalname}:`, fileError);
          continue;
        }
      }

      console.log(`✅ ${documents.length} document(s) processed successfully`);
    }

    if (documents.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one document must be uploaded'
      });
    }

    // Update assignee's submission
    assignee.completionStatus = 'submitted';
    assignee.completionDocuments = documents;
    assignee.completionNotes = completionNotes || '';
    assignee.submittedAt = new Date();

    // Update task status if this is the first submission
    if (task.status === 'Not Started' || task.status === 'In Progress') {
      task.status = 'Pending Completion Approval';
    }

    task.logActivity('submitted_for_completion', userId, 
      `Completion submitted with ${documents.length} document(s)`);

    await task.save();

    // Send notification to supervisor
    try {
      const user = await User.findById(userId);
      await sendActionItemEmail.taskCompletionApproval(
        task.supervisor.email,
        task.supervisor.name,
        user.fullName,
        task.title,
        task.description,
        task._id,
        documents.length,
        completionNotes
      );
    } catch (emailError) {
      console.error('Failed to send supervisor notification:', emailError);
    }

    console.log('✅ Completion submitted for assignee');

    res.json({
      success: true,
      message: 'Completion submitted for supervisor approval',
      data: task,
      documentsUploaded: documents.length
    });

  } catch (error) {
    console.error('Error submitting completion:', error);

    // ✅ UPDATED: Clean up uploaded files if submission failed
    if (req.files && req.files.length > 0) {
      console.log('Cleaning up uploaded files due to error...');
      await Promise.allSettled(
        req.files.map(file => {
          if (file.path && fsSync.existsSync(file.path)) {
            return fs.promises.unlink(file.path).catch(e => 
              console.error('File cleanup failed:', e)
            );
          }
        })
      );
    }

    res.status(500).json({
      success: false,
      message: 'Failed to submit completion',
      error: error.message
    });
  }
};



// const approveCompletionForAssignee = async (req, res) => {
//   try {
//     const { id, assigneeId } = req.params;
//     const { grade, qualityNotes, comments } = req.body;
//     const userId = req.user.userId;

//     console.log('=== APPROVE COMPLETION FOR ASSIGNEE ===');
//     console.log('Task ID:', id);
//     console.log('Assignee ID:', assigneeId);
//     console.log('Grade:', grade);

//     // ✅ UPDATED: Validate grade with decimal support
//     if (!grade || grade < 1.0 || grade > 5.0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Grade must be between 1.0 and 5.0'
//       });
//     }

//     // Optional: Validate that grade has at most 1 decimal place
//     if (!Number.isInteger(grade * 10)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Grade can have at most 1 decimal place (e.g., 3.5, 4.2)'
//       });
//     }

//     const task = await ActionItem.findById(id)
//       .populate('assignedTo.user', 'fullName email department')
//       .populate('linkedKPIs.kpiDocId');

//     if (!task) {
//       return res.status(404).json({
//         success: false,
//         message: 'Task not found'
//       });
//     }

//     const user = await User.findById(userId);
    
//     console.log('Task supervisor:', task.supervisor.email);
//     console.log('Current user:', user.email);
    
//     const isTheSupervisor = task.supervisor.email === user.email;
//     const isAdmin = user.role === 'admin';

//     if (!isTheSupervisor && !isAdmin) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the assigned supervisor can approve this completion'
//       });
//     }

//     const assignee = task.assignedTo.find(a => a.user._id.equals(assigneeId));
//     if (!assignee) {
//       return res.status(404).json({
//         success: false,
//         message: 'Assignee not found for this task'
//       });
//     }

//     if (assignee.completionStatus !== 'submitted') {
//       return res.status(400).json({
//         success: false,
//         message: 'Assignee has not submitted completion yet'
//       });
//     }

//     // Approve completion with decimal grading
//     await task.approveCompletionForAssignee(userId, assigneeId, grade, qualityNotes, comments);
//     await task.save();

//     await task.populate([
//       { path: 'assignedTo.user', select: 'fullName email department' },
//       { path: 'linkedKPIs.kpiDocId' }
//     ]);

//     // Send notification to assignee
//     try {
//       const assigneeUser = await User.findById(assigneeId);
//       await sendActionItemEmail.taskCompletionApproved(
//         assigneeUser.email,
//         assigneeUser.fullName,
//         user.fullName,
//         task.title,
//         task._id,
//         comments,
//         grade
//       );
//     } catch (emailError) {
//       console.error('Failed to send notification:', emailError);
//     }

//     console.log('✅ Completion approved with grade:', grade.toFixed(1));

//     res.json({
//       success: true,
//       message: `Completion approved with grade ${grade.toFixed(1)}/5.0`,
//       data: task
//     });

//   } catch (error) {
//     console.error('Error approving completion:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to approve completion',
//       error: error.message
//     });
//   }
// };



const approveCompletionForAssignee = async (req, res) => {
  try {
    const { id, assigneeId } = req.params;
    const { grade, qualityNotes, comments } = req.body;
    const userId = req.user.userId;

    console.log('=== APPROVE COMPLETION FOR ASSIGNEE ===');
    console.log('Task ID:', id);
    console.log('Assignee ID:', assigneeId);
    console.log('Grade:', grade);

    // ✅ Validate grade with decimal support
    if (!grade || grade < 1.0 || grade > 5.0) {
      return res.status(400).json({
        success: false,
        message: 'Grade must be between 1.0 and 5.0'
      });
    }

    // Validate that grade has at most 1 decimal place
    if (!Number.isInteger(grade * 10)) {
      return res.status(400).json({
        success: false,
        message: 'Grade can have at most 1 decimal place (e.g., 3.5, 4.2)'
      });
    }

    const task = await ActionItem.findById(id)
      .populate('assignedTo.user', 'fullName email department')
      .populate('linkedKPIs.kpiDocId');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const user = await User.findById(userId);
    
    console.log('Task supervisor:', task.supervisor.email);
    console.log('Current user:', user.email);
    
    const isTheSupervisor = task.supervisor.email === user.email;
    const isAdmin = user.role === 'admin';

    if (!isTheSupervisor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned supervisor can approve this completion'
      });
    }

    const assignee = task.assignedTo.find(a => a.user._id.equals(assigneeId));
    if (!assignee) {
      return res.status(404).json({
        success: false,
        message: 'Assignee not found for this task'
      });
    }

    if (assignee.completionStatus !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Assignee has not submitted completion yet'
      });
    }

    // ✅ Check if already graded
    if (assignee.completionGrade && assignee.completionGrade.score) {
      return res.status(400).json({
        success: false,
        message: 'This completion has already been graded'
      });
    }

    // Approve completion with decimal grading
    await task.approveCompletionForAssignee(userId, assigneeId, grade, qualityNotes, comments);
    await task.save();

    await task.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'linkedKPIs.kpiDocId' }
    ]);

    // Send notification to assignee
    try {
      const assigneeUser = await User.findById(assigneeId);
      await sendActionItemEmail.taskCompletionApproved(
        assigneeUser.email,
        assigneeUser.fullName,
        user.fullName,
        task.title,
        task._id,
        comments,
        grade
      );
    } catch (emailError) {
      console.error('Failed to send notification:', emailError);
    }

    console.log('✅ Completion approved with grade:', grade.toFixed(1));

    res.json({
      success: true,
      message: `Completion approved with grade ${grade.toFixed(1)}/5.0`,
      data: task
    });

  } catch (error) {
    console.error('Error approving completion:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve completion',
      error: error.message
    });
  }
};


const rejectCompletionForAssignee = async (req, res) => {
  try {
    const { id, assigneeId } = req.params;
    const { comments } = req.body;
    const userId = req.user.userId;

    console.log('=== REJECT COMPLETION FOR ASSIGNEE ===');
    console.log('Task ID:', id);
    console.log('Assignee ID:', assigneeId);

    if (!comments) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const task = await ActionItem.findById(id)
      .populate('assignedTo.user', 'fullName email department');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // ✅ FIX: Verify user is THE supervisor (not just has admin role)
    const user = await User.findById(userId);
    
    console.log('Task supervisor:', task.supervisor.email);
    console.log('Current user:', user.email);
    
    const isTheSupervisor = task.supervisor.email === user.email;
    const isAdmin = user.role === 'admin';

    if (!isTheSupervisor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned supervisor can reject this completion'
      });
    }

    // Find assignee
    const assignee = task.assignedTo.find(a => a.user._id.equals(assigneeId));
    if (!assignee) {
      return res.status(404).json({
        success: false,
        message: 'Assignee not found for this task'
      });
    }

    if (assignee.completionStatus !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Assignee has not submitted completion yet'
      });
    }

    // Reject completion
    task.rejectCompletionForAssignee(userId, assigneeId, comments);
    await task.save();

    // Send notification to assignee
    try {
      const assigneeUser = await User.findById(assigneeId);
      await sendActionItemEmail.taskCompletionRejected(
        assigneeUser.email,
        assigneeUser.fullName,
        user.fullName,
        task.title,
        task._id,
        comments
      );
    } catch (emailError) {
      console.error('Failed to send notification:', emailError);
    }

    console.log('❌ Completion rejected for assignee');

    res.json({
      success: true,
      message: 'Completion rejected - sent back for revision',
      data: task
    });

  } catch (error) {
    console.error('Error rejecting completion:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject completion',
      error: error.message
    });
  }
};


// Get tasks for milestone
const getMilestoneTasks = async (req, res) => {
  try {
    const { milestoneId } = req.params;

    console.log('=== GET MILESTONE TASKS ===');
    console.log('Milestone:', milestoneId);

    const tasks = await ActionItem.find({ milestoneId })
      .populate('assignedTo.user', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .populate('linkedKPIs.kpiDocId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: tasks,
      count: tasks.length
    });

  } catch (error) {
    console.error('Error fetching milestone tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch milestone tasks',
      error: error.message
    });
  }
};

// Reassign task
const reassignTask = async (req, res) => {
  try {
    const { id } = req.params;
    const { newAssignees } = req.body; // Array of user IDs

    console.log('=== REASSIGN TASK ===');
    console.log('Task ID:', id);
    console.log('New Assignees:', newAssignees?.length || 0);

    if (!newAssignees || newAssignees.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one assignee is required'
      });
    }

    const task = await ActionItem.findById(id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Verify user is creator or supervisor
    const user = await User.findById(req.user.userId);
    const isCreator = task.createdBy.equals(req.user.userId);
    const isSupervisor = task.supervisor.email === user.email;

    if (!isCreator && !isSupervisor && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only the task creator or supervisor can reassign tasks'
      });
    }

    // Validate new assignees
    for (const assigneeId of newAssignees) {
      const assignee = await User.findById(assigneeId);
      if (!assignee) {
        return res.status(400).json({
          success: false,
          message: `User ${assigneeId} not found`
        });
      }
    }

    const oldAssignees = task.assignedTo.map(a => a.user.toString());

    // Update assignees
    task.assignedTo = newAssignees.map(userId => ({
      user: userId,
      completionStatus: 'pending'
    }));

    task.logActivity('reassigned', req.user.userId, 
      `Task reassigned from ${oldAssignees.length} to ${newAssignees.length} assignee(s)`,
      oldAssignees,
      newAssignees
    );

    await task.save();

    await task.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' }
    ]);

    // Send notifications to new assignees
    for (const assigneeId of newAssignees) {
      const assignee = await User.findById(assigneeId);
      if (assignee) {
        try {
          await sendActionItemEmail.taskAssigned(
            assignee.email,
            assignee.fullName,
            user.fullName,
            task.title,
            task.description,
            task.priority,
            task.dueDate,
            task._id,
            task.projectId?.name || null
          );
        } catch (emailError) {
          console.error('Failed to send notification:', emailError);
        }
      }
    }

    console.log('✅ Task reassigned');

    res.json({
      success: true,
      message: 'Task reassigned successfully',
      data: task
    });

  } catch (error) {
    console.error('Error reassigning task:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reassign task',
      error: error.message
    });
  }
};


const getActionItems = async (req, res) => {
  try {
    const { status, priority, projectId, assignedTo, view, page = 1, limit = 50 } = req.query;
    const user = await User.findById(req.user.userId);
    const userObjectId = new mongoose.Types.ObjectId(req.user.userId);

    console.log('=== GET ACTION ITEMS ===');
    console.log(`User: ${user.fullName} (${user.role})`);
    console.log(`Email: ${user.email}`);
    console.log(`View: ${view || 'default'}`);

    let filter = {};

    // Check if user IS a supervisor (not if role === 'supervisor')
    const isSupervisorOf = await ActionItem.countDocuments({ 
      'supervisor.email': user.email 
    });

    console.log(`User supervises ${isSupervisorOf} tasks`);

    // Apply view-based filters
    if (view === 'my-tasks') {
      // Tasks assigned to me
      filter['assignedTo.user'] = req.user.userId;
      
    } else if (view === 'team-tasks') {
      if (['admin', 'supply_chain'].includes(user.role)) {
        // Admins and supply chain see ALL tasks
        // No additional filter
      } else if (isSupervisorOf > 0) {
        // If user supervises ANY tasks, show:
        // 1. Tasks they supervise
        // 2. Tasks assigned to them
        // 3. Tasks in their department
        const departmentUsers = await User.find({ department: user.department }).select('_id');
        
        filter.$or = [
          { 'supervisor.email': user.email },
          { 'assignedTo.user': req.user.userId },
          { 'assignedTo.user': { $in: departmentUsers.map(u => u._id) } }
        ];
      } else {
        // Not a supervisor - just show own tasks
        filter['assignedTo.user'] = req.user.userId;
      }
      
    } else if (view === 'project-tasks') {
      if (projectId) {
        filter.projectId = projectId;
      } else {
        filter.projectId = { $ne: null };
      }
      
    } else if (view === 'standalone-tasks') {
      filter.projectId = null;
      
    } else if (view === 'my-approvals') {
      // ✅ CRITICAL FIX: Show ONLY tasks that need MY approval
      // Includes creation approvals (supervisor) and completion approvals (L1/L2/L3)
      // Do NOT show tasks where I'm an assignee

      const completionStatuses = [
        'Pending Completion Approval',
        'Pending L1 Grading',
        'Pending L2 Review',
        'Pending L3 Final Approval'
      ];

      if (['admin', 'supply_chain'].includes(user.role)) {
        // Admins see all pending approvals across the system
        filter.status = { $in: ['Pending Approval', ...completionStatuses] };
      } else {
        filter.$and = [
          {
            // ✅ Exclude tasks where I'm an assignee
            'assignedTo.user': { $ne: req.user.userId }
          },
          {
            $or: [
              // Creation approvals (supervisor of task)
              {
                status: 'Pending Approval',
                'supervisor.email': user.email
              },
              // Completion approvals (L1/L2/L3 based on approval chain)
              {
                status: { $in: completionStatuses },
                assignedTo: {
                  $elemMatch: {
                    completionApprovalChain: {
                      $elemMatch: {
                        status: 'pending',
                        $or: [
                          { 'approver.email': user.email },
                          { 'approver.userId': userObjectId }
                        ]
                      }
                    }
                  }
                }
              }
            ]
          }
        ];
      }

      console.log('My Approvals Filter:', JSON.stringify(filter, null, 2));

    } else {
      // Default view - show own tasks
      filter['assignedTo.user'] = req.user.userId;
    }

    // Apply additional filters
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (projectId && view !== 'project-tasks') filter.projectId = projectId;
    if (assignedTo) filter['assignedTo.user'] = assignedTo;

    console.log('Final Filter:', JSON.stringify(filter, null, 2));

    const tasks = await ActionItem.find(filter)
      .populate('assignedTo.user', 'fullName email department position')
      .populate('createdBy', 'fullName email')
      .populate('projectId', 'name code department')
      .sort({ dueDate: 1, priority: -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ActionItem.countDocuments(filter);

    console.log(`Found ${tasks.length} action items`);

    // Additional debug for 'my-approvals' view
    if (view === 'my-approvals' && tasks.length === 0) {
      console.log('=== DEBUG: No tasks found for approval ===');
      
      // Check if there are ANY tasks supervised by this user
      const supervisedTasks = await ActionItem.find({ 
        'supervisor.email': user.email 
      }).select('title status assignedTo');
      
      console.log(`Total tasks supervised: ${supervisedTasks.length}`);
      
      if (supervisedTasks.length > 0) {
        console.log('Supervised tasks:');
        for (const task of supervisedTasks) {
          const assigneeIds = task.assignedTo.map(a => a.user.toString());
          const isAssignee = assigneeIds.includes(req.user.userId.toString());
          
          console.log({
            title: task.title,
            status: task.status,
            isUserAnAssignee: isAssignee,
            needsApproval: ['Pending Approval', 'Pending Completion Approval', 'Pending L1 Grading'].includes(task.status)
          });
        }
      }
    }

    res.json({
      success: true,
      data: tasks,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: tasks.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get action items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch action items',
      error: error.message
    });
  }
};


// Get action item statistics
const getActionItemStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    let filter = {};

    if (['supply_chain', 'admin'].includes(user.role)) {
      // See all tasks
    } else if (user.role === 'supervisor') {
      const departmentUsers = await User.find({ department: user.department }).select('_id');
      filter['assignedTo.user'] = { $in: departmentUsers.map(u => u._id) }; // Changed
    } else {
      filter['assignedTo.user'] = req.user.userId; // Changed
    }

    const [total, notStarted, inProgress, completed, onHold, overdue] = await Promise.all([
      ActionItem.countDocuments(filter),
      ActionItem.countDocuments({ ...filter, status: 'Not Started' }),
      ActionItem.countDocuments({ ...filter, status: 'In Progress' }),
      ActionItem.countDocuments({ ...filter, status: 'Completed' }),
      ActionItem.countDocuments({ ...filter, status: 'On Hold' }),
      ActionItem.countDocuments({
        ...filter,
        status: { $ne: 'Completed' },
        dueDate: { $lt: new Date() }
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        notStarted,
        inProgress,
        completed,
        onHold,
        overdue,
        pending: notStarted + inProgress
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};

// Create new action item
const createActionItem = async (req, res) => {
  try {
    const { title, description, priority, dueDate, projectId, notes, tags, assignedTo } = req.body;

    console.log('=== CREATE ACTION ITEM ===');
    console.log('Title:', title);
    console.log('Created By:', req.user.userId);
    console.log('Assigned To:', assignedTo);

    // Validate inputs
    if (!title || !description || !priority || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title, description, priority, or dueDate'
      });
    }

    const creator = await User.findById(req.user.userId);
    if (!creator) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate project if provided
    let project = null;
    if (projectId) {
      project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found'
        });
      }
    }

    // Determine task status and assignee
    let taskStatus = 'Pending Approval';
    let taskAssignedTo = []; // Changed: Initialize as array
    let supervisor = null;

    // If assigning to someone else (user is supervisor/admin)
    if (assignedTo && assignedTo !== req.user.userId) {
      const assignedUser = await User.findById(assignedTo);
      if (!assignedUser) {
        return res.status(404).json({
          success: false,
          message: 'Assigned user not found'
        });
      }

      // Only supervisors/admins can assign to others
      if (!['supervisor', 'admin', 'supply_chain'].includes(creator.role)) {
        return res.status(403).json({
          success: false,
          message: 'Only supervisors and admins can assign tasks to other users'
        });
      }

      // Changed: Use array format
      taskAssignedTo = [{
        user: assignedTo,
        completionStatus: 'pending'
      }];
      taskStatus = 'Not Started';
      supervisor = {
        name: creator.fullName,
        email: creator.email,
        department: creator.department
      };

      console.log(`Task assigned to: ${assignedUser.fullName}`);
    } else {
      // Self-assigned task - needs supervisor approval
      // Changed: Use array format for self-assignment
      taskAssignedTo = [{
        user: req.user.userId,
        completionStatus: 'pending'
      }];

      supervisor = getTaskSupervisor(creator.fullName, creator.department);

      if (!supervisor) {
        return res.status(400).json({
          success: false,
          message: 'Unable to determine your immediate supervisor. Please contact HR for assistance.'
        });
      }

      console.log(`Immediate Supervisor: ${supervisor.name} (${supervisor.email})`);
    }

    // Create action item
    const actionItem = new ActionItem({
      title,
      description,
      priority,
      dueDate: new Date(dueDate),
      projectId: project ? project._id : null,
      assignedTo: taskAssignedTo, // Now using array format
      createdBy: req.user.userId,
      notes: notes || '',
      tags: tags || [],
      status: taskStatus,
      progress: 0,
      supervisor: supervisor,
      creationApproval: {
        status: taskStatus === 'Pending Approval' ? 'pending' : 'approved',
        approvedBy: taskStatus === 'Pending Approval' ? null : req.user.userId,
        approvalDate: taskStatus === 'Pending Approval' ? null : new Date()
      },
      completionApproval: {
        status: 'not_submitted'
      }
    });

    // Link to KPI if provided
    if (req.body.linkedKPI && req.body.linkedKPI.kpiDocId && req.body.linkedKPI.kpiIndex !== undefined) {
      try {
        await linkTaskToKPI(
          actionItem._id,
          req.body.linkedKPI.kpiDocId,
          req.body.linkedKPI.kpiIndex
        );
        console.log('✅ Task linked to KPI');
      } catch (kpiError) {
        console.error('Failed to link task to KPI:', kpiError);
        // Continue without failing - task is created
      }
    }

    // Log creation activity
    const logMessage = assignedTo && assignedTo !== req.user.userId
      ? `Task created by ${creator.fullName} and assigned to ${(await User.findById(assignedTo)).fullName}`
      : `Task created by ${creator.fullName} - pending supervisor approval`;
    
    actionItem.logActivity('created', req.user.userId, logMessage);

    await actionItem.save();

    // Populate references
    await actionItem.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' },
      { path: 'projectId', select: 'name code' }
    ]);

    console.log('✅ Action item created');

    // Send appropriate notifications
    if (assignedTo && assignedTo !== req.user.userId) {
      // Task assigned - notify assigned user
      try {
        const assignedUser = await User.findById(assignedTo);
        await sendActionItemEmail.taskAssigned(
          assignedUser.email,
          assignedUser.fullName,
          creator.fullName,
          title,
          description,
          priority,
          dueDate,
          actionItem._id,
          project ? project.name : null
        );
        console.log(`✅ Assignment notification sent to: ${assignedUser.email}`);
      } catch (emailError) {
        console.error('Failed to send assignment notification:', emailError);
      }
    } else {
      // Self-assigned - notify supervisor for approval
      try {
        await sendActionItemEmail.taskCreationApproval(
          supervisor.email,
          supervisor.name,
          creator.fullName,
          title,
          description,
          priority,
          dueDate,
          actionItem._id,
          project ? project.name : null
        );
        console.log(`✅ Approval notification sent to supervisor: ${supervisor.email}`);
      } catch (emailError) {
        console.error('Failed to send supervisor notification:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: assignedTo && assignedTo !== req.user.userId 
        ? 'Task created and assigned to user' 
        : 'Task created and sent to your supervisor for approval',
      data: actionItem
    });

  } catch (error) {
    console.error('Create action item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create action item',
      error: error.message
    });
  }
};


const processCreationApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, comments } = req.body;

    console.log('=== TASK CREATION APPROVAL DECISION ===');
    console.log('Task ID:', id);
    console.log('Decision:', decision);

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be "approve" or "reject"'
      });
    }

    const user = await User.findById(req.user.userId);
    
    // Fetch the action item
    let actionItem = await ActionItem.findById(id);

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    console.log('Task supervisor:', actionItem.supervisor.email);
    console.log('Current user:', user.email);

    // ✅ FIX: Check if user is THE supervisor (not just has role 'supervisor')
    const isTheSupervisor = actionItem.supervisor.email === user.email;
    const isAdmin = ['admin', 'supply_chain'].includes(user.role);

    if (!isTheSupervisor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned supervisor can approve this task'
      });
    }

    // Check if task is pending approval
    if (actionItem.status !== 'Pending Approval') {
      return res.status(400).json({
        success: false,
        message: 'Task is not pending approval'
      });
    }

    // Fix the assignedTo array if it has buffer/invalid data
    const validAssignedTo = actionItem.assignedTo.filter(assignee => {
      if (assignee.user) {
        return true;
      }
      if (assignee.buffer) {
        const userId = assignee.buffer;
        assignee.user = userId;
        return true;
      }
      return false;
    });

    actionItem.assignedTo = validAssignedTo;

    // Now populate to get user details for emails
    await actionItem.populate('assignedTo.user', 'fullName email department');
    await actionItem.populate('createdBy', 'fullName email');

    console.log('BEFORE APPROVAL - assignedTo:', JSON.stringify(actionItem.assignedTo, null, 2));

    // Store email recipients BEFORE calling approval methods
    const emailRecipients = actionItem.assignedTo
      .filter(assignee => assignee.user && assignee.user.email)
      .map(assignee => ({
        email: assignee.user.email,
        fullName: assignee.user.fullName
      }));

    console.log('Email recipients:', emailRecipients);

    if (decision === 'approve') {
      actionItem.status = 'In Progress';
      actionItem.creationApproval = {
        status: 'approved',
        approvedBy: req.user.userId,
        approvedAt: new Date(),
        comments: comments || ''
      };

      actionItem.activityLog.push({
        action: 'creation_approved',
        performedBy: req.user.userId,
        timestamp: new Date(),
        details: `Task creation approved by ${user.fullName}${comments ? `: ${comments}` : ''}`,
        oldValue: 'Pending Approval',
        newValue: 'In Progress'
      });

      // Send notification to ALL assigned users
      const emailPromises = emailRecipients.map(async (recipient) => {
        try {
          await sendActionItemEmail.taskCreationApproved(
            recipient.email,
            recipient.fullName,
            user.fullName,
            actionItem.title,
            actionItem._id,
            comments
          );
        } catch (emailError) {
          console.error(`Failed to send approval notification to ${recipient.email}:`, emailError);
        }
      });

      await Promise.allSettled(emailPromises);

      console.log('✅ Task CREATION APPROVED - Employee(s) can now start work');
    } else {
      actionItem.status = 'Rejected';
      actionItem.creationApproval = {
        status: 'rejected',
        rejectedBy: req.user.userId,
        rejectedAt: new Date(),
        comments: comments || 'No reason provided'
      };

      actionItem.activityLog.push({
        action: 'creation_rejected',
        performedBy: req.user.userId,
        timestamp: new Date(),
        details: `Task creation rejected by ${user.fullName}: ${comments || 'No reason provided'}`,
        oldValue: 'Pending Approval',
        newValue: 'Rejected'
      });

      // Send notification to ALL assigned users
      const emailPromises = emailRecipients.map(async (recipient) => {
        try {
          await sendActionItemEmail.taskCreationRejected(
            recipient.email,
            recipient.fullName,
            user.fullName,
            actionItem.title,
            actionItem._id,
            comments
          );
        } catch (emailError) {
          console.error(`Failed to send rejection notification to ${recipient.email}:`, emailError);
        }
      });

      await Promise.allSettled(emailPromises);

      console.log('❌ Task CREATION REJECTED');
    }

    await actionItem.save({ validateModifiedOnly: true });

    console.log('=== CREATION APPROVAL DECISION PROCESSED ===');

    res.json({
      success: true,
      message: `Task creation ${decision}d successfully`,
      data: actionItem
    });

  } catch (error) {
    console.error('Creation approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process creation approval',
      error: error.message
    });
  }
};


// Submit task for COMPLETION approval
const submitForCompletion = async (req, res) => {
  try {
    const { id } = req.params;
    const { completionNotes } = req.body;

    console.log('=== SUBMIT TASK FOR COMPLETION APPROVAL ===');
    console.log('Task ID:', id);
    console.log('Files:', req.files?.length || 0);

    const actionItem = await ActionItem.findById(id)
      .populate('assignedTo', 'fullName email department')
      .populate('createdBy', 'fullName email');

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    // Check permissions
    if (!actionItem.assignedTo._id.equals(req.user.userId)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned person can submit this task for completion approval'
      });
    }

    // Check if task can be submitted
    if (actionItem.status === 'Pending Approval') {
      return res.status(400).json({
        success: false,
        message: 'Task must be approved by supervisor before you can work on it'
      });
    }

    if (actionItem.status === 'Pending Completion Approval') {
      return res.status(400).json({
        success: false,
        message: 'Task is already pending completion approval'
      });
    }

    if (actionItem.status === 'Completed') {
      return res.status(400).json({
        success: false,
        message: 'Task is already completed and approved'
      });
    }

    if (actionItem.status === 'Rejected') {
      return res.status(400).json({
        success: false,
        message: 'Task creation was rejected. Please create a new task.'
      });
    }

    // Process completion documents
    let documents = [];
    if (req.files && req.files.length > 0) {
      console.log(`Processing ${req.files.length} completion documents`);

      const uploadDir = path.join(__dirname, '../uploads/action-items');

      try {
        await fs.promises.mkdir(uploadDir, { recursive: true });
        console.log(`✓ Upload directory ready: ${uploadDir}`);
      } catch (dirError) {
        console.error('Failed to create upload directory:', dirError);
        throw new Error('Failed to prepare upload directory');
      }

      for (const file of req.files) {
        try {
          console.log(`Processing file: ${file.originalname}`);

          const timestamp = Date.now();
          const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
          const fileName = `${timestamp}-${sanitizedName}`;
          const filePath = path.join(uploadDir, fileName);

          if (!file.path || !fs.existsSync(file.path)) {
            console.error(`Temp file not found: ${file.path}`);
            continue;
          }

          await fs.promises.rename(file.path, filePath);

          console.log(`✓ File saved: ${fileName}`);

          documents.push({
            name: file.originalname,
            url: `/uploads/action-items/${fileName}`,
            publicId: fileName,
            size: file.size,
            mimetype: file.mimetype,
            uploadedAt: new Date()
          });
        } catch (fileError) {
          console.error(`Error processing file ${file.originalname}:`, fileError);

          if (file.path && fs.existsSync(file.path)) {
            try {
              await fs.promises.unlink(file.path);
            } catch (cleanupError) {
              console.error('Failed to clean up temp file:', cleanupError);
            }
          }
          continue;
        }
      }

      console.log(`Successfully processed ${documents.length} documents`);
    }

    // Submit for completion approval
    actionItem.submitForCompletion(req.user.userId, documents, completionNotes);
    await actionItem.save();

    // Send notification to supervisor
    try {
      await sendActionItemEmail.taskCompletionApproval(
        actionItem.supervisor.email,
        actionItem.supervisor.name,
        actionItem.assignedTo.fullName,
        actionItem.title,
        actionItem.description,
        actionItem._id,
        documents.length,
        completionNotes
      );
      console.log(`✅ Completion approval notification sent to supervisor: ${actionItem.supervisor.email}`);
    } catch (emailError) {
      console.error('Failed to send supervisor notification:', emailError);
    }

    console.log('=== TASK SUBMITTED FOR COMPLETION APPROVAL ===');

    res.json({
      success: true,
      message: 'Task submitted for supervisor completion approval',
      data: actionItem,
      documentsUploaded: {
        count: documents.length,
        files: documents.map(d => ({ name: d.name, size: d.size }))
      }
    });

  } catch (error) {
    console.error('Submit for completion error:', error);

    // Clean up uploaded files if submission failed
    if (req.files && req.files.length > 0) {
      await Promise.allSettled(
        req.files.map(file => {
          if (file.path && fs.existsSync(file.path)) {
            return fs.promises.unlink(file.path).catch(e => console.error('File cleanup failed:', e));
          }
        })
      );
    }

    res.status(500).json({
      success: false,
      message: 'Failed to submit task for completion approval',
      error: error.message
    });
  }
};

// Approve/Reject task COMPLETION
// Approve/Reject task COMPLETION (with grading)
const processCompletionApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, comments, grade, qualityNotes } = req.body;

    console.log('=== TASK COMPLETION APPROVAL DECISION ===');
    console.log('Task ID:', id);
    console.log('Decision:', decision);
    console.log('Grade:', grade);

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be "approve" or "reject"'
      });
    }

    // Validate grade if approving
    if (decision === 'approve') {
      if (!grade || grade < 1 || grade > 5) {
        return res.status(400).json({
          success: false,
          message: 'Grade is required and must be between 1 and 5 when approving completion'
        });
      }
    }

    const user = await User.findById(req.user.userId);
    const actionItem = await ActionItem.findById(id)
      .populate('assignedTo', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .populate('linkedKPI.kpiDocId');

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    // Check if this user is the supervisor
    if (actionItem.supervisor.email !== user.email && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only the immediate supervisor can approve this task'
      });
    }

    // Check if task is pending completion approval
    if (actionItem.status !== 'Pending Completion Approval') {
      return res.status(400).json({
        success: false,
        message: 'Task is not pending completion approval'
      });
    }

    if (decision === 'approve') {
      // Add completion grade
      actionItem.completionGrade = {
        score: grade,
        qualityNotes: qualityNotes || '',
        gradedBy: req.user.userId,
        gradedAt: new Date()
      };

      actionItem.approveCompletion(req.user.userId, comments);

      // Send notification to employee
      try {
        await sendActionItemEmail.taskCompletionApproved(
          actionItem.assignedTo.email,
          actionItem.assignedTo.fullName,
          user.fullName,
          actionItem.title,
          actionItem._id,
          comments,
          grade
        );
      } catch (emailError) {
        console.error('Failed to send approval notification:', emailError);
      }

      console.log(`✅ Task COMPLETION APPROVED with grade: ${grade}/5`);
    } else {
      actionItem.rejectCompletion(req.user.userId, comments);

      // Send notification to employee
      try {
        await sendActionItemEmail.taskCompletionRejected(
          actionItem.assignedTo.email,
          actionItem.assignedTo.fullName,
          user.fullName,
          actionItem.title,
          actionItem._id,
          comments
        );
      } catch (emailError) {
        console.error('Failed to send rejection notification:', emailError);
      }

      console.log('❌ Task COMPLETION REJECTED');
    }

    await actionItem.save();

    console.log('=== COMPLETION APPROVAL DECISION PROCESSED ===');

    res.json({
      success: true,
      message: `Task completion ${decision}d${decision === 'approve' ? ' with grade ' + grade + '/5' : ''}`,
      data: actionItem
    });

  } catch (error) {
    console.error('Completion approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process completion approval',
      error: error.message
    });
  }
};

// Link task to KPI when creating
const linkTaskToKPI = async (taskId, kpiDocId, kpiIndex) => {
  try {
    const kpiDoc = await QuarterlyKPI.findById(kpiDocId);
    if (!kpiDoc || !kpiDoc.kpis[kpiIndex]) {
      throw new Error('KPI not found');
    }

    const kpi = kpiDoc.kpis[kpiIndex];

    const task = await ActionItem.findById(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    task.linkedKPI = {
      kpiDocId: kpiDocId,
      kpiIndex: kpiIndex,
      kpiTitle: kpi.title,
      kpiWeight: kpi.weight
    };

    await task.save();
    return task;
  } catch (error) {
    console.error('Link task to KPI error:', error);
    throw error;
  }
};


// Update action item
const updateActionItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, priority, dueDate, projectId, notes, tags } = req.body;

    const actionItem = await ActionItem.findById(id);

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    // Check permissions - FIXED: assignedTo is now an array
    const user = await User.findById(req.user.userId);
    
    // Check if user is one of the assignees or the creator
    const isAssignee = actionItem.assignedTo.some(a => 
      a.user.equals(req.user.userId)
    );
    
    const canEdit = 
      isAssignee ||
      actionItem.createdBy.equals(req.user.userId) ||
      ['supply_chain', 'admin'].includes(user.role);

    if (!canEdit) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this task'
      });
    }

    // Track changes
    const changes = [];
    if (title && title !== actionItem.title) {
      changes.push(`Title changed from "${actionItem.title}" to "${title}"`);
      actionItem.title = title;
    }
    if (description && description !== actionItem.description) {
      actionItem.description = description;
      changes.push('Description updated');
    }
    if (priority && priority !== actionItem.priority) {
      changes.push(`Priority changed from ${actionItem.priority} to ${priority}`);
      actionItem.priority = priority;
    }
    if (dueDate && new Date(dueDate).getTime() !== actionItem.dueDate.getTime()) {
      changes.push('Due date changed');
      actionItem.dueDate = new Date(dueDate);
    }
    if (notes !== undefined) actionItem.notes = notes;
    if (tags) actionItem.tags = tags;

    // Handle project change
    if (projectId !== undefined) {
      if (projectId && projectId !== actionItem.projectId?.toString()) {
        const project = await Project.findById(projectId);
        if (!project) {
          return res.status(404).json({
            success: false,
            message: 'Project not found'
          });
        }
        actionItem.projectId = project._id;
        changes.push(`Assigned to project: ${project.name}`);
      } else if (projectId === null && actionItem.projectId) {
        changes.push('Removed from project');
        actionItem.projectId = null;
      }
    }

    if (changes.length > 0) {
      actionItem.logActivity('updated', req.user.userId, changes.join('; '));
    }

    await actionItem.save();
    await actionItem.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' },
      { path: 'projectId', select: 'name code' }
    ]);

    res.json({
      success: true,
      message: 'Action item updated successfully',
      data: actionItem
    });

  } catch (error) {
    console.error('Update action item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update action item',
      error: error.message
    });
  }
};

// Update progress
const updateProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const { progress, notes } = req.body;

    if (progress === undefined || progress < 0 || progress > 100) {
      return res.status(400).json({
        success: false,
        message: 'Progress must be between 0 and 100'
      });
    }

    const actionItem = await ActionItem.findById(id);

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    // Check permissions - FIXED: assignedTo is now an array
    const user = await User.findById(req.user.userId);
    
    // Check if user is one of the assignees
    const isAssignee = actionItem.assignedTo.some(a => 
      a.user.equals(req.user.userId)
    );
    
    const canUpdate = 
      isAssignee ||
      ['supply_chain', 'admin', 'supervisor'].includes(user.role);

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this task'
      });
    }

    const oldProgress = actionItem.progress;
    actionItem.updateProgress(progress, req.user.userId);

    if (notes) {
      actionItem.notes = actionItem.notes ? `${actionItem.notes}\n${notes}` : notes;
    }

    await actionItem.save();
    await actionItem.populate([
      { path: 'assignedTo.user', select: 'fullName email' },
      { path: 'createdBy', select: 'fullName email' }
    ]);

    // Send notification if task is completed
    if (progress === 100 && oldProgress < 100) {
      // Notify all assignees
      for (const assignee of actionItem.assignedTo) {
        if (assignee.user && assignee.user.email) {
          await sendActionItemEmail.taskCompleted(
            assignee.user.email,
            assignee.user.fullName,
            actionItem.title,
            actionItem._id
          ).catch(err => console.error('Failed to send completion email:', err));
        }
      }
    }

    res.json({
      success: true,
      message: 'Progress updated successfully',
      data: actionItem
    });

  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update progress',
      error: error.message
    });
  }
};


// Update status
const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const actionItem = await ActionItem.findById(id);

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    // Check permissions - assignedTo is now an array
    const user = await User.findById(req.user.userId);
    
    // Check if user is one of the assignees
    const isAssignee = actionItem.assignedTo.some(a => 
      a.user.equals(req.user.userId)
    );
    
    const canUpdate = 
      isAssignee ||
      ['supply_chain', 'admin', 'supervisor', 'hse'].includes(user.role);

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this task'
      });
    }

    const oldStatus = actionItem.status;
    
    // Use the model method
    actionItem.updateStatus(status, req.user.userId, notes || '');

    if (notes) {
      actionItem.notes = actionItem.notes ? `${actionItem.notes}\n${notes}` : notes;
    }

    await actionItem.save();
    await actionItem.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' },
      { path: 'projectId', select: 'name code' },
      { path: 'completedBy', select: 'fullName email' }
    ]);

    // Send notification if status changed to completed
    if (status === 'Completed' && oldStatus !== 'Completed') {
      // Notify all assignees
      for (const assignee of actionItem.assignedTo) {
        if (assignee.user && assignee.user.email) {
          try {
            await sendActionItemEmail.taskCompleted(
              assignee.user.email,
              assignee.user.fullName,
              actionItem.title,
              actionItem._id
            );
          } catch (emailError) {
            console.error('Failed to send completion email:', emailError);
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: actionItem
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message
    });
  }
};

// Delete action item
const deleteActionItem = async (req, res) => {
  try {
    const { id } = req.params;

    const actionItem = await ActionItem.findById(id);

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    // Check permissions
    const user = await User.findById(req.user.userId);
    const canDelete = 
      actionItem.createdBy.equals(req.user.userId) ||
      ['supply_chain', 'admin'].includes(user.role);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this task'
      });
    }

    await actionItem.deleteOne();

    res.json({
      success: true,
      message: 'Action item deleted successfully'
    });

  } catch (error) {
    console.error('Delete action item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete action item',
      error: error.message
    });
  }
};

// Get single action item
const getActionItem = async (req, res) => {
  try {
    const { id } = req.params;
    const actionItem = await ActionItem.findById(id)
      .populate('assignedTo.user', 'fullName email department position')
      .populate('createdBy', 'fullName email department')
      .populate('projectId', 'name code department')
      .populate('activityLog.performedBy', 'fullName email');

    if (!actionItem) {
      return res.status(404).json({
        success: false,
        message: 'Action item not found'
      });
    }

    // Get user details
    const user = await User.findById(req.user.userId);
    
    console.log('\n=== GET ACTION ITEM AUTHORIZATION ===');
    console.log('User:', user.fullName, user.email, user.role);
    console.log('Task ID:', id);
    console.log('Task Status:', actionItem.status);
    
    // Define roles with full access
    const authorizedRoles = ['admin', 'supply_chain', 'supervisor', 'manager', 'hr', 'it', 'hse', 'technical'];
    
    // Check if user has an authorized role (full access)
    if (authorizedRoles.includes(user.role)) {
      console.log('✅ Access granted: Authorized role');
      return res.json({
        success: true,
        data: actionItem
      });
    }
    
    // Check if user is assigned to the action item
    const isAssignedUser = actionItem.assignedTo.some(assignee => 
      assignee.user && assignee.user._id.equals(req.user.userId)
    );
    
    // Check if user is the creator
    const isCreator = actionItem.createdBy._id.equals(req.user.userId);
    
    // Check if user is the supervisor
    const isSupervisor = actionItem.supervisor && actionItem.supervisor.email === user.email;
    
    // Check if user is an approver in the completion approval chain
    const isApprover = actionItem.assignedTo.some(assignee => 
      assignee.completionApprovalChain && assignee.completionApprovalChain.some(chain => 
        chain.status === 'pending' && chain.approver && (
          chain.approver.email === user.email || 
          (chain.approver.userId && chain.approver.userId.equals && chain.approver.userId.equals(req.user.userId))
        )
      )
    );
    
    console.log('Authorization checks:');
    console.log('- isAssignedUser:', isAssignedUser);
    console.log('- isCreator:', isCreator);
    console.log('- isSupervisor:', isSupervisor);
    console.log('- isApprover:', isApprover);
    console.log('- user.role:', user.role);
    
    // Debug approval chain structure
    if (!isApprover) {
      console.log('Approval chain debug:');
      actionItem.assignedTo.forEach((assignee, idx) => {
        console.log(`  Assignee ${idx}:`, assignee.user?._id);
        if (assignee.completionApprovalChain) {
          assignee.completionApprovalChain.forEach((chain, chainIdx) => {
            console.log(`    Chain ${chainIdx}:`, {
              status: chain.status,
              approverEmail: chain.approver?.email,
              approverUserId: chain.approver?.userId,
              level: chain.level
            });
          });
        }
      });
    }
    
    // For supervisors, check department match
    if (user.role === 'supervisor') {
      const departmentMatch = actionItem.assignedTo.some(assignee => 
        assignee.user && assignee.user.department === user.department
      );
      console.log('- departmentMatch:', departmentMatch);
      
      if (isAssignedUser || isCreator || isSupervisor || departmentMatch || isApprover) {
        console.log('✅ Access granted: Supervisor with match');
        return res.json({
          success: true,
          data: actionItem
        });
      }
    }
    
    // For regular users, check if assigned, creator, or approver
    if (isAssignedUser || isCreator || isApprover) {
      console.log('✅ Access granted: User match');
      return res.json({
        success: true,
        data: actionItem
      });
    }
    
    // If none of the conditions are met, deny access
    console.log('❌ Access denied: No matching criteria');
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });

  } catch (error) {
    console.error('Get action item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch action item',
      error: error.message
    });
  }
};

// Get action items by project
const getProjectActionItems = async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const tasks = await ActionItem.find({ projectId })
      .populate('assignedTo', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .sort({ priority: -1, dueDate: 1 });

    res.json({
      success: true,
      data: tasks,
      project: {
        _id: project._id,
        name: project.name,
        code: project.code
      }
    });

  } catch (error) {
    console.error('Get project action items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch project action items',
      error: error.message
    });
  }
};


// const createTaskUnderSubMilestone = async (req, res) => {
//   try {
//     const {
//       projectId,
//       milestoneId,
//       subMilestoneId, // NEW: Can be nested at any level
//       title,
//       description,
//       priority,
//       dueDate,
//       taskWeight,
//       assignedTo,
//       linkedKPIs,
//       notes
//     } = req.body;

//     console.log('=== CREATE TASK UNDER SUB-MILESTONE ===');
//     console.log('Creator:', req.user.userId);
//     console.log('Sub-Milestone:', subMilestoneId);
//     console.log('Assignees:', assignedTo?.length || 0);

//     // Validate required fields
//     if (!projectId || !milestoneId || !subMilestoneId || !title || !description || !priority || !dueDate || !taskWeight) {
//       return res.status(400).json({
//         success: false,
//         message: 'Missing required fields'
//       });
//     }

//     // Get project and find sub-milestone
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

//     // Find sub-milestone recursively
//     const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
//     if (!subMilestone) {
//       return res.status(404).json({
//         success: false,
//         message: 'Sub-milestone not found'
//       });
//     }

//     // Get creator user
//     const creator = await User.findById(req.user.userId);
//     if (!creator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Creator user not found'
//       });
//     }

//     // Check if creator is the assigned supervisor of this sub-milestone
//     if (!subMilestone.assignedSupervisor.equals(req.user.userId) && 
//         !['admin', 'supply_chain', 'project'].includes(creator.role)) {
//       return res.status(403).json({
//         success: false,
//         message: 'Only the assigned supervisor can create tasks under this sub-milestone'
//       });
//     }

//     // Validate task weight against sub-milestone capacity
//     const existingTasks = await ActionItem.find({ subMilestoneId: subMilestoneId });
//     const totalExistingWeight = existingTasks.reduce((sum, t) => sum + t.taskWeight, 0);
    
//     if (totalExistingWeight + taskWeight > 100) {
//       return res.status(400).json({
//         success: false,
//         message: `Task weight exceeds available capacity. Available: ${100 - totalExistingWeight}%, Requested: ${taskWeight}%`,
//         availableWeight: 100 - totalExistingWeight
//       });
//     }

//     // Handle assignment
//     let assignees = [];
//     let supervisor = null;

//     if (!assignedTo || assignedTo.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'At least one assignee is required'
//       });
//     }

//     // Validate assignees
//     for (const assigneeId of assignedTo) {
//       const assignee = await User.findById(assigneeId);
//       if (!assignee) {
//         return res.status(400).json({
//           success: false,
//           message: `Assignee ${assigneeId} not found'`
//         });
//       }

//       assignees.push({
//         user: assigneeId,
//         completionStatus: 'pending'
//       });
//     }

//     // Creator becomes the supervisor
//     supervisor = {
//       name: creator.fullName,
//       email: creator.email,
//       department: creator.department
//     };

//     console.log(`✅ Task assigned to ${assignees.length} user(s)`);
//     console.log(`   Supervisor (creator): ${supervisor.name}`);

//     // Process linked KPIs
//     const processedKPIs = [];
//     if (linkedKPIs && linkedKPIs.length > 0) {
//       for (const kpiLink of linkedKPIs) {
//         const kpiDoc = await QuarterlyKPI.findOne({
//           _id: kpiLink.kpiDocId,
//           approvalStatus: 'approved'
//         });

//         if (!kpiDoc) {
//           return res.status(400).json({
//             success: false,
//             message: `No approved KPI found for KPI document ${kpiLink.kpiDocId}`
//           });
//         }

//         const kpi = kpiDoc.kpis[kpiLink.kpiIndex];
//         if (!kpi) {
//           return res.status(400).json({
//             success: false,
//             message: `KPI index ${kpiLink.kpiIndex} not found`
//           });
//         }

//         processedKPIs.push({
//           kpiDocId: kpiLink.kpiDocId,
//           kpiIndex: kpiLink.kpiIndex,
//           kpiTitle: kpi.title,
//           kpiWeight: kpi.weight,
//           contributionToKPI: 0
//         });
//       }
//     }

//     // Create task
//     const task = new ActionItem({
//       title,
//       description,
//       priority,
//       dueDate: new Date(dueDate),
//       taskWeight,
//       assignedTo: assignees,
//       linkedKPIs: processedKPIs,
//       projectId,
//       milestoneId,
//       subMilestoneId, // NEW: Link to sub-milestone
//       createdBy: req.user.userId,
//       supervisor,
//       status: 'Not Started',
//       notes: notes || '',
//       creationApproval: {
//         status: 'approved',
//         approvedBy: req.user.userId,
//         approvalDate: new Date()
//       }
//     });

//     task.logActivity('created', req.user.userId, 
//       `Task created under sub-milestone "${subMilestone.title}" with weight ${taskWeight}%`);

//     await task.save();

//     // Populate task
//     await task.populate([
//       { path: 'assignedTo.user', select: 'fullName email department' },
//       { path: 'createdBy', select: 'fullName email' },
//       { path: 'projectId', select: 'name code' },
//       { path: 'linkedKPIs.kpiDocId' }
//     ]);

//     console.log('✅ Task created under sub-milestone');

//     // Send notifications to assignees
//     if (assignedTo && assignedTo.length > 0) {
//       for (const assigneeId of assignedTo) {
//         const assignee = await User.findById(assigneeId);
//         if (assignee) {
//           try {
//             await sendActionItemEmail.taskAssigned(
//               assignee.email,
//               assignee.fullName,
//               creator.fullName,
//               title,
//               description,
//               priority,
//               dueDate,
//               task._id,
//               `${project.name} > ${milestone.title} > ${subMilestone.title}`
//             );
//           } catch (emailError) {
//             console.error('Failed to send notification:', emailError);
//           }
//         }
//       }
//     }

//     res.status(201).json({
//       success: true,
//       message: 'Task created under sub-milestone successfully',
//       data: task
//     });

//   } catch (error) {
//     console.error('Error creating task under sub-milestone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create task',
//       error: error.message
//     });
//   }
// };



const createTaskUnderSubMilestone = async (req, res) => {
  try {
    const {
      projectId,
      milestoneId,
      subMilestoneId,
      title,
      description,
      priority,
      dueDate,
      taskWeight,
      assignedTo,
      linkedKPIs,
      notes
    } = req.body;

    console.log('=== CREATE TASK UNDER SUB-MILESTONE ===');
    console.log('Creator:', req.user.userId);
    console.log('Sub-Milestone:', subMilestoneId);
    console.log('Assignees:', assignedTo?.length || 0);

    // Validate required fields
    if (!projectId || !milestoneId || !subMilestoneId || !title || !description || !priority || !dueDate || !taskWeight) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Get project and find sub-milestone
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

    // Find sub-milestone recursively
    const subMilestone = findSubMilestoneById(milestone.subMilestones, subMilestoneId);
    if (!subMilestone) {
      return res.status(404).json({
        success: false,
        message: 'Sub-milestone not found'
      });
    }

    // Get creator user
    const creator = await User.findById(req.user.userId);
    if (!creator) {
      return res.status(404).json({
        success: false,
        message: 'Creator user not found'
      });
    }

    // Check if creator is the assigned supervisor of this sub-milestone
    if (!subMilestone.assignedSupervisor.equals(req.user.userId) && 
        !['admin', 'supply_chain', 'project'].includes(creator.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only the assigned supervisor can create tasks under this sub-milestone'
      });
    }

    // Validate task weight against sub-milestone capacity
    const existingTasks = await ActionItem.find({ subMilestoneId: subMilestoneId });
    const totalExistingWeight = existingTasks.reduce((sum, t) => sum + t.taskWeight, 0);
    
    if (totalExistingWeight + taskWeight > 100) {
      return res.status(400).json({
        success: false,
        message: `Task weight exceeds available capacity. Available: ${100 - totalExistingWeight}%, Requested: ${taskWeight}%`,
        availableWeight: 100 - totalExistingWeight
      });
    }

    // Handle assignment
    let assignees = [];
    let supervisor = null;

    if (!assignedTo || assignedTo.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one assignee is required'
      });
    }

    // ✅ CRITICAL FIX: Validate assignees and determine supervisor
    for (const assigneeId of assignedTo) {
      const assignee = await User.findById(assigneeId);
      if (!assignee) {
        return res.status(400).json({
          success: false,
          message: `Assignee ${assigneeId} not found`
        });
      }

      assignees.push({
        user: assigneeId,
        completionStatus: 'pending'
      });
    }

    // ✅ NEW: Get supervisor based on ASSIGNEE (not creator)
    const firstAssigneeId = assignedTo[0];
    const firstAssignee = await User.findById(firstAssigneeId);

    if (firstAssigneeId === req.user.userId) {
      // ✅ Assigning to self - get MY supervisor
      const { getTaskSupervisor } = require('../config/actionItemApprovalChain');
      supervisor = getTaskSupervisor(firstAssignee.email, firstAssignee.department);
      
      if (!supervisor) {
        return res.status(400).json({
          success: false,
          message: 'Unable to determine your supervisor. Please contact HR.'
        });
      }
      
      console.log(`✅ Task assigned to self - supervisor: ${supervisor.name} (${supervisor.email})`);
    } else {
      // ✅ Assigning to others - creator becomes supervisor
      supervisor = {
        name: creator.fullName,
        email: creator.email,
        department: creator.department
      };
      
      console.log(`✅ Task assigned to others - creator is supervisor: ${supervisor.name}`);
    }

    console.log(`✅ Task assigned to ${assignees.length} user(s)`);
    console.log(`   Supervisor: ${supervisor.name} (${supervisor.email})`);

    // Process linked KPIs
    const processedKPIs = [];
    if (linkedKPIs && linkedKPIs.length > 0) {
      for (const kpiLink of linkedKPIs) {
        const kpiDoc = await QuarterlyKPI.findOne({
          _id: kpiLink.kpiDocId,
          approvalStatus: 'approved'
        });

        if (!kpiDoc) {
          return res.status(400).json({
            success: false,
            message: `No approved KPI found for KPI document ${kpiLink.kpiDocId}`
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
          contributionToKPI: 0
        });
      }
    }

    // Create task
    const task = new ActionItem({
      title,
      description,
      priority,
      dueDate: new Date(dueDate),
      taskWeight,
      assignedTo: assignees,
      linkedKPIs: processedKPIs,
      projectId,
      milestoneId,
      subMilestoneId,
      createdBy: req.user.userId,
      supervisor,
      status: 'Not Started',
      notes: notes || '',
      creationApproval: {
        status: 'approved',
        approvedBy: req.user.userId,
        approvalDate: new Date()
      }
    });

    task.logActivity('created', req.user.userId, 
      `Task created under sub-milestone "${subMilestone.title}" with weight ${taskWeight}%`);

    await task.save();

    // Populate task
    await task.populate([
      { path: 'assignedTo.user', select: 'fullName email department' },
      { path: 'createdBy', select: 'fullName email' },
      { path: 'projectId', select: 'name code' },
      { path: 'linkedKPIs.kpiDocId' }
    ]);

    console.log('✅ Task created under sub-milestone');

    // Send notifications to assignees
    if (assignedTo && assignedTo.length > 0) {
      for (const assigneeId of assignedTo) {
        const assignee = await User.findById(assigneeId);
        if (assignee) {
          try {
            await sendActionItemEmail.taskAssigned(
              assignee.email,
              assignee.fullName,
              creator.fullName,
              title,
              description,
              priority,
              dueDate,
              task._id,
              `${project.name} > ${milestone.title} > ${subMilestone.title}`
            );
          } catch (emailError) {
            console.error('Failed to send notification:', emailError);
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Task created under sub-milestone successfully',
      data: task
    });

  } catch (error) {
    console.error('Error creating task under sub-milestone:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create task',
      error: error.message
    });
  }
};


// Get tasks for sub-milestone
const getSubMilestoneTasks = async (req, res) => {
  try {
    const { subMilestoneId } = req.params;

    console.log('=== GET SUB-MILESTONE TASKS ===');
    console.log('Sub-Milestone:', subMilestoneId);

    const tasks = await ActionItem.find({ subMilestoneId })
      .populate('assignedTo.user', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .populate('linkedKPIs.kpiDocId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: tasks,
      count: tasks.length
    });

  } catch (error) {
    console.error('Error fetching sub-milestone tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sub-milestone tasks',
      error: error.message
    });
  }
};


module.exports = {
  createTaskUnderMilestone,
  createPersonalTask,
  submitCompletionForAssignee,
  approveCompletionForAssignee,
  rejectCompletionForAssignee,
  getMilestoneTasks,
  reassignTask,
  getActionItems,
  getActionItemStats,
  createActionItem,
  updateActionItem,
  updateProgress,
  updateStatus,
  deleteActionItem,
  getActionItem,
  getProjectActionItems,
  processCreationApproval,
  submitForCompletion,
  processCompletionApproval,
  createTaskUnderSubMilestone,
  getSubMilestoneTasks
};



