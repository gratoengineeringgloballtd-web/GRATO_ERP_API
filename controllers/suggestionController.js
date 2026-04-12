const Suggestion = require('../models/Suggestion');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const fs = require('fs');
const path = require('path');

// // Create new employee suggestion
const createSuggestion = async (req, res) => {
  try {
    console.log('=== CREATE EMPLOYEE SUGGESTION STARTED ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const {
      suggestionId,
      title,
      description,
      category,
      priority,
      expectedBenefit,
      impactAreas,
      beneficiaries,
      successMetrics,
      estimatedCost,
      costJustification,
      estimatedTimeframe,
      requiredResources,
      implementationSteps,
      potentialChallenges,
      similarAttempts,
      previousAttemptDetails,
      additionalNotes,
      followUpWilling,
      isAnonymous
    } = req.body;

    // Validate required fields
    if (!title || title.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Title must be at least 5 characters long'
      });
    }

    if (!description || description.length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Description must be at least 20 characters long'
      });
    }

    if (!expectedBenefit || expectedBenefit.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Expected benefit must be at least 10 characters long'
      });
    }

    // Get user details
    const employee = await User.findById(req.user.userId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    console.log('Employee details:', {
      fullName: employee.fullName,
      department: employee.department,
      email: employee.email,
      isAnonymous: isAnonymous
    });

    // Parse arrays if they're strings
    let parsedImpactAreas, parsedBeneficiaries;
    try {
      parsedImpactAreas = typeof impactAreas === 'string' ? JSON.parse(impactAreas) : impactAreas;
      parsedBeneficiaries = typeof beneficiaries === 'string' ? JSON.parse(beneficiaries) : beneficiaries;
    } catch (error) {
      console.log('Error parsing arrays:', error);
      parsedImpactAreas = [];
      parsedBeneficiaries = [];
    }

    // Process attachments if any
    let attachments = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const fileName = `${Date.now()}-${file.originalname}`;
          const uploadDir = path.join(__dirname, '../uploads/suggestions');
          const filePath = path.join(uploadDir, fileName);

          // Ensure directory exists
          await fs.promises.mkdir(uploadDir, {
            recursive: true
          });

          // Move file to permanent location
          if (file.path) {
            await fs.promises.rename(file.path, filePath);
          }

          attachments.push({
            name: file.originalname,
            url: `/uploads/suggestions/${fileName}`,
            publicId: fileName,
            size: file.size,
            mimetype: file.mimetype
          });
        } catch (fileError) {
          console.error('Error processing file:', file.originalname, fileError);
        }
      }
    }

    // Create the suggestion
    const suggestion = new Suggestion({
      suggestionId,
      employee: isAnonymous === 'true' ? null : req.user.userId,
      title,
      description,
      category,
      priority,
      isAnonymous: isAnonymous === 'true',
      submittedBy: employee.email,
      department: employee.department,
      expectedBenefit,
      impactAreas: parsedImpactAreas || [],
      beneficiaries: parsedBeneficiaries || [],
      successMetrics,
      estimatedCost,
      costJustification,
      estimatedTimeframe,
      requiredResources,
      implementationSteps,
      potentialChallenges,
      similarAttempts,
      previousAttemptDetails,
      additionalNotes,
      followUpWilling: followUpWilling === 'true' || followUpWilling === true,
      attachments,
      status: 'pending',
      submittedAt: new Date()
    });

    // Add audit log
    suggestion.addAuditLog('created', req.user.userId, `Suggestion created by ${employee.fullName}`, null, {
      title,
      category,
      priority,
      isAnonymous: isAnonymous === 'true'
    });

    await suggestion.save();
    console.log('Suggestion saved successfully with ID:', suggestion._id);

    // Populate employee details for response (if not anonymous)
    if (!suggestion.isAnonymous) {
      await suggestion.populate('employee', 'fullName email department');
    }

    // === ENHANCED EMAIL NOTIFICATIONS ===
    const notifications = [];
    console.log('=== STARTING EMAIL NOTIFICATIONS ===');

    // Notify HR team about new suggestion
    try {
      const hrTeam = await User.find({
        role: 'hr'
      }).select('email fullName');
      console.log('Found HR team members:', hrTeam.map(h => ({
        name: h.fullName,
        email: h.email
      })));

      if (hrTeam.length > 0) {
        const hrEmails = hrTeam.map(h => h.email);
        console.log('Sending HR notification to:', hrEmails);

        const hrNotification = await sendEmail({
          to: hrEmails,
          subject: `New Employee Suggestion: ${title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #1890ff; margin: 0;">💡 New Employee Suggestion Submitted</h2>
                <p style="color: #666; margin: 5px 0 0 0;">A new suggestion has been submitted by ${isAnonymous === 'true' ? 'an anonymous employee' : employee.fullName}</p>
              </div>
              <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: #333; margin-top: 0;">Suggestion Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #555; font-weight: bold; width: 30%;">Title:</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${title}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #555; font-weight: bold; width: 30%;">Category:</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${category}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #555; font-weight: bold; width: 30%;">Priority:</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${priority}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #555; font-weight: bold; width: 30%;">Submitted By:</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${isAnonymous === 'true' ? 'Anonymous' : employee.fullName}</td>
                  </tr>
                </table>
                <p style="margin-top: 20px;">You can review the full suggestion details in the suggestion management dashboard.</p>
              </div>
            </div>
          `
        });
        notifications.push(hrNotification);
      }
    } catch (error) {
      console.error('Error sending email to HR team:', error);
    }

    // Notify department heads and managers
    try {
      const departmentManagers = await User.find({
        'employee.department': employee.department,
        role: {
          $in: ['manager', 'department_head']
        }
      }).select('email fullName');
      console.log('Found department managers:', departmentManagers.map(m => ({
        name: m.fullName,
        email: m.email
      })));
      if (departmentManagers.length > 0) {
        const managerEmails = departmentManagers.map(m => m.email);
        console.log('Sending department notification to:', managerEmails);
        const departmentNotification = await sendEmail({
          to: managerEmails,
          subject: `New Departmental Suggestion: ${title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #1890ff; margin: 0;">💡 New Suggestion for Your Department</h2>
                <p style="color: #666; margin: 5px 0 0 0;">A new suggestion has been submitted related to your department (${employee.department}) by ${isAnonymous === 'true' ? 'an anonymous employee' : employee.fullName}.</p>
              </div>
              <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: #333; margin-top: 0;">Suggestion Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #555; font-weight: bold; width: 30%;">Title:</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${title}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #555; font-weight: bold; width: 30%;">Category:</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${category}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #555; font-weight: bold; width: 30%;">Priority:</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; color: #333;">${priority}</td>
                  </tr>
                </table>
                <p style="margin-top: 20px;">Please review the suggestion and provide feedback.</p>
              </div>
            </div>
          `
        });
        notifications.push(departmentNotification);
      }
    } catch (error) {
      console.error('Error sending email to department managers:', error);
    }

    // Notify a general "suggestions" mailing list or specific group
    try {
      const adminUsers = await User.find({
        role: 'admin'
      }).select('email');
      const adminEmails = adminUsers.map(u => u.email);
      if (adminEmails.length > 0) {
        const adminNotification = await sendEmail({
          to: adminEmails,
          subject: `New Suggestion Submitted: ${title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #1890ff; margin: 0;">💡 A New Suggestion has been Submitted</h2>
                <p style="color: #666; margin: 5px 0 0 0;">A new suggestion has been submitted. Check the dashboard for details.</p>
              </div>
              <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: #333; margin-top: 0;">Summary</h3>
                <p><strong>Title:</strong> ${title}</p>
                <p><strong>Category:</strong> ${category}</p>
                <p><strong>Priority:</strong> ${priority}</p>
              </div>
            </div>
          `
        });
        notifications.push(adminNotification);
      }
    } catch (error) {
      console.error('Error sending email to admin team:', error);
    }

    console.log('Total notifications scheduled:', notifications.length);
    // You can use Promise.all to send all emails concurrently for better performance
    // await Promise.all(notifications);

    // Send the response
    res.status(201).json({
      message: 'Suggestion submitted successfully!',
      suggestionId: suggestion._id,
      suggestion
    });

  } catch (error) {
    console.error('Create suggestion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create suggestion',
      error: error.message
    });
  }
};


