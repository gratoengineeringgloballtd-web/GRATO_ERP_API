const mongoose = require('mongoose');

const approvalStepSchema = new mongoose.Schema({
  level: {
    type: Number,
    required: true
  },
  approver: {
    name: String,
    email: String,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: String,
    department: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  decision: {
    type: String,
    enum: ['approved', 'rejected']
  },
  comments: {
    type: String,
    trim: true
  },
  actionDate: Date,
  actionTime: {
    type: String, // Store time as HH:MM:SS format
  },
  // Track when this step becomes active (for sequential processing)
  activatedDate: {
    type: Date
  },
  // Email notification tracking
  notificationSent: {
    type: Boolean,
    default: false
  },
  notificationSentAt: Date
}, {
  timestamps: true
});

const invoiceSchema = new mongoose.Schema({
  poNumber: {
    type: String,
    required: false,
    uppercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        if (!v) return true;
        // Allow both supplier PO format (PO-XX0000000000-X) and customer PO format (PO-YYYY-NNN)
        return /^PO-\w{2}\d{10}-\d+$/.test(v) || /^PO-\d{4}-\d{3}$/.test(v);
      },
      message: 'PO number format should be: PO-XX0000000000-X (supplier) or PO-YYYY-NNN (customer)'
    }
  },
  
  invoiceNumber: {
    type: String,
    required: [true, 'Invoice number is required'],
    trim: true
  },
  
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Made optional for finance-prepared customer invoices
  },

  // Employee details (cached for historical records)
  employeeDetails: {
    name: String,
    email: String,
    department: String,
    position: String
  },
  
  // Finance user who created/prepared the invoice (for customer invoices)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Created by details (cached for historical records)
  createdByDetails: {
    name: String,
    email: String,
    department: String,
    role: String
  },
  
  uploadedDate: {
    type: Date,
    default: Date.now
  },

  uploadedTime: {
    type: String,
    default: function() {
      return new Date().toTimeString().split(' ')[0]; // HH:MM:SS
    }
  },
  
  // PO File stored in Cloudinary
  poFile: {
    publicId: String,
    url: String,
    format: String,
    resourceType: String,
    bytes: Number,
    originalName: String
  },
  
  // Invoice File stored in Cloudinary
  invoiceFile: {
    publicId: String,
    url: String,
    format: String,
    resourceType: String,
    bytes: Number,
    originalName: String
  },

  // References for finance-prepared invoices
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  },
  customerDetails: {
    name: String,
    email: String,
    phone: String
  },
  customerPOId: {
    type: mongoose.Schema.Types.ObjectId
  },
  poReference: {
    type: String,
    trim: true
  },

  // Supplier PO linkage (legacy/supplier invoices)
  poId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder'
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  supplierDetails: {
    name: String,
    email: String,
    taxId: String
  },

  // Core invoice data
  invoiceDate: Date,
  dueDate: Date,
  totalAmount: Number,
  taxAmount: Number,
  netAmount: Number,
  description: {
    type: String,
    trim: true
  },
  paymentTerms: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'rejected', 'paid', 'assigned'],
    default: 'draft'
  },

  items: [
    {
      description: String,
      quantity: Number,
      unitPrice: Number,
      taxRate: Number
    }
  ],

  paymentTermsInvoiced: [
    {
      termIndex: Number,
      description: String,
      percentage: Number
    }
  ],

  paymentTermsBreakdown: [
    {
      description: String,
      percentage: Number,
      amount: Number,
      timeframe: String,
      customTimeframe: String
    }
  ],
  
  // Overall approval status
  approvalStatus: {
    type: String,
    enum: [
      'pending_finance_assignment', 
      'pending_department_approval', 
      'pending_finance_review',
      'pending_approval',
      'approved', 
      'rejected', 
      'processed'
    ],
    default: 'pending_finance_assignment'
  },

  // Department assignment by finance
  assignedDepartment: {
    type: String,
    trim: true
  },

  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  assignmentDate: Date,

  assignmentTime: String,

  // Sequential approval chain
  approvalChain: [approvalStepSchema],

  // Current active approval level (only this person can approve)
  currentApprovalLevel: {
    type: Number,
    default: 0
  },

  // Finance review
  financeReview: {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewDate: Date,
    reviewTime: String,
    status: {
      type: String,
      enum: ['assigned', 'processed'],
      default: 'assigned'
    },
    finalComments: String
  },
  
  // Legacy fields for backward compatibility
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  reviewDate: Date,
  
  rejectionComments: {
    type: String,
    trim: true
  },
  
  // Additional tracking fields
  metadata: {
    ipAddress: String,
    userAgent: String,
    uploadSource: {
      type: String,
      default: 'web'
    }
  },

  accountingAudit: {
    isPosted: {
      type: Boolean,
      default: false
    },
    postedAt: Date,
    entryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry'
    },
    entryNumber: String,
    sourceType: {
      type: String,
      default: 'customer_invoice'
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for querying invoices by PO number
invoiceSchema.index({ 
  poNumber: 1, 
  invoiceNumber: 1
}, { 
  name: 'idx_po_invoice'
});

// Indexes for efficient queries
invoiceSchema.index({ employee: 1, uploadedDate: -1 });
invoiceSchema.index({ createdBy: 1, createdAt: -1 }); // For finance-prepared invoices
invoiceSchema.index({ approvalStatus: 1, uploadedDate: -1 });
invoiceSchema.index({ assignedDepartment: 1, approvalStatus: 1 });
invoiceSchema.index({ poNumber: 1 });
invoiceSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });
invoiceSchema.index({ currentApprovalLevel: 1, approvalStatus: 1 });

