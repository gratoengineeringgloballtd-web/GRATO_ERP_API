const QuarterlyKPI = require('../models/QuarterlyKPI');
const User = require('../models/User');
const { getTaskSupervisor } = require('../config/actionItemApprovalChain');
const mongoose = require('mongoose');
const { sendKPIEmail } = require('../services/emailService');

// Get current quarter string
const getCurrentQuarter = () => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const quarter = Math.ceil(month / 3);
  return `Q${quarter}-${year}`;
};

// Get quarter date range
const getQuarterDateRange = (quarter) => {
  const [q, year] = quarter.split('-');
  const quarterNum = parseInt(q.replace('Q', ''));
  const yearNum = parseInt(year);
  
  const startMonth = (quarterNum - 1) * 3;
  const startDate = new Date(yearNum, startMonth, 1);
  const endDate = new Date(yearNum, startMonth + 3, 0, 23, 59, 59);
  
  return { startDate, endDate };
};

const createOrUpdateKPIs = async (req, res) => {
  try {
    const { quarter, kpis } = req.body;
    const userId = req.user.userId;

    console.log('=== CREATE/UPDATE KPIs ===');
    console.log('User:', userId);
    console.log('Quarter received:', quarter);
    console.log('KPIs count:', kpis?.length);

    // Validate KPIs
    if (!kpis || !Array.isArray(kpis) || kpis.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'At least 3 KPIs are required'
      });
    }

    // Validate total weight
    const totalWeight = kpis.reduce((sum, kpi) => sum + (kpi.weight || 0), 0);
    if (totalWeight !== 100) {
      return res.status(400).json({
        success: false,
        message: `Total KPI weight must equal 100%. Current total: ${totalWeight}%`
      });
    }

    // Map fields BEFORE validation
    const mappedKPIs = kpis.map(kpi => {
      if (!kpi.title || !kpi.description || !kpi.weight || !kpi.targetValue || !kpi.measurableOutcome) {
        throw new Error('All KPI fields are required: title, description, weight, targetValue, measurableOutcome');
      }
      
      return {
        title: kpi.title,
        description: kpi.description,
        weight: kpi.weight,
        target: kpi.targetValue,
        measurement: kpi.measurableOutcome,
        status: 'draft'
      };
    });

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Handle supervisor logic
    const isKelvin = user.email === 'kelvin.eyong@gratoglobal.com';
    let supervisorInfo = null;

    if (!isKelvin) {
      const supervisorData = getTaskSupervisor(user.email, user.department);
      
      if (!supervisorData) {
        return res.status(400).json({
          success: false,
          message: 'Unable to determine your supervisor. Please contact HR.'
        });
      }

      supervisorInfo = {
        name: supervisorData.name,
        email: supervisorData.email,
        department: supervisorData.department || user.department
      };
    }

    // ✅ FIX: Handle empty/missing quarter - use current quarter as default
    let finalQuarter = quarter;
    let finalYear;

    if (!finalQuarter || finalQuarter.trim() === '') {
      finalQuarter = getCurrentQuarter();
      console.log('⚠️ Empty quarter provided, using current:', finalQuarter);
    }

    // ✅ Parse year from quarter string
    const quarterParts = finalQuarter.split('-');
    if (quarterParts.length === 2) {
      finalYear = parseInt(quarterParts[1], 10);
    } else {
      // Fallback to current year if quarter format is unexpected
      finalYear = new Date().getFullYear();
      console.log('⚠️ Could not parse year from quarter, using current:', finalYear);
    }

    // Handle NaN year
    if (isNaN(finalYear)) {
      finalYear = new Date().getFullYear();
      console.log('⚠️ Invalid year parsed, using current:', finalYear);
    }

    console.log('Final quarter:', finalQuarter);
    console.log('Final year:', finalYear);

    // Check if KPIs already exist
    let quarterlyKPI = await QuarterlyKPI.findOne({
      employee: userId,
      quarter: finalQuarter
    });

    if (quarterlyKPI) {
      // Update existing KPIs
      if (quarterlyKPI.approvalStatus === 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Cannot modify approved KPIs. Please contact your supervisor.'
        });
      }

      if (quarterlyKPI.approvalStatus === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'KPIs are pending approval. Cannot modify until reviewed.'
        });
      }

      quarterlyKPI.kpis = mappedKPIs;
      quarterlyKPI.approvalStatus = 'draft';
      quarterlyKPI.rejectionReason = undefined;
      quarterlyKPI.supervisor = supervisorInfo;
      quarterlyKPI.year = finalYear;

      console.log('Updating existing KPIs');
    } else {
      // Create new KPIs
      quarterlyKPI = new QuarterlyKPI({
        employee: userId,
        quarter: finalQuarter,
        year: finalYear,
        kpis: mappedKPIs,
        supervisor: supervisorInfo
      });

      console.log('Creating new KPIs');
    }

    await quarterlyKPI.save();
    console.log('✅ KPIs saved successfully');

    res.status(200).json({
      success: true,
      message: 'KPIs saved successfully',
      data: quarterlyKPI
    });

  } catch (error) {
    console.error('Create/Update KPIs error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      errors: error.errors
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to save KPIs',
      error: error.message
    });
  }
};



const submitKPIsForApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const quarterlyKPI = await QuarterlyKPI.findOne({
      _id: id,
      employee: userId
    }).populate('employee', 'fullName email department');

    if (!quarterlyKPI) {
      return res.status(404).json({
        success: false,
        message: 'KPIs not found'
      });
    }

    if (quarterlyKPI.approvalStatus === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'KPIs are already approved'
      });
    }

    if (quarterlyKPI.approvalStatus === 'pending') {
      return res.status(400).json({
        success: false,
        message: 'KPIs are already pending approval'
      });
    }

    // Validate before submission
    if (quarterlyKPI.totalWeight !== 100) {
      return res.status(400).json({
        success: false,
        message: 'Total KPI weight must equal 100%'
      });
    }

    const isKelvin = quarterlyKPI.employee.email === 'kelvin.eyong@gratoglobal.com';
    
    if (isKelvin) {
      quarterlyKPI.approvalStatus = 'approved';
      quarterlyKPI.submittedAt = new Date();
      quarterlyKPI.approvedBy = userId;
      quarterlyKPI.approvedAt = new Date();
      
      quarterlyKPI.kpis.forEach(kpi => {
        kpi.status = 'approved';
        kpi.approvedBy = userId;
        kpi.approvedAt = new Date();
      });
      
      await quarterlyKPI.save();  // ✅ Single save for Kelvin
      
      return res.json({
        success: true,
        message: 'KPIs automatically approved (no supervisor required)',
        data: quarterlyKPI
      });
    }

    // ✅ FIX: submitForApproval() already saves, don't save again
    await quarterlyKPI.submitForApproval();

    // Send email to supervisor
    try {
      await sendKPIEmail.kpiSubmittedForApproval(
        quarterlyKPI.supervisor.email,
        quarterlyKPI.supervisor.name,
        quarterlyKPI.employee.fullName,
        quarterlyKPI.quarter,
        quarterlyKPI.kpis.length,
        quarterlyKPI._id
      );
    } catch (emailError) {
      console.error('Failed to send KPI submission email:', emailError);
    }

    res.json({
      success: true,
      message: 'KPIs submitted for supervisor approval',
      data: quarterlyKPI
    });

  } catch (error) {
    console.error('Submit KPIs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit KPIs',
      error: error.message
    });
  }
};


const processKPIApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, comments } = req.body;
    const userId = req.user.userId;

    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be "approve" or "reject"'
      });
    }

    const user = await User.findById(userId);
    const quarterlyKPI = await QuarterlyKPI.findById(id)
      .populate('employee', 'fullName email department');

    if (!quarterlyKPI) {
      return res.status(404).json({
        success: false,
        message: 'KPIs not found'
      });
    }

    const isImmediateSupervisor = quarterlyKPI.supervisor?.email === user.email;
    const isAdmin = ['admin', 'supply_chain'].includes(user.role);

    if (!isImmediateSupervisor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the immediate supervisor can approve these KPIs'
      });
    }

    if (quarterlyKPI.approvalStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'KPIs are not pending approval'
      });
    }

    if (decision === 'approve') {
      // ✅ approve() method returns saved document
      await quarterlyKPI.approve(userId);
      
      try {
        await sendKPIEmail.kpiApproved(
          quarterlyKPI.employee.email,
          quarterlyKPI.employee.fullName,
          user.fullName,
          quarterlyKPI.quarter,
          quarterlyKPI._id,
          comments
        );
      } catch (emailError) {
        console.error('Failed to send approval email:', emailError);
      }
    } else {
      if (!comments) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required'
        });
      }

      // ✅ reject() method returns saved document
      await quarterlyKPI.reject(userId, comments);
      
      try {
        await sendKPIEmail.kpiRejected(
          quarterlyKPI.employee.email,
          quarterlyKPI.employee.fullName,
          user.fullName,
          quarterlyKPI.quarter,
          quarterlyKPI._id,
          comments
        );
      } catch (emailError) {
        console.error('Failed to send rejection email:', emailError);
      }
    }

    // ✅ REMOVE: Don't save again, methods already saved
    // await quarterlyKPI.save();

    res.json({
      success: true,
      message: `KPIs ${decision}d successfully`,
      data: quarterlyKPI
    });

  } catch (error) {
    console.error('Process KPI approval error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process KPI approval',
      error: error.message
    });
  }
};

