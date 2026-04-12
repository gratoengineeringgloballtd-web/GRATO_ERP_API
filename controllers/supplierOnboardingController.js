const SupplierOnboardingApplication = require('../models/SupplierOnboardingApplication');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');
const { 
  saveFile, 
  deleteFile, 
  STORAGE_CATEGORIES 
} = require('../utils/localFileStorage');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');


// Helper function
function normalizeDocuments(documents) {
  if (!documents) return {};
  
  const normalized = {};
  
  Object.keys(documents).forEach(key => {
    const doc = documents[key];
    
    if (typeof doc === 'string') {
      normalized[key] = {
        name: doc,
        url: `/uploads/attachments/${doc}`,
        publicId: doc,
        size: null,
        mimetype: null
      };
    } else if (Array.isArray(doc)) {
      normalized[key] = doc.map(item => {
        if (typeof item === 'string') {
          return {
            name: item,
            url: `/uploads/attachments/${item}`,
            publicId: item,
            size: null,
            mimetype: null
          };
        }
        return item;
      });
    } else {
      normalized[key] = doc;
    }
  });
  
  return normalized;
}

exports.submitApplication = async (req, res) => {
  try {
    const {
      companyName,
      contactName,
      email,
      phoneNumber,
      address,
      businessRegistrationNumber,
      taxIdNumber,
      bankDetails,
      supplierType
    } = req.body;

    if (!companyName || !contactName || !email || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // CHECK IF EMAIL ALREADY EXISTS IN USERS TABLE
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'This email is already registered. Please use a different email address.',
      });
    }

    // Check if application already exists
    const existingApplication = await SupplierOnboardingApplication.findOne({
      email: email.toLowerCase(),
      status: { $nin: ['rejected'] }
    });

    if (existingApplication) {
      return res.status(409).json({
        success: false,
        message: 'An application with this email already exists',
      });
    }

    const applicationData = {
        applicationId: 'APP-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        companyName,
        contactName,
        email: email.toLowerCase(),
        phoneNumber,
        address,
        businessRegistrationNumber,
        taxIdNumber,
        bankDetails,
        supplierType,
        documents: {}
    };

    if (req.files) {
        const moveFile = (file) => {
            const tempPath = file.path;
            const originalName = file.originalname;
            const extension = path.extname(originalName);
            const newFileName = `supplier_doc_${Date.now()}_${crypto.randomBytes(16).toString('hex')}${extension}`;
            const newPath = path.join(__dirname, '..', 'uploads', 'attachments', newFileName);
            fs.renameSync(tempPath, newPath);
            
            return {
                name: originalName,
                url: `/uploads/attachments/${newFileName}`,
                publicId: newFileName,
                size: file.size,
                mimetype: file.mimetype
            };
        };

        if (req.files.businessRegistrationCertificate) {
            applicationData.documents.businessRegistrationCertificate = moveFile(req.files.businessRegistrationCertificate[0]);
        }
        if (req.files.taxClearanceCertificate) {
            applicationData.documents.taxClearanceCertificate = moveFile(req.files.taxClearanceCertificate[0]);
        }
        if (req.files.bankStatement) {
            applicationData.documents.bankStatement = moveFile(req.files.bankStatement[0]);
        }
        if (req.files.insuranceCertificate) {
            applicationData.documents.insuranceCertificate = moveFile(req.files.insuranceCertificate[0]);
        }
        if (req.files.additionalDocuments) {
            applicationData.documents.additionalDocuments = req.files.additionalDocuments.map(moveFile);
        }
    }

    const application = await SupplierOnboardingApplication.create(applicationData);
    console.log('✅ Supplier onboarding application created:', application.applicationId);
    
    // NOW CREATE USER WITH APPROVAL CHAIN
    try {
      const { getSupplierApprovalChain } = require('../config/supplierApprovalChain');
      
      // Generate approval chain
      const approvalChain = getSupplierApprovalChain(supplierType);
      
      const supplierUser = await User.create({
        email: email.toLowerCase(),
        password: 'ChangeMe123!', // Temporary password
        fullName: contactName,
        role: 'supplier',
        department: 'External Suppliers',
        isActive: false,
        phone: phoneNumber,
        
        supplierDetails: {
          companyName: companyName,
          contactName: contactName,
          phoneNumber: phoneNumber,
          supplierType: supplierType,
          address: typeof address === 'object' && address !== null ? address : {
            street: address || '',
            city: '',
            state: '',
            country: 'Cameroon',
            postalCode: ''
          },
          businessRegistrationNumber: businessRegistrationNumber,
          taxIdNumber: taxIdNumber,
          bankDetails: bankDetails,
          documents: this.normalizeDocuments(applicationData.documents || {})
        },
        
        supplierStatus: {
          accountStatus: 'pending_supply_chain',
          isVerified: false, // ✅ Start as false
          emailVerified: false, // ✅ Start as false - will be set to true on final approval
          applicationId: application._id
        },
        
        // Add approval chain
        approvalChain: approvalChain,
        currentApprovalLevel: 1
      });
      
      console.log('✅ Supplier user created:', supplierUser.email);
      console.log('   Status:', supplierUser.supplierStatus.accountStatus);
      console.log('   Email Verified:', supplierUser.supplierStatus.emailVerified);
      console.log('   Is Verified:', supplierUser.supplierStatus.isVerified);
      console.log('   Approval levels:', supplierUser.approvalChain.length);
      
      // Send email to first approver
      if (approvalChain && approvalChain.length > 0) {
        const firstApprover = approvalChain[0];
        
        try {
          await sendEmail({
            to: firstApprover.approver.email,
            subject: `New Supplier Registration: ${companyName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1890ff;">New Supplier Registration</h2>
                <p>Dear ${firstApprover.approver.name},</p>
                <p>A new supplier has registered and requires your review:</p>
                
                <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p><strong>Company:</strong> ${companyName}</p>
                  <p><strong>Contact:</strong> ${contactName}</p>
                  <p><strong>Email:</strong> ${email}</p>
                  <p><strong>Type:</strong> ${supplierType}</p>
                  <p><strong>Application ID:</strong> ${application.applicationId}</p>
                </div>

                <p style="text-align: center;">
                  <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/admin/suppliers/approvals" 
                     style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    Review Supplier
                  </a>
                </p>
              </div>
            `
          });
          console.log('✅ Notification sent to:', firstApprover.approver.email);
        } catch (emailError) {
          console.error('❌ Failed to send notification email:', emailError);
        }
      }
      
    } catch (userError) {
      console.error('❌ Failed to create supplier user:', userError);
    }
    
    res.status(201).json({
      success: true,
      message: 'Supplier onboarding application submitted successfully',
      data: {
        applicationId: application.applicationId,
        companyName: application.companyName,
        status: 'pending_supply_chain'
      }
    });

  } catch (error) {
    console.error('Error submitting supplier application:', error);
    
    if (error.code === 11000) {
      if (error.message.includes('applicationId')) {
        return res.status(400).json({
          success: false,
          message: 'Application ID conflict. Please try again.',
          error: 'Duplicate application ID'
        });
      }
      if (error.message.includes('email')) {
        return res.status(400).json({
          success: false,
          message: 'This email is already registered. Please use a different email address.',
          error: 'Duplicate email'
        });
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to submit application',
      error: error.message
    });
  }
};



