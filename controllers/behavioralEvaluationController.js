const BehavioralEvaluation = require('../models/BehavioralEvaluation');
const User = require('../models/User');
const { sendEvaluationEmail } = require('../services/emailService');
const { findPersonByEmail } = require('../config/departmentStructure');

// Default behavioral criteria
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

// ============================================
// FIXED: Create or update behavioral evaluation
// ============================================

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

    // Validate each criterion
    for (const criterion of criteria) {
      if (!criterion.name || criterion.score === undefined || criterion.score === null) {
        return res.status(400).json({
          success: false,
          message: 'Each criterion must have a name and score'
        });
      }
      // Updated validation to allow decimals
      if (criterion.score < 1.0 || criterion.score > 5.0) {
        return res.status(400).json({
          success: false,
          message: 'Scores must be between 1.0 and 5.0'
        });
      }
      // Optional: Validate that score has at most 1 decimal place
      if (!Number.isInteger(criterion.score * 10)) {
        return res.status(400).json({
          success: false,
          message: 'Scores can have at most 1 decimal place (e.g., 3.5, 4.2)'
        });
      }
    }


    const evaluator = await User.findById(evaluatorId);
    const employee = await User.findById(employeeId);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    console.log('Evaluator:', evaluator.fullName, evaluator.email);
    console.log('Employee:', employee.fullName, employee.email);

    // ✅ FIX: Check if evaluator IS the employee's supervisor
    // Find the employee in the org structure
    const employeeInStructure = findPersonByEmail(employee.email);
    
    let canEvaluate = false;
    let evaluationReason = '';

    // Check if evaluator is admin/supply_chain (can evaluate anyone)
    if (['admin', 'supply_chain'].includes(evaluator.role)) {
      canEvaluate = true;
      evaluationReason = 'Admin privilege';
    } 
    // Check if evaluator is the employee's direct supervisor
    else if (employeeInStructure && employeeInStructure.reportsTo) {
      const supervisorInStructure = findPersonByEmail(employeeInStructure.reportsTo);
      
      if (supervisorInStructure && supervisorInStructure.email === evaluator.email) {
        canEvaluate = true;
        evaluationReason = 'Direct supervisor';
      }
    }
    // Fallback: Check if evaluator is in the same department and has people reporting to them
    else if (employee.department === evaluator.department) {
      // Check if evaluator has anyone reporting to them
      const evaluatorInStructure = findPersonByEmail(evaluator.email);
      
      if (evaluatorInStructure && 
          (evaluatorInStructure.canSupervise && evaluatorInStructure.canSupervise.length > 0) ||
          evaluatorInStructure.isDepartmentHead) {
        canEvaluate = true;
        evaluationReason = 'Department supervisor';
      }
    }

    if (!canEvaluate) {
      console.log(`❌ ${evaluator.fullName} cannot evaluate ${employee.fullName}`);
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to evaluate this employee. Only direct supervisors can create behavioral evaluations.'
      });
    }

    console.log(`✅ Evaluation allowed: ${evaluationReason}`);

    const [, year] = quarter.split('-');

    // Check if evaluation already exists
    let evaluation = await BehavioralEvaluation.findOne({
      employee: employeeId,
      quarter: quarter
    });

    if (evaluation) {
      // Update existing evaluation (only if not submitted)
      if (evaluation.status === 'submitted' || evaluation.status === 'acknowledged') {
        return res.status(400).json({
          success: false,
          message: 'Cannot modify a submitted evaluation'
        });
      }

      evaluation.criteria = criteria;
      evaluation.overallComments = overallComments || '';
      evaluation.evaluator = evaluatorId;

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
      { path: 'employee', select: 'fullName email department' },
      { path: 'evaluator', select: 'fullName email' }
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

// ============================================
// Submit behavioral evaluation
// ============================================

const submitEvaluation = async (req, res) => {
  try {
    const { id } = req.params;
    const evaluatorId = req.user.userId;

    const evaluation = await BehavioralEvaluation.findOne({
      _id: id,
      evaluator: evaluatorId
    }).populate('employee', 'fullName email department');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    if (evaluation.status === 'submitted' || evaluation.status === 'acknowledged') {
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
      await sendEvaluationEmail.behavioralEvaluationSubmitted(
        evaluation.employee.email,
        evaluation.employee.fullName,
        evaluator.fullName,
        evaluation.quarter,
        evaluation.overallBehavioralScore,
        evaluation._id
      );
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

// ============================================
// Employee acknowledges evaluation
// ============================================

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

// ============================================
// FIXED: Get evaluations (for supervisors)
// ============================================

const getEvaluations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { quarter, status, employeeId } = req.query;
    const user = await User.findById(userId);

    console.log('=== GET EVALUATIONS ===');
    console.log('User:', user.fullName, user.email);
    console.log('Role:', user.role);

    let filter = {};

    // ✅ FIX: Check if user IS a supervisor (not if role === 'supervisor')
    if (['admin', 'supply_chain'].includes(user.role)) {
      // Admins see all evaluations
      console.log('✓ Admin access - showing all evaluations');
    } else {
      // ✅ Find employees that this user supervises
      const userInStructure = findPersonByEmail(user.email);
      
      if (!userInStructure) {
        console.log('⚠ User not found in org structure');
        return res.json({
          success: true,
          data: [],
          count: 0,
          message: 'You are not configured as a supervisor in the system'
        });
      }

      // Find all users in the system
      const allUsers = await User.find({}).select('email _id');
      const supervisedEmployeeIds = [];

      // Check each user to see if current user is their supervisor
      for (const employee of allUsers) {
        const employeeInStructure = findPersonByEmail(employee.email);
        
        if (employeeInStructure && employeeInStructure.reportsTo === user.email) {
          supervisedEmployeeIds.push(employee._id);
        }
      }

      if (supervisedEmployeeIds.length === 0) {
        console.log('⚠ No supervised employees found');
        return res.json({
          success: true,
          data: [],
          count: 0,
          message: 'You do not supervise any employees'
        });
      }

      console.log(`✓ Found ${supervisedEmployeeIds.length} supervised employees`);
      filter.employee = { $in: supervisedEmployeeIds };
    }

    if (quarter) filter.quarter = quarter;
    if (status) filter.status = status;
    if (employeeId) filter.employee = employeeId;

    console.log('Filter:', JSON.stringify(filter, null, 2));

    const evaluations = await BehavioralEvaluation.find(filter)
      .populate('employee', 'fullName email department position')
      .populate('evaluator', 'fullName email')
      .sort({ createdAt: -1 });

    console.log(`Found ${evaluations.length} evaluations`);

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

// ============================================
// Get employee's evaluations
// ============================================

const getEmployeeEvaluations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { quarter } = req.query;

    const filter = { employee: userId };
    if (quarter) filter.quarter = quarter;

    const evaluations = await BehavioralEvaluation.find(filter)
      .populate('evaluator', 'fullName email')
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

// ============================================
// Get single evaluation
// ============================================

const getEvaluationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const user = await User.findById(userId);

    const evaluation = await BehavioralEvaluation.findById(id)
      .populate('employee', 'fullName email department position')
      .populate('evaluator', 'fullName email');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    // Check access permissions
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

// ============================================
// Delete evaluation (only draft)
// ============================================

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

// ============================================
// Get default criteria
// ============================================

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

// ============================================
// HELPER: Get list of employees that current user can evaluate
// ============================================

const getEvaluableEmployees = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    console.log('=== GET EVALUABLE EMPLOYEES ===');
    console.log('User:', user.fullName, user.email);

    let evaluableEmployees = [];

    if (['admin', 'supply_chain'].includes(user.role)) {
      // Admins can evaluate anyone
      evaluableEmployees = await User.find({ 
        _id: { $ne: userId } 
      }).select('fullName email department position');
      
      console.log(`✓ Admin access - can evaluate all ${evaluableEmployees.length} employees`);
    } else {
      // Find employees that report to this user
      const userInStructure = findPersonByEmail(user.email);
      
      if (!userInStructure) {
        return res.json({
          success: true,
          data: [],
          message: 'You are not configured as a supervisor'
        });
      }

      const allUsers = await User.find({ 
        _id: { $ne: userId } 
      }).select('fullName email department position');

      for (const employee of allUsers) {
        const employeeInStructure = findPersonByEmail(employee.email);
        
        // Check if this employee reports to current user
        if (employeeInStructure && employeeInStructure.reportsTo === user.email) {
          evaluableEmployees.push(employee);
        }
      }

      console.log(`✓ Found ${evaluableEmployees.length} evaluable employees`);
    }

    res.json({
      success: true,
      data: evaluableEmployees,
      count: evaluableEmployees.length
    });

  } catch (error) {
    console.error('Get evaluable employees error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch evaluable employees',
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
  getEvaluableEmployees, 
  DEFAULT_CRITERIA
};





