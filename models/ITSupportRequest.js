const mongoose = require('mongoose');

const ITSupportRequestSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  ticketNumber: {
    type: String,
    unique: true,
  },
  requestType: {
    type: String,
    enum: ['material_request', 'technical_issue'],
  },
  title: {
    type: String,
    minlength: 5
  },
  description: {
    type: String,
    minlength: 10
  },
  department: {
    type: String,
  },
  category: {
    type: String,
    enum: [
      'hardware',
      'software', 
      'network',
      'mobile',
      'security',
      'accessories',
      'other'
    ],
  },
  subcategory: {
    type: String,
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
  },
  urgency: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
  },
  
  // Material Request specific fields
  requestedItems: [{
    item: {
      type: String,
    },
    brand: String,
    model: String,
    specifications: String,
    quantity: {
      type: Number,
      min: 1
    },
    estimatedCost: {
      type: Number,
      min: 0
    },
    justification: String,
    category: String
  }],
  totalEstimatedCost: {
    type: Number,
    min: 0
  },
  businessJustification: String,

  // Technical Issue specific fields
  deviceDetails: {
    deviceType: String,
    brand: String,
    model: String,
    serialNumber: String,
    operatingSystem: String,
    purchaseDate: Date,
    warrantyStatus: String,
    location: String
  },
  issueDetails: {
    firstOccurred: Date,
    frequency: String,
    reproducible: String,
    errorMessages: String,
    stepsToReproduce: String,
    affectedUsers: String,
    workaroundAvailable: String,
    workaroundDescription: String
  },
  troubleshootingAttempted: {
    type: Boolean,
    default: false
  },
  troubleshootingSteps: [String],

  // Common fields
  businessImpact: String,
  location: String,
  contactInfo: {
    phone: String,
    email: String,
    alternateContact: String
  },
  preferredContactMethod: {
    type: String,
    enum: ['email', 'phone', 'in_person', 'teams'],
    default: 'email'
  },

  // Approval Chain (similar to purchase requests)
  approvalChain: [{
    level: {
      type: Number,
      required: true
    },
    approver: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      role: { type: String, required: true },
      department: { type: String, required: true }
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    comments: String,
    actionDate: Date,
    actionTime: String,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedDate: {
      type: Date,
      default: Date.now
    }
  }],


  status: {
    type: String,
    enum: [
      'draft',
      'pending_supervisor',
      'pending_departmental_head',
      'pending_head_of_business',
      'pending_it_approval',
      'supervisor_approved',
      'supervisor_rejected',
      'it_approved',
      'pending_discharge', // <-- NEW: IT to discharge items
      'pending_acknowledgment', // <-- NEW: Requester to acknowledge
      'discharge_complete', // <-- NEW: Both steps done
      'it_assigned',
      'it_rejected',
      'approved',
      'rejected',
      'in_progress',
      'waiting_parts',
      'resolved',
      'closed',
      'cancelled'
    ],
    default: 'draft'
  },

  // Discharge/Acknowledgment workflow fields
  dischargedItems: [{
    item: String,
    quantity: Number,
    assetTag: String,
    serialNumber: String,
    dischargeDate: Date
  }],
  dischargeSignature: {
    name: String,
    imageUrl: String, // Path or URL to signature image
    signedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    signedAt: Date
  },
  acknowledgmentSignature: {
    name: String,
    imageUrl: String, // Path or URL to signature image
    signedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    signedAt: Date
  },

  // IT Department Review
  itReview: {
    assignedTechnician: String,
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    estimatedCost: Number,
    estimatedCompletion: Date,
    decision: {
      type: String,
      enum: ['approve', 'reject', 'needs_finance_approval', 'resolved']
    },
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    workLog: [{
      date: Date,
      technician: String,
      activity: String,
      timeSpent: Number, // minutes
      status: String
    }]
  },

  // Finance Review (for high-cost items)
  financeReview: {
    decision: {
      type: String,
      enum: ['approve', 'reject']
    },
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedBudget: Number
  },

  // Resolution Details
  resolution: {
    description: String,
    resolvedBy: String,
    resolvedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedDate: Date,
    solution: String,
    preventiveMeasures: String,
    satisfactionRating: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String
  },

  // Asset Management
  assetAssignment: {
    assignedAssets: [{
      assetId: String,
      assetTag: String,
      description: String,
      serialNumber: String,
      assignmentDate: Date,
      returnRequired: {
        type: Boolean,
        default: false
      },
      returnDate: Date
    }],
    totalAssignedValue: Number
  },

  // Procurement Details (for material requests)
  procurementDetails: {
    vendor: String,
    purchaseOrder: String,
    orderDate: Date,
    expectedDelivery: Date,
    actualDelivery: Date,
    finalCost: Number,
    deliveryStatus: {
      type: String,
      enum: ['pending', 'partial', 'complete'],
      default: 'pending'
    }
  },

  // In the attachments field:
  attachments: [{
    name: String,
    url: String,
    publicId: String,
    localPath: String, // ✅ Add this field
    size: Number,
    mimetype: String
  }],

  // Communication Log
  comments: [{
    id: Number,
    author: String,
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    isInternal: {
      type: Boolean,
      default: false
    },
    attachments: [{
      name: String,
      url: String
    }]
  }],

  // Service Level Agreement tracking
  slaMetrics: {
    responseTime: Number, 
    resolutionTime: Number, 
    targetResponseTime: Number, 
    targetResolutionTime: Number, 
    slaBreached: {
      type: Boolean,
      default: false
    }
  },

  // Legacy compatibility fields
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  supervisorDecision: {
    decision: String,
    comments: String,
    decisionDate: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Audit trail
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  submittedAt: Date,
  completedAt: Date
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
ITSupportRequestSchema.index({ employee: 1, status: 1 });
ITSupportRequestSchema.index({ 'approvalChain.approver.email': 1, 'approvalChain.status': 1 });
ITSupportRequestSchema.index({ status: 1, createdAt: -1 });
ITSupportRequestSchema.index({ category: 1, requestType: 1 });
ITSupportRequestSchema.index({ department: 1 });
ITSupportRequestSchema.index({ priority: 1, urgency: 1 });
ITSupportRequestSchema.index({ 'itReview.assignedTechnician': 1 });
ITSupportRequestSchema.index({ ticketNumber: 1 });

// Virtual for display ID
ITSupportRequestSchema.virtual('displayId').get(function() {
  return this.ticketNumber || `IT-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Method to get current approval step
ITSupportRequestSchema.methods.getCurrentApprovalStep = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) return null;
  
  return this.approvalChain.find(step => step.status === 'pending');
};

// Method to get next approver
ITSupportRequestSchema.methods.getNextApprover = function() {
  const currentStep = this.getCurrentApprovalStep();
  return currentStep ? currentStep.approver : null;
};

// Method to check if user can approve request
ITSupportRequestSchema.methods.canUserApprove = function(userEmail) {
  const currentStep = this.getCurrentApprovalStep();
  return currentStep && currentStep.approver.email === userEmail;
};

// Method to get approval progress percentage
ITSupportRequestSchema.methods.getApprovalProgress = function() {
  if (!this.approvalChain || this.approvalChain.length === 0) return 0;
  
  const approvedSteps = this.approvalChain.filter(step => step.status === 'approved').length;
  return Math.round((approvedSteps / this.approvalChain.length) * 100);
};

ITSupportRequestSchema.methods.getCurrentStage = function() {
  const stageMap = {
    'draft': 'Draft',
    'pending_supervisor': 'Pending Supervisor Approval',
    'pending_departmental_head': 'Pending Department Head Approval',
    'pending_head_of_business': 'Pending President Approval',
    'pending_it_approval': 'Pending IT Department Final Approval',
    'supervisor_approved': 'Supervisor Approved',
    'supervisor_rejected': 'Supervisor Rejected',
    'it_approved': 'IT Department Approved - Ready for Work',
    'it_assigned': 'Assigned to IT Technician',
    'it_rejected': 'IT Department Rejected',
    'approved': 'Approved - Ready for Implementation',
    'rejected': 'Rejected',
    'in_progress': 'Work In Progress',
    'waiting_parts': 'Waiting for Parts/Resources',
    'resolved': 'Resolved',
    'closed': 'Closed',
    'cancelled': 'Cancelled'
  };
  
  return stageMap[this.status] || 'Unknown Status';
};

// Method to calculate SLA targets based on priority and request type
ITSupportRequestSchema.methods.calculateSLATargets = function() {
  const slaMatrix = {
    material_request: {
      critical: { response: 60, resolution: 4 * 60 }, 
      high: { response: 2 * 60, resolution: 8 * 60 }, 
      medium: { response: 4 * 60, resolution: 24 * 60 }, 
      low: { response: 8 * 60, resolution: 72 * 60 } 
    },
    technical_issue: {
      critical: { response: 30, resolution: 2 * 60 }, 
      high: { response: 60, resolution: 4 * 60 }, 
      medium: { response: 2 * 60, resolution: 24 * 60 }, 
      low: { response: 4 * 60, resolution: 48 * 60 } 
    }
  };

  const targets = slaMatrix[this.requestType]?.[this.priority] || 
                  slaMatrix.technical_issue.medium;

  return {
    targetResponseTime: targets.response,
    targetResolutionTime: targets.resolution
  };
};

// Method to check if SLA is breached
ITSupportRequestSchema.methods.checkSLABreach = function() {
  if (!this.slaMetrics.targetResponseTime || !this.slaMetrics.targetResolutionTime) {
    const targets = this.calculateSLATargets();
    this.slaMetrics.targetResponseTime = targets.targetResponseTime;
    this.slaMetrics.targetResolutionTime = targets.targetResolutionTime;
  }

  const now = new Date();
  const createdTime = new Date(this.createdAt);
  const elapsedMinutes = Math.floor((now - createdTime) / (1000 * 60));

  // Check response SLA breach
  if (!this.slaMetrics.responseTime && elapsedMinutes > this.slaMetrics.targetResponseTime) {
    return { responseBreached: true, resolutionBreached: false };
  }

  // Check resolution SLA breach
  const resolutionBreached = !['resolved', 'closed'].includes(this.status) && 
                           elapsedMinutes > this.slaMetrics.targetResolutionTime;

  return {
    responseBreached: false,
    resolutionBreached: resolutionBreached
  };
};

// Method to get waiting time for current stage
ITSupportRequestSchema.methods.getWaitingTime = function(fromDate = null) {
  const now = new Date();
  const startDate = fromDate ? new Date(fromDate) : new Date(this.createdAt);
  const diffTime = Math.abs(now - startDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return {
    days: diffDays,
    hours: diffHours,
    text: diffDays > 0 ? `${diffDays} day${diffDays !== 1 ? 's' : ''} ${diffHours}h` : `${diffHours}h`
  };
};

// Method to determine if finance approval is needed
// ITSupportRequestSchema.methods.needsFinanceApproval = function() {
//   if (this.requestType !== 'material_request') return false;
  
//   const threshold = 100000; // XAF 100,000
//   return this.totalEstimatedCost && this.totalEstimatedCost > threshold;
// };

// Method to get total estimated cost
ITSupportRequestSchema.methods.getTotalEstimatedCost = function() {
  if (this.requestType === 'material_request' && this.requestedItems) {
    return this.requestedItems.reduce((total, item) => {
      return total + ((item.estimatedCost || 0) * (item.quantity || 1));
    }, 0);
  }
  return this.itReview?.estimatedCost || 0;
};

// Pre-save middleware to update timestamps and generate ticket number
ITSupportRequestSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Generate ticket number if not exists
  if (!this.ticketNumber) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    const prefix = this.requestType === 'material_request' ? 'ITM' : 'ITI';
    this.ticketNumber = `${prefix}${year}${month}${day}${random}`;
  }

  // Calculate total estimated cost for material requests
  if (this.requestType === 'material_request' && this.requestedItems) {
    this.totalEstimatedCost = this.getTotalEstimatedCost();
  }

  // Set SLA targets if not set
  if (!this.slaMetrics.targetResponseTime) {
    const targets = this.calculateSLATargets();
    this.slaMetrics.targetResponseTime = targets.targetResponseTime;
    this.slaMetrics.targetResolutionTime = targets.targetResolutionTime;
  }

  // Set submitted date when status changes from draft
  if (this.status !== 'draft' && !this.submittedAt) {
    this.submittedAt = new Date();
  }

  // Set completion date when resolved or closed
  if (['resolved', 'closed'].includes(this.status) && !this.completedAt) {
    this.completedAt = new Date();
    
    // Calculate resolution time
    if (this.submittedAt) {
      this.slaMetrics.resolutionTime = Math.floor(
        (new Date() - new Date(this.submittedAt)) / (1000 * 60)
      );
    }
  }

  next();
});

// Pre-update middleware to update timestamps
ITSupportRequestSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model('ITSupportRequest', ITSupportRequestSchema);