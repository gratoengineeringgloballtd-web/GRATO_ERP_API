const mongoose = require('mongoose');

const supplierApprovalStepSchema = new mongoose.Schema({
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
  // NEW: Signed document tracking
  signedDocument: {
    publicId: String,
    url: String,
    format: String,
    resourceType: String,
    bytes: Number,
    originalName: String,
    uploadedAt: Date
  },
  documentDownloaded: {
    type: Boolean,
    default: false
  },
  downloadedAt: Date,
  actionDate: Date,
  actionTime: String,
  activatedDate: Date,
  notificationSent: {
    type: Boolean,
    default: false
  },
  notificationSentAt: Date
}, {
  timestamps: true
});

const supplierInvoiceSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', 
    required: true
  },
  
  supplierDetails: {
    companyName: String,
    contactName: String,
    email: String,
    supplierType: String,
    businessRegistrationNumber: String
  },
  
  invoiceNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  
  poNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    validate: {
      validator: function(v) {
        return /^PO-\w{2}\d{8,12}-\d+$/.test(v);
      },
      message: 'PO number format should be: PO-XX########-X (e.g., PO-NG010000000-1)'
    }
  },
  
  invoiceAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  currency: {
    type: String,
    default: 'XAF',
    enum: ['XAF', 'USD', 'EUR', 'GBP']
  },
  
  invoiceDate: {
    type: Date,
    default: Date.now
  },
  
  dueDate: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  serviceCategory: {
    type: String,
    enum: ['HSE', 'Refurbishment', 'Project', 'Operations', 'Diesel', 'Supply Chain', 'HR/Admin', 'General', 'Civil works', 'Rollout', 'Security', 'IT'],
    default: 'General'
  },
  
  lineItems: [{
    description: String,
    quantity: Number,
    unitPrice: Number,
    totalPrice: Number,
    category: String
  }],
  
  uploadedDate: {
    type: Date,
    default: Date.now
  },

  uploadedTime: {
    type: String,
    default: function() {
      return new Date().toTimeString().split(' ')[0];
    }
  },
  
  // Files stored in Cloudinary
  invoiceFile: {
    publicId: String,
    url: String,
    format: String,
    resourceType: String,
    bytes: Number,
    originalName: String
  },
  
  poFile: {
    publicId: String,
    url: String,
    format: String,
    resourceType: String,
    bytes: Number,
    originalName: String
  },
  
  supportingDocuments: [{
    publicId: String,
    url: String,
    format: String,
    resourceType: String,
    bytes: Number,
    originalName: String,
    documentType: String
  }],
  
  // UPDATED: New approval statuses
  approvalStatus: {
    type: String,
    enum: [
      'pending_supply_chain_assignment',  // NEW - First status after submission
      'pending_department_head_approval',
      'pending_head_of_business_approval', 
      'pending_finance_approval',          // NEW - Finance is now Level 3
      'approved', 
      'rejected',
      'paid'
    ],
    default: 'pending_supply_chain_assignment'  // CHANGED
  },

  // NEW: Supply Chain Review
  supplyChainReview: {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewDate: Date,
    reviewTime: String,
    action: {
      type: String,
      enum: ['assigned', 'rejected']
    },
    comments: String,
    rejectionReason: String
  },

  // Department assignment
  assignedDepartment: {
    type: String,
    enum: [
      'HSE', 
      'Refurbishment', 
      'Project', 
      'Operations', 
      'Diesel', 
      'Supply Chain', 
      'HR/Admin',
      'Technical',
      'Business Development & Supply Chain',
      'Finance'
    ],
    trim: true
  },

  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  assignmentDate: Date,
  assignmentTime: String,

  // UPDATED: 3-level approval chain (Dept Head → Head of Business → Finance)
  approvalChain: [supplierApprovalStepSchema],

  currentApprovalLevel: {
    type: Number,
    default: 0
  },

  // Finance final approval (Level 3)
  financeApproval: {
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvalDate: Date,
    approvalTime: String,
    comments: String
  },
  
  // Payment tracking
  paymentStatus: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'overdue', 'disputed'],
    default: 'pending'
  },
  
  paymentDetails: {
    amountPaid: Number,
    paymentDate: Date,
    paymentMethod: String,
    transactionReference: String,
    bankReference: String,
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },

  allocatedBudgetCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetCode',
    description: 'Budget code assigned during finance approval for payment'
  },

  allocationAmount: {
    type: Number,
    default: null,
    description: 'Amount to be deducted from the allocated budget code'
  },

  paymentMethod: {
    type: String,
    enum: ['Bank Transfer', 'Mobile Money', 'Cash'],
    default: 'Bank Transfer',
    description: 'Payment method selected during finance approval'
  },
  
  tags: [String],
  
  internalNotes: [{
    note: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],

  linkedContract: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contract'
  },
  
  contractLinkMethod: {
    type: String,
    enum: ['automatic', 'manual', 'none'],
    default: 'none'
  },
  
  metadata: {
    ipAddress: String,
    userAgent: String,
    uploadSource: {
      type: String,
      default: 'supplier_portal'
    },
    totalProcessingTime: Number,
    escalationCount: Number,
    supplyChainProcessingTime: Number,
    submissionToAssignmentTime: Number
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
      default: 'supplier_invoice'
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
supplierInvoiceSchema.index({ supplier: 1, uploadedDate: -1 });
supplierInvoiceSchema.index({ invoiceNumber: 1, supplier: 1 }, { unique: true });
supplierInvoiceSchema.index({ poNumber: 1 });
supplierInvoiceSchema.index({ approvalStatus: 1, uploadedDate: -1 });
supplierInvoiceSchema.index({ assignedDepartment: 1, approvalStatus: 1 });
supplierInvoiceSchema.index({ serviceCategory: 1 });
supplierInvoiceSchema.index({ paymentStatus: 1, dueDate: 1 });
supplierInvoiceSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });
supplierInvoiceSchema.index({ currentApprovalLevel: 1, approvalStatus: 1 });

