const BehavioralEvaluation = require('../models/BehavioralEvaluation');
const User = require('../models/User');
const { sendEvaluationEmail } = require('../services/emailService');

const DEFAULT_CRITERIA = [
  'Attendance & Punctuality',
  'Teamwork & Collaboration',
  'Communication Skills',
  'Initiative & Proactivity',
  'Professionalism',
  'Adaptability',
  'Problem Solving',
  'Time Management'
];

/**
 * Create or update behavioral evaluation
 * STRICT RULE: Can only evaluate direct reports
 */
const createOrUpdateEvaluation = async (req, res) => {
  try {
    const { employeeId, quarter, criteria, overallComments } = req.body;
    const evaluatorId = req.user.userId;

    console.log('=== CREATE/UPDATE BEHAVIORAL EVALUATION ===');
    console.log('Evaluator:', evaluatorId);
    console.log('Employee:', employeeId);
    console.log('Quarter:', quarter);

    // Validate quarter format
    if (!/^Q[1-4]-\d{4}$/.test(quarter)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quarter format. Use Q1-2025, Q2-2025, etc.'
      });
    }

    // Validate criteria
    if (!criteria || !Array.isArray(criteria) || criteria.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'At least 5 behavioral criteria must be evaluated'
      });
    }

    for (const criterion of criteria) {
      if (!criterion.name || !criterion.score) {
        return res.status(400).json({
          success: false,
          message: 'Each criterion must have a name and score'
        });
      }
      if (criterion.score < 1 || criterion.score > 5) {
        return res.status(400).json({
          success: false,
          message: 'Scores must be between 1 and 5'
        });
      }
    }

    const evaluator = await User.findById(evaluatorId).populate('directReports', '_id');
    const employee = await User.findById(employeeId);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // CRITICAL: Verify immediate supervisor relationship
    const isDirectReport = evaluator.directReports.some(
      report => report._id.equals(employeeId)
    );
    
    const hasCorrectSupervisor = employee.supervisor?.equals(evaluatorId);

    if (!isDirectReport || !hasCorrectSupervisor) {
      console.log('❌ AUTHORIZATION FAILED:');
      console.log('  - Is in directReports:', isDirectReport);
      console.log('  - Has correct supervisor:', hasCorrectSupervisor);
      
      return res.status(403).json({
        success: false,
        message: 'You can only evaluate your immediate direct reports'
      });
    }

    console.log('✓ Authorization passed: Direct report verified');

    const [, year] = quarter.split('-');

    // Check for existing evaluation
    let evaluation = await BehavioralEvaluation.findOne({
      employee: employeeId,
      quarter: quarter
    });

    if (evaluation) {
      // Prevent modification of submitted evaluations
      if (evaluation.status === 'submitted' || evaluation.status === 'acknowledged') {
        return res.status(400).json({
          success: false,
          message: 'Cannot modify a submitted evaluation'
        });
      }

      // Verify evaluator hasn't changed
      if (!evaluation.evaluator.equals(evaluatorId)) {
        return res.status(403).json({
          success: false,
          message: 'You are not the original evaluator'
        });
      }

      evaluation.criteria = criteria;
      evaluation.overallComments = overallComments || '';
      console.log('Updating existing evaluation');

    } else {
      // Create new evaluation
      evaluation = new BehavioralEvaluation({
        employee: employeeId,
        evaluator: evaluatorId,
        quarter: quarter,
        year: parseInt(year),
        criteria: criteria,
        overallComments: overallComments || ''
      });

      console.log('Creating new evaluation');
    }

    await evaluation.save();

    await evaluation.populate([
      { path: 'employee', select: 'fullName email department position' },
      { path: 'evaluator', select: 'fullName email position' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Behavioral evaluation saved successfully',
      data: evaluation
    });

  } catch (error) {
    console.error('Create/Update behavioral evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save behavioral evaluation',
      error: error.message
    });
  }
};

/**
 * Submit behavioral evaluation
 */