// ===============================
// GET ALL APPLICATIONS
// ===============================

exports.getAllApplications = async (req, res) => {
  try {
    const {
      status,
      category,
      priority,
      page = 1,
      limit = 20,
      sortBy = 'submittedAt',
      sortOrder = 'desc',
      search
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { applicationId: { $regex: search, $options: 'i' } }
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const applications = await SupplierOnboardingApplication
      .find(filter)
      .populate('reviewHistory.reviewer', 'fullName email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await SupplierOnboardingApplication.countDocuments(filter);

    res.json({
      success: true,
      data: applications,
      pagination: {
        current: parseInt(page),
        pageSize: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch applications'
    });
  }
};

// exports.getAllApplications = async (req, res) => {
//   try {
//     const {
//       status,
//       category,
//       priority,
//       page = 1,
//       limit = 20,
//       sortBy = 'submissionDate',
//       sortOrder = 'desc',
//       search
//     } = req.query;

//     // Build filter
//     const filter = {};
//     if (status) filter.status = status;
//     if (category) filter.category = category;
//     if (priority) filter.priority = priority;
//     if (search) {
//       filter.$or = [
//         { companyName: { $regex: search, $options: 'i' } },
//         { contactPerson: { $regex: search, $options: 'i' } },
//         { email: { $regex: search, $options: 'i' } },
//         { applicationId: { $regex: search, $options: 'i' } }
//       ];
//     }

//     // Build sort
//     const sort = {};
//     sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

//     const skip = (parseInt(page) - 1) * parseInt(limit);

//     const applications = await SupplierOnboardingApplication
//       .find(filter)
//       .populate('reviewHistory.reviewer', 'fullName email')
//       .sort(sort)
//       .skip(skip)
//       .limit(parseInt(limit))
//       .lean();

//     const total = await SupplierOnboardingApplication.countDocuments(filter);

//     // Get statistics for dashboard
//     const stats = await this.getApplicationStatistics();

//     res.json({
//       success: true,
//       data: applications,
//       pagination: {
//         current: parseInt(page),
//         pageSize: parseInt(limit),
//         total,
//         pages: Math.ceil(total / parseInt(limit))
//       },
//       statistics: stats
//     });

//   } catch (error) {
//     console.error('Error fetching applications:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch applications'
//     });
//   }
// };

// ===============================
// GET APPLICATION BY ID
// ===============================
exports.getApplicationById = async (req, res) => {
  try {
    const { applicationId } = req.params;

    const application = await SupplierOnboardingApplication
      .findOne({
        $or: [
          { _id: applicationId },
          { applicationId: applicationId }
        ]
      })
      .populate('reviewHistory.reviewer', 'fullName email department');

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      data: application
    });

  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch application'
    });
  }
};

