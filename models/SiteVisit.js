const mongoose = require('mongoose');

const siteVisitSchema = new mongoose.Schema({
  technician: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  site_id: {
    type: String, // IHS_ID_SITE
    required: true,
    index: true
  },
  site_name: String,
  
  check_in_time: {
    type: Date,
    required: true,
    default: Date.now
  },
  check_in_location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  
  check_out_time: Date,
  check_out_location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  
  duration_minutes: Number,
  
  status: {
    type: String,
    enum: ['active', 'completed', 'auto_closed'],
    default: 'active',
    index: true
  },
  
  notes: String,
  
  // Link to maintenance report if generated during this visit
  maintenance_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Maintenance'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SiteVisit', siteVisitSchema);