// Virtuals
supplierInvoiceSchema.virtual('daysUntilDue').get(function() {
  if (!this.dueDate) return null;
  const today = new Date();
  const diffTime = this.dueDate - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

supplierInvoiceSchema.virtual('currentApprovalStep').get(function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return null;
  return this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && step.status === 'pending'
  );
});

supplierInvoiceSchema.virtual('approvalProgress').get(function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain) || this.approvalChain.length === 0) return 0;
  const approvedSteps = this.approvalChain.filter(step => step.status === 'approved').length;
  return Math.round((approvedSteps / this.approvalChain.length) * 100);
});

// Method to process and assign in one step (optional - if finance wants to update details during assignment)
supplierInvoiceSchema.methods.assignBySupplyChain = function(department, assignedByUserId, comments) {
  const { getSupplierApprovalChain, mapDepartmentToStructureKey } = require('../config/supplierApprovalChain');
  
  if (this.approvalStatus !== 'pending_supply_chain_assignment') {
    throw new Error('Invoice has already been assigned');
  }
  
  console.log(`\n=== ASSIGNING SUPPLIER INVOICE BY SUPPLY CHAIN ===`);
  console.log(`Invoice: ${this.invoiceNumber}`);
  console.log(`Department: ${department}`);
  console.log(`Assigned By: ${assignedByUserId}`);
  
  this.assignedDepartment = department;
  this.assignedBy = assignedByUserId;
  this.assignmentDate = new Date();
  this.assignmentTime = new Date().toTimeString().split(' ')[0];
  this.approvalStatus = 'pending_department_head_approval';
  
  // Supply Chain review (auto-approved by assignment)
  this.supplyChainReview = {
    reviewedBy: assignedByUserId,
    reviewDate: new Date(),
    reviewTime: new Date().toTimeString().split(' ')[0],
    action: 'assigned',
    comments: comments || `Assigned to ${department} department`
  };
  
  // Create 3-level approval chain: Dept Head → Head of Business → Finance
  const chain = getSupplierApprovalChain(department, this.serviceCategory);
  
  // VALIDATION: Ensure we have all 3 levels
  if (!chain || chain.length !== 3) {
    console.error('❌ CRITICAL ERROR: Approval chain must have exactly 3 levels');
    console.error('Chain received:', JSON.stringify(chain, null, 2));
    throw new Error(`Failed to create complete approval chain for ${department}. Expected 3 levels, got ${chain?.length || 0}`);
  }
  
  // VALIDATION: Ensure Level 1 exists
  const level1 = chain.find(step => step.level === 1);
  if (!level1) {
    console.error('❌ CRITICAL ERROR: Level 1 (Department Head) missing from approval chain');
    console.error('Chain:', JSON.stringify(chain, null, 2));
    throw new Error(`Department Head not found for ${department}. Cannot create approval chain.`);
  }
  
  console.log(`✓ Validation passed: 3-level chain with Department Head at Level 1`);
  
  this.approvalChain = chain.map(step => ({
    level: step.level,
    approver: {
      name: step.approver.name,
      email: step.approver.email,
      role: step.approver.role,
      department: step.approver.department
    },
    status: 'pending',
    activatedDate: step.level === 1 ? new Date() : null // Activate Level 1 immediately
  }));

  this.currentApprovalLevel = 1;
  
  if (this.metadata) {
    this.metadata.submissionToAssignmentTime = 
      (this.assignmentDate - this.uploadedDate) / (1000 * 60 * 60 * 24);
  }
  
  console.log(`✅ Supplier Invoice ${this.invoiceNumber} assigned to ${department}`);
  console.log(`First approver (Level 1): ${this.approvalChain[0]?.approver.name} (${this.approvalChain[0]?.approver.email})`);
  console.log(`=== END ASSIGNMENT ===\n`);
};

