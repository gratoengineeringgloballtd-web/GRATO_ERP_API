const mongoose = require('mongoose');

const IncidentReportSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reportNumber: {
    type: String,
    unique: true,
    sparse: true 
  },
  title: {
    type: String,
    required: true,
    minlength: 5
  },
  department: {
    type: String,
    required: true
  },
  incidentType: {
    type: String,
    enum: [
      'injury',
      'near_miss',
      'equipment',
      'environmental',
      'security',
      'fire',
      'other'
    ],
    required: true
  },
  severity: {
    type: String,
    enum: ['critical', 'high', 'medium', 'low'],
    required: true
  },
  description: {
    type: String,
    required: true,
    minlength: 20
  },

  // Location and Time Information
  location: {
    type: String,
    required: true
  },
  specificLocation: {
    type: String,
    required: true
  },
  incidentDate: {
    type: Date,
    required: true
  },
  incidentTime: {
    type: String,
    required: true
  },
  reportedDate: {
    type: Date,
    default: Date.now
  },

  // Environmental conditions
  weatherConditions: String,
  lightingConditions: String,

  // People involved
  injuriesReported: {
    type: Boolean,
    default: false
  },
  peopleInvolved: [String],
  witnesses: [String],

  // Injury details (if applicable)
  injuryDetails: {
    bodyPartsAffected: [String],
    injuryType: [String],
    medicalAttentionRequired: {
      type: String,
      enum: ['none', 'first_aid', 'medical_center', 'hospital', 'doctor']
    },
    medicalProvider: String,
    hospitalName: String,
    treatmentReceived: String,
    workRestrictions: {
      type: String,
      enum: ['none', 'light_duty', 'time_off', 'other']
    }
  },

  // Equipment/Property details (if applicable)
  equipmentDetails: {
    equipmentInvolved: String,
    equipmentCondition: String,
    damageDescription: String,
    estimatedCost: Number
  },

  // Environmental details (if applicable)
  environmentalDetails: {
    substanceInvolved: String,
    quantityReleased: String,
    containmentMeasures: String,
    environmentalImpact: String
  },

  // Immediate actions
  immediateActions: {
    type: String,
    required: true
  },
  emergencyServicesContacted: {
    type: Boolean,
    default: false
  },
  supervisorNotified: {
    type: Boolean,
    default: false
  },
  supervisorName: String,
  notificationTime: String,

  // Contributing factors and analysis
  contributingFactors: String,
  rootCause: String,
  preventiveMeasures: String,

  // Additional information
  additionalComments: String,
  followUpRequired: {
    type: Boolean,
    default: false
  },

  // Attachments
  attachments: [{
    name: String,
    url: String,
    publicId: String,
    size: Number,
    mimetype: String
  }],

  // REMOVED: approvalChain - No approval workflow needed
  
  // Status - Simplified for HSE-only management
  status: {
    type: String,
    enum: [
      'submitted',           // Initial submission - notifications sent
      'under_review',        // HSE reviewing
      'under_investigation', // HSE investigating
      'action_required',     // HSE identified actions needed
      'resolved',           // HSE closed the incident
      'archived'            // Archived for records
    ],
    default: 'submitted'
  },

  // HSE Management - Primary workflow
  hseManagement: {
    assignedTo: {
      type: String,
      default: 'Mr. Ovo Becheni' // HSE Coordinator
    },
    assignedEmail: {
      type: String,
      default: 'bechem.mbu@gratoglobal.com'
    },
    reviewStartDate: Date,
    reviewNotes: String,
    
    // Investigation
    investigationRequired: {
      type: Boolean,
      default: false
    },
    investigationStartDate: Date,
    investigationFindings: String,
    investigationRecommendations: [String],
    investigationCompletedDate: Date,
    
    // Actions
    correctiveActions: [{
      action: String,
      assignedTo: String,
      dueDate: Date,
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed'],
        default: 'pending'
      },
      completedDate: Date,
      notes: String
    }],
    
    preventiveActions: [{
      action: String,
      assignedTo: String,
      dueDate: Date,
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed'],
        default: 'pending'
      },
      completedDate: Date,
      notes: String
    }],
    
    // Resolution
    resolutionSummary: String,
    resolutionDate: Date,
    lessonsLearned: String,
    
    // HSE Comments/Updates
    updates: [{
      date: {
        type: Date,
        default: Date.now
      },
      comment: String,
      updatedBy: String
    }]
  },

  // Notifications tracking (who was notified)
  notificationsSent: {
    supervisor: { sent: Boolean, sentAt: Date, email: String },
    departmentHead: { sent: Boolean, sentAt: Date, email: String },
    hse: { sent: Boolean, sentAt: Date, email: String },
    hr: { sent: Boolean, sentAt: Date, emails: [String] },
    admin: { sent: Boolean, sentAt: Date, emails: [String] }
  },

  // Risk Assessment
  riskAssessment: {
    probability: {
      type: String,
      enum: ['very_low', 'low', 'medium', 'high', 'very_high']
    },
    consequence: {
      type: String,
      enum: ['insignificant', 'minor', 'moderate', 'major', 'catastrophic']
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'extreme']
    },
    controlMeasures: [String]
  },

  // Reporter information
  reportedBy: {
    employeeId: String,
    fullName: String,
    department: String,
    email: String,
    phone: String
  },

  // Audit trail
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
IncidentReportSchema.index({ employee: 1, status: 1 });
IncidentReportSchema.index({ status: 1, createdAt: -1 });
IncidentReportSchema.index({ incidentType: 1 });
IncidentReportSchema.index({ severity: 1 });
IncidentReportSchema.index({ department: 1 });
IncidentReportSchema.index({ incidentDate: 1 });
IncidentReportSchema.index({ 'hseManagement.assignedTo': 1 });