// Get employee KPIs
const getEmployeeKPIs = async (req, res) => {
  try {
    const { quarter } = req.query;
    const userId = req.user.userId;

    const filter = { employee: userId };
    if (quarter) {
      filter.quarter = quarter;
    }

    const kpis = await QuarterlyKPI.find(filter)
      .populate('employee', 'fullName email department')
      .populate('approvedBy', 'fullName email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: kpis,
      currentQuarter: getCurrentQuarter()
    });

  } catch (error) {
    console.error('Get employee KPIs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch KPIs',
      error: error.message
    });
  }
};

// // Get KPIs pending approval - FIXED VERSION
// const getPendingKPIApprovals = async (req, res) => {
//   try {
//     const userId = req.user.userId;
//     const user = await User.findById(userId);

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     let filter = { approvalStatus: 'pending' };

//     // ✅ CRITICAL FIX: Only show KPIs where this user is the IMMEDIATE supervisor
//     if (user.role === 'admin' || user.role === 'supply_chain') {
//       // Admins can see all pending KPIs (no filter restriction)
//       console.log('✓ Admin user - showing all pending KPIs');
//     } else {
//       // Non-admins can ONLY see KPIs where they are listed as the supervisor
//       filter['supervisor.email'] = user.email;
//       console.log(`✓ Regular user - filtering by supervisor email: ${user.email}`);
//     }

//     const pendingKPIs = await QuarterlyKPI.find(filter)
//       .populate('employee', 'fullName email department position')
//       .sort({ submittedAt: 1 });

//     console.log(`Found ${pendingKPIs.length} pending KPIs for ${user.fullName}`);

//     res.json({
//       success: true,
//       data: pendingKPIs,
//       count: pendingKPIs.length
//     });

//   } catch (error) {
//     console.error('Get pending KPI approvals error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch pending KPI approvals',
//       error: error.message
//     });
//   }
// };


const getPendingKPIApprovals = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('=== GET PENDING KPI APPROVALS ===');
    console.log('User:', user.fullName);
    console.log('Email:', user.email);
    console.log('Role:', user.role);
    console.log('Department:', user.department);

    let filter = { approvalStatus: 'pending' };

    // ✅ FIXED: Strict supervisor filtering for ALL users
    // Only show KPIs where this user is EXPLICITLY listed as the supervisor
    filter['supervisor.email'] = user.email;

    console.log('Filter being applied:', JSON.stringify(filter, null, 2));

    const pendingKPIs = await QuarterlyKPI.find(filter)
      .populate('employee', 'fullName email department position')
      .sort({ submittedAt: 1 });

    console.log(`Found ${pendingKPIs.length} pending KPIs for ${user.fullName}`);
    
    // Log each KPI's supervisor for debugging
    if (pendingKPIs.length > 0) {
      console.log('\nKPIs found:');
      pendingKPIs.forEach(kpi => {
        console.log(`- Employee: ${kpi.employee.fullName}, Supervisor: ${kpi.supervisor?.email}`);
      });
    }

    res.json({
      success: true,
      data: pendingKPIs,
      count: pendingKPIs.length
    });

  } catch (error) {
    console.error('Get pending KPI approvals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending KPI approvals',
      error: error.message
    });
  }
};

