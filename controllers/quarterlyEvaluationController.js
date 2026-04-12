// controllers/quarterlyEvaluationController.js
const mongoose = require('mongoose');
const QuarterlyEvaluation = require('../models/QuarterlyEvaluation');
const BehavioralEvaluation = require('../models/BehavioralEvaluation');
const QuarterlyKPI = require('../models/QuarterlyKPI');
const ActionItem = require('../models/ActionItem');
const User = require('../models/User');
const { getQuarterDateRange } = require('./quarterlyKPIController');
const { sendEvaluationEmail } = require('../services/emailService');

// Generate quarterly evaluation
const generateQuarterlyEvaluation = async (req, res) => {
  try {
    const { employeeId, quarter } = req.body;
    const supervisorId = req.user.userId;

    console.log('=== GENERATE QUARTERLY EVALUATION ===');
    console.log('Supervisor:', supervisorId);
    console.log('Employee:', employeeId);
    console.log('Quarter:', quarter);

    // Validate quarter format
    if (!/^Q[1-4]-\d{4}$/.test(quarter)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quarter format. Use Q1-2025, Q2-2025, etc.'
      });
    }

    const supervisor = await User.findById(supervisorId).populate('directReports', '_id');
    const employee = await User.findById(employeeId);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // CRITICAL: Verify immediate supervisor relationship
    const isDirectReport = supervisor.directReports.some(
      report => report._id.equals(employeeId)
    );
    
    const hasCorrectSupervisor = employee.supervisor?.equals(supervisorId);

    // Allow admins to bypass check
    const isAdmin = ['admin', 'supply_chain'].includes(supervisor.role);

    if (!isAdmin && (!isDirectReport || !hasCorrectSupervisor)) {
      console.log('❌ AUTHORIZATION FAILED:');
      console.log('  - Is in directReports:', isDirectReport);
      console.log('  - Has correct supervisor:', hasCorrectSupervisor);
      
      return res.status(403).json({
        success: false,
        message: 'You can only generate evaluations for your immediate direct reports'
      });
    }

    console.log('✓ Authorization passed: Direct report verified');

    // Check if evaluation already exists
    let evaluation = await QuarterlyEvaluation.findOne({
      employee: employeeId,
      quarter: quarter
    });

    if (evaluation && evaluation.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation already exists for this quarter and cannot be regenerated'
      });
    }

    // Get quarter date range
    const { startDate, endDate } = getQuarterDateRange(quarter);
    const [, year] = quarter.split('-');

    // Fetch KPIs
    const quarterlyKPI = await QuarterlyKPI.findOne({
      employee: employeeId,
      quarter: quarter,
      approvalStatus: 'approved'
    });

    if (!quarterlyKPI) {
      return res.status(400).json({
        success: false,
        message: 'No approved KPIs found for this quarter. Employee must set and get KPIs approved first.'
      });
    }

    // Fetch behavioral evaluation
    const behavioralEvaluation = await BehavioralEvaluation.findOne({
      employee: employeeId,
      quarter: quarter,
      status: { $in: ['submitted', 'acknowledged'] }
    });

    if (!behavioralEvaluation) {
      return res.status(400).json({
        success: false,
        message: 'Behavioral evaluation not found or not submitted for this quarter'
      });
    }

    // Fetch completed tasks for this quarter
    console.log('Querying for completed tasks...');
    console.log('Employee ID:', employeeId);
    console.log('Date Range:', startDate, 'to', endDate);
    
    // Convert employeeId to ObjectId
    const employeeObjectId = new mongoose.Types.ObjectId(employeeId);
    
    // First, get all completed tasks in the date range
    const completedTasks = await ActionItem.find({
      'assignedTo.user': employeeObjectId,
      status: 'Completed',
      completedDate: {
        $gte: startDate,
        $lte: endDate
      }
    }).populate('linkedKPIs.kpiDocId');

    console.log(`Found ${completedTasks.length} completed tasks for this employee in the quarter`);

    // Filter to only include tasks where THIS employee has been graded
    const gradedTasks = completedTasks.filter(task => {
      const assignedToEntry = task.assignedTo.find(
        a => a.user && a.user.toString() === employeeObjectId.toString()
      );
      
      const hasGrade = assignedToEntry && 
                       assignedToEntry.completionGrade && 
                       typeof assignedToEntry.completionGrade.score === 'number';
      
      if (hasGrade) {
        // Store the grade at task level for easier access
        task._employeeGrade = assignedToEntry.completionGrade.score;
      }
      
      return hasGrade;
    });

    console.log(`Found ${gradedTasks.length} completed and graded tasks`);
    
    if (gradedTasks.length > 0) {
      gradedTasks.forEach((task, index) => {
        console.log(`Task ${index + 1}:`, {
          id: task._id,
          title: task.title,
          completedDate: task.completedDate,
          grade: task._employeeGrade,
          linkedKPIs: task.linkedKPIs?.length || 0,
          linkedKPIsData: task.linkedKPIs?.map(kpi => ({
            kpiDocId: kpi.kpiDocId?._id || kpi.kpiDocId,
            kpiTitle: kpi.kpiTitle
          }))
        });
      });
    }
    
    console.log('Looking for KPI ID:', quarterlyKPI._id.toString());

    // Calculate task performance by KPI
    const kpiAchievement = [];
    let totalWeightedScore = 0;

    for (const kpi of quarterlyKPI.kpis) {
      // Match tasks by checking linkedKPIs array
      const kpiTasks = gradedTasks.filter(task => {
        if (!task.linkedKPIs || !Array.isArray(task.linkedKPIs)) return false;
        
        return task.linkedKPIs.some(linkedKPI => {
          if (!linkedKPI.kpiTitle || linkedKPI.kpiTitle !== kpi.title) return false;
          
          // Check if kpiDocId matches (could be populated object or ObjectId string)
          const kpiDocId = linkedKPI.kpiDocId?._id || linkedKPI.kpiDocId;
          const matches = kpiDocId && 
            (kpiDocId.toString() === quarterlyKPI._id.toString() || 
             (typeof kpiDocId === 'object' && kpiDocId.equals && kpiDocId.equals(quarterlyKPI._id)));
          
          if (matches) {
            console.log(`  ✓ Task "${task.title}" matches KPI "${kpi.title}"`);
          }
          
          return matches;
        });
      });

      console.log(`KPI "${kpi.title}": Found ${kpiTasks.length} tasks`);

      if (kpiTasks.length > 0) {
        // Use _employeeGrade instead of completionGrade.score
        const totalGrade = kpiTasks.reduce((sum, task) => sum + task._employeeGrade, 0);
        const averageGrade = totalGrade / kpiTasks.length;
        const achievedPercentage = (averageGrade / 5) * 100;
        const weightedScore = (achievedPercentage * kpi.weight) / 100;

        kpiAchievement.push({
          kpiTitle: kpi.title,
          kpiWeight: kpi.weight,
          tasksCompleted: kpiTasks.length,
          averageGrade: averageGrade,
          achievedScore: achievedPercentage,
          weightedScore: weightedScore
        });

        totalWeightedScore += weightedScore;
        
        console.log(`  KPI "${kpi.title}": avg grade ${averageGrade.toFixed(2)}/5, achieved ${achievedPercentage.toFixed(2)}%, weighted score ${weightedScore.toFixed(2)}%`);
      } else {
        kpiAchievement.push({
          kpiTitle: kpi.title,
          kpiWeight: kpi.weight,
          tasksCompleted: 0,
          averageGrade: 0,
          achievedScore: 0,
          weightedScore: 0
        });
      }
    }

    const taskPerformanceScore = totalWeightedScore;

    // Calculate totals
    const totalTasks = await ActionItem.countDocuments({
      'assignedTo.user': employeeObjectId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      },
      status: { $ne: 'Rejected' }
    });

    // Calculate average from gradedTasks with _employeeGrade
    const averageCompletionGrade = gradedTasks.length > 0
      ? gradedTasks.reduce((sum, task) => sum + task._employeeGrade, 0) / gradedTasks.length
      : 0;

    console.log(`Total Tasks: ${totalTasks}, Completed: ${completedTasks.length}, Graded: ${gradedTasks.length}, Avg Grade: ${averageCompletionGrade.toFixed(2)}`);

    // Create or update evaluation
    if (evaluation) {
      evaluation.supervisor = supervisorId;
      evaluation.period = { startDate, endDate };
      evaluation.quarterlyKPI = quarterlyKPI._id;
      evaluation.taskMetrics = {
        totalTasks,
        completedTasks: gradedTasks.length,
        averageCompletionGrade,
        kpiAchievement,
        taskPerformanceScore
      };
      evaluation.behavioralEvaluation = behavioralEvaluation._id;
      evaluation.behavioralScore = behavioralEvaluation.overallBehavioralScore;
      evaluation.generatedBy = supervisorId;
    } else {
      evaluation = new QuarterlyEvaluation({
        employee: employeeId,
        supervisor: supervisorId,
        quarter: quarter,
        year: parseInt(year),
        period: { startDate, endDate },
        quarterlyKPI: quarterlyKPI._id,
        taskMetrics: {
          totalTasks,
          completedTasks: gradedTasks.length,
          averageCompletionGrade,
          kpiAchievement,
          taskPerformanceScore
        },
        behavioralEvaluation: behavioralEvaluation._id,
        behavioralScore: behavioralEvaluation.overallBehavioralScore,
        generatedBy: supervisorId
      });
    }

    // Calculate final score
    evaluation.calculateFinalScore();
    await evaluation.save();

    console.log('=== FINAL SCORES ===');
    console.log(`Task Performance: ${evaluation.taskMetrics.taskPerformanceScore.toFixed(2)}% (70% weight)`);
    console.log(`Behavioral Score: ${evaluation.behavioralScore.toFixed(2)}% (30% weight)`);
    console.log(`Final Score: ${evaluation.finalScore.toFixed(2)}%`);
    console.log(`Grade: ${evaluation.grade}`);
    console.log(`Performance Level: ${evaluation.performanceLevel}`);

    await evaluation.populate([
      { path: 'employee', select: 'fullName email department position' },
      { path: 'supervisor', select: 'fullName email' },
      { path: 'quarterlyKPI' },
      { path: 'behavioralEvaluation' }
    ]);

    console.log(`✅ Evaluation generated successfully`);
    console.log('===================\n');

    res.status(200).json({
      success: true,
      message: 'Quarterly evaluation generated successfully',
      data: evaluation
    });

  } catch (error) {
    console.error('Generate quarterly evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate quarterly evaluation',
      error: error.message
    });
  }
};