// Virtual for display ID
IncidentReportSchema.virtual('displayId').get(function() {
  return this.reportNumber || `INC-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Method to get current stage description
IncidentReportSchema.methods.getCurrentStage = function() {
  const stageMap = {
    'submitted': 'Submitted - Awaiting HSE Review',
    'under_review': 'Under HSE Review',
    'under_investigation': 'Under HSE Investigation',
    'action_required': 'HSE Actions Required',
    'resolved': 'Resolved by HSE',
    'archived': 'Archived'
  };
  return stageMap[this.status] || 'Unknown Status';
};

// Method to check if incident requires investigation
IncidentReportSchema.methods.requiresInvestigation = function() {
  return this.severity === 'critical' || 
         this.severity === 'high' || 
         this.injuriesReported || 
         this.incidentType === 'fire' ||
         this.incidentType === 'environmental';
};

// Method to calculate risk level
IncidentReportSchema.methods.calculateRiskLevel = function() {
  if (!this.riskAssessment?.probability || !this.riskAssessment?.consequence) {
    return 'medium';
  }

  const riskMatrix = {
    'very_low': { 'insignificant': 'low', 'minor': 'low', 'moderate': 'low', 'major': 'medium', 'catastrophic': 'medium' },
    'low': { 'insignificant': 'low', 'minor': 'low', 'moderate': 'medium', 'major': 'medium', 'catastrophic': 'high' },
    'medium': { 'insignificant': 'low', 'minor': 'medium', 'moderate': 'medium', 'major': 'high', 'catastrophic': 'high' },
    'high': { 'insignificant': 'medium', 'minor': 'medium', 'moderate': 'high', 'major': 'high', 'catastrophic': 'extreme' },
    'very_high': { 'insignificant': 'medium', 'minor': 'high', 'moderate': 'high', 'major': 'extreme', 'catastrophic': 'extreme' }
  };

  return riskMatrix[this.riskAssessment.probability]?.[this.riskAssessment.consequence] || 'medium';
};

// Pre-save middleware to generate report number and calculate risk
IncidentReportSchema.pre('save', async function(next) {
  try {
    this.updatedAt = new Date();

    // Generate report number if not exists - BEFORE validation
    if (!this.reportNumber) {
      let reportNumber;
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

        reportNumber = `INC${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;

        // Check if reportNumber already exists
        const existingReport = await this.constructor.findOne({ 
          reportNumber: reportNumber,
          _id: { $ne: this._id }
        });

        if (!existingReport) {
          this.reportNumber = reportNumber;
          break;
        }

        attempts++;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique report number after multiple attempts');
      }
    }

    // Auto-calculate risk level
    if (this.riskAssessment?.probability && this.riskAssessment?.consequence) {
      this.riskAssessment.riskLevel = this.calculateRiskLevel();
    }

    next();
  } catch (error) {
    next(error);
  }
});


// Pre-update middleware
IncidentReportSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

module.exports = mongoose.model('IncidentReport', IncidentReportSchema);