// ===============================
// UPDATE APPLICATION STATUS
// ===============================
exports.updateApplicationStatus = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { 
      status, 
      reviewComments, 
      rejectionReason,
      riskAssessment,
      priority 
    } = req.body;

    const application = await SupplierOnboardingApplication.findOne({
      $or: [
        { _id: applicationId },
        { applicationId: applicationId }
      ]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Update basic status info
    const oldStatus = application.status;
    application.status = status;
    
    // Add to review history
    application.reviewHistory.push({
      reviewer: req.user.userId,
      status: status,
      comments: reviewComments || '',
      reviewedAt: new Date()
    });
    
    if (priority) {
      application.priority = priority;
    }

    // Handle approval
    if (status === 'approved') {
      // Create supplier user account
      await this.createSupplierAccount(application);
    }

    // Handle rejection
    if (status === 'rejected' && rejectionReason) {
      application.rejectionReason = rejectionReason;
    }

    // Update risk assessment if provided
    if (riskAssessment) {
      application.riskAssessment = {
        ...application.riskAssessment,
        ...riskAssessment,
        assessedBy: req.user.userId,
        assessmentDate: new Date()
      };
      application.riskAssessment.overallRisk = application.calculateRiskScore();
    }

    // Add review note
    await application.addNote(
      req.user.userId,
      req.user.fullName || 'System',
      reviewComments || `Status updated from ${oldStatus} to ${status}`,
      this.getNoteType(status),
      false
    );

    await application.save();

    // Send notification email
    await this.sendStatusUpdateEmail(application, oldStatus);

    res.json({
      success: true,
      message: `Application ${status} successfully`,
      data: application
    });

  } catch (error) {
    console.error('Error updating application status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update application status',
      error: error.message
    });
  }
};