// Get single KPI document
const getKPIById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const user = await User.findById(userId);

    const quarterlyKPI = await QuarterlyKPI.findById(id)
      .populate('employee', 'fullName email department position')
      .populate('approvedBy', 'fullName email');

    if (!quarterlyKPI) {
      return res.status(404).json({
        success: false,
        message: 'KPIs not found'
      });
    }

    // Check access permissions
    const isOwner = quarterlyKPI.employee._id.equals(userId);
    const isSupervisor = quarterlyKPI.supervisor?.email === user.email;
    const isAdmin = ['admin', 'supply_chain'].includes(user.role);

    if (!isOwner && !isSupervisor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: quarterlyKPI
    });

  } catch (error) {
    console.error('Get KPI by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch KPI',
      error: error.message
    });
  }
};

// Delete KPIs (only draft/rejected)
const deleteKPIs = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const quarterlyKPI = await QuarterlyKPI.findOne({
      _id: id,
      employee: userId
    });

    if (!quarterlyKPI) {
      return res.status(404).json({
        success: false,
        message: 'KPIs not found'
      });
    }

    if (quarterlyKPI.approvalStatus === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete approved KPIs'
      });
    }

    if (quarterlyKPI.approvalStatus === 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete KPIs pending approval. Please wait for supervisor review.'
      });
    }

    await quarterlyKPI.deleteOne();

    res.json({
      success: true,
      message: 'KPIs deleted successfully'
    });

  } catch (error) {
    console.error('Delete KPIs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete KPIs',
      error: error.message
    });
  }
};

const getApprovedKPIsForTaskLinking = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { quarter, userId } = req.query;

    console.log('=== FETCH APPROVED KPIs FOR LINKING ===');
    console.log('Current User:', currentUserId);
    console.log('Target User:', userId);
    console.log('Quarter:', quarter);

    // Determine whose KPIs to fetch
    let targetUserId = userId || currentUserId;

    // ✅ FIX: Check if it's a MongoDB ObjectId OR a valid database user
    let targetUser;
    
    if (mongoose.Types.ObjectId.isValid(targetUserId)) {
      // Valid ObjectId - try to find user
      targetUser = await User.findById(targetUserId);
    } else {
      // Not a valid ObjectId - might be an email or fallback ID
      console.log('❌ Invalid ObjectId format:', targetUserId);
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format. User must be registered in the system.'
      });
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found or not registered in the system'
      });
    }

    // If fetching for another user, verify permissions
    if (userId && userId !== currentUserId) {
      const currentUser = await User.findById(currentUserId);

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message: 'Current user not found'
        });
      }

      // Allow supervisors, managers, and authorized roles to fetch KPIs for anyone
      const authorizedRoles = ['admin', 'supply_chain', 'supervisor', 'manager', 'hr', 'it', 'hse', 'technical', 'ceo'];
      
      if (!authorizedRoles.includes(currentUser.role)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You do not have permission to view other users\' KPIs'
        });
      }

      console.log(`✅ ${currentUser.role} accessing KPIs for ${targetUser.fullName}`);
    }

    const filter = {
      employee: targetUserId,
      approvalStatus: 'approved'
    };

    if (quarter) {
      filter.quarter = quarter;
    } else {
      filter.quarter = getCurrentQuarter();
    }

    console.log('Filter:', filter);

    const kpis = await QuarterlyKPI.findOne(filter)
      .select('quarter kpis totalWeight employee')
      .populate('employee', 'fullName email department');

    if (!kpis) {
      console.log('⚠️ No approved KPIs found');
      return res.json({
        success: true,
        data: null,
        message: 'No approved KPIs found for this quarter'
      });
    }

    console.log(`✅ Found ${kpis.kpis.length} approved KPIs for quarter ${kpis.quarter}`);

    res.json({
      success: true,
      data: kpis
    });

  } catch (error) {
    console.error('Get approved KPIs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approved KPIs',
      error: error.message
    });
  }
};

module.exports = {
  createOrUpdateKPIs,
  submitKPIsForApproval,
  processKPIApproval,
  getEmployeeKPIs,
  getPendingKPIApprovals,
  getKPIById,
  deleteKPIs,
  getApprovedKPIsForTaskLinking,
  getCurrentQuarter,
  getQuarterDateRange
};









// const QuarterlyKPI = require('../models/QuarterlyKPI');
// const User = require('../models/User');
// const { getTaskSupervisor } = require('../config/actionItemApprovalChain');
// const mongoose = require('mongoose');
// const { sendKPIEmail } = require('../services/emailService');

// // Get current quarter string
// const getCurrentQuarter = () => {
//   const now = new Date();
//   const month = now.getMonth() + 1;
//   const year = now.getFullYear();
//   const quarter = Math.ceil(month / 3);
//   return `Q${quarter}-${year}`;
// };

