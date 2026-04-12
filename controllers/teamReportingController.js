const ActionItem = require('../models/ActionItem');
const User = require('../models/User');
const { findPersonByEmail } = require('../config/departmentStructure');

/**
 * Get all tasks for supervisor's direct reports
 */
const getTeamTasks = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, priority, dateFrom, dateTo, includeCompleted = 'false' } = req.query;

    console.log('=== GET TEAM TASKS ===');
    console.log('Supervisor:', userId);

    const supervisor = await User.findById(userId);
    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find all users who report to this supervisor
    const allUsers = await User.find({ isActive: true });
    const directReports = [];

    for (const user of allUsers) {
      const personData = findPersonByEmail(user.email);
      if (personData && personData.reportsTo === supervisor.email) {
        directReports.push(user._id);
      }
    }

    console.log(`Found ${directReports.length} direct reports`);

    if (directReports.length === 0) {
      return res.json({
        success: true,
        message: 'No direct reports found',
        data: [],
        stats: {
          totalTasks: 0,
          inProgress: 0,
          completed: 0,
          overdue: 0,
          pendingApproval: 0
        }
      });
    }

    // Build query for tasks
    const query = {
      'assignedTo.user': { $in: directReports },
      isActive: true
    };

    // Apply filters
    if (status) {
      query.status = status;
    }

    if (priority) {
      query.priority = priority;
    }

    if (includeCompleted === 'false') {
      query.status = { $ne: 'Completed' };
    }

    if (dateFrom || dateTo) {
      query.dueDate = {};
      if (dateFrom) query.dueDate.$gte = new Date(dateFrom);
      if (dateTo) query.dueDate.$lte = new Date(dateTo);
    }

    // Fetch tasks
    const tasks = await ActionItem.find(query)
      .populate('assignedTo.user', 'fullName email department position')
      .populate('createdBy', 'fullName email')
      .populate('projectId', 'name code')
      .populate('milestoneId')
      .sort({ dueDate: 1, priority: -1 });

    // Calculate statistics
    const stats = {
      totalTasks: tasks.length,
      notStarted: tasks.filter(t => t.status === 'Not Started').length,
      inProgress: tasks.filter(t => t.status === 'In Progress').length,
      pendingL1: tasks.filter(t => t.status === 'Pending L1 Grading').length,
      pendingL2: tasks.filter(t => t.status === 'Pending L2 Review').length,
      pendingL3: tasks.filter(t => t.status === 'Pending L3 Final Approval').length,
      completed: tasks.filter(t => t.status === 'Completed').length,
      overdue: tasks.filter(t => 
        t.status !== 'Completed' && new Date(t.dueDate) < new Date()
      ).length,
      byPriority: {
        critical: tasks.filter(t => t.priority === 'CRITICAL').length,
        high: tasks.filter(t => t.priority === 'HIGH').length,
        medium: tasks.filter(t => t.priority === 'MEDIUM').length,
        low: tasks.filter(t => t.priority === 'LOW').length
      },
      byEmployee: {}
    };

    // Group by employee
    directReports.forEach(empId => {
      const empTasks = tasks.filter(t => 
        t.assignedTo.some(a => a.user._id.equals(empId))
      );
      const employee = allUsers.find(u => u._id.equals(empId));
      
      if (employee && empTasks.length > 0) {
        stats.byEmployee[employee.fullName] = {
          total: empTasks.length,
          completed: empTasks.filter(t => t.status === 'Completed').length,
          inProgress: empTasks.filter(t => t.status === 'In Progress').length,
          overdue: empTasks.filter(t => 
            t.status !== 'Completed' && new Date(t.dueDate) < new Date()
          ).length
        };
      }
    });

    console.log(`✅ Found ${tasks.length} team tasks`);

    res.json({
      success: true,
      data: tasks,
      stats,
      directReports: directReports.length
    });

  } catch (error) {
    console.error('Error fetching team tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch team tasks',
      error: error.message
    });
  }
};

/**
 * Get all tasks for department head's entire department
 */
