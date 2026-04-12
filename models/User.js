const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const documentSchema = new mongoose.Schema({
    name: String,
    url: String,
    publicId: String,
    filename: String,
    filePath: String,
    relativePath: String,
    size: Number,
    mimetype: String,
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        unique: true,
        required: true,
        trim: true,
        lowercase: true,
        validate: {
            validator: function(v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: props => `${props.value} is not a valid email address!`
        }
    },
    personalEmail: {
        type: String,
        trim: true,
        lowercase: true,
        validate: {
            validator: function(v) {
                return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: props => `${props.value} is not a valid email address!`
        }
    },
    phoneNumber: {
        type: String,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    
    // CORE ROLE (What they do, NOT who they supervise)
    role: {
        type: String,
        enum: ['employee', 'finance', 'admin', 'buyer', 'hr', 'supply_chain', 'technical', 'hse', 'supplier', 'it', 'project', 'ceo'],
        required: true,
        default: 'employee'
    },

    signature: {
        url: String,       
        localPath: String,  
        filename: String,      
        originalName: String,  
        format: String,       
        size: Number,          
        uploadedAt: Date
    },
    
    isActive: {
        type: Boolean,
        default: true
    },
    
    // ORGANIZATIONAL STRUCTURE
    department: {
        type: String,
        required: function() {
            return this.role !== 'supplier';
        }
    },
    
    position: {
        type: String,
        required: function() {
            return this.role !== 'supplier';
        }
        // e.g., "IT Staff", "HR & Admin Head", "Technical Director"
    },

    // PERSONAL DETAILS (ID INFORMATION)
    personalDetails: {
        dateOfBirth: Date,
        placeOfBirth: String,
        sex: {
            type: String,
            enum: ['M', 'F']
        },
        height: Number,
        nationality: String,
        idNumber: String,
        idIssueDate: Date,
        idExpiryDate: Date,
        idAuthority: String,
        idAddress: String,
        fatherName: String,
        motherName: String
    },

    // HR EMPLOYMENT DETAILS
    employmentDetails: {
        employeeId: String,
        employmentStatus: {
            type: String,
            enum: ['Probation', 'Ongoing', 'On Leave', 'Suspended', 'Notice Period', 'Termination', 'End of Contract'],
            default: 'Probation'
        },
        startDate: Date,
        probationEndDate: Date,
        contractEndDate: Date,
        contractType: String,
        salary: {
            amount: Number,
            currency: { type: String, default: 'XAF' },
            paymentFrequency: String
        },
        bankDetails: {
            bankName: String,
            accountName: String
        },
        governmentIds: {
            cnpsNumber: String,
            taxPayerNumber: String,
            nationalIdNumber: String
        },
        emergencyContacts: [{
            name: String,
            relationship: String,
            phone: String,
            email: String,
            isPrimary: { type: Boolean, default: false }
        }],
        hrNotes: String,
        documents: {
            nationalId: documentSchema,
            birthCertificate: documentSchema,
            bankAttestation: documentSchema,
            locationPlan: documentSchema,
            medicalCertificate: documentSchema,
            criminalRecord: documentSchema,
            references: [documentSchema],
            academicDiplomas: [documentSchema],
            workCertificates: [documentSchema],
            employmentContract: documentSchema
        }
    },
    
    // PRIMARY HIERARCHY REFERENCE
    supervisor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
        // Index removed - defined in schema.index() below
    },
    
    // SECONDARY REFERENCE
    departmentHead: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
        // Index removed - defined in schema.index() below
    },
    
    // DIRECT REPORTS (People who report to this user)
    directReports: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    
    approvalCapacities: [{
        type: String,
        enum: [
            'direct_supervisor',      // Immediate manager
            'department_head',        // Head of department
            'business_head',          // Head of Business (Kelvin)
            'finance_officer',        // Finance approval
            'technical_director',     // Technical dept head
            'hse_coordinator',        // HSE approval
            'project_manager',        // Project-specific
            'supply_chain_coordinator', // Supply chain
            'operations_manager',     // Operations
            'executive_decisions'     // ADD THIS LINE - Executive/CEO level
        ]
    }],
    
    // CACHED HIERARCHY PATH (for quick lookups and loop prevention)
    hierarchyPath: [{
        type: String  // Array of user IDs from this user up to top
        // e.g., ["marcel_id", "bruiline_id", "kelvin_id"]
    }],
    
    // HIERARCHY LEVEL (1 = lowest, 5 = highest)
    hierarchyLevel: {
        type: Number,
        default: 1,
        min: 1,
        max: 6
    },
    
    // DEPARTMENT ROLE (for legacy compatibility)
    departmentRole: {
        type: String,
        enum: ['head', 'supervisor', 'coordinator', 'staff', 'buyer', 'hr', 'it', 'supply_chain'],
        default: 'staff'
    },
    
    // PERMISSIONS
    permissions: {
        type: [String],
        default: []
    },

    // ==========================================
    // SUPPLIER-SPECIFIC FIELDS
    // ==========================================
    supplierDetails: {
        companyName: { type: String, required: function() { return this.role === 'supplier'; } },
        contactName: { type: String, required: function() { return this.role === 'supplier'; } },
        phoneNumber: { type: String, required: function() { return this.role === 'supplier'; } },
        alternatePhone: String,
        website: String,
        
        address: {
            street: String,
            city: String,
            state: String,
            country: { type: String, default: 'Cameroon' },
            postalCode: String
        },
        supplierType: {
            type: String,
            enum: [
                'General', 
                'Supply Chain', 
                'HR/Admin', 
                'Operations', 
                'HSE', 
                'Refurbishment',
                'Civil Works',
                'Rollout',
                'Security',
                'IT',
                'Generator Maintenance'
            ],
            required: function() { return this.role === 'supplier'; }
        },
        businessType: {
            type: String,
            enum: ['Corporation', 'Limited Company', 'Partnership', 'Sole Proprietorship', 'Cooperative', 'Other']
        },
        businessRegistrationNumber: String,
        taxIdNumber: String,
        establishedYear: Number,
        employeeCount: String,
        
        servicesOffered: [String],
        businessDescription: String,
        
        bankDetails: {
            bankName: String,
            accountNumber: String,
            accountName: String,
            swiftCode: String,
            routingNumber: String
        },
        paymentTerms: {
            type: String,
            enum: ['15 days NET', '30 days NET', '45 days NET', '60 days NET', 'Cash on Delivery', 'Advance Payment'],
            default: '30 days NET'
        },
        
        documents: {
            businessRegistrationCertificate: documentSchema,
            taxClearanceCertificate: documentSchema,
            bankStatement: documentSchema,
            insuranceCertificate: documentSchema,
            additionalDocuments: [documentSchema]
        }
    },

    // BUYER-SPECIFIC FIELDS
    buyerDetails: {
        specializations: [{
            type: String,
            enum: ['IT_Accessories', 'Office_Supplies', 'Equipment', 'Consumables', 
                   'Software', 'Hardware', 'Furniture', 'Safety_Equipment', 
                   'Maintenance_Supplies', 'General']
        }],
        maxOrderValue: {
            type: Number,
            default: 1000000
        },
        workload: {
            currentAssignments: { type: Number, default: 0 },
            monthlyTarget: { type: Number, default: 50 }
        },
        performance: {
            completedOrders: { type: Number, default: 0 },
            averageProcessingTime: { type: Number, default: 0 },
            customerSatisfactionRating: { type: Number, min: 1, max: 5, default: 5 }
        },
        availability: {
            isAvailable: { type: Boolean, default: true },
            unavailableReason: String,
            unavailableUntil: Date
        }
    },

    supplierStatus: {
        accountStatus: {
            type: String,
            enum: [
              'pending', 
              'pending_supply_chain',
              'pending_head_of_business',
              'pending_finance',
              'approved', 
              'rejected', 
              'suspended', 
              'inactive'
            ],
            default: 'pending'
        },
        emailVerified: { type: Boolean, default: false },
        isVerified: { type: Boolean, default: false },
        verificationToken: String,
        verificationTokenExpiry: Date,
        approvalDate: Date,
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rejectionReason: String,
        rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rejectionDate: Date,
        suspensionReason: String
    },

    approvalChain: [{
      level: {
        type: Number,
        required: true
      },
      approver: {
        name: { type: String, required: true },
        email: { type: String, required: true },
        role: { type: String, required: true },
        department: { type: String }
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
      comments: String,
      signature: {
        url: String,
        signedAt: Date,
        signedBy: String
      },
      actionDate: Date,
      actionTime: String,
      assignedDate: {
        type: Date,
        default: Date.now
      }
    }],

    currentApprovalLevel: {
      type: Number,
      default: 0
    },

    onboardingApplicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SupplierOnboardingApplication'
    },

    createdAt: { type: Date, default: Date.now },
    lastLogin: Date,
    
    // AUDIT FIELDS
    lastHierarchyUpdate: Date,
    hierarchyUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ==========================================
// INDEXES FOR PERFORMANCE
// ==========================================
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ department: 1, hierarchyLevel: -1 });
UserSchema.index({ supervisor: 1 });
UserSchema.index({ departmentHead: 1 });
UserSchema.index({ hierarchyPath: 1 });
UserSchema.index({ 'supplierDetails.supplierType': 1 });
UserSchema.index({ 'supplierStatus.accountStatus': 1 });
UserSchema.index({ 'buyerDetails.specializations': 1 });