// // Get quarter date range
// const getQuarterDateRange = (quarter) => {
//   const [q, year] = quarter.split('-');
//   const quarterNum = parseInt(q.replace('Q', ''));
//   const yearNum = parseInt(year);
  
//   const startMonth = (quarterNum - 1) * 3;
//   const startDate = new Date(yearNum, startMonth, 1);
//   const endDate = new Date(yearNum, startMonth + 3, 0, 23, 59, 59);
  
//   return { startDate, endDate };
// };

// // Create or update quarterly KPIs - FIXED VERSION
// const createOrUpdateKPIs = async (req, res) => {
//   try {
//     const { quarter, kpis } = req.body;
//     const userId = req.user.userId;

//     console.log('=== CREATE/UPDATE KPIs ===');
//     console.log('User:', userId);
//     console.log('Quarter:', quarter);
//     console.log('KPIs count:', kpis?.length);

//     // Validate quarter format
//     // if (!/^Q[1-4]-\d{4}$/.test(quarter)) {
//     //   return res.status(400).json({
//     //     success: false,
//     //     message: 'Invalid quarter format. Use Q1-2025, Q2-2025, etc.'
//     //   });
//     // }

//     // Validate KPIs
//     if (!kpis || !Array.isArray(kpis) || kpis.length < 3) {
//       return res.status(400).json({
//         success: false,
//         message: 'At least 3 KPIs are required'
//       });
//     }

//     // if (kpis.length > 10) {
//     //   return res.status(400).json({
//     //     success: false,
//     //     message: 'Maximum 10 KPIs allowed'
//     //   });
//     // }

//     // Validate total weight
//     const totalWeight = kpis.reduce((sum, kpi) => sum + (kpi.weight || 0), 0);
//     if (totalWeight !== 100) {
//       return res.status(400).json({
//         success: false,
//         message: `Total KPI weight must equal 100%. Current total: ${totalWeight}%`
//       });
//     }

//     // Validate individual KPIs
//     for (const kpi of kpis) {
//       if (!kpi.title || !kpi.description || !kpi.weight || !kpi.targetValue || !kpi.measurableOutcome) {
//         return res.status(400).json({
//           success: false,
//           message: 'All KPI fields are required: title, description, weight, targetValue, measurableOutcome'
//         });
//       }
//     }

//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     // ✅ FIX: Get supervisor using EMAIL (not name)
//     const supervisorData = getTaskSupervisor(user.email, user.department);
    
//     if (!supervisorData) {
//       console.error('❌ Unable to determine supervisor for:', user.email);
//       return res.status(400).json({
//         success: false,
//         message: 'Unable to determine your supervisor. Please contact HR.'
//       });
//     }

//     console.log('✓ Supervisor data received:', supervisorData);

//     // ✅ Validate supervisor data structure
//     if (!supervisorData.name || typeof supervisorData.name !== 'string') {
//       console.error('❌ Invalid supervisor name:', supervisorData.name);
//       return res.status(500).json({
//         success: false,
//         message: 'System error: Invalid supervisor name configuration. Please contact HR.'
//       });
//     }

//     if (!supervisorData.email || typeof supervisorData.email !== 'string') {
//       console.error('❌ Invalid supervisor email:', supervisorData.email);
//       return res.status(500).json({
//         success: false,
//         message: 'System error: Invalid supervisor email configuration. Please contact HR.'
//       });
//     }

//     // ✅ Use the supervisor data directly (it's already properly formatted)
//     const supervisorInfo = {
//       name: supervisorData.name,
//       email: supervisorData.email,
//       department: supervisorData.department || user.department
//     };

//     console.log('✓ Final supervisor info:', supervisorInfo);

//     const [, year] = quarter.split('-');

//     // Check if KPIs already exist
//     let quarterlyKPI = await QuarterlyKPI.findOne({
//       employee: userId,
//       quarter: quarter
//     });

//     if (quarterlyKPI) {
//       // Update existing KPIs (only if in draft or rejected status)
//       if (quarterlyKPI.approvalStatus === 'approved') {
//         return res.status(400).json({
//           success: false,
//           message: 'Cannot modify approved KPIs. Please contact your supervisor.'
//         });
//       }

//       if (quarterlyKPI.approvalStatus === 'pending') {
//         return res.status(400).json({
//           success: false,
//           message: 'KPIs are pending approval. Cannot modify until reviewed.'
//         });
//       }

