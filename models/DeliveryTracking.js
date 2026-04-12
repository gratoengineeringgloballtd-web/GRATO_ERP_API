const mongoose = require('mongoose');

const DeliveryTrackingSchema = new mongoose.Schema({
  // Basic Information
  trackingNumber: {
    type: String,
    unique: true,
    required: true
  },
  purchaseOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder',
    required: true
  },
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Delivery Details
  status: {
    type: String,
    enum: [
      'pending_dispatch',
      'dispatched',
      'in_transit',
      'at_facility',
      'out_for_delivery',
      'delivered',
      'delivery_failed',
      'returned',
      'cancelled'
    ],
    default: 'pending_dispatch'
  },
  
  // Timeline
  dispatchDate: Date,
  estimatedDeliveryDate: Date,
  actualDeliveryDate: Date,
  
  // Location and Logistics
  currentLocation: String,
  deliveryAddress: {
    type: String,
    required: true
  },
  
  // Carrier Information
  carrier: {
    name: String,
    contactNumber: String,
    trackingUrl: String
  },
  
  // Progress Tracking
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Tracking Updates
  trackingUpdates: [{
    status: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    location: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: String
  }],
  
  // Delivery Confirmation
  deliveryConfirmation: {
    receivedBy: String,
    receivedDate: Date,
    condition: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'damaged']
    },
    notes: String,
    photos: [String], 
    signature: String, 
    confirmed: {
      type: Boolean,
      default: false
    }
  },
  
  // Issues and Problems
  issues: [{
    type: {
      type: String,
      enum: ['delay', 'damage', 'missing_items', 'wrong_address', 'recipient_unavailable', 'other']
    },
    description: String,
    reportedDate: Date,
    reportedBy: String,
    resolved: {
      type: Boolean,
      default: false
    },
    resolution: String,
    resolvedDate: Date
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
DeliveryTrackingSchema.index({ trackingNumber: 1 });
DeliveryTrackingSchema.index({ purchaseOrderId: 1 });
DeliveryTrackingSchema.index({ buyerId: 1 });
DeliveryTrackingSchema.index({ status: 1 });

// Method to add tracking update
DeliveryTrackingSchema.methods.addUpdate = function(status, description, location, updatedBy = 'System') {
  this.trackingUpdates.push({
    status,
    description,
    location,
    updatedBy,
    timestamp: new Date()
  });
  
  // Update current status and location
  this.status = status;
  if (location) this.currentLocation = location;
  
  // Update progress based on status
  const progressMap = {
    'pending_dispatch': 5,
    'dispatched': 20,
    'in_transit': 50,
    'at_facility': 70,
    'out_for_delivery': 85,
    'delivered': 100,
    'delivery_failed': 90,
    'returned': 30,
    'cancelled': 0
  };
  
  this.progress = progressMap[status] || this.progress;
  
  return this.save();
};

// Method to confirm delivery
DeliveryTrackingSchema.methods.confirmDelivery = function(confirmationData) {
  this.deliveryConfirmation = {
    ...confirmationData,
    receivedDate: new Date(),
    confirmed: true
  };
  
  this.status = 'delivered';
  this.actualDeliveryDate = new Date();
  this.progress = 100;
  
  this.addUpdate('delivered', 'Package delivered and confirmed', this.deliveryAddress, confirmationData.receivedBy);
  
  return this.save();
};

// Method to report issue
DeliveryTrackingSchema.methods.reportIssue = function(issueData) {
  this.issues.push({
    ...issueData,
    reportedDate: new Date()
  });
  
  return this.save();
};

module.exports = mongoose.model('DeliveryTracking', DeliveryTrackingSchema);