// ==========================================
// VIRTUALS
// ==========================================
UserSchema.virtual('displayName').get(function() {
    if (this.role === 'supplier') {
        return this.supplierDetails?.companyName || this.fullName;
    }
    return this.fullName;
});

UserSchema.virtual('contracts', {
    ref: 'Contract',
    localField: '_id',
    foreignField: 'supplier'
});

UserSchema.virtual('invoices', {
    ref: 'SupplierInvoice',
    localField: '_id',
    foreignField: 'supplier'
});

UserSchema.virtual('performanceEvaluations', {
    ref: 'SupplierPerformance',
    localField: '_id',
    foreignField: 'supplier'
});

// Virtual for current approval step
UserSchema.virtual('currentApprovalStep').get(function() {
  if (this.role !== 'supplier' || !this.approvalChain) return null;
  return this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && step.status === 'pending'
  );
});

// Virtual for approval progress
UserSchema.virtual('approvalProgress').get(function() {
  if (this.role !== 'supplier' || !this.approvalChain || this.approvalChain.length === 0) return 0;
  const approvedSteps = this.approvalChain.filter(step => step.status === 'approved').length;
  return Math.round((approvedSteps / this.approvalChain.length) * 100);
});

// ==========================================
// INSTANCE METHODS
// ==========================================