// // Update implementation status
const updateImplementationStatus = async (req, res) => {
  try {
    const {
      suggestionId
    } = req.params;
    const {
      status,
      progress,
      assignedTeam,
      startDate,
      targetDate,
      completionDate,
      actualCost,
      results,
      impactMeasurement
    } = req.body;

    const user = await User.findById(req.user.userId);
    const suggestion = await Suggestion.findById(suggestionId)
      .populate('employee', 'fullName email department');

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update implementation details
    if (!suggestion.implementation) {
      suggestion.implementation = {};
    }

    if (status) suggestion.implementation.status = status;
    if (progress !== undefined) suggestion.implementation.progress = Math.min(100, Math.max(0, progress));
    if (assignedTeam) suggestion.implementation.assignedTeam = assignedTeam;
    if (startDate) suggestion.implementation.startDate = new Date(startDate);
    if (targetDate) suggestion.implementation.targetDate = new Date(targetDate);
    if (completionDate) suggestion.implementation.completionDate = new Date(completionDate);
    if (actualCost) suggestion.implementation.actualCost = parseFloat(actualCost);
    if (results) suggestion.implementation.results = results;
    if (impactMeasurement) suggestion.implementation.impactMeasurement = impactMeasurement;

    // Update main status if completed
    if (status === 'completed') {
      suggestion.status = 'implemented';
      suggestion.implementation.completionDate = new Date();
      suggestion.implementation.progress = 100;
    }

    suggestion.addAuditLog('implementation_updated', req.user.userId,
      `Implementation updated by ${user.fullName}`,
      null, {
        status,
        progress,
        actualCost
      }
    );

    await suggestion.save();

    // Notify employee if implementation is completed
    if (status === 'completed' && !suggestion.isAnonymous) {
      try {
        await sendEmail({
          to: suggestion.submittedBy,
          subject: 'Your Suggestion Has Been Successfully Implemented!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f6ffed; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #52c41a; margin: 0;">Congratulations! Your Suggestion is Now Live</h2>
                <p style="color: #666; margin: 5px 0 0 0;">Your suggestion has been successfully implemented and is making a positive impact.</p>
              </div>

              <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: #333; margin-top: 0;">Implementation Completed</h3>
                <ul style="list-style: none; padding: 0;">
                  <li style="padding: 5px 0;"><strong>Suggestion:</strong> ${suggestion.title}</li>
                  <li style="padding: 5px 0;"><strong>Completed on:</strong> ${new Date().toLocaleDateString()}</li>
                  ${assignedTeam ? `<li style="padding: 5px 0;"><strong>Implementation Team:</strong> ${assignedTeam}</li>` : ''}
                  ${actualCost ? `<li style="padding: 5px 0;"><strong>Final Cost:</strong> XAF ${parseFloat(actualCost).toLocaleString()}</li>` : ''}
                </ul>
              </div>

              ${results ? `
              <div style="background-color: #e6f7ff; border-left: 4px solid #1890ff; padding: 15px; margin: 20px 0;">
                <h4 style="margin: 0 0 10px 0; color: #1890ff;">Implementation Results</h4>
                <p style="margin: 0; color: #333;">${results}</p>
              </div>
              ` : ''}

              <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                <h4 style="margin: 0 0 10px 0; color: #856404;">Thank You!</h4>
                <p style="margin: 0; color: #856404;">Your innovative thinking has contributed to making our workplace better. We encourage you to continue sharing your ideas!</p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/employee/suggestions/new"
                  style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Share Another Idea
                </a>
              </div>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send implementation completion notification:', emailError);
      }
    }

    res.json({
      success: true,
      message: 'Implementation status updated successfully',
      data: suggestion
    });

  } catch (error) {
      console.error('Update implementation status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update implementation status',
        error: error.message
      });
  }
};

// Get all suggestions (Admin)
const getAllSuggestions = async (req, res) => {
  try {
    const {
      status,
      department,
      page = 1,
      limit = 20
    } = req.query;

    let filter = {};
    if (status) filter.status = status;
    if (department) filter.department = department;

    const suggestions = await Suggestion.find(filter)
      .populate('employee', 'fullName email department')
      .populate('hrReview.decidedBy', 'fullName email')
      .populate('managementReview.decidedBy', 'fullName email')
      .sort({
        createdAt: -1
      })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Suggestion.countDocuments(filter);

    res.json({
      success: true,
      data: suggestions,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: suggestions.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get all suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suggestions',
      error: error.message
    });
  }
};

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const {
      role,
      userId
    } = req.user;
    const user = await User.findById(userId);

    let filter = {};

    // Filter based on user role
    if (role === 'employee') {
      // Employee sees their own suggestions and public ones for community features
      filter = {
        $or: [{
          employee: userId
        }, {
          submittedBy: user.email
        }, // For anonymous suggestions
        {
          isAnonymous: false
        } // Public suggestions for voting/commenting
        ]
      };
    } else if (role === 'hr') {
      // HR sees all suggestions
    } else if (role === 'admin') {
      // Admin sees all suggestions
    }

    const [
      totalCount,
      pendingCount,
      approvedCount,
      rejectedCount,
      implementedCount,
      recentSuggestions,
      topCategories,
      monthlyStats
    ] = await Promise.all([
      Suggestion.countDocuments(filter),
      Suggestion.countDocuments({
        ...filter,
        status: 'pending'
      }),
      Suggestion.countDocuments({
        ...filter,
        status: 'approved'
      }),
      Suggestion.countDocuments({
        ...filter,
        status: 'rejected'
      }),
      Suggestion.countDocuments({
        ...filter,
        status: 'implemented'
      }),

      // Recent suggestions (last 10)
      Suggestion.find(filter)
      .populate('employee', 'fullName email department')
      .sort({
        createdAt: -1
      })
      .limit(10),

      // Top categories
      Suggestion.aggregate([{
        $match: filter
      }, {
        $group: {
          _id: '$category',
          count: {
            $sum: 1
          },
          avgVotes: {
            $avg: '$votes.upvotes'
          }
        }
      }, {
        $sort: {
          count: -1
        }
      }, {
        $limit: 5
      }, ]),

      // Monthly stats
      Suggestion.aggregate([{
        $match: filter
      }, {
        $group: {
          _id: {
            year: {
              $year: '$submittedAt'
            },
            month: {
              $month: '$submittedAt'
            }
          },
          total: {
            $sum: 1
          },
          pending: {
            $sum: {
              $cond: [{
                $eq: ['$status', 'pending']
              }, 1, 0]
            }
          },
          approved: {
            $sum: {
              $cond: [{
                $eq: ['$status', 'approved']
              }, 1, 0]
            }
          },
          rejected: {
            $sum: {
              $cond: [{
                $eq: ['$status', 'rejected']
              }, 1, 0]
            }
          },
          implemented: {
            $sum: {
              $cond: [{
                $eq: ['$status', 'implemented']
              }, 1, 0]
            }
          },
        }
      }, {
        $sort: {
          '_id.year': 1,
          '_id.month': 1
        }
      }, ])
    ]);

    res.json({
      success: true,
      data: {
        totalCount,
        pendingCount,
        approvedCount,
        rejectedCount,
        implementedCount,
        recentSuggestions,
        topCategories,
        monthlyStats
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};


// Get suggestions by role (replaces multiple role-specific endpoints)
const getSuggestionsByRole = async (req, res) => {
  try {
    const { role, userId } = req.user;
    const { status, category, priority, page = 1, limit = 20 } = req.query;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let filter = {};
    
    // Role-based filtering
    if (role === 'employee') {
      // Employee sees all non-anonymous suggestions + their own anonymous ones
      filter = {
        $or: [
          { isAnonymous: false }, // All public suggestions
          { employee: userId }, // Their own suggestions (including anonymous)
          { submittedBy: user.email } // Anonymous suggestions by email
        ]
      };
    } else if (role === 'hr' || role === 'admin') {
      // HR and Admin see all suggestions
      filter = {};
    }

    // Apply additional filters
    if (status && status !== 'all') filter.status = status;
    if (category && category !== 'all') filter.category = category;
    if (priority && priority !== 'all') filter.priority = priority;

    const suggestions = await Suggestion.find(filter)
      .populate('employee', 'fullName email department employeeId')
      .populate('hrReview.decidedBy', 'fullName email')
      .populate('managementReview.decidedBy', 'fullName email')
      .sort({ submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Suggestion.countDocuments(filter);

    // Transform data to match frontend expectations
    const transformedSuggestions = suggestions.map(suggestion => {
      const suggestionObj = suggestion.toObject();
      
      // Add user vote information
      if (suggestionObj.votes && suggestionObj.votes.voters) {
        const userVote = suggestionObj.votes.voters.find(v => 
          v.user && v.user.toString() === userId.toString()
        );
        suggestionObj.votes.userVote = userVote ? userVote.vote : null;
      }

      // Transform submittedBy for anonymous suggestions
      if (suggestionObj.isAnonymous) {
        suggestionObj.submittedBy = null;
      } else if (suggestionObj.employee) {
        suggestionObj.submittedBy = suggestionObj.employee;
      }

      // Add reviewStatus for frontend compatibility
      suggestionObj.reviewStatus = {
        hrReview: suggestionObj.hrReview?.reviewed ? 
          (suggestionObj.hrReview.recommendation || 'reviewed') : 'pending',
        managementReview: suggestionObj.managementReview?.reviewed ? 
          (suggestionObj.managementReview.decision || 'reviewed') : 'pending',
        feasibilityScore: suggestionObj.hrReview?.feasibilityScore || null
      };

      return suggestionObj;
    });

    res.json({
      success: true,
      data: transformedSuggestions,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: transformedSuggestions.length,
        totalRecords: total
      }
    });

  } catch (error) {
    console.error('Get suggestions by role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suggestions',
      error: error.message
    });
  }
};

// Get suggestion details
const getSuggestionDetails = async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { role, userId } = req.user;

    const suggestion = await Suggestion.findById(suggestionId)
      .populate('employee', 'fullName email department employeeId')
      .populate('hrReview.decidedBy', 'fullName email')
      .populate('managementReview.decidedBy', 'fullName email')
      .populate('comments.userId', 'fullName email');

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    // Check access permissions
    const user = await User.findById(userId);
    const canView = (
      role === 'admin' || 
      role === 'hr' || 
      !suggestion.isAnonymous || 
      suggestion.employee?.toString() === userId.toString() ||
      suggestion.submittedBy === user.email
    );

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Increment view count
    suggestion.viewCount += 1;
    suggestion.lastViewedAt = new Date();
    await suggestion.save();

    // Transform data to match frontend expectations
    const suggestionObj = suggestion.toObject();
    
    // Add user vote information
    if (suggestionObj.votes && suggestionObj.votes.voters) {
      const userVote = suggestionObj.votes.voters.find(v => 
        v.user && v.user.toString() === userId.toString()
      );
      suggestionObj.votes.userVote = userVote ? userVote.vote : null;
    }

    // Transform submittedBy for anonymous suggestions
    if (suggestionObj.isAnonymous) {
      suggestionObj.submittedBy = null;
    } else if (suggestionObj.employee) {
      suggestionObj.submittedBy = suggestionObj.employee;
    }

    // Add reviewStatus for frontend compatibility
    suggestionObj.reviewStatus = {
      hrReview: suggestionObj.hrReview?.reviewed ? 
        (suggestionObj.hrReview.recommendation || 'reviewed') : 'pending',
      managementReview: suggestionObj.managementReview?.reviewed ? 
        (suggestionObj.managementReview.decision || 'reviewed') : 'pending',
      feasibilityScore: suggestionObj.hrReview?.feasibilityScore || null
    };

    res.json({
      success: true,
      data: suggestionObj
    });

  } catch (error) {
    console.error('Get suggestion details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suggestion details',
      error: error.message
    });
  }
};