//       quarterlyKPI.kpis = kpis.map(kpi => ({
//         title: kpi.title,
//         description: kpi.description,
//         weight: kpi.weight,
//         targetValue: kpi.targetValue,
//         measurableOutcome: kpi.measurableOutcome,
//         status: 'pending'
//       }));
//       quarterlyKPI.approvalStatus = 'draft';
//       quarterlyKPI.rejectionReason = undefined;
//       quarterlyKPI.supervisor = supervisorInfo;

//       console.log('Updating existing KPIs');
//     } else {
//       // Create new KPIs
//       quarterlyKPI = new QuarterlyKPI({
//         employee: userId,
//         quarter: quarter,
//         year: parseInt(year),
//         kpis: kpis.map(kpi => ({
//           title: kpi.title,
//           description: kpi.description,
//           weight: kpi.weight,
//           targetValue: kpi.targetValue,
//           measurableOutcome: kpi.measurableOutcome,
//           status: 'pending'
//         })),
//         supervisor: supervisorInfo
//       });

//       console.log('Creating new KPIs');
//     }

//     await quarterlyKPI.save();
//     console.log('✅ KPIs saved successfully');

//     res.status(200).json({
//       success: true,
//       message: 'KPIs saved successfully',
//       data: quarterlyKPI
//     });

//   } catch (error) {
//     console.error('Create/Update KPIs error:', error);
//     console.error('Error details:', {
//       name: error.name,
//       message: error.message,
//       errors: error.errors
//     });
    
//     res.status(500).json({
//       success: false,
//       message: 'Failed to save KPIs',
//       error: error.message
//     });
//   }
// };

// // Submit KPIs for approval
// const submitKPIsForApproval = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.userId;

//     const quarterlyKPI = await QuarterlyKPI.findOne({
//       _id: id,
//       employee: userId
//     }).populate('employee', 'fullName email department');

//     if (!quarterlyKPI) {
//       return res.status(404).json({
//         success: false,
//         message: 'KPIs not found'
//       });
//     }

//     if (quarterlyKPI.approvalStatus === 'approved') {
//       return res.status(400).json({
//         success: false,
//         message: 'KPIs are already approved'
//       });
//     }

//     if (quarterlyKPI.approvalStatus === 'pending') {
//       return res.status(400).json({
//         success: false,
//         message: 'KPIs are already pending approval'
//       });
//     }

//     // Validate before submission
//     if (quarterlyKPI.totalWeight !== 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Total KPI weight must equal 100%'
//       });
//     }

//     if (quarterlyKPI.kpis.length < 3) {
//       return res.status(400).json({
//         success: false,
//         message: 'Minimum 3 KPIs required'
//       });
//     }

//     quarterlyKPI.submitForApproval();
//     await quarterlyKPI.save();

//     // Send email to supervisor
//     try {
//       await sendKPIEmail.kpiSubmittedForApproval(
//         quarterlyKPI.supervisor.email,
//         quarterlyKPI.supervisor.name,
//         quarterlyKPI.employee.fullName,
//         quarterlyKPI.quarter,
//         quarterlyKPI.kpis.length,
//         quarterlyKPI._id
//       );
//     } catch (emailError) {
//       console.error('Failed to send KPI submission email:', emailError);
//     }

//     res.json({
//       success: true,
//       message: 'KPIs submitted for supervisor approval',
//       data: quarterlyKPI
//     });

//   } catch (error) {
//     console.error('Submit KPIs error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to submit KPIs',
//       error: error.message
//     });
//   }
// };

// // Supervisor approve/reject KPIs
// const processKPIApproval = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { decision, comments } = req.body;
//     const userId = req.user.userId;

//     if (!['approve', 'reject'].includes(decision)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid decision. Must be "approve" or "reject"'
//       });
//     }

//     const user = await User.findById(userId);
//     const quarterlyKPI = await QuarterlyKPI.findById(id)
//       .populate('employee', 'fullName email department');

//     if (!quarterlyKPI) {
//       return res.status(404).json({
//         success: false,
//         message: 'KPIs not found'
//       });
//     }

//     // Define authorized roles that can approve any KPI
//     const authorizedRoles = ['admin', 'supply_chain', 'supervisor', 'manager', 'hr', 'it', 'hse', 'technical'];