// Submit evaluation for employee review
const submitEvaluation = async (req, res) => {
  try {
    const { id } = req.params;
    const { supervisorComments } = req.body;
    const supervisorId = req.user.userId;

    const evaluation = await QuarterlyEvaluation.findOne({
      _id: id,
      supervisor: supervisorId
    }).populate('employee', 'fullName email');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status !== 'calculated' && evaluation.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation must be calculated before submission'
      });
    }

    if (supervisorComments) {
      evaluation.supervisorComments = supervisorComments;
    }

    evaluation.submit();
    await evaluation.save();

    // Send notification to employee
    const supervisor = await User.findById(supervisorId);
    try {
      if (sendEvaluationEmail && sendEvaluationEmail.quarterlyEvaluationReady) {
        await sendEvaluationEmail.quarterlyEvaluationReady(
          evaluation.employee.email,
          evaluation.employee.fullName,
          supervisor.fullName,
          evaluation.quarter,
          evaluation.finalScore,
          evaluation.grade,
          evaluation._id
        );
      }
    } catch (emailError) {
      console.error('Failed to send evaluation ready email:', emailError);
    }

    res.json({
      success: true,
      message: 'Evaluation submitted successfully',
      data: evaluation
    });

  } catch (error) {
    console.error('Submit evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit evaluation',
      error: error.message
    });
  }
};