// Vote on suggestion
const voteSuggestion = async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { voteType } = req.body; // 'up' or 'down'
    const { userId } = req.user;

    if (!['up', 'down'].includes(voteType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vote type. Must be "up" or "down"'
      });
    }

    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    // Check if suggestion can be voted on
    if (!suggestion.canBeVotedOn()) {
      return res.status(400).json({
        success: false,
        message: 'This suggestion cannot be voted on'
      });
    }

    // Remove existing vote if any
    const existingVoteIndex = suggestion.votes.voters.findIndex(v => 
      v.user && v.user.toString() === userId.toString()
    );

    if (existingVoteIndex !== -1) {
      const existingVote = suggestion.votes.voters[existingVoteIndex];
      if (existingVote.vote === 'up') suggestion.votes.upvotes -= 1;
      if (existingVote.vote === 'down') suggestion.votes.downvotes -= 1;
      suggestion.votes.voters.splice(existingVoteIndex, 1);
    }

    // Add new vote
    if (voteType === 'up') {
      suggestion.votes.upvotes += 1;
    } else {
      suggestion.votes.downvotes += 1;
    }

    suggestion.votes.voters.push({
      user: userId,
      vote: voteType,
      votedAt: new Date()
    });

    suggestion.votes.totalVotes = suggestion.votes.upvotes + suggestion.votes.downvotes;
    
    // Update trending status
    suggestion.updateTrendingStatus();

    await suggestion.save();

    res.json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        votes: {
          upvotes: suggestion.votes.upvotes,
          downvotes: suggestion.votes.downvotes,
          totalVotes: suggestion.votes.totalVotes,
          userVote: voteType
        }
      }
    });

  } catch (error) {
    console.error('Vote suggestion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record vote',
      error: error.message
    });
  }
};