// Virtual for formatted upload date and time
invoiceSchema.virtual('formattedUploadDateTime').get(function() {
  if (!this.uploadedDate) return null;
  const date = this.uploadedDate.toLocaleDateString('en-GB');
  const time = this.uploadedTime || this.uploadedDate.toTimeString().split(' ')[0];
  return `${date} at ${time}`;
});

// Virtual for current approval step (only the active one)
// invoiceSchema.virtual('currentApprovalStep').get(function() {
//   return this.approvalChain.find(step => step.level === this.currentApprovalLevel && step.status === 'pending');
// });
invoiceSchema.virtual('currentApprovalStep').get(function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return null;
  return this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && step.status === 'pending'
  );
});

// Virtual for approval progress
// invoiceSchema.virtual('approvalProgress').get(function() {
//   if (this.approvalChain.length === 0) return 0;
//   const approvedSteps = this.approvalChain.filter(step => step.status === 'approved').length;
//   return Math.round((approvedSteps / this.approvalChain.length) * 100);
// });

invoiceSchema.virtual('approvalProgress').get(function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain) || this.approvalChain.length === 0) return 0;
  const approvedSteps = this.approvalChain.filter(step => step.status === 'approved').length;
  return Math.round((approvedSteps / this.approvalChain.length) * 100);
});

// Virtual for status display
invoiceSchema.virtual('statusDisplay').get(function() {
  const statusMap = {
    'pending_finance_assignment': 'Pending Finance Assignment',
    'pending_department_approval': 'Pending Department Approval',
    'approved': 'Approved',
    'rejected': 'Rejected',
    'processed': 'Processed'
  };
  return statusMap[this.approvalStatus] || this.approvalStatus;
});

