const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true,
      trim: true
    },
    registrationNumber: {
      type: String,
      unique: true
    },
    taxId: String,
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: true
    },
    alternatePhone: String,
    website: String,
    
    // Address
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: {
        type: String,
        default: 'Cameroon'
      }
    },
    
    // Business Information
    businessType: {
      type: String,
      enum: ['sole_proprietorship', 'partnership', 'corporation', 'llc', 'other'],
      required: true
    },
    yearEstablished: Number,
    employeeCount: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '500+']
    },
    annualRevenue: {
      type: String,
      enum: ['<1M', '1M-5M', '5M-20M', '20M-100M', '100M+']
    },
    
    categories: [{
      type: String,
      enum: [
        'IT Accessories',
        'Office Supplies', 
        'Equipment',
        'Consumables',
        'Software',
        'Hardware',
        'Furniture',
        'Safety Equipment',
        'Maintenance Supplies',
        'Medical Supplies',
        'Construction Materials',
        'Other'
      ]
    }],
    
    services: [String], 
    
    // Performance Metrics
    performance: {
      overallRating: {
        type: Number,
        min: 1,
        max: 5,
        default: 3
      },
      qualityRating: {
        type: Number,
        min: 1,
        max: 5,
        default: 3
      },
      deliveryRating: {
        type: Number,
        min: 1,
        max: 5,
        default: 3
      },
      communicationRating: {
        type: Number,
        min: 1,
        max: 5,
        default: 3
      },
      priceCompetitiveness: {
        type: Number,
        min: 1,
        max: 5,
        default: 3
      },
      
      // Statistics
      totalOrders: {
        type: Number,
        default: 0
      },
      completedOrders: {
        type: Number,
        default: 0
      },
      cancelledOrders: {
        type: Number,
        default: 0
      },
      
      // Delivery Performance
      onTimeDeliveries: {
        type: Number,
        default: 0
      },
      lateDeliveries: {
        type: Number,
        default: 0
      },
      averageDeliveryTime: {
        type: Number,
        default: 0
      }, // in days
      
      // Financial
      totalBusinessValue: {
        type: Number,
        default: 0
      },
      averageOrderValue: {
        type: Number,
        default: 0
      },
      
      // Response Times
      averageResponseTime: {
        type: Number,
        default: 0
      }, // in hours
      
      // Last transaction date
      lastOrderDate: Date,
      lastPaymentDate: Date
    },
    
    // Financial Information
    paymentTerms: [{
      type: String,
      enum: ['15 days', '30 days', '45 days', '60 days', 'Cash on delivery', 'Advance payment']
    }],
    preferredPaymentMethod: {
      type: String,
      enum: ['bank_transfer', 'check', 'cash', 'mobile_money', 'credit_card']
    },
    
    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
      swiftCode: String,
      iban: String
    },
    
    // Operational Details
    deliveryCapability: {
      localDelivery: {
        type: Boolean,
        default: true
      },
      regionalDelivery: {
        type: Boolean,
        default: false
      },
      nationalDelivery: {
        type: Boolean,
        default: false
      },
      internationalDelivery: {
        type: Boolean,
        default: false
      },
      averageDeliveryTime: String, // e.g., "3-5 days"
      minimumOrderValue: Number
    },
    
    // Certifications and Compliance
    certifications: [{
      name: String,
      issuingBody: String,
      issueDate: Date,
      expiryDate: Date,
      certificateNumber: String,
      status: {
        type: String,
        enum: ['active', 'expired', 'pending_renewal'],
        default: 'active'
      }
    }],
    
    // Documents
    documents: [{
      type: {
        type: String,
        enum: ['business_license', 'tax_certificate', 'insurance', 'certification', 'contract', 'other']
      },
      name: String,
      url: String,
      publicId: String,
      uploadDate: Date,
      expiryDate: Date,
      status: {
        type: String,
        enum: ['valid', 'expired', 'pending_review'],
        default: 'pending_review'
      }
    }],
    
    // Status and Approval
    status: {
      type: String,
      enum: ['pending', 'approved', 'suspended', 'rejected', 'inactive'],
      default: 'pending'
    },
    
    approvalStatus: {
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      approvalDate: Date,
      rejectionReason: String
    },
    
    // Risk Assessment
    riskProfile: {
      level: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
      },
      factors: [String], // Risk factors identified
      lastAssessment: Date,
      assessedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    
    // Communication History
    communications: [{
      type: {
        type: String,
        enum: ['email', 'phone', 'meeting', 'rfq', 'quote', 'order', 'complaint', 'other']
      },
      subject: String,
      summary: String,
      date: Date,
      direction: {
        type: String,
        enum: ['inbound', 'outbound']
      },
      contactPerson: String,
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    
    // Relationship Management
    relationshipManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    
    // Notes and Comments
    internalNotes: String,
    publicNotes: String,
    
    // Contract Information
    contracts: [{
      type: String, 
      startDate: Date,
      endDate: Date,
      value: Number,
      status: {
        type: String,
        enum: ['active', 'expired', 'terminated', 'pending']
      },
      documentUrl: String
    }],
    
    // Preferences
    preferences: {
      communicationLanguage: {
        type: String,
        default: 'English'
      },
      preferredContactMethod: {
        type: String,
        enum: ['email', 'phone', 'whatsapp', 'sms']
      },
      businessHours: {
        start: String, // e.g., "08:00"
        end: String,   // e.g., "17:00"
        timezone: String
      }
    }
  }, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  });
  
  // Indexes
  SupplierSchema.index({ email: 1 });
  SupplierSchema.index({ name: 1 });
  SupplierSchema.index({ status: 1 });
  SupplierSchema.index({ categories: 1 });
  SupplierSchema.index({ 'performance.overallRating': -1 });
  SupplierSchema.index({ 'performance.lastOrderDate': -1 });
  
  // Virtual for completion score
  SupplierSchema.virtual('profileCompletionScore').get(function() {
    let score = 0;
    const requiredFields = [
      'name', 'email', 'phone', 'address.city', 'businessType',
      'categories', 'paymentTerms'
    ];
    
    requiredFields.forEach(field => {
      const fieldValue = field.split('.').reduce((obj, key) => obj?.[key], this);
      if (fieldValue && (Array.isArray(fieldValue) ? fieldValue.length > 0 : true)) {
        score += (100 / requiredFields.length);
      }
    });
    
    return Math.round(score);
  });
  
  // Virtual for on-time delivery rate
  SupplierSchema.virtual('onTimeDeliveryRate').get(function() {
    const total = this.performance.onTimeDeliveries + this.performance.lateDeliveries;
    return total > 0 ? Math.round((this.performance.onTimeDeliveries / total) * 100) : 0;
  });
  
  // Virtual for order completion rate
  SupplierSchema.virtual('orderCompletionRate').get(function() {
    const total = this.performance.totalOrders;
    return total > 0 ? Math.round((this.performance.completedOrders / total) * 100) : 0;
  });
  
  // Method to update performance metrics
  SupplierSchema.methods.updatePerformance = function(orderData) {
    const performance = this.performance;
    
    // Update order counts
    performance.totalOrders += 1;
    if (orderData.status === 'completed') {
      performance.completedOrders += 1;
    } else if (orderData.status === 'cancelled') {
      performance.cancelledOrders += 1;
    }
    
    // Update delivery performance
    if (orderData.deliveryDate && orderData.expectedDeliveryDate) {
      const deliveryDate = new Date(orderData.deliveryDate);
      const expectedDate = new Date(orderData.expectedDeliveryDate);
      
      if (deliveryDate <= expectedDate) {
        performance.onTimeDeliveries += 1;
      } else {
        performance.lateDeliveries += 1;
      }
      
      // Update average delivery time
      const deliveryTime = Math.ceil((deliveryDate - new Date(orderData.orderDate)) / (1000 * 60 * 60 * 24));
      const totalDeliveries = performance.onTimeDeliveries + performance.lateDeliveries;
      performance.averageDeliveryTime = Math.round(
        ((performance.averageDeliveryTime * (totalDeliveries - 1)) + deliveryTime) / totalDeliveries
      );
    }
    
    // Update financial metrics
    if (orderData.value) {
      performance.totalBusinessValue += orderData.value;
      performance.averageOrderValue = performance.totalOrders > 0 ? 
        performance.totalBusinessValue / performance.totalOrders : 0;
    }
    
    // Update last order date
    performance.lastOrderDate = new Date();
    
    return this.save();
  };
  
  // Method to add communication record
  SupplierSchema.methods.addCommunication = function(communicationData) {
    this.communications.push({
      ...communicationData,
      date: new Date()
    });
    
    // Keep only last 50 communications
    if (this.communications.length > 50) {
      this.communications = this.communications.slice(-50);
    }
    
    return this.save();
  };
  
  // Static method to find suppliers by category
  SupplierSchema.statics.findByCategory = function(category, options = {}) {
    const query = { 
      categories: category,
      status: 'approved'
    };
    
    let sortOptions = { 'performance.overallRating': -1 };
    
    if (options.sortBy === 'performance') {
      sortOptions = { 'performance.overallRating': -1, 'performance.onTimeDeliveries': -1 };
    } else if (options.sortBy === 'recent') {
      sortOptions = { 'performance.lastOrderDate': -1 };
    }
    
    return this.find(query).sort(sortOptions).limit(options.limit || 20);
  };
  
  // Static method to get top performers
  SupplierSchema.statics.getTopPerformers = function(limit = 10) {
    return this.find({
      status: 'approved',
      'performance.totalOrders': { $gte: 3 } // Minimum 3 orders to be considered
    }).sort({
      'performance.overallRating': -1,
      'performance.onTimeDeliveries': -1,
      'performance.totalBusinessValue': -1
    }).limit(limit);
  };
  
module.exports = mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema);
  
  

