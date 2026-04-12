const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  generator_id: {
    type: String,
    ref: 'Generator',
    required: true
  },
  tower_id: {
    type: String,
    ref: 'Tower',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['low_fuel', 'overheating', 'mechanical_issue', 'shutdown', 'maintenance_due']
  },
  severity: {
    type: String,
    required: true,
    enum: ['warning', 'critical'],
    default: 'warning'
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  resolved: {
    type: Boolean,
    default: false
  },
  resolved_at: Date,
  resolved_by: String,
  notification_sent: {
    type: Boolean,
    default: false
  },
  data: {
    // Contextual data about the alert
    fuel_level: Number,
    temperature: Number,
    vibration: Number,
    runtime: Number
  }
});

// Indexes
alertSchema.index({ generator_id: 1, timestamp: -1 });
alertSchema.index({ tower_id: 1 });
alertSchema.index({ type: 1 });
alertSchema.index({ resolved: 1 });
alertSchema.index({ timestamp: -1 });

// Auto-resolve related alerts when generator status changes
alertSchema.statics.resolveAlerts = async function(generatorId, resolvedBy) {
  await this.updateMany(
    { 
      generator_id: generatorId, 
      resolved: false 
    },
    { 
      resolved: true,
      resolved_at: new Date(),
      resolved_by: resolvedBy 
    }
  );
};

module.exports = mongoose.model('Alert', alertSchema);