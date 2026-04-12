const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveManagementController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// Employee routes
router.post('/', 
  authMiddleware, 
  upload.fields([
    { name: 'medicalCertificate', maxCount: 1 },
    { name: 'supportingDocuments', maxCount: 5 }
  ]),
  leaveController.createLeave
);

router.get('/employee', 
  authMiddleware, 
  leaveController.getEmployeeLeaves
);

router.get('/employee/balance', 
  authMiddleware, 
  leaveController.getEmployeeLeaveBalance
);

// Preview approval chain endpoint
router.post('/preview-approval-chain',
  authMiddleware,
  leaveController.getApprovalChainPreview
);

router.get('/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'), 
  leaveController.getSupervisorLeaves
);

router.get('/supervisor/:leaveId', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  leaveController.getEmployeeLeave
);

router.get('/hr', 
  authMiddleware, 
  requireRoles('hr', 'admin'),
  leaveController.getHRLeaves
);

router.get('/hr/:leaveId', 
  authMiddleware, 
  requireRoles('hr', 'admin'),
  leaveController.getEmployeeLeave
);

router.get('/admin', 
  authMiddleware, 
  requireRoles('admin'), 
  leaveController.getAllLeaves
);

router.get('/admin/:leaveId', 
  authMiddleware, 
  requireRoles('admin'),
  leaveController.getEmployeeLeave
);

router.put('/:leaveId/supervisor', 
  authMiddleware, 
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'), 
  leaveController.processSupervisorDecision
);

router.put('/:leaveId/hr', 
  authMiddleware, 
  requireRoles('hr', 'admin'),
  leaveController.processHRDecision
);

router.get('/:leaveId', 
  authMiddleware, 
  leaveController.getEmployeeLeave
);

router.post('/draft',
  authMiddleware,
  leaveController.saveDraft
);

router.get('/role',
  authMiddleware,
  leaveController.getLeavesByRole
);

router.get('/dashboard/stats',
  authMiddleware,
  leaveController.getDashboardStats
);

router.get('/analytics/general',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  leaveController.getLeaveAnalytics
);

router.get('/analytics/trends',
  authMiddleware,
  requireRoles('admin', 'hr'),
  leaveController.getLeaveTrends
);

router.get('/hr/analytics',
  authMiddleware,
  requireRoles('hr', 'admin'),
  leaveController.getHRAnalytics
);

router.get('/statistics',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  leaveController.getLeaveStats
);

router.put('/:leaveId',
  authMiddleware,
  leaveController.updateLeave
);

router.delete('/:leaveId',
  authMiddleware,
  leaveController.deleteLeave
);

router.post('/bulk/approve',
  authMiddleware,
  requireRoles('hr', 'admin'),
  leaveController.bulkApprove
);

router.post('/bulk/reject',
  authMiddleware,
  requireRoles('hr', 'admin'),
  leaveController.bulkReject
);

router.get('/info/types',
  authMiddleware,
  (req, res) => {
    const leaveTypes = {
      medical: {
        category: 'Medical Leave',
        types: [
          { value: 'sick_leave', label: 'Sick Leave', description: 'General illness requiring time off work', requiresCertificate: true },
          { value: 'medical_appointment', label: 'Medical Appointment', description: 'Scheduled medical consultation', requiresCertificate: false },
          { value: 'medical_procedure', label: 'Medical Procedure', description: 'Scheduled medical procedure or surgery', requiresCertificate: true },
          { value: 'recovery_leave', label: 'Recovery Leave', description: 'Post-surgery or treatment recovery', requiresCertificate: true },
        ]
      },
      vacation: {
        category: 'Vacation Leave',
        types: [
          { value: 'annual_leave', label: 'Annual Leave', description: 'Regular vacation time', requiresCertificate: false }
        ]
      },
      family: {
        category: 'Family Leave',
        types: [
          { value: 'family_care', label: 'Family Care Leave', description: 'Caring for sick family member', requiresCertificate: false },
          { value: 'child_sick_care', label: 'Child Sick Care', description: 'Caring for sick child', requiresCertificate: false },
          { value: 'elder_care', label: 'Elder Care Leave', description: 'Caring for elderly family members', requiresCertificate: false },
          { value: 'parental_leave', label: 'Parental Leave', description: 'General parental responsibilities', requiresCertificate: false }
        ]
      },
      emergency: {
        category: 'Emergency Leave',
        types: [
          { value: 'emergency_leave', label: 'Emergency Leave', description: 'Unexpected urgent situations', requiresCertificate: false },
          { value: 'disaster_leave', label: 'Disaster Leave', description: 'Natural disaster or emergency situations', requiresCertificate: false }
        ]
      },
      bereavement: {
        category: 'Bereavement Leave',
        types: [
          { value: 'bereavement_leave', label: 'Bereavement Leave', description: 'Death of family member or close friend', requiresCertificate: false },
          { value: 'funeral_leave', label: 'Funeral Leave', description: 'Attending funeral services', requiresCertificate: false }
        ]
      },
      study: {
        category: 'Study Leave',
        types: [
          { value: 'study_leave', label: 'Study Leave', description: 'Educational pursuits and courses', requiresCertificate: false },
          { value: 'training_leave', label: 'Training Leave', description: 'Professional training and development', requiresCertificate: false },
          { value: 'conference_leave', label: 'Conference Leave', description: 'Professional conferences and seminars', requiresCertificate: false },
          { value: 'examination_leave', label: 'Examination Leave', description: 'Taking professional or academic exams', requiresCertificate: false }
        ]
      }
    };

    res.json({
      success: true,
      data: leaveTypes
    });
  }
);