invoiceSchema.methods.assignToDepartment = function(department, assignedByUserId) {
  const { getInvoiceApprovalChain } = require('../config/invoiceApprovalChain');
  
  this.assignedDepartment = department;
  this.assignedBy = assignedByUserId;
  this.assignmentDate = new Date();
  this.assignmentTime = new Date().toTimeString().split(' ')[0];
  this.approvalStatus = 'pending_department_approval';
  
  const employeeName = this.employeeDetails?.name || 'Unknown Employee';
  
  console.log(`Creating invoice approval chain for: "${employeeName}" in department: "${department}"`);
  
  const chain = getInvoiceApprovalChain(employeeName, department);
  
  if (!chain || !Array.isArray(chain) || chain.length === 0) {
    console.warn(`No approval chain found. Creating default chain.`);
    
    const { DEPARTMENT_STRUCTURE } = require('../config/departmentStructure');
    const defaultChain = [];
    
    if (DEPARTMENT_STRUCTURE[department] && DEPARTMENT_STRUCTURE[department].head) {
      defaultChain.push({
        level: 1,
        approver: {
          name: DEPARTMENT_STRUCTURE[department].head,
          email: DEPARTMENT_STRUCTURE[department].headEmail,
          role: 'Department Head',
          department: department
        }
      });
    }
    
    // Add Finance as final approver
    defaultChain.push({
      level: defaultChain.length + 1,
      approver: {
        name: 'Ms. Ranibell Mambo',
        email: 'ranibellmambo@gratoengineering.com',
        role: 'Finance Officer',
        department: 'Business Development & Supply Chain'
      }
    });
    
    this.approvalChain = defaultChain.map(step => ({
      level: step.level,
      approver: step.approver,
      status: 'pending',
      activatedDate: step.level === 1 ? new Date() : null,
      notificationSent: false
    }));
    
  } else {
    this.approvalChain = chain.map(step => ({
      level: step.level,
      approver: step.approver,
      status: 'pending',
      activatedDate: step.level === 1 ? new Date() : null,
      notificationSent: false
    }));
  }

  this.currentApprovalLevel = this.approvalChain.length > 0 ? 1 : 0;
  
  console.log(`Invoice ${this.poNumber} assigned to ${department}. Approval chain: ${this.approvalChain.length} levels`);
};

invoiceSchema.methods.processApprovalStep = function(approverEmail, decision, comments, userId) {
  const currentStep = this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && 
    step.approver.email === approverEmail && 
    step.status === 'pending'
  );

  if (!currentStep) {
    throw new Error(`You are not authorized to approve at this level. Current level: ${this.currentApprovalLevel}`);
  }

  currentStep.status = decision === 'approved' ? 'approved' : 'rejected';
  currentStep.decision = decision;
  currentStep.comments = comments;
  currentStep.actionDate = new Date();
  currentStep.actionTime = new Date().toTimeString().split(' ')[0];
  currentStep.approver.userId = userId;

  if (decision === 'rejected') {
    this.approvalStatus = 'rejected';
    this.rejectionComments = comments;
    this.currentApprovalLevel = 0;
    
    console.log(`Invoice ${this.poNumber} REJECTED by ${currentStep.approver.name} at level ${currentStep.level}`);
  } else {
    const nextLevel = this.currentApprovalLevel + 1;
    const nextStep = this.approvalChain.find(step => step.level === nextLevel);
    
    if (nextStep) {
      this.currentApprovalLevel = nextLevel;
      nextStep.activatedDate = new Date();
      nextStep.notificationSent = false;
      
      console.log(`Invoice ${this.poNumber} approved by ${currentStep.approver.name}. Moving to level ${nextLevel}: ${nextStep.approver.name}`);
    } else {
      this.approvalStatus = 'approved';
      this.currentApprovalLevel = 0;
      
      console.log(`Invoice ${this.poNumber} FULLY APPROVED. All approval steps completed.`);
    }
  }

  return currentStep;
};


// Method to get current active approver (only person who can approve right now)
// invoiceSchema.methods.getCurrentApprover = function() {
//   if (this.currentApprovalLevel === 0) return null;
//   return this.approvalChain.find(step => step.level === this.currentApprovalLevel);
// };