// Approve evaluation (by higher management if needed)
const approveEvaluation = async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    
    if (!['admin', 'supply_chain'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can approve evaluations'
      });
    }

    const evaluation = await QuarterlyEvaluation.findById(id);

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation must be submitted before approval'
      });
    }

    evaluation.approve(userId, comments);
    await evaluation.save();

    res.json({
      success: true,
      message: 'Evaluation approved successfully',
      data: evaluation
    });

  } catch (error) {
    console.error('Approve evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve evaluation',
      error: error.message
    });
  }
};

// Employee acknowledges evaluation
const acknowledgeEvaluation = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeComments } = req.body;
    const userId = req.user.userId;

    const evaluation = await QuarterlyEvaluation.findOne({
      _id: id,
      employee: userId
    });

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status !== 'submitted' && evaluation.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation must be submitted before acknowledgment'
      });
    }

    evaluation.acknowledge(employeeComments);
    await evaluation.save();

    res.json({
      success: true,
      message: 'Evaluation acknowledged successfully',
      data: evaluation
    });

  } catch (error) {
    console.error('Acknowledge evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to acknowledge evaluation',
      error: error.message
    });
  }
};

// Get evaluations (for supervisors/admins)
const getEvaluations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { quarter, status, employeeId } = req.query;
    const user = await User.findById(userId).populate('directReports', '_id');

    let filter = {};

    // Non-admins can only see evaluations they created
    if (!['admin', 'supply_chain'].includes(user.role)) {
      filter.supervisor = userId;
    }

    if (quarter) filter.quarter = quarter;
    if (status) filter.status = status;
    if (employeeId) filter.employee = employeeId;

    const evaluations = await QuarterlyEvaluation.find(filter)
      .populate('employee', 'fullName email department position')
      .populate('supervisor', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: evaluations,
      count: evaluations.length
    });

  } catch (error) {
    console.error('Get evaluations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch evaluations',
      error: error.message
    });
  }
};