// Remove vote
const removeVote = async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { userId } = req.user;

    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    // Find and remove existing vote
    const existingVoteIndex = suggestion.votes.voters.findIndex(v => 
      v.user && v.user.toString() === userId.toString()
    );

    if (existingVoteIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'No vote found to remove'
      });
    }

    const existingVote = suggestion.votes.voters[existingVoteIndex];
    if (existingVote.vote === 'up') suggestion.votes.upvotes -= 1;
    if (existingVote.vote === 'down') suggestion.votes.downvotes -= 1;
    
    suggestion.votes.voters.splice(existingVoteIndex, 1);
    suggestion.votes.totalVotes = suggestion.votes.upvotes + suggestion.votes.downvotes;

    await suggestion.save();

    res.json({
      success: true,
      message: 'Vote removed successfully',
      data: {
        votes: {
          upvotes: suggestion.votes.upvotes,
          downvotes: suggestion.votes.downvotes,
          totalVotes: suggestion.votes.totalVotes,
          userVote: null
        }
      }
    });

  } catch (error) {
    console.error('Remove vote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove vote',
      error: error.message
    });
  }
};

// Add comment
const addComment = async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { comment } = req.body;
    const { userId } = req.user;

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment cannot be empty'
      });
    }

    if (comment.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Comment must be 500 characters or less'
      });
    }

    const user = await User.findById(userId);
    const suggestion = await Suggestion.findById(suggestionId);

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    const isOfficial = ['hr', 'admin'].includes(user.role);
    const newComment = suggestion.addComment(
      userId, 
      user.fullName, 
      comment.trim(), 
      isOfficial
    );

    await suggestion.save();

    res.json({
      success: true,
      message: 'Comment added successfully',
      data: newComment
    });

  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message
    });
  }
};