// ===============================
// ADD REVIEW NOTE
// ===============================
exports.addReviewNote = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { note, noteType = 'general', isInternal = false } = req.body;

    if (!note || note.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Note content is required'
      });
    }

    const application = await SupplierOnboardingApplication.findOne({
      $or: [
        { _id: applicationId },
        { applicationId: applicationId }
      ]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    await application.addNote(
      req.user.userId,
      req.user.fullName || 'System User',
      note.trim(),
      noteType,
      isInternal
    );

    res.json({
      success: true,
      message: 'Note added successfully'
    });

  } catch (error) {
    console.error('Error adding review note:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add note'
    });
  }
};

// ===============================
// UPLOAD ADDITIONAL DOCUMENTS
// ===============================
exports.uploadAdditionalDocuments = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { documentType, description } = req.body;

    const application = await SupplierOnboardingApplication.findOne({
      $or: [
        { _id: applicationId },
        { applicationId: applicationId }
      ]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    if (!req.files || !req.files.documents) {
      return res.status(400).json({
        success: false,
        message: 'No documents uploaded'
      });
    }

    const uploadedDocs = [];

    for (const file of req.files.documents) {
      try {
        const customFilename = `${applicationId}-${documentType}-${Date.now()}${path.extname(file.originalname)}`;
        
        const uploadResult = await saveFile(
          file,
          STORAGE_CATEGORIES.SUPPLIER_DOCUMENTS,
          applicationId,
          customFilename
        );
        
        const newDocument = {
          name: description || file.originalname,
          type: documentType || 'Additional Documents',
          status: 'submitted',
          filename: uploadResult.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url: uploadResult.url,
          publicId: uploadResult.publicId
        };

        application.documents.push(newDocument);
        uploadedDocs.push(newDocument);

        // Delete temp file
        await fs.unlink(file.path).catch(err => 
          console.warn('Failed to delete temp file:', err.message)
        );
        
      } catch (uploadError) {
        console.error('Failed to upload document:', uploadError);
        await fs.unlink(file.path).catch(() => {});
      }
    }

    await application.save();

    // Add note about document upload
    await application.addNote(
      req.user.userId,
      req.user.fullName || 'System User',
      `Uploaded ${uploadedDocs.length} additional document(s)`,
      'general',
      false
    );

    res.json({
      success: true,
      message: `${uploadedDocs.length} document(s) uploaded successfully`,
      data: uploadedDocs
    });

  } catch (error) {
    console.error('Error uploading documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload documents'
    });
  }
};