//     // Check permission: either assigned supervisor OR authorized role
//     const isAssignedSupervisor = quarterlyKPI.supervisor.email === user.email;
//     const isAuthorizedRole = authorizedRoles.includes(user.role);

//     if (!isAssignedSupervisor && !isAuthorizedRole) {
//       return res.status(403).json({
//         success: false,
//         message: 'You do not have permission to approve these KPIs'
//       });
//     }

//     if (quarterlyKPI.approvalStatus !== 'pending') {
//       return res.status(400).json({
//         success: false,
//         message: 'KPIs are not pending approval'
//       });
//     }

//     if (decision === 'approve') {
//       quarterlyKPI.approve(userId);
      
//       // Send approval email
//       try {
//         await sendKPIEmail.kpiApproved(
//           quarterlyKPI.employee.email,
//           quarterlyKPI.employee.fullName,
//           user.fullName,
//           quarterlyKPI.quarter,
//           quarterlyKPI._id,
//           comments
//         );
//       } catch (emailError) {
//         console.error('Failed to send approval email:', emailError);
//       }

//       console.log('✅ KPIs APPROVED');
//     } else {
//       if (!comments) {
//         return res.status(400).json({
//           success: false,
//           message: 'Rejection reason is required'
//         });
//       }

//       quarterlyKPI.reject(userId, comments);
      
//       // Send rejection email
//       try {
//         await sendKPIEmail.kpiRejected(
//           quarterlyKPI.employee.email,
//           quarterlyKPI.employee.fullName,
//           user.fullName,
//           quarterlyKPI.quarter,
//           quarterlyKPI._id,
//           comments
//         );
//       } catch (emailError) {
//         console.error('Failed to send rejection email:', emailError);
//       }

//       console.log('❌ KPIs REJECTED');
//     }

//     await quarterlyKPI.save();

//     res.json({
//       success: true,
//       message: `KPIs ${decision}d successfully`,
//       data: quarterlyKPI
//     });

//   } catch (error) {
//     console.error('Process KPI approval error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to process KPI approval',
//       error: error.message
//     });
//   }
// };

// // Get employee KPIs
// const getEmployeeKPIs = async (req, res) => {
//   try {
//     const { quarter } = req.query;
//     const userId = req.user.userId;

//     const filter = { employee: userId };
//     if (quarter) {
//       filter.quarter = quarter;
//     }

//     const kpis = await QuarterlyKPI.find(filter)
//       .populate('employee', 'fullName email department')
//       .populate('approvedBy', 'fullName email')
//       .sort({ createdAt: -1 });

//     res.json({
//       success: true,
//       data: kpis,
//       currentQuarter: getCurrentQuarter()
//     });

//   } catch (error) {
//     console.error('Get employee KPIs error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch KPIs',
//       error: error.message
//     });
//   }
// };



// // Get KPIs pending approval (for supervisors and authorized roles)
// const getPendingKPIApprovals = async (req, res) => {
//   try {
//     const userId = req.user.userId;
//     const user = await User.findById(userId);

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     let filter = { approvalStatus: 'pending' };

//     // Define authorized roles that can view pending approvals
//     const authorizedRoles = ['admin', 'supply_chain', 'supervisor', 'manager', 'hr', 'it', 'hse', 'technical'];

//     if (user.role === 'supervisor') {
//       // Supervisors can only see KPIs assigned to them
//       filter['supervisor.email'] = user.email;
//     } else if (!authorizedRoles.includes(user.role)) {
//       // If user is not a supervisor and not in authorized roles, deny access
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }
//     // If user is in authorizedRoles, they can see all pending KPIs (no additional filter)

//     const pendingKPIs = await QuarterlyKPI.find(filter)
//       .populate('employee', 'fullName email department position')
//       .sort({ submittedAt: 1 });

//     res.json({
//       success: true,
//       data: pendingKPIs,
//       count: pendingKPIs.length
//     });

//   } catch (error) {
//     console.error('Get pending KPI approvals error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch pending KPI approvals',
//       error: error.message
//     });
//   }
// };

// // Get single KPI document
// const getKPIById = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.userId;
//     const user = await User.findById(userId);

//     const quarterlyKPI = await QuarterlyKPI.findById(id)
//       .populate('employee', 'fullName email department position')
//       .populate('approvedBy', 'fullName email');

//     if (!quarterlyKPI) {
//       return res.status(404).json({
//         success: false,
//         message: 'KPIs not found'
//       });
//     }