invoiceSchema.methods.getCurrentApprover = function() {
  if (this.currentApprovalLevel === 0 || !this.approvalChain || !Array.isArray(this.approvalChain)) {
    return null;
  }
  return this.approvalChain.find(step => step.level === this.currentApprovalLevel);
};

// Method to get next approver (for information purposes)
// invoiceSchema.methods.getNextApprover = function() {
//   const nextLevel = this.currentApprovalLevel + 1;
//   return this.approvalChain.find(step => step.level === nextLevel);
// };
invoiceSchema.methods.getNextApprover = function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return null;
  const nextLevel = this.currentApprovalLevel + 1;
  return this.approvalChain.find(step => step.level === nextLevel);
};

// Method to check if user can approve at current level
// invoiceSchema.methods.canUserApprove = function(userEmail) {
//   const currentStep = this.getCurrentApprover();
//   return currentStep && currentStep.approver.email === userEmail;
// };
invoiceSchema.methods.canUserApprove = function(userEmail) {
  const currentStep = this.getCurrentApprover();
  return currentStep && currentStep.approver && currentStep.approver.email === userEmail;
};

// Method to get approval history (completed steps only)
// invoiceSchema.methods.getApprovalHistory = function() {
//   return this.approvalChain
//     .filter(step => step.status !== 'pending')
//     .sort((a, b) => a.level - b.level);
// };

invoiceSchema.methods.getApprovalHistory = function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return [];
  return this.approvalChain
    .filter(step => step.status !== 'pending')
    .sort((a, b) => a.level - b.level);
};

// Method to get pending steps (for display purposes)
invoiceSchema.methods.getPendingSteps = function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return [];
  return this.approvalChain
    .filter(step => step.status === 'pending')
    .sort((a, b) => a.level - b.level);
};

// UPDATED: Static method to get pending invoices for specific approver
invoiceSchema.statics.getPendingForApprover = function(approverEmail) {
  return this.aggregate([
    {
      $match: {
        approvalStatus: 'pending_department_approval'
      }
    },
    {
      $addFields: {
        currentStep: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$approvalChain',
                cond: { $eq: ['$$this.level', '$currentApprovalLevel'] }
              }
            },
            0
          ]
        }
      }
    },
    {
      $match: {
        'currentStep.approver.email': approverEmail,
        'currentStep.status': 'pending'
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
    {
      $unwind: {
        path: '$employeeData',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $sort: { uploadedDate: -1 }
    }
  ]).then(results => {
    // Convert aggregation results back to Mongoose documents
    return results.map(doc => {
      const invoice = new this(doc);
      if (doc.employeeData) {
        invoice.employee = doc.employeeData;
      }
      return invoice;
    });
  });
};

// Static method to get all invoices for a department supervisor (including upcoming ones)
invoiceSchema.statics.getForSupervisor = function(supervisorEmail) {
  return this.find({
    'approvalChain.approver.email': supervisorEmail,
    approvalStatus: { $in: ['pending_department_approval', 'approved', 'rejected'] }
  }).populate('employee', 'fullName email department')
    .sort({ assignmentDate: -1 });
};