const getDepartmentTasks = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, priority, dateFrom, dateTo, includeCompleted = 'false' } = req.query;

    console.log('=== GET DEPARTMENT TASKS ===');
    console.log('Department Head:', userId);

    const deptHead = await User.findById(userId);
    if (!deptHead) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find all users in this department
    const departmentUsers = await User.find({
      department: deptHead.department,
      isActive: true
    });

    console.log(`Found ${departmentUsers.length} users in ${deptHead.department} department`);

    const userIds = departmentUsers.map(u => u._id);

    // Build query
    const query = {
      'assignedTo.user': { $in: userIds },
      isActive: true
    };

    if (status) {
      query.status = status;
    }

    if (priority) {
      query.priority = priority;
    }

    if (includeCompleted === 'false') {
      query.status = { $ne: 'Completed' };
    }

    if (dateFrom || dateTo) {
      query.dueDate = {};
      if (dateFrom) query.dueDate.$gte = new Date(dateFrom);
      if (dateTo) query.dueDate.$lte = new Date(dateTo);
    }

    // Fetch tasks
    const tasks = await ActionItem.find(query)
      .populate('assignedTo.user', 'fullName email department position')
      .populate('createdBy', 'fullName email')
      .populate('projectId', 'name code')
      .populate('milestoneId')
      .sort({ dueDate: 1, priority: -1 });

    // Calculate statistics
    const stats = {
      totalTasks: tasks.length,
      notStarted: tasks.filter(t => t.status === 'Not Started').length,
      inProgress: tasks.filter(t => t.status === 'In Progress').length,
      pendingL1: tasks.filter(t => t.status === 'Pending L1 Grading').length,
      pendingL2: tasks.filter(t => t.status === 'Pending L2 Review').length,
      pendingL3: tasks.filter(t => t.status === 'Pending L3 Final Approval').length,
      completed: tasks.filter(t => t.status === 'Completed').length,
      overdue: tasks.filter(t => 
        t.status !== 'Completed' && new Date(t.dueDate) < new Date()
      ).length,
      byPriority: {
        critical: tasks.filter(t => t.priority === 'CRITICAL').length,
        high: tasks.filter(t => t.priority === 'HIGH').length,
        medium: tasks.filter(t => t.priority === 'MEDIUM').length,
        low: tasks.filter(t => t.priority === 'LOW').length
      },
      byEmployee: {},
      byProject: {}
    };

    // Group by employee
    departmentUsers.forEach(emp => {
      const empTasks = tasks.filter(t => 
        t.assignedTo.some(a => a.user._id.equals(emp._id))
      );
      
      if (empTasks.length > 0) {
        stats.byEmployee[emp.fullName] = {
          total: empTasks.length,
          completed: empTasks.filter(t => t.status === 'Completed').length,
          inProgress: empTasks.filter(t => t.status === 'In Progress').length,
          overdue: empTasks.filter(t => 
            t.status !== 'Completed' && new Date(t.dueDate) < new Date()
          ).length
        };
      }
    });

    // Group by project
    const projects = [...new Set(tasks.filter(t => t.projectId).map(t => t.projectId._id.toString()))];
    projects.forEach(projId => {
      const projTasks = tasks.filter(t => t.projectId && t.projectId._id.toString() === projId);
      const projectName = projTasks[0].projectId.name;
      
      stats.byProject[projectName] = {
        total: projTasks.length,
        completed: projTasks.filter(t => t.status === 'Completed').length,
        inProgress: projTasks.filter(t => t.status === 'In Progress').length
      };
    });

    console.log(`✅ Found ${tasks.length} department tasks`);

    res.json({
      success: true,
      data: tasks,
      stats,
      department: deptHead.department,
      totalEmployees: departmentUsers.length
    });

  } catch (error) {
    console.error('Error fetching department tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch department tasks',
      error: error.message
    });
  }
};

/**
 * Get pending approvals for current user (at any level)
 */