// ===============================
// DOWNLOAD DOCUMENT
// ===============================
exports.downloadDocument = async (req, res) => {
  try {
    const { applicationId, documentId } = req.params;

    const application = await SupplierOnboardingApplication.findOne({
      $or: [
        { _id: applicationId },
        { applicationId: applicationId }
      ]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const document = application.documents.id(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // In a real implementation, you would stream the file from your storage service
    // For now, redirect to the URL
    res.redirect(document.url);

  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download document'
    });
  }
};

// ===============================
// GET STATISTICS
// ===============================
exports.getOnboardingStatistics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateRange = {};
    
    if (startDate) dateRange.startDate = startDate;
    if (endDate) dateRange.endDate = endDate;

    const stats = await SupplierOnboardingApplication.getStatistics(dateRange);
    
    // Get recent applications
    const recentApplications = await SupplierOnboardingApplication
      .find({})
      .sort({ submissionDate: -1 })
      .limit(5)
      .select('applicationId companyName status submissionDate priority')
      .lean();

    // Get applications by reviewer
    const reviewerStats = await SupplierOnboardingApplication.aggregate([
      {
        $match: { 
          reviewHistory: { $exists: true, $ne: [] },
          ...(dateRange.startDate || dateRange.endDate ? {
            submissionDate: {
              ...(dateRange.startDate ? { $gte: new Date(dateRange.startDate) } : {}),
              ...(dateRange.endDate ? { $lte: new Date(dateRange.endDate) } : {})
            }
          } : {})
        }
      },
      { $unwind: '$reviewHistory' },
      {
        $lookup: {
          from: 'users',
          localField: 'reviewHistory.reviewer',
          foreignField: '_id',
          as: 'reviewer'
        }
      },
      {
        $group: {
          _id: '$reviewHistory.reviewer',
          reviewerName: { $first: { $arrayElemAt: ['$reviewer.fullName', 0] } },
          count: { $sum: 1 },
          avgProcessingTime: { $avg: '$daysSinceSubmission' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        ...stats,
        recentApplications,
        reviewerStats
      }
    });

  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// ===============================
// BULK UPDATE APPLICATIONS
// ===============================
exports.bulkUpdateApplications = async (req, res) => {
  try {
    const { applicationIds, updateData } = req.body;

    if (!applicationIds || !Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Application IDs are required'
      });
    }

    const results = [];

    for (const applicationId of applicationIds) {
      try {
        const application = await SupplierOnboardingApplication.findOne({
          $or: [
            { _id: applicationId },
            { applicationId: applicationId }
          ]
        });

        if (application) {
          // Apply updates
          Object.keys(updateData).forEach(key => {
            if (key !== '_id' && key !== 'applicationId') {
              application[key] = updateData[key];
            }
          });

          if (updateData.status) {
            await application.addNote(
              req.user.userId,
              req.user.fullName || 'System User',
              `Bulk status update to ${updateData.status}`,
              this.getNoteType(updateData.status),
              false
            );
          }

          await application.save();
          results.push({
            applicationId: application.applicationId,
            success: true
          });
        } else {
          results.push({
            applicationId,
            success: false,
            error: 'Application not found'
          });
        }
      } catch (error) {
        results.push({
          applicationId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: 'Bulk update completed',
      data: results
    });

  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform bulk update'
    });
  }
};

// ===============================
// EXPORT APPLICATIONS
// ===============================
exports.exportApplications = async (req, res) => {
  try {
    const { format = 'csv', status, category, startDate, endDate } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (startDate || endDate) {
      filter.submissionDate = {};
      if (startDate) filter.submissionDate.$gte = new Date(startDate);
      if (endDate) filter.submissionDate.$lte = new Date(endDate);
    }

    const applications = await SupplierOnboardingApplication
      .find(filter)
      .populate('reviewHistory.reviewer', 'fullName email')
      .sort({ submissionDate: -1 })
      .lean();

    if (format === 'csv') {
      const csvData = this.convertToCSV(applications);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=supplier-applications-${Date.now()}.csv`);
      res.send(csvData);
    } else {
      res.json({
        success: true,
        data: applications,
        count: applications.length
      });
    }

  } catch (error) {
    console.error('Error exporting applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export applications'
    });
  }
};

// ===============================
// CHECK APPLICATION STATUS
// ===============================
exports.checkApplicationStatus = async (req, res) => {
  try {
    const { email, applicationId } = req.body;

    if (!email && !applicationId) {
      return res.status(400).json({
        success: false,
        message: 'Email or Application ID is required'
      });
    }

    const filter = {};
    if (applicationId) {
      filter.applicationId = applicationId;
    } else {
      filter.email = email.toLowerCase().trim();
    }

    const application = await SupplierOnboardingApplication
      .findOne(filter)
      .select('applicationId companyName status submissionDate completionPercentage priority')
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      data: application
    });

  } catch (error) {
    console.error('Error checking application status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check application status'
    });
  }
};

// ===============================
// UPDATE SUPPLIER PROFILE
// ===============================
exports.updateSupplierProfile = async (req, res) => {
  try {
    const supplierId = req.supplier.userId;
    const updateData = { ...req.body };

    // Remove sensitive fields
    delete updateData.role;
    delete updateData.supplierStatus;
    delete updateData.password;

    const supplier = await User.findByIdAndUpdate(
      supplierId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: supplier
    });

  } catch (error) {
    console.error('Error updating supplier profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// ===============================
// HELPER METHODS
// ===============================

// Get document display name
exports.getDocumentDisplayName = function(docType) {
  const displayNames = {
    businessRegistration: 'Business Registration Certificate',
    taxClearance: 'Tax Clearance Certificate',
    bankStatement: 'Bank Statement',
    insuranceCertificate: 'Insurance Certificate',
    qualityCertifications: 'Quality Certifications'
  };
  return displayNames[docType] || docType;
};

// Calculate application priority
exports.calculatePriority = function(category, revenue) {
  const highValueCategories = ['IT Services', 'Construction', 'Energy & Environment'];
  const highRevenue = parseInt(revenue) >= 500000000; // 500M XAF
  
  if (highValueCategories.includes(category) || highRevenue) {
    return 'High';
  }
  return 'Medium';
};

// Get note type based on status
exports.getNoteType = function(status) {
  const noteTypes = {
    'approved': 'approval',
    'rejected': 'rejection',
    'requires_clarification': 'clarification',
    'under_review': 'review'
  };
  return noteTypes[status] || 'general';
};

// Send application confirmation email
exports.sendApplicationConfirmationEmail = async function(application) {
  try {
    await sendEmail({
      to: application.email,
      subject: `Supplier Application Received - ${application.applicationId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
            <h2 style="color: #28a745;">Application Received Successfully</h2>
            <p>Dear ${application.contactPerson},</p>
            
            <p>Thank you for submitting your supplier onboarding application. We have received your application and it is now under review.</p>
            
            <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3>Application Details:</h3>
              <ul>
                <li><strong>Application ID:</strong> ${application.applicationId}</li>
                <li><strong>Company:</strong> ${application.companyName}</li>
                <li><strong>Category:</strong> ${application.category}</li>
                <li><strong>Submission Date:</strong> ${application.submissionDate.toLocaleDateString('en-GB')}</li>
                <li><strong>Status:</strong> ${application.status}</li>
                <li><strong>Completion:</strong> ${application.completionPercentage}%</li>
              </ul>
            </div>
            
            <div style="background-color: #d1ecf1; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Next Steps:</strong></p>
              <ol>
                <li>Our team will review your application</li>
                <li>We may contact you for additional information</li>
                <li>You'll receive an email notification once reviewed</li>
                <li>Upon approval, you'll receive access to our supplier portal</li>
              </ol>
            </div>
            
            <p>If you have any questions, please contact our supply chain team.</p>
            <p>Best regards,<br>Grato Engineering Supply Chain Team</p>
          </div>
        </div>
      `
    });
  } catch (error) {
    console.error('Failed to send confirmation email:', error);
  }
};

// Notify admin of new application
exports.notifyAdminOfNewApplication = async function(application) {
  try {
    const adminUsers = await User.find({
      role: { $in: ['admin', 'supply_chain'] },
      isActive: true
    }).select('email fullName');

    if (adminUsers.length > 0) {
      await sendEmail({
        to: adminUsers.map(u => u.email),
        subject: `New Supplier Application - ${application.companyName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px;">
              <h3>New Supplier Application Received</h3>
              <p>A new supplier has submitted an onboarding application and requires review.</p>
              
              <div style="background-color: white; padding: 15px; border-radius: 5px;">
                <ul>
                  <li><strong>Application ID:</strong> ${application.applicationId}</li>
                  <li><strong>Company:</strong> ${application.companyName}</li>
                  <li><strong>Contact:</strong> ${application.contactPerson}</li>
                  <li><strong>Email:</strong> ${application.email}</li>
                  <li><strong>Category:</strong> ${application.category}</li>
                  <li><strong>Priority:</strong> ${application.priority}</li>
                  <li><strong>Completion:</strong> ${application.completionPercentage}%</li>
                </ul>
              </div>
              
              <p>Please review the application in the admin panel.</p>
            </div>
          </div>
        `
      });
    }
  } catch (error) {
    console.error('Failed to notify admin:', error);
  }
};

// Send status update email
exports.sendStatusUpdateEmail = async function(application, oldStatus) {
  try {
    const statusMessages = {
      'approved': 'approved and you can now access our supplier portal',
      'rejected': 'not approved at this time',
      'requires_clarification': 'requires additional information',
      'under_review': 'currently under detailed review'
    };

    const message = statusMessages[application.status] || 'been updated';

    await sendEmail({
      to: application.email,
      subject: `Application Status Update - ${application.applicationId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: ${application.status === 'approved' ? '#d4edda' : '#f8d7da'}; padding: 20px; border-radius: 8px;">
            <h2>Application Status Update</h2>
            <p>Dear ${application.contactPerson},</p>
            
            <p>Your supplier application for <strong>${application.companyName}</strong> has ${message}.</p>
            
            <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <ul>
                <li><strong>Application ID:</strong> ${application.applicationId}</li>
                <li><strong>Previous Status:</strong> ${oldStatus}</li>
                <li><strong>New Status:</strong> ${application.status}</li>
                <li><strong>Review Date:</strong> ${application.reviewDate?.toLocaleDateString('en-GB') || 'N/A'}</li>
              </ul>
              
              ${application.reviewComments ? `
                <div style="margin-top: 15px;">
                  <strong>Comments:</strong>
                  <p style="background-color: #f8f9fa; padding: 10px; border-radius: 3px;">${application.reviewComments}</p>
                </div>
              ` : ''}
            </div>
            
            ${application.status === 'approved' ? `
              <div style="background-color: #d1ecf1; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Congratulations!</strong> You can now access our supplier portal and begin submitting quotes and invoices.</p>
                <p>Login details will be sent separately.</p>
              </div>
            ` : ''}
            
            <p>Best regards,<br>Grato Engineering Supply Chain Team</p>
          </div>
        </div>
      `
    });
  } catch (error) {
    console.error('Failed to send status update email:', error);
  }
};

// Create supplier user account
exports.createSupplierAccount = async function(application) {
  try {
    // Check if supplier user already exists
    const existingUser = await User.findOne({ email: application.email });
    if (existingUser) {
      console.log('Supplier user already exists:', application.email);
      return;
    }

    // Generate temporary password
    const tempPassword = crypto.randomBytes(12).toString('hex');

    // Create supplier user
    const supplierData = {
      email: application.email,
      password: tempPassword,
      fullName: application.contactPerson,
      role: 'supplier',
      isActive: true,
      
      supplierDetails: {
        companyName: application.companyName,
        contactName: application.contactPerson,
        phoneNumber: application.phone,
        address: application.address,
        businessRegistrationNumber: application.businessLicense,
        taxIdNumber: application.taxId,
        supplierType: this.mapCategoryToSupplierType(application.category),
        bankDetails: application.bankDetails,
        businessInfo: {
          yearsInBusiness: application.yearsInBusiness,
          primaryServices: application.services,
          website: application.website
        }
      },
      
      supplierStatus: {
        accountStatus: 'approved',
        isVerified: true,
        emailVerified: true,
        approvalDate: new Date(),
        approvedBy: application.reviewHistory.find(review => review.status === 'approved')?.reviewer || null
      }
    };

    const supplier = await User.create(supplierData);
    console.log('Supplier account created:', supplier.email);

    // Send login credentials
    await sendEmail({
      to: application.email,
      subject: 'Supplier Portal Access - Login Credentials',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #d4edda; padding: 20px; border-radius: 8px;">
            <h2>Welcome to Grato Engineering Supplier Portal</h2>
            <p>Dear ${application.contactPerson},</p>
            
            <p>Your supplier account has been approved and created. You can now access our supplier portal.</p>
            
            <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3>Login Credentials:</h3>
              <ul>
                <li><strong>Email:</strong> ${application.email}</li>
                <li><strong>Temporary Password:</strong> ${tempPassword}</li>
                <li><strong>Portal URL:</strong> ${process.env.CLIENT_URL}/supplier/login</li>
              </ul>
              
              <div style="background-color: #fff3cd; padding: 10px; border-radius: 3px; margin-top: 15px;">
                <p><strong>Important:</strong> Please change your password after first login for security.</p>
              </div>
            </div>
            
            <p>You can now submit quotes, track orders, and manage your supplier profile through the portal.</p>
            <p>Best regards,<br>Grato Engineering Team</p>
          </div>
        </div>
      `
    });

  } catch (error) {
    console.error('Failed to create supplier account:', error);
    throw error;
  }
};

// Map category to supplier type
exports.mapCategoryToSupplierType = function(category) {
  const mapping = {
    'IT Services': 'Supply Chain',
    'Construction': 'Project',
    'Energy & Environment': 'HSE',
    'Professional Services': 'HR/Admin',
    'Healthcare': 'Operations'
  };
  return mapping[category] || 'General';
};

// Get application statistics
exports.getApplicationStatistics = async function() {
  const total = await SupplierOnboardingApplication.countDocuments();
  const pending = await SupplierOnboardingApplication.countDocuments({ status: 'pending_review' });
  const underReview = await SupplierOnboardingApplication.countDocuments({ status: 'under_review' });
  const approved = await SupplierOnboardingApplication.countDocuments({ 
    status: { $in: ['approved', 'onboarded'] }
  });
  const rejected = await SupplierOnboardingApplication.countDocuments({ status: 'rejected' });

  return {
    total,
    pending,
    underReview,
    approved,
    rejected
  };
};

// Convert applications to CSV
exports.convertToCSV = function(applications) {
  const headers = [
    'Application ID', 'Company Name', 'Contact Person', 'Email', 'Phone',
    'Category', 'Business Type', 'Status', 'Priority', 'Submission Date',
    'Completion %', 'Reviewed By', 'Review Date'
  ];

  const rows = applications.map(app => {
    const latestReview = app.reviewHistory && app.reviewHistory.length > 0 
      ? app.reviewHistory[app.reviewHistory.length - 1] 
      : null;
    
    return [
      app.applicationId,
      app.companyName,
      app.contactPerson,
      app.email,
      app.phone,
      app.category,
      app.businessType,
      app.status,
      app.priority,
      app.submissionDate?.toISOString?.()?.split('T')?.[0] || '',
      app.completionPercentage,
      latestReview?.reviewer?.fullName || '',
      latestReview?.reviewedAt?.toISOString?.()?.split('T')?.[0] || ''
    ];
  });

  return [headers.join(','), ...rows.map(row => 
    row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
  )].join('\n');
};

// Helper method to normalize document formats (handle both old string format and new object format)
exports.normalizeDocuments = function(documents) {
  if (!documents) return {};
  
  const normalized = {};
  
  Object.keys(documents).forEach(key => {
    const doc = documents[key];
    
    if (typeof doc === 'string') {
      // Old format - just filename, convert to object
      normalized[key] = {
        name: doc,
        url: `/uploads/attachments/${doc}`,
        publicId: doc,
        size: null,
        mimetype: null
      };
    } else if (Array.isArray(doc)) {
      // Handle additional documents array
      normalized[key] = doc.map(item => {
        if (typeof item === 'string') {
          return {
            name: item,
            url: `/uploads/attachments/${item}`,
            publicId: item,
            size: null,
            mimetype: null
          };
        }
        return item; // Already in object format
      });
    } else {
      // Already in object format
      normalized[key] = doc;
    }
  });
  
  return normalized;
};