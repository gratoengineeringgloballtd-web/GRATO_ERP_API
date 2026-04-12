const mongoose = require('mongoose');

/**
 * Counter Schema for generating unique sequential codes
 * Used for item codes, PR numbers, and other sequential identifiers
 */
const counterSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    required: true,
    description: 'Counter identifier (e.g., "item_IT", "item_OFF", "pr_counter")'
  },
  seq: { 
    type: Number, 
    default: 0,
    description: 'Current sequence number'
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Update lastUpdated on any modification
counterSchema.pre('findOneAndUpdate', function(next) {
  this.set({ lastUpdated: new Date() });
  next();
});

const Counter = mongoose.model('Counter', counterSchema);

module.exports = Counter;