// NEW: Method for Supply Chain rejection
supplierInvoiceSchema.methods.rejectBySupplyChain = function(rejectedByUserId, rejectionReason) {
  if (this.approvalStatus !== 'pending_supply_chain_assignment') {
    throw new Error('Invoice can only be rejected at supply chain assignment stage');
  }
  
  this.approvalStatus = 'rejected';
  this.supplyChainReview = {
    reviewedBy: rejectedByUserId,
    reviewDate: new Date(),
    reviewTime: new Date().toTimeString().split(' ')[0],
    action: 'rejected',
    rejectionReason: rejectionReason
  };
  
  console.log(`Supplier Invoice ${this.invoiceNumber} rejected by Supply Chain`);
};

// Method to process approval step
supplierInvoiceSchema.methods.processApprovalStep = function(approverEmail, decision, comments, userId) {
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
    this.currentApprovalLevel = 0;
  } else {
    const nextLevel = this.currentApprovalLevel + 1;
    const nextStep = this.approvalChain.find(step => step.level === nextLevel);
    
    if (nextStep) {
      // Move to next approval level
      this.currentApprovalLevel = nextLevel;
      nextStep.activatedDate = new Date();
      nextStep.notificationSent = false;
      
      // Update status based on level
      if (nextLevel === 2) {
        this.approvalStatus = 'pending_head_of_business_approval';
      } else if (nextLevel === 3) {
        this.approvalStatus = 'pending_finance_approval';
      }
    } else {
      // All approvals complete
      this.approvalStatus = 'approved';
      this.currentApprovalLevel = 0;
    }
  }

  return currentStep;
};

// Method to get current active approver
supplierInvoiceSchema.methods.getCurrentApprover = function() {
  if (this.currentApprovalLevel === 0 || !this.approvalChain || !Array.isArray(this.approvalChain)) {
    return null;
  }
  return this.approvalChain.find(step => step.level === this.currentApprovalLevel);
};

// Method to check if user can approve
supplierInvoiceSchema.methods.canUserApprove = function(userEmail) {
  const currentStep = this.getCurrentApprover();
  return currentStep && currentStep.approver && currentStep.approver.email === userEmail;
};