/**
 * Get complete approval chain for this user
 */
UserSchema.methods.getApprovalChain = async function(workflowType = 'general') {
    const WorkflowService = require('../services/workflowService');
    return await WorkflowService.generateApprovalWorkflow(this._id, workflowType);
};

/**
 * Check if this user can approve for another user
 */
UserSchema.methods.canApproveFor = function(userId) {
    return this.directReports.some(id => id.toString() === userId.toString()) ||
           this.approvalCapacities.length > 0;
};

/**
 * Get all subordinates (direct and indirect)
 */
UserSchema.methods.getAllSubordinates = async function() {
    const User = mongoose.model('User');
    const subordinates = [];
    
    const traverse = async (userId) => {
        const user = await User.findById(userId).populate('directReports');
        if (!user) return;
        
        for (const report of user.directReports) {
            subordinates.push(report);
            await traverse(report._id);
        }
    };
    
    await traverse(this._id);
    return subordinates;
};

/**
 * Get approval authority level
 */
UserSchema.methods.getApprovalAuthority = function() {
    if (this.role === 'admin') return 'admin';
    if (this.role === 'supplier') return 'supplier';
    if (this.approvalCapacities.includes('business_head')) return 'business_head';
    if (this.approvalCapacities.includes('department_head')) return 'department_head';
    if (this.approvalCapacities.includes('direct_supervisor')) return 'supervisor';
    if (this.role === 'buyer') return 'buyer';
    return 'employee';
};

/**
 * Check if buyer can handle requisition
 */
UserSchema.methods.canHandleRequisition = function(requisition) {
    if (this.role !== 'buyer') return false;
    if (!this.buyerDetails?.availability?.isAvailable) return false;
    
    const buyerSpecs = this.buyerDetails.specializations || [];
    if (buyerSpecs.length > 0 && !buyerSpecs.includes(requisition.itemCategory?.replace(' ', '_'))) {
        return false;
    }
    
    const estimatedValue = requisition.budgetXAF || requisition.financeVerification?.assignedBudget || 0;
    if (estimatedValue > (this.buyerDetails?.maxOrderValue || 1000000)) {
        return false;
    }
    
    return true;
};

/**
 * Get buyer workload
 */