// Get comments
const getComments = async (req, res) => {
  try {
    const { suggestionId } = req.params;

    const suggestion = await Suggestion.findById(suggestionId)
      .populate('comments.userId', 'fullName email')
      .select('comments');

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    res.json({
      success: true,
      data: suggestion.comments || []
    });

  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments',
      error: error.message
    });
  }
};

// HR Review - Process HR review
const processHRReview = async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { 
      recommendation, 
      comments, 
      feasibilityScore, 
      hrPriority 
    } = req.body;

    const user = await User.findById(req.user.userId);
    const suggestion = await Suggestion.findById(suggestionId)
      .populate('employee', 'fullName email department');

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    if (!['hr', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. HR role required.'
      });
    }

    // Validate required fields
    if (!recommendation || !comments) {
      return res.status(400).json({
        success: false,
        message: 'Recommendation and comments are required'
      });
    }

    if (feasibilityScore && (feasibilityScore < 1 || feasibilityScore > 10)) {
      return res.status(400).json({
        success: false,
        message: 'Feasibility score must be between 1 and 10'
      });
    }

    // Update HR review
    suggestion.hrReview = {
      reviewed: true,
      reviewedBy: user.fullName,
      reviewedAt: new Date(),
      comments: comments,
      recommendation: recommendation,
      feasibilityScore: feasibilityScore || null,
      hrPriority: hrPriority || 'medium',
      decidedBy: req.user.userId
    };

    // Update suggestion status based on recommendation
    if (recommendation === 'approve') {
      suggestion.status = 'management_review';
    } else if (recommendation === 'reject') {
      suggestion.status = 'rejected';
    } else {
      suggestion.status = 'hr_review';
    }

    suggestion.addAuditLog('hr_review', req.user.userId, 
      `HR review completed by ${user.fullName}`, null, {
        recommendation,
        feasibilityScore,
        hrPriority
      }
    );

    await suggestion.save();

    // Send notification emails
    try {
      // Notify employee if not anonymous
      if (!suggestion.isAnonymous && suggestion.employee) {
        const statusText = recommendation === 'approve' ? 'approved and forwarded to management' :
                          recommendation === 'reject' ? 'not approved at this time' : 'under further review';
        
        await sendEmail({
          to: suggestion.employee.email,
          subject: `Update on Your Suggestion: ${suggestion.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: ${recommendation === 'approve' ? '#f6ffed' : recommendation === 'reject' ? '#fff2f0' : '#e6f7ff'}; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: ${recommendation === 'approve' ? '#52c41a' : recommendation === 'reject' ? '#ff4d4f' : '#1890ff'}; margin: 0;">HR Review Completed</h2>
                <p style="color: #666; margin: 5px 0 0 0;">Your suggestion has been ${statusText}.</p>
              </div>
              <div style="background-color: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 20px;">
                <h3 style="color: #333; margin-top: 0;">Suggestion: ${suggestion.title}</h3>
                <p><strong>HR Feedback:</strong> ${comments}</p>
                ${feasibilityScore ? `<p><strong>Feasibility Score:</strong> ${feasibilityScore}/10</p>` : ''}
              </div>
            </div>
          `
        });
      }
    } catch (emailError) {
      console.error('Failed to send HR review notification:', emailError);
    }

    res.json({
      success: true,
      message: 'HR review completed successfully',
      data: suggestion
    });

  } catch (error) {
    console.error('Process HR review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process HR review',
      error: error.message
    });
  }
};

// Update suggestion status (HR/Admin)
const updateSuggestionStatus = async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { status, reason } = req.body;

    const user = await User.findById(req.user.userId);
    const suggestion = await Suggestion.findById(suggestionId);

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: 'Suggestion not found'
      });
    }

    if (!['hr', 'admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const oldStatus = suggestion.status;
    suggestion.status = status;

    if (status === 'rejected' && reason) {
      suggestion.rejectionReason = reason;
      suggestion.rejectionDate = new Date();
    }

    suggestion.addAuditLog('status_updated', req.user.userId,
      `Status changed from ${oldStatus} to ${status} by ${user.fullName}`,
      oldStatus, status
    );

    await suggestion.save();

    res.json({
      success: true,
      message: 'Suggestion status updated successfully',
      data: suggestion
    });

  } catch (error) {
    console.error('Update suggestion status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update suggestion status',
      error: error.message
    });
  }
};

module.exports = {
  getSuggestionsByRole,
  getSuggestionDetails,
  voteSuggestion,
  removeVote,
  addComment,
  getComments,
  processHRReview,
  updateSuggestionStatus,
  createSuggestion,
  updateImplementationStatus,
  getAllSuggestions,
  getDashboardStats,
};