// Method to send notification to current approver
invoiceSchema.methods.notifyCurrentApprover = async function() {
  const currentStep = this.getCurrentApprover();
  if (!currentStep || currentStep.notificationSent) return;
  
  const { sendEmail } = require('../services/emailService');
  
  try {
    await sendEmail({
      to: currentStep.approver.email,
      subject: `🔔 Invoice Approval Required - ${this.poNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #333; margin-top: 0;">🔔 Invoice Approval Required</h2>
            <p style="color: #555; line-height: 1.6;">
              Dear ${currentStep.approver.name},
            </p>
            <p style="color: #555; line-height: 1.6;">
              An invoice is now ready for your approval. You are the current approver in the chain.
            </p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #ffc107; padding-bottom: 10px;">Invoice Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Employee:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.employeeDetails.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Department:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.employeeDetails.department}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>PO Number:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.poNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Invoice Number:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Your Role:</strong></td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${currentStep.approver.role}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><strong>Approval Level:</strong></td>
                  <td style="padding: 8px 0;"><span style="background-color: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px; font-size: 12px;">Level ${currentStep.level} of ${this.approvalChain.length}</span></td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #e6f7ff; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #1890ff;">
              <h4 style="color: #0c5460; margin-top: 0;">Approval Progress</h4>
              <p style="color: #0c5460; margin: 0;">
                ${this.approvalChain.filter(s => s.status === 'approved').length} of ${this.approvalChain.length} approvals completed
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/invoices" 
                 style="display: inline-block; background-color: #28a745; color: white; 
                        padding: 15px 30px; text-decoration: none; border-radius: 8px;
                        font-weight: bold; font-size: 16px;">
                👀 Review & Process Invoice
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px; margin-bottom: 0; text-align: center;">
              This is an automated message from the Finance Management System.
            </p>
          </div>
        </div>
      `
    });
    
    currentStep.notificationSent = true;
    currentStep.notificationSentAt = new Date();
    await this.save();
    
    console.log(`✅ Notification sent to ${currentStep.approver.email} for invoice ${this.poNumber}`);
  } catch (error) {
    console.error(`❌ Failed to send notification for invoice ${this.poNumber}:`, error);
  }
};

// Method to get approval chain with status indicators
invoiceSchema.methods.getApprovalChainStatus = function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return [];
  return this.approvalChain.map(step => ({
    ...step.toObject(),
    isActive: step.level === this.currentApprovalLevel,
    isCompleted: step.status !== 'pending',
    isPending: step.status === 'pending' && step.level === this.currentApprovalLevel,
    isWaiting: step.status === 'pending' && step.level > this.currentApprovalLevel
  }));
};

// Method to delete files from Cloudinary
invoiceSchema.methods.deleteCloudinaryFiles = async function() {
  const { cloudinary } = require('../config/cloudinary');
  const deletionPromises = [];
  
  if (this.poFile && this.poFile.publicId) {
    deletionPromises.push(
      cloudinary.uploader.destroy(this.poFile.publicId)
        .catch(err => console.error('Failed to delete PO file:', err))
    );
  }
  
  if (this.invoiceFile && this.invoiceFile.publicId) {
    deletionPromises.push(
      cloudinary.uploader.destroy(this.invoiceFile.publicId)
        .catch(err => console.error('Failed to delete invoice file:', err))
    );
  }
  
  if (deletionPromises.length > 0) {
    await Promise.allSettled(deletionPromises);
  }
};

// Pre-remove middleware to clean up Cloudinary files
invoiceSchema.pre('remove', async function(next) {
  try {
    await this.deleteCloudinaryFiles();
    next();
  } catch (error) {
    console.error('Error deleting Cloudinary files:', error);
    next(error);
  }
});

// Post-save middleware to send notifications
invoiceSchema.post('save', async function() {
  // Only send notification if approval chain exists and we have a current approver
  if (this.approvalStatus === 'pending_department_approval' && 
      this.currentApprovalLevel > 0 && 
      this.approvalChain.length > 0) {
    
    const currentStep = this.getCurrentApprover();
    if (currentStep && !currentStep.notificationSent) {
      // Use setTimeout to avoid blocking the save operation
      setTimeout(() => {
        this.notifyCurrentApprover().catch(err => 
          console.error('Failed to send notification:', err)
        );
      }, 1000);
    }
  }
});

// Handle duplicate key errors
invoiceSchema.post('save', function(error, doc, next) {
  if (error.name === 'MongoError' && error.code === 11000) {
    if (error.keyPattern && error.keyPattern.poNumber && error.keyPattern.invoiceNumber) {
      next(new Error('An invoice with this PO number and invoice number already exists for this employee'));
    } else {
      next(new Error('Duplicate entry detected'));
    }
  } else {
    next(error);
  }
});

module.exports = mongoose.model('Invoice', invoiceSchema);