UserSchema.methods.getBuyerWorkload = function() {
    if (this.role !== 'buyer') return null;
    
    return {
        current: this.buyerDetails?.workload?.currentAssignments || 0,
        target: this.buyerDetails?.workload?.monthlyTarget || 50,
        percentage: Math.round(((this.buyerDetails?.workload?.currentAssignments || 0) / 
                               (this.buyerDetails?.workload?.monthlyTarget || 50)) * 100)
    };
};

/**
 * Check if supplier is approved
 */
UserSchema.methods.isApprovedSupplier = function() {
    return this.role === 'supplier' && 
           this.supplierStatus.accountStatus === 'approved' && 
           this.isActive && 
           this.supplierStatus.emailVerified;
};

/**
 * Get supplier summary
 */
UserSchema.methods.getSupplierSummary = async function() {
    const Contract = mongoose.model('Contract');
    const SupplierInvoice = mongoose.model('SupplierInvoice');
    
    const [contracts, invoices, performance] = await Promise.all([
        Contract.find({ supplier: this._id }),
        SupplierInvoice.find({ supplier: this._id }),
        this.getPerformanceScore()
    ]);
    
    const activeContracts = contracts.filter(c => c.status === 'active').length;
    const totalContractValue = contracts.reduce((sum, c) => sum + (c.financials?.totalValue || 0), 0);
    
    const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.invoiceAmount, 0);
    const pendingInvoices = invoices.filter(inv => 
        ['pending_finance_assignment', 'pending_department_approval'].includes(inv.approvalStatus)
    ).length;
    const paidInvoices = invoices.filter(inv => inv.approvalStatus === 'paid').length;
    
    return {
        contracts: { total: contracts.length, active: activeContracts, totalValue: totalContractValue },
        invoices: { total: invoices.length, pending: pendingInvoices, paid: paidInvoices, totalInvoiced },
        performance: performance || { averageScore: 0, evaluationCount: 0 }
    };
};

UserSchema.methods.getPerformanceScore = async function() {
    const SupplierPerformance = mongoose.model('SupplierPerformance');
    const evaluations = await SupplierPerformance.find({
        supplier: this._id,
        status: { $in: ['submitted', 'reviewed'] }
    }).sort({ evaluationDate: -1 }).limit(5);
    
    if (evaluations.length === 0) return null;
    
    const avgScore = evaluations.reduce((sum, eval) => sum + eval.overallScore, 0) / evaluations.length;
    return {
        averageScore: avgScore.toFixed(2),
        latestScore: evaluations[0].overallScore,
        evaluationCount: evaluations.length,
        latestEvaluationDate: evaluations[0].evaluationDate
    };
};


/**
 * Initialize approval chain for new supplier
 */
UserSchema.methods.initializeSupplierApprovalChain = function() {
  if (this.role !== 'supplier') {
    throw new Error('Can only initialize approval chain for suppliers');
  }
  
  const { getSupplierApprovalChain } = require('../config/supplierApprovalChain');
  this.approvalChain = getSupplierApprovalChain(this.supplierDetails.supplierType);
  this.currentApprovalLevel = 1; // Start at level 1
  this.supplierStatus.accountStatus = 'pending_supply_chain';
  
  return this;
};

/**
 * Get current approval step
 */
UserSchema.methods.getCurrentApprovalStep = function() {
  if (this.role !== 'supplier' || !this.approvalChain) return null;
  return this.approvalChain.find(step => 
    step.level === this.currentApprovalLevel && step.status === 'pending'
  );
};

/**
 * Check if user can approve this supplier
 */
UserSchema.methods.canUserApproveSupplier = function(userEmail) {
  const currentStep = this.getCurrentApprovalStep();
  return currentStep && currentStep.approver.email === userEmail;
};

/**
 * Get approval history
 */
UserSchema.methods.getSupplierApprovalHistory = function() {
  if (this.role !== 'supplier' || !this.approvalChain) return [];
  return this.approvalChain
    .filter(step => step.status !== 'pending')
    .sort((a, b) => a.level - b.level);
};

// Add index for supplier approval queries:
UserSchema.index({ 
  'approvalChain.approver.email': 1, 
  'approvalChain.status': 1,
  'supplierStatus.accountStatus': 1 
});
UserSchema.index({ currentApprovalLevel: 1, role: 1 });

// ==========================================
// PASSWORD HANDLING
// ==========================================
UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

UserSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);