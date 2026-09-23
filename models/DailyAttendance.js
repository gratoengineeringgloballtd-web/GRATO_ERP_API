const mongoose = require('mongoose');

const dailyAttendanceSchema = new mongoose.Schema({
  technician: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  checkInTime: {
    type: Date,
    required: true
  },
  checkOutTime: {
    type: Date
  },
  location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  status: {
    type: String,
    enum: ['checked-in', 'checked-out'],
    default: 'checked-in'
  }
}, {
  timestamps: true
});

// Ensure a technician can only check in once per day (or handle multiple check-ins differently)
// We'll enforce one record per technician per day
dailyAttendanceSchema.index({ technician: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyAttendance', dailyAttendanceSchema);