// Leave balance policies endpoint
router.get('/info/policies',
  authMiddleware,
  (req, res) => {
    const leavePolicies = {
      balances: {
        vacation: { annual: 21, description: 'Annual vacation days' },
        medical: { annual: 10, description: 'Sick leave days per year' },
        emergency: { annual: 3, description: 'Emergency leave days' },
        family: { annual: 12, description: 'Family care leave days' },
        bereavement: { annual: 5, description: 'Bereavement leave days' },
        study: { annual: 10, description: 'Professional development days' }
      },
      requirements: {
        medicalCertificate: {
          required: ['sick_leave', 'medical_procedure', 'recovery_leave', 'chronic_condition'],
          recommended: ['mental_health', 'emergency_medical'],
          threshold: 'Required for leaves exceeding 1 day'
        },
        advanceNotice: {
          routine: '2 weeks notice preferred',
          urgent: '48 hours notice minimum',
          emergency: 'Contact supervisor immediately, submit within 24 hours'
        }
      },
      approval: {
        supervisor: 'All leave requests require supervisor approval',
        hr: 'HR approval required for medical, family, and extended leaves (>5 days)',
        admin: 'Admin approval for sabbatical and extended unpaid leaves'
      }
    };

    res.json({
      success: true,
      data: leavePolicies
    });
  }
);

// Employee wellness tracking
router.get('/wellness/employee/:employeeId',
  authMiddleware,
  requireRoles('hr', 'admin'),
  async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { timeframe = 12 } = req.query; // months

      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - timeframe);

      const Leave = require('../models/Leave');

      const wellnessData = await Leave.aggregate([
        {
          $match: {
            employee: mongoose.Types.ObjectId(employeeId),
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              category: '$leaveCategory',
              month: { $month: '$createdAt' }
            },
            count: { $sum: 1 },
            totalDays: { $sum: '$totalDays' }
          }
        },
        {
          $group: {
            _id: '$_id.category',
            monthlyData: {
              $push: {
                month: '$_id.month',
                count: '$count',
                days: '$totalDays'
              }
            },
            totalCount: { $sum: '$count' },
            totalDays: { $sum: '$totalDays' }
          }
        }
      ]);

      res.json({
        success: true,
        data: wellnessData
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch wellness data',
        error: error.message
      });
    }
  }
);

// Department wellness overview
router.get('/wellness/department/:department',
  authMiddleware,
  requireRoles('employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project'),
  async (req, res) => {
    try {
      const { department } = req.params;
      const { timeframe = 12 } = req.query;

      const User = require('../models/User');
      const Leave = require('../models/Leave');

      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - timeframe);

      // Get department users
      const departmentUsers = await User.find({ department }).select('_id');
      const userIds = departmentUsers.map(u => u._id);

      const wellnessData = await Leave.aggregate([
        {
          $match: {
            employee: { $in: userIds },
            createdAt: { $gte: startDate }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'employee',
            foreignField: '_id',
            as: 'employeeData'
          }
        },
        { $unwind: '$employeeData' },
        {
          $group: {
            _id: {
              category: '$leaveCategory',
              employee: '$employeeData.fullName'
            },
            count: { $sum: 1 },
            totalDays: { $sum: '$totalDays' }
          }
        },
        {
          $group: {
            _id: '$_id.category',
            employees: {
              $push: {
                name: '$_id.employee',
                count: '$count',
                days: '$totalDays'
              }
            },
            categoryTotal: { $sum: '$totalDays' },
            averageDays: { $avg: '$totalDays' }
          }
        }
      ]);

      res.json({
        success: true,
        data: wellnessData
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch department wellness data',
        error: error.message
      });
    }
  }
);

module.exports = router;






