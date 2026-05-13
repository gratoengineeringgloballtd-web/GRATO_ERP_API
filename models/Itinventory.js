const mongoose = require('mongoose');

const MaintenanceRecordSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  type: { type: String, required: true },
  description: { type: String, required: true },
  technician: { type: String, required: true },
  cost: { type: Number, default: 0 },
  nextMaintenanceDate: Date
}, { _id: true });

const ITInventorySchema = new mongoose.Schema({
  itemCode: {
    type: String,
    unique: true,
    sparse: true   // auto-generated on save if absent
  },
  itemName: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['hardware', 'software', 'network', 'mobile', 'accessories']
  },
  subcategory: {
    type: String,
    trim: true
  },
  brand: { type: String, trim: true },
  model: { type: String, trim: true },
  serialNumber: { type: String, trim: true, sparse: true },

  specifications: {
    type: Map,
    of: String,
    default: {}
  },

  status: {
    type: String,
    required: true,
    enum: ['available', 'assigned', 'installed', 'maintenance', 'retired', 'lost'],
    default: 'available'
  },
  condition: {
    type: String,
    required: true,
    enum: ['new', 'excellent', 'good', 'fair', 'poor', 'active', 'needs_repair'],
    default: 'good'
  },

  location: { type: String, trim: true },

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignedDate: Date,

  purchaseInfo: {
    purchaseDate: Date,
    purchasePrice: { type: Number, min: 0, default: 0 },
    supplier: String,
    warrantyExpiry: Date,
    invoiceNumber: String
  },

  stockInfo: {
    quantity: { type: Number, min: 0, default: 1 },
    minStockLevel: { type: Number, min: 0, default: 1 },
    maxStockLevel: { type: Number, min: 0, default: 10 },
    reorderPoint: { type: Number, min: 0, default: 2 }
  },

  maintenanceHistory: [MaintenanceRecordSchema],

  // Link back to the IT support request that resulted in this item being added
  sourceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ITSupportRequest',
    default: null
  },

  notes: { type: String, trim: true },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
ITInventorySchema.index({ category: 1, status: 1 });
ITInventorySchema.index({ assignedTo: 1 });
ITInventorySchema.index({ 'stockInfo.quantity': 1 });
ITInventorySchema.index({ itemCode: 1 }, { unique: true, sparse: true });
ITInventorySchema.index({
  itemName: 'text',
  brand: 'text',
  model: 'text',
  serialNumber: 'text',
  itemCode: 'text'
});

// ─── Virtuals ─────────────────────────────────────────────────────────────────
ITInventorySchema.virtual('isLowStock').get(function () {
  if (!this.stockInfo) return false;
  return this.stockInfo.quantity <= this.stockInfo.minStockLevel;
});

ITInventorySchema.virtual('warrantyStatus').get(function () {
  if (!this.purchaseInfo?.warrantyExpiry) return 'unknown';
  const now = new Date();
  const expiry = new Date(this.purchaseInfo.warrantyExpiry);
  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 90) return 'expiring_soon';
  return 'valid';
});

// ─── Auto-generate itemCode ───────────────────────────────────────────────────
ITInventorySchema.pre('save', async function (next) {
  if (!this.itemCode) {
    const prefix = {
      hardware: 'IT-HW',
      software: 'IT-SW',
      network: 'IT-NW',
      mobile: 'IT-MB',
      accessories: 'IT-AC'
    }[this.category] || 'IT-GN';

    // Find the highest existing code for this prefix
    const last = await this.constructor
      .findOne({ itemCode: new RegExp(`^${prefix}-`) })
      .sort({ itemCode: -1 })
      .select('itemCode');

    let seq = 1;
    if (last?.itemCode) {
      const parts = last.itemCode.split('-');
      seq = (parseInt(parts[parts.length - 1], 10) || 0) + 1;
    }

    this.itemCode = `${prefix}-${String(seq).padStart(3, '0')}`;
  }
  next();
});

module.exports = mongoose.model('ITInventory', ITInventorySchema);