// Method to get approval history
supplierInvoiceSchema.methods.getApprovalHistory = function() {
  if (!this.approvalChain || !Array.isArray(this.approvalChain)) return [];
  return this.approvalChain
    .filter(step => step.status !== 'pending')
    .sort((a, b) => a.level - b.level);
};

// Static method to get invoices pending supply chain assignment
supplierInvoiceSchema.statics.getPendingSupplyChainAssignment = function() {
  return this.find({
    approvalStatus: 'pending_supply_chain_assignment'
  }).populate('supplier', 'supplierDetails.companyName supplierDetails.contactName email supplierDetails.supplierType')
    .sort({ uploadedDate: 1 });
};

// Static method to get pending invoices for approver
supplierInvoiceSchema.statics.getPendingForApprover = function(approverEmail) {
  // Simplified query: Find invoices where:
  // 1. The approver is in the approval chain with pending status
  // 2. The approval chain at currentApprovalLevel matches this approver
  return this.find({
    // Must have the approver in chain
    'approvalChain.approver.email': approverEmail,
    // Must have a pending step in the chain
    'approvalChain.status': 'pending',
    // Must be in an approval status
    approvalStatus: { 
      $in: [
        'pending_department_head_approval', 
        'pending_head_of_business_approval',
        'pending_finance_approval'
      ] 
    }
  })
  .populate('supplier', 'supplierDetails.companyName supplierDetails.contactName email supplierDetails.supplierType')
  .sort({ assignmentDate: -1 });
};

// Method to send notification to current approver
supplierInvoiceSchema.methods.notifyCurrentApprover = async function() {
  const currentStep = this.getCurrentApprover();
  if (!currentStep || currentStep.notificationSent) return;
  
  const { sendEmail } = require('../services/emailService');
  
  try {
    await sendEmail({
      to: currentStep.approver.email,
      subject: `Supplier Invoice Approval Required - ${this.invoiceNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h2 style="color: #333; margin-top: 0;">Supplier Invoice Approval Required</h2>
            <p style="color: #555;">Dear ${currentStep.approver.name},</p>
            <p>A supplier invoice requires your approval at Level ${currentStep.level}.</p>
            
            <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Invoice Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Supplier:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.supplierDetails.companyName}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Invoice Number:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.invoiceNumber}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>PO Number:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.poNumber}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.currency} ${this.invoiceAmount.toLocaleString()}</td></tr>
                <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Department:</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${this.assignedDepartment}</td></tr>
                <tr><td style="padding: 8px 0;"><strong>Approval Level:</strong></td><td style="padding: 8px 0;"><span style="background-color: #ffc107; color: #333; padding: 4px 8px; border-radius: 4px;">Level ${currentStep.level}</span></td></tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:3000'}/supervisor/supplier-invoice/${this._id}" 
                 style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                Review Invoice
              </a>
            </div>
          </div>
        </div>
      `
    });
    
    currentStep.notificationSent = true;
    currentStep.notificationSentAt = new Date();
    await this.save();
    
  } catch (error) {
    console.error(`Failed to send supplier invoice notification:`, error);
  }
};

// Post-save middleware for notifications
supplierInvoiceSchema.post('save', async function() {
  if (this.approvalStatus === 'pending_department_head_approval' || 
      this.approvalStatus === 'pending_head_of_business_approval' ||
      this.approvalStatus === 'pending_finance_approval') {
    
    if (this.currentApprovalLevel > 0 && this.approvalChain.length > 0) {
      const currentStep = this.getCurrentApprover();
      if (currentStep && !currentStep.notificationSent) {
        setTimeout(() => {
          this.notifyCurrentApprover().catch(err => 
            console.error('Failed to send supplier invoice notification:', err)
          );
        }, 1000);
      }
    }
  }
});

module.exports = mongoose.model('SupplierInvoice', supplierInvoiceSchema);

