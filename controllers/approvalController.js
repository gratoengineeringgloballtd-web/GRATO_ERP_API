const ActionItem = require('../models/ActionItem');
const User = require('../models/User');
const { sendActionItemEmail } = require('../services/emailService');
const {
  buildApprovalChain,
  getNextPendingApprover,
  isApprovalChainComplete,
  canUserApproveAtLevel,
  getApprovalChainSummary
} = require('../config/approvalChainHelper');

/**
 * Submit completion for assignee - Initialize approval chain
 */
const submitCompletionForAssignee = async (req, res) => {
  try {
    const { id } = req.params;
    const { completionNotes } = req.body;
    const userId = req.user.userId;

    console.log('=== SUBMIT COMPLETION WITH APPROVAL CHAIN ===');
    console.log('Task ID:', id);
    console.log('User ID:', userId);

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

    // Process uploaded documents
    let documents = [];
    if (req.files && req.files.length > 0) {
      console.log(`Processing ${req.files.length} completion documents`);

      for (const file of req.files) {
        try {
          const { saveFile, STORAGE_CATEGORIES } = require('../utils/localFileStorage');
          
          const fileMetadata = await saveFile(
            file,
            STORAGE_CATEGORIES.ACTION_ITEMS,
            'completion-docs',
            null
          );

          documents.push({
            name: file.originalname,
            url: fileMetadata.url,
            publicId: fileMetadata.publicId,
            localPath: fileMetadata.localPath,
            size: file.size,
            mimetype: file.mimetype,
            uploadedAt: new Date()
          });

          console.log(`✅ Saved: ${fileMetadata.publicId}`);
        } catch (fileError) {
          console.error(`Error processing ${file.originalname}:`, fileError);
          continue;
        }
      }
    }

    if (documents.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one document must be uploaded'
      });
    }

    // Build approval chain for this assignee
    const approvalChain = await buildApprovalChain(
      userId,
      task.createdBy._id,
      task.projectId
    );

    // Update assignee's submission
    assignee.completionStatus = 'submitted';
    assignee.completionDocuments = documents;
    assignee.completionNotes = completionNotes || '';
    assignee.submittedAt = new Date();
    assignee.completionApprovalChain = approvalChain;

    // Update task status based on approval chain
    const nextApprover = getNextPendingApprover(approvalChain);
    
    if (nextApprover) {
      if (nextApprover.level === 1) {
        task.status = 'Pending L1 Grading';
      } else if (nextApprover.level === 2) {
        task.status = 'Pending L2 Review';
      } else if (nextApprover.level === 3) {
        task.status = 'Pending L3 Final Approval';
      }
    } else {
      // All levels skipped (top-level employee) - auto-complete
      task.status = 'Completed';
      assignee.completionStatus = 'approved';
      task.completedDate = new Date();
      task.completedBy = userId;
      task.progress = 100;
    }

    task.logActivity('submitted_for_completion', userId, 
      `Completion submitted with ${documents.length} document(s) - entering approval chain`);

    await task.save();

    // Send notification to next approver
    if (nextApprover && nextApprover.approver.email) {
      try {
        const user = await User.findById(userId);
        await sendActionItemEmail.taskCompletionApproval(
          nextApprover.approver.email,
          nextApprover.approver.name,
          user.fullName,
          task.title,
          task.description,
          task._id,
          documents.length,
          completionNotes
        );
      } catch (emailError) {
        console.error('Failed to send notification:', emailError);
      }
    }

    const summary = getApprovalChainSummary(approvalChain);
    console.log('✅ Approval chain initialized:', summary);

    res.json({
      success: true,
      message: nextApprover 
        ? `Completion submitted - awaiting ${nextApprover.approver.name} (Level ${nextApprover.level})`
        : 'Completion submitted and auto-approved (no approval chain required)',
      data: task,
      documentsUploaded: documents.length,
      approvalProgress: summary
    });

  } catch (error) {
    console.error('Error submitting completion:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit completion',
      error: error.message
    });
  }
};

/**
 * LEVEL 1: Immediate Supervisor grades the task
 */