const submitEvaluation = async (req, res) => {
  try {
    const { id } = req.params;
    const evaluatorId = req.user.userId;

    const evaluation = await BehavioralEvaluation.findOne({
      _id: id,
      evaluator: evaluatorId
    }).populate('employee', 'fullName email department position');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found or not authorized'
      });
    }

    if (evaluation.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation is already submitted'
      });
    }

    evaluation.submit();
    await evaluation.save();

    // Send notification to employee
    const evaluator = await User.findById(evaluatorId);
    try {
      if (sendEvaluationEmail && sendEvaluationEmail.behavioralEvaluationSubmitted) {
        await sendEvaluationEmail.behavioralEvaluationSubmitted(
          evaluation.employee.email,
          evaluation.employee.fullName,
          evaluator.fullName,
          evaluation.quarter,
          evaluation.overallBehavioralScore,
          evaluation._id
        );
      }
    } catch (emailError) {
      console.error('Failed to send evaluation submission email:', emailError);
    }

    res.json({
      success: true,
      message: 'Behavioral evaluation submitted successfully',
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

/**
 * Get evaluations for supervisor (their direct reports only)
 */
const getEvaluations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { quarter, status, employeeId } = req.query;
    
    const user = await User.findById(userId).populate('directReports', '_id');

    let filter = {};

    // Non-admins can only see evaluations they created
    if (!['admin', 'supply_chain'].includes(user.role)) {
      filter.evaluator = userId;
    }

    if (quarter) filter.quarter = quarter;
    if (status) filter.status = status;
    if (employeeId) filter.employee = employeeId;

    const evaluations = await BehavioralEvaluation.find(filter)
      .populate('employee', 'fullName email department position')
      .populate('evaluator', 'fullName email position')
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

/**
 * Get employee's evaluations (their own)
 */
const getEmployeeEvaluations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { quarter } = req.query;

    const filter = { employee: userId };
    if (quarter) filter.quarter = quarter;

    const evaluations = await BehavioralEvaluation.find(filter)
      .populate('evaluator', 'fullName email position')
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

/**
 * Acknowledge evaluation
 */
const acknowledgeEvaluation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const evaluation = await BehavioralEvaluation.findOne({
      _id: id,
      employee: userId
    });

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: 'Evaluation must be submitted before acknowledgment'
      });
    }

    evaluation.acknowledge(userId);
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

/**
 * Get single evaluation
 */
const getEvaluationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const user = await User.findById(userId);

    const evaluation = await BehavioralEvaluation.findById(id)
      .populate('employee', 'fullName email department position')
      .populate('evaluator', 'fullName email position');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    // Check access
    const isEmployee = evaluation.employee._id.equals(userId);
    const isEvaluator = evaluation.evaluator._id.equals(userId);
    const isAdmin = ['admin', 'supply_chain'].includes(user.role);

    if (!isEmployee && !isEvaluator && !isAdmin) {
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

/**
 * Delete evaluation (draft only)
 */
const deleteEvaluation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const evaluation = await BehavioralEvaluation.findOne({
      _id: id,
      evaluator: userId
    });

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete draft evaluations'
      });
    }

    await evaluation.deleteOne();

    res.json({
      success: true,
      message: 'Evaluation deleted successfully'
    });

  } catch (error) {
    console.error('Delete evaluation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete evaluation',
      error: error.message
    });
  }
};

/**
 * Get default criteria
 */
const getDefaultCriteria = async (req, res) => {
  try {
    res.json({
      success: true,
      data: DEFAULT_CRITERIA.map(name => ({
        name,
        score: null,
        comments: ''
      }))
    });
  } catch (error) {
    console.error('Get default criteria error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch default criteria',
      error: error.message
    });
  }
};

module.exports = {
  createOrUpdateEvaluation,
  submitEvaluation,
  acknowledgeEvaluation,
  getEvaluations,
  getEmployeeEvaluations,
  getEvaluationById,
  deleteEvaluation,
  getDefaultCriteria,
  DEFAULT_CRITERIA
};