// Get employee's evaluations
const getEmployeeEvaluations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    const { quarter, employeeId } = req.query;

    let targetEmployeeId = userId; // Default to logged-in user
    
    // If employeeId is provided, verify access
    if (employeeId) {
      const isAdmin = ['admin', 'supply_chain', 'supervisor', 'manager', 'hr', 'it', 'hse', 'technical'].includes(user.role);
      const isSupervisor = user.role === 'supervisor';
      
      if (isAdmin) {
        // Admins/HR can view any employee
        targetEmployeeId = employeeId;
      } else if (isSupervisor) {
        // Supervisors can view their direct reports
        const supervisor = await User.findById(userId).populate('directReports', '_id');
        const isDirectReport = supervisor.directReports.some(
          report => report._id.toString() === employeeId
        );
        
        if (isDirectReport || userId === employeeId) {
          targetEmployeeId = employeeId;
        } else {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only view evaluations for your direct reports.'
          });
        }
      } else if (userId !== employeeId) {
        // Regular employees can only view their own
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own evaluations.'
        });
      }
    }

    const filter = { employee: targetEmployeeId };
    if (quarter) filter.quarter = quarter;

    const evaluations = await QuarterlyEvaluation.find(filter)
      .populate('supervisor', 'fullName email')
      .populate('quarterlyKPI')
      .populate('behavioralEvaluation')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: evaluations
    });

  } catch (error) {
    console.error('Get employee evaluations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch evaluations',
      error: error.message
    });
  }
};

// Get single evaluation
const getEvaluationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const user = await User.findById(userId);

    const evaluation = await QuarterlyEvaluation.findById(id)
      .populate('employee', 'fullName email department position')
      .populate('supervisor', 'fullName email')
      .populate('quarterlyKPI')
      .populate('behavioralEvaluation')
      .populate('approvedBy', 'fullName email');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    // Check access permissions
    const isEmployee = evaluation.employee._id.equals(userId);
    const isSupervisor = evaluation.supervisor._id.equals(userId);
    const isAdmin = ['admin', 'supply_chain'].includes(user.role);

    if (!isEmployee && !isSupervisor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: evaluation
    });

  } catch (error) {
    console.error('Get evaluation by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch evaluation',
      error: error.message
    });
  }
};

// Get evaluation statistics
const getEvaluationStatistics = async (req, res) => {
  try {
    const { quarter, department } = req.query;
    const userId = req.user.userId;
    const user = await User.findById(userId).populate('directReports', '_id');

    if (!['admin', 'supply_chain', 'supervisor', 'manager', 'hr', 'it', 'hse', 'technical'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let filter = {};
    if (quarter) filter.quarter = quarter;

    // For supervisors, only show stats for their evaluations
    if (user.role === 'supervisor') {
      filter.supervisor = userId;
    } else if (department) {
      const departmentEmployees = await User.find({ 
        department: department,
        role: { $ne: 'supervisor' }
      }).select('_id');
      filter.employee = { $in: departmentEmployees.map(e => e._id) };
    }

    const evaluations = await QuarterlyEvaluation.find(filter);

    const stats = {
      total: evaluations.length,
      byStatus: {
        draft: evaluations.filter(e => e.status === 'draft').length,
        calculated: evaluations.filter(e => e.status === 'calculated').length,
        submitted: evaluations.filter(e => e.status === 'submitted').length,
        approved: evaluations.filter(e => e.status === 'approved').length,
        acknowledged: evaluations.filter(e => e.status === 'acknowledged').length
      },
      byGrade: {
        'A+': evaluations.filter(e => e.grade === 'A+').length,
        'A': evaluations.filter(e => e.grade === 'A').length,
        'B+': evaluations.filter(e => e.grade === 'B+').length,
        'B': evaluations.filter(e => e.grade === 'B').length,
        'C+': evaluations.filter(e => e.grade === 'C+').length,
        'C': evaluations.filter(e => e.grade === 'C').length,
        'D': evaluations.filter(e => e.grade === 'D').length,
        'F': evaluations.filter(e => e.grade === 'F').length
      },
      averageScores: {
        finalScore: evaluations.length > 0 
          ? evaluations.reduce((sum, e) => sum + e.finalScore, 0) / evaluations.length 
          : 0,
        taskPerformance: evaluations.length > 0
          ? evaluations.reduce((sum, e) => sum + e.taskMetrics.taskPerformanceScore, 0) / evaluations.length
          : 0,
        behavioral: evaluations.length > 0
          ? evaluations.reduce((sum, e) => sum + e.behavioralScore, 0) / evaluations.length
          : 0
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get evaluation statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};

module.exports = {
  generateQuarterlyEvaluation,
  submitEvaluation,
  approveEvaluation,
  acknowledgeEvaluation,
  getEvaluations,
  getEmployeeEvaluations,
  getEvaluationById,
  getEvaluationStatistics
};


