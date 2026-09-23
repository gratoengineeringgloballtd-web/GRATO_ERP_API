const mongoose = require('mongoose');

const telemetrySchema = new mongoose.Schema({
  metadata: {
    generator_id: {
      type: String,
      ref: 'Generator',
      required: true
    },
    tower_id: {
      type: String,
      ref: 'Tower',
      required: true
    }
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  fuel_level: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  power_output: {
    type: Number,
    required: true,
    min: 0
  },
  temperature: {
    type: Number,
    required: true
  },
  vibration: {
    type: Number,
    min: 0,
    max: 100
  },
  status: {
    type: String,
    required: true,
    enum: ['running', 'standby', 'fault', 'shutdown']
  },
  runtime: {
    type: Number, 
    default: 0
  },
  shutdown_reason: {
    type: String,
    enum: [
      'low_fuel',         
      'overheating',      
      'mechanical_issue',  
      'grid_power',        
      'manual',            
      'other'              
    ],
    default: null
  },
  event_type: {
    type: String,
    enum: ['normal', 'low_fuel', 'overheating', 'mechanical_issue', 'shutdown'],
    default: 'normal'
  },
  notes: String
}, { 
  timeseries: {
    timeField: 'timestamp',
    metaField: 'metadata',
    granularity: 'minutes'
  },
  autoCreate: false 
});

// Indexes
telemetrySchema.index({ 'metadata.generator_id': 1, timestamp: -1 });
telemetrySchema.index({ 'metadata.tower_id': 1, timestamp: -1 });
telemetrySchema.index({ event_type: 1 });

// Pre-save validation
telemetrySchema.pre('save', async function(next) {
  // Validate generator exists
  const gen = await mongoose.model('Generator').findById(this.metadata.generator_id);
  if (!gen) {
    throw new Error(`Generator ${this.metadata.generator_id} not found`);
  }
  
  // Validate tower exists
  const tower = await mongoose.model('Tower').findById(this.metadata.tower_id);
  if (!tower) {
    throw new Error(`Tower ${this.metadata.tower_id} not found`);
  }
  
  // Auto-detect event type
  if (this.fuel_level < 20) this.event_type = 'low_fuel';
  if (this.temperature > 85) this.event_type = 'overheating';
  if (this.vibration > 80) this.event_type = 'mechanical_issue';
  
  next();
});

module.exports = mongoose.model('Telemetry', telemetrySchema);