const approveL1WithGrade = async (req, res) => {
  try {
    const { id, assigneeId } = req.params;
    const { grade, qualityNotes, comments } = req.body;
    const userId = req.user.userId;

    console.log('=== LEVEL 1 GRADING ===');
    console.log('Task:', id);
    console.log('Assignee:', assigneeId);
    console.log('Grade:', grade);

    // Validate grade
    if (!grade || grade < 1.0 || grade > 5.0) {
      return res.status(400).json({
        success: false,
        message: 'Grade must be between 1.0 and 5.0'
      });
    }

    if (!Number.isInteger(grade * 10)) {
      return res.status(400).json({
        success: false,
        message: 'Grade can have at most 1 decimal place'
      });
    }

    const task = await ActionItem.findById(id)
      .populate('assignedTo.user', 'fullName email department')
      .populate('createdBy', 'fullName email');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const assignee = task.assignedTo.find(a => a.user._id.equals(assigneeId));
    if (!assignee) {
      return res.status(404).json({
        success: false,
        message: 'Assignee not found'
      });
    }

    // Check if user can approve at Level 1
    if (!canUserApproveAtLevel(userId, assignee.completionApprovalChain, 1)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to grade this task at Level 1'
      });
    }

    // Update Level 1 approval
    const l1Approval = assignee.completionApprovalChain.find(a => a.level === 1);
    l1Approval.status = 'approved';
    l1Approval.grade = grade;
    l1Approval.comments = comments || qualityNotes;
    l1Approval.reviewedAt = new Date();

    // Store grade in assignee record
    const effectiveScore = parseFloat(((grade / 5.0) * task.taskWeight).toFixed(2));
    assignee.completionGrade = {
      score: parseFloat(grade.toFixed(1)),
      effectiveScore: effectiveScore,
      qualityNotes: qualityNotes || '',
      gradedBy: userId,
      gradedAt: new Date()
    };

    // Move to next approval level
    const nextApprover = getNextPendingApprover(assignee.completionApprovalChain);
    
    if (nextApprover) {
      if (nextApprover.level === 2) {
        task.status = 'Pending L2 Review';
      } else if (nextApprover.level === 3) {
        task.status = 'Pending L3 Final Approval';
      }
      
      // Send notification to next approver
      if (nextApprover.approver.email) {
        try {
          const user = await User.findById(userId);
          await sendActionItemEmail.taskCompletionApproval(
            nextApprover.approver.email,
            nextApprover.approver.name,
            assignee.user.fullName,
            task.title,
            task.description,
            task._id,
            assignee.completionDocuments.length,
            `Grade: ${grade}/5.0 - ${qualityNotes || 'No notes'}`
          );
        } catch (emailError) {
          console.error('Failed to send notification:', emailError);
        }
      }
    } else {
      // All approvals complete
      task.status = 'Completed';
      assignee.completionStatus = 'approved';
      task.completedDate = new Date();
      task.completedBy = userId;
      task.progress = 100;

      // Update KPIs and milestone
      await task.updateKPIAchievements(assigneeId, grade);
      if (task.milestoneId) {
        await task.updateMilestoneProgress();
      }
    }

    task.logActivity('l1_graded', userId, 
      `L1 graded with ${grade}/5.0 (Effective: ${effectiveScore}%)`);

    await task.save();

    const summary = getApprovalChainSummary(assignee.completionApprovalChain);
    console.log('✅ L1 approved, progress:', summary);

    res.json({
      success: true,
      message: nextApprover 
        ? `L1 graded ${grade}/5.0 - forwarded to ${nextApprover.approver.name} (Level ${nextApprover.level})`
        : `L1 graded ${grade}/5.0 - task completed!`,
      data: task,
      approvalProgress: summary
    });

  } catch (error) {
    console.error('Error in L1 grading:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to grade at Level 1',
      error: error.message
    });
  }
};

/**
 * LEVEL 2: Supervisor's Supervisor reviews
 */
const approveL2Review = async (req, res) => {
  try {
    const { id, assigneeId } = req.params;
    const { comments, decision } = req.body; // decision: 'approve' or 'reject'
    const userId = req.user.userId;

    console.log('=== LEVEL 2 REVIEW ===');
    console.log('Task:', id);
    console.log('Decision:', decision);

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Decision must be "approve" or "reject"'
      });
    }

    const task = await ActionItem.findById(id)
      .populate('assignedTo.user', 'fullName email department')
      .populate('createdBy', 'fullName email');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const assignee = task.assignedTo.find(a => a.user._id.equals(assigneeId));
    if (!assignee) {
      return res.status(404).json({
        success: false,
        message: 'Assignee not found'
      });
    }

    // Check authorization
    if (!canUserApproveAtLevel(userId, assignee.completionApprovalChain, 2)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to review this task at Level 2'
      });
    }

    const l2Approval = assignee.completionApprovalChain.find(a => a.level === 2);
    
    if (decision === 'approve') {
      l2Approval.status = 'approved';
      l2Approval.comments = comments || 'Approved';
      l2Approval.reviewedAt = new Date();

      // Move to Level 3
      const nextApprover = getNextPendingApprover(assignee.completionApprovalChain);
      
      if (nextApprover && nextApprover.level === 3) {
        task.status = 'Pending L3 Final Approval';
        
        // Notify L3
        if (nextApprover.approver.email) {
          try {
            const user = await User.findById(userId);
            await sendActionItemEmail.taskCompletionApproval(
              nextApprover.approver.email,
              nextApprover.approver.name,
              assignee.user.fullName,
              task.title,
              task.description,
              task._id,
              assignee.completionDocuments.length,
              `L2 approved - awaiting final approval`
            );
          } catch (emailError) {
            console.error('Failed to send notification:', emailError);
          }
        }
      } else {
        // Complete task
        task.status = 'Completed';
        assignee.completionStatus = 'approved';
        task.completedDate = new Date();
        task.completedBy = userId;
        task.progress = 100;

        // Update KPIs
        const grade = assignee.completionGrade.score;
        await task.updateKPIAchievements(assigneeId, grade);
        if (task.milestoneId) {
          await task.updateMilestoneProgress();
        }
      }

      task.logActivity('l2_reviewed', userId, 'L2 approved');
    } else {
      // Reject - send back to employee
      l2Approval.status = 'rejected';
      l2Approval.comments = comments || 'Needs revision';
      l2Approval.reviewedAt = new Date();
      
      task.status = 'In Progress';
      assignee.completionStatus = 'rejected';

      task.logActivity('completion_rejected', userId, `L2 rejected: ${comments}`);

      // Notify employee
      try {
        await sendActionItemEmail.taskCompletionRejected(
          assignee.user.email,
          assignee.user.fullName,
          (await User.findById(userId)).fullName,
          task.title,
          task._id,
          comments
        );
      } catch (emailError) {
        console.error('Failed to send rejection notification:', emailError);
      }
    }

    await task.save();

    const summary = getApprovalChainSummary(assignee.completionApprovalChain);
    console.log(`✅ L2 ${decision}d, progress:`, summary);

    res.json({
      success: true,
      message: decision === 'approve' 
        ? 'L2 approved - forwarded to final approval'
        : 'L2 rejected - sent back to employee',
      data: task,
      approvalProgress: summary
    });

  } catch (error) {
    console.error('Error in L2 review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review at Level 2',
      error: error.message
    });
  }
};

