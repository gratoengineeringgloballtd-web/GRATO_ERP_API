const mongoose = require('mongoose');

const ItemRequestSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestNumber: {
    type: String,
    unique: true,
    required: true
  },
  description: {
    type: String,
    required: true,
    minlength: 10
  },
  category: {
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
      'Spares',
      'Other'
    ],
    required: true
  },
  subcategory: {
    type: String,
    // Removed required: true to make it optional
  },
  unitOfMeasure: {
    type: String,
    enum: ['Pieces', 'Sets', 'Boxes', 'Packs', 'Units', 'Kg', 'Litres', 'Meters', 'Pairs', 'Each', 'Reams'],
    required: true
  },
  justification: {
    type: String,
    required: true,
    minlength: 20
  },
  estimatedPrice: {
    type: Number,
    min: 0
  },
  preferredSupplier: String,
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high'],
    required: true
  },
  additionalNotes: String,
  
  // Request processing
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  
  // Supply chain review
  supplyChainReview: {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    decision: {
      type: String,
      enum: ['approve', 'reject', 'create_item']
    },
    comments: String,
    reviewDate: Date
  },
  
  // If item was created
  createdItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item'
  },
  itemCode: String, // For quick reference
  
  // Response to employee
  response: String,
  
  // Department info
  department: String,
  requestedBy: String,
  
  // Audit trail
  requestDate: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
ItemRequestSchema.index({ employee: 1, status: 1 });
ItemRequestSchema.index({ status: 1, createdAt: -1 });
ItemRequestSchema.index({ category: 1 });
ItemRequestSchema.index({ urgency: 1, status: 1 });

// Virtual for display ID
ItemRequestSchema.virtual('displayId').get(function() {
  return this.requestNumber || `REQ-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Pre-save middleware to generate request number
ItemRequestSchema.pre('save', function(next) {
  if (!this.requestNumber) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.requestNumber = `IREQ${year}${month}${day}${random}`;
  }
  next();
});

module.exports = mongoose.model('ItemRequest', ItemRequestSchema);