const getMyPendingApprovals = async (req, res) => {
  try {
    const userId = req.user.userId;

    console.log('=== GET MY PENDING APPROVALS ===');
    console.log('User:', userId);

    // Find all tasks where user is in approval chain with pending status
    const tasks = await ActionItem.find({
      'assignedTo.completionApprovalChain.approver.userId': userId,
      'assignedTo.completionApprovalChain.status': 'pending'
    })
    .populate('assignedTo.user', 'fullName email department')
    .populate('createdBy', 'fullName email')
    .populate('projectId', 'name code')
    .sort({ 'assignedTo.submittedAt': 1 });

    // Filter to only tasks where THIS user has pending approval
    const pendingTasks = [];
    
    for (const task of tasks) {
      for (const assignee of task.assignedTo) {
        const pendingApproval = assignee.completionApprovalChain.find(a => 
          a.approver.userId && 
          a.approver.userId.equals(userId) && 
          a.status === 'pending'
        );
        
        if (pendingApproval) {
          pendingTasks.push({
            task: task,
            assignee: assignee.user,
            approvalLevel: pendingApproval.level,
            submittedAt: assignee.submittedAt,
            grade: assignee.completionGrade?.score || null,
            documents: assignee.completionDocuments
          });
        }
      }
    }

    const stats = {
      total: pendingTasks.length,
      level1: pendingTasks.filter(t => t.approvalLevel === 1).length,
      level2: pendingTasks.filter(t => t.approvalLevel === 2).length,
      level3: pendingTasks.filter(t => t.approvalLevel === 3).length
    };

    console.log(`✅ Found ${pendingTasks.length} pending approvals`);

    res.json({
      success: true,
      data: pendingTasks,
      stats
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

/**
 * Export team report (CSV/Excel)
 */
const exportTeamReport = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { format = 'csv', dateFrom, dateTo } = req.query;

    console.log('=== EXPORT TEAM REPORT ===');
    console.log('Format:', format);

    const supervisor = await User.findById(userId);
    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find direct reports
    const allUsers = await User.find({ isActive: true });
    const directReports = [];

    for (const user of allUsers) {
      const personData = findPersonByEmail(user.email);
      if (personData && personData.reportsTo === supervisor.email) {
        directReports.push(user._id);
      }
    }

    // Build query
    const query = {
      'assignedTo.user': { $in: directReports },
      isActive: true
    };

    if (dateFrom || dateTo) {
      query.dueDate = {};
      if (dateFrom) query.dueDate.$gte = new Date(dateFrom);
      if (dateTo) query.dueDate.$lte = new Date(dateTo);
    }

    const tasks = await ActionItem.find(query)
      .populate('assignedTo.user', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .populate('projectId', 'name code')
      .sort({ dueDate: 1 });

    // Format data for export
    const reportData = [];
    
    for (const task of tasks) {
      for (const assignee of task.assignedTo) {
        if (directReports.some(id => id.equals(assignee.user._id))) {
          reportData.push({
            'Task ID': task.displayId,
            'Task Title': task.title,
            'Employee': assignee.user.fullName,
            'Department': assignee.user.department,
            'Priority': task.priority,
            'Status': task.status,
            'Progress': `${task.progress}%`,
            'Due Date': task.dueDate.toISOString().split('T')[0],
            'Created': task.createdAt.toISOString().split('T')[0],
            'Project': task.projectId ? task.projectId.name : 'N/A',
            'Grade': assignee.completionGrade?.score || 'N/A',
            'Overdue': new Date(task.dueDate) < new Date() && task.status !== 'Completed' ? 'Yes' : 'No'
          });
        }
      }
    }

    if (format === 'csv') {
      // Convert to CSV
      const headers = Object.keys(reportData[0] || {});
      const csvRows = [
        headers.join(','),
        ...reportData.map(row => 
          headers.map(header => {
            const value = row[header];
            return typeof value === 'string' && value.includes(',') 
              ? `"${value}"` 
              : value;
          }).join(',')
        )
      ];
      
      const csv = csvRows.join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=team-report-${Date.now()}.csv`);
      res.send(csv);
    } else {
      // Return JSON for other formats
      res.json({
        success: true,
        data: reportData,
        count: reportData.length
      });
    }

  } catch (error) {
    console.error('Error exporting team report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export team report',
      error: error.message
    });
  }
};

module.exports = {
  getTeamTasks,
  getDepartmentTasks,
  getMyPendingApprovals,
  exportTeamReport
};