//     // Check access permissions
//     const isOwner = quarterlyKPI.employee._id.equals(userId);
//     const isSupervisor = quarterlyKPI.supervisor.email === user.email;
//     const isAdmin = ['admin', 'supply_chain'].includes(user.role);

//     if (!isOwner && !isSupervisor && !isAdmin) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied'
//       });
//     }

//     res.json({
//       success: true,
//       data: quarterlyKPI
//     });

//   } catch (error) {
//     console.error('Get KPI by ID error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch KPI',
//       error: error.message
//     });
//   }
// };

// // Delete KPIs (only draft/rejected)
// const deleteKPIs = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.userId;

//     const quarterlyKPI = await QuarterlyKPI.findOne({
//       _id: id,
//       employee: userId
//     });

//     if (!quarterlyKPI) {
//       return res.status(404).json({
//         success: false,
//         message: 'KPIs not found'
//       });
//     }

//     if (quarterlyKPI.approvalStatus === 'approved') {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot delete approved KPIs'
//       });
//     }

//     if (quarterlyKPI.approvalStatus === 'pending') {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot delete KPIs pending approval. Please wait for supervisor review.'
//       });
//     }

//     await quarterlyKPI.deleteOne();

//     res.json({
//       success: true,
//       message: 'KPIs deleted successfully'
//     });

//   } catch (error) {
//     console.error('Delete KPIs error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete KPIs',
//       error: error.message
//     });
//   }
// };



// const getApprovedKPIsForTaskLinking = async (req, res) => {
//   try {
//     const currentUserId = req.user.userId;
//     const { quarter, userId } = req.query;

//     console.log('=== FETCH APPROVED KPIs FOR LINKING ===');
//     console.log('Current User:', currentUserId);
//     console.log('Target User:', userId);
//     console.log('Quarter:', quarter);

//     // Determine whose KPIs to fetch
//     let targetUserId = userId || currentUserId;

//     // NEW: Validate that targetUserId is a valid ObjectId
//     if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
//       console.log('❌ Invalid user ID format:', targetUserId);
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid user ID format. User must be registered in the system.'
//       });
//     }

//     // If fetching for another user, verify the target user exists
//     if (userId && userId !== currentUserId) {
//       const currentUser = await User.findById(currentUserId);
//       const targetUser = await User.findById(userId);

//       if (!currentUser) {
//         return res.status(404).json({
//           success: false,
//           message: 'Current user not found'
//         });
//       }

//       if (!targetUser) {
//         return res.status(404).json({
//           success: false,
//           message: 'Target user not found or not registered in the system'
//         });
//       }

//       // Allow supervisors, managers, and authorized roles to fetch KPIs for anyone
//       const authorizedRoles = ['admin', 'supply_chain', 'supervisor', 'manager', 'hr', 'it', 'hse', 'technical'];
      
//       if (!authorizedRoles.includes(currentUser.role)) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied: You do not have permission to view other users\' KPIs'
//         });
//       }

//       console.log(`✅ ${currentUser.role} accessing KPIs for ${targetUser.fullName}`);
//     }

//     const filter = {
//       employee: targetUserId,
//       approvalStatus: 'approved'
//     };

//     if (quarter) {
//       filter.quarter = quarter;
//     } else {
//       filter.quarter = getCurrentQuarter();
//     }

//     console.log('Filter:', filter);

//     const kpis = await QuarterlyKPI.findOne(filter)
//       .select('quarter kpis totalWeight employee')
//       .populate('employee', 'fullName email department');

//     if (!kpis) {
//       console.log('⚠️ No approved KPIs found');
//       return res.json({
//         success: true,
//         data: null,
//         message: 'No approved KPIs found for this quarter'
//       });
//     }

//     console.log(`✅ Found ${kpis.kpis.length} approved KPIs for quarter ${kpis.quarter}`);

//     res.json({
//       success: true,
//       data: kpis
//     });

//   } catch (error) {
//     console.error('Get approved KPIs error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch approved KPIs',
//       error: error.message
//     });
//   }
// };


// module.exports = {
//   createOrUpdateKPIs,
//   submitKPIsForApproval,
//   processKPIApproval,
//   getEmployeeKPIs,
//   getPendingKPIApprovals,
//   getKPIById,
//   deleteKPIs,
//   getApprovedKPIsForTaskLinking,
//   getCurrentQuarter,
//   getQuarterDateRange
// };