/**
 * LEVEL 3: Project Creator gives final approval
 */
const approveL3Final = async (req, res) => {
  try {
    const { id, assigneeId } = req.params;
    const { comments, decision } = req.body;
    const userId = req.user.userId;

    console.log('=== LEVEL 3 FINAL APPROVAL ===');
    console.log('Task:', id);
    console.log('Decision:', decision);

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Decision must be "approve" or "reject"'
      });
    }

    const task = await ActionItem.findById(id)
      .populate('assignedTo.user', 'fullName email department')
      .populate('createdBy', 'fullName email');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const assignee = task.assignedTo.find(a => a.user._id.equals(assigneeId));
    if (!assignee) {
      return res.status(404).json({
        success: false,
        message: 'Assignee not found'
      });
    }

    // Check authorization
    if (!canUserApproveAtLevel(userId, assignee.completionApprovalChain, 3)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to give final approval for this task'
      });
    }

    const l3Approval = assignee.completionApprovalChain.find(a => a.level === 3);
    
    if (decision === 'approve') {
      l3Approval.status = 'approved';
      l3Approval.comments = comments || 'Final approval granted';
      l3Approval.reviewedAt = new Date();

      // Complete task
      task.status = 'Completed';
      assignee.completionStatus = 'approved';
      task.completedDate = new Date();
      task.completedBy = userId;
      task.progress = 100;

      // Update KPIs and milestone
      const grade = assignee.completionGrade.score;
      await task.updateKPIAchievements(assigneeId, grade);
      if (task.milestoneId) {
        await task.updateMilestoneProgress();
      }

      task.logActivity('l3_approved', userId, 'L3 final approval - task completed');

      // Notify employee
      try {
        await sendActionItemEmail.taskCompletionApproved(
          assignee.user.email,
          assignee.user.fullName,
          (await User.findById(userId)).fullName,
          task.title,
          task._id,
          comments,
          grade
        );
      } catch (emailError) {
        console.error('Failed to send completion notification:', emailError);
      }
    } else {
      // Reject - send back to employee
      l3Approval.status = 'rejected';
      l3Approval.comments = comments || 'Needs revision';
      l3Approval.reviewedAt = new Date();
      
      task.status = 'In Progress';
      assignee.completionStatus = 'rejected';

      task.logActivity('completion_rejected', userId, `L3 rejected: ${comments}`);

      // Notify employee
      try {
        await sendActionItemEmail.taskCompletionRejected(
          assignee.user.email,
          assignee.user.fullName,
          (await User.findById(userId)).fullName,
          task.title,
          task._id,
          comments
        );
      } catch (emailError) {
        console.error('Failed to send rejection notification:', emailError);
      }
    }

    await task.save();

    const summary = getApprovalChainSummary(assignee.completionApprovalChain);
    console.log(`✅ L3 ${decision}d, progress:`, summary);

    res.json({
      success: true,
      message: decision === 'approve' 
        ? 'Task completed with final approval!'
        : 'L3 rejected - sent back to employee',
      data: task,
      approvalProgress: summary
    });

  } catch (error) {
    console.error('Error in L3 final approval:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to give final approval',
      error: error.message
    });
  }
};

module.exports = {
  submitCompletionForAssignee,
  approveL1WithGrade,
  approveL2Review,
  approveL3Final
};