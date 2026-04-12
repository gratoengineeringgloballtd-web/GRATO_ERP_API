const mongoose = require('mongoose');

const scheduledReportSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  reportType: {
    type: String,
    required: true,
    enum: [
      'budget_dashboard',
      'budget_utilization',
      'budget_revisions',
      'budget_transfers',
      'budget_alerts',
      'custom'
    ]
  },
  frequency: {
    type: String,
    required: true,
    enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'custom']
  },
  customCron: {
    type: String,
    // For custom cron expressions (e.g., '0 8 * * 1' for every Monday at 8 AM)
  },
  schedule: {
    dayOfWeek: {
      type: Number, // 0 = Sunday, 1 = Monday, etc.
      min: 0,
      max: 6
    },
    dayOfMonth: {
      type: Number, // 1-31
      min: 1,
      max: 31
    },
    time: {
      type: String, // Format: "HH:mm" (24-hour)
      default: '08:00'
    },
    timezone: {
      type: String,
      default: 'Africa/Douala'
    }
  },
  filters: {
    fiscalYear: Number,
    department: String,
    budgetType: String,
    utilizationThreshold: Number,
    dateRange: {
      start: Date,
      end: Date
    }
  },
  recipients: [{
    email: {
      type: String,
      required: true
    },
    name: String,
    role: String
  }],
  format: {
    type: String,
    enum: ['pdf', 'excel', 'both'],
    default: 'pdf'
  },
  includeCharts: {
    type: Boolean,
    default: true
  },
  active: {
    type: Boolean,
    default: true
  },
  lastRun: {
    type: Date
  },
  nextRun: {
    type: Date
  },
  runCount: {
    type: Number,
    default: 0
  },
  lastRunStatus: {
    type: String,
    enum: ['success', 'failed', 'pending'],
    default: 'pending'
  },
  lastRunError: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
scheduledReportSchema.index({ active: 1, nextRun: 1 });
scheduledReportSchema.index({ createdBy: 1 });
scheduledReportSchema.index({ reportType: 1 });

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Calculate next run date based on frequency and schedule
 */
scheduledReportSchema.methods.calculateNextRun = function() {
  const now = new Date();
  let nextRun = new Date();

  const [hours, minutes] = this.schedule.time.split(':').map(Number);
  nextRun.setHours(hours, minutes, 0, 0);

  switch (this.frequency) {
    case 'daily':
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      break;

    case 'weekly':
      const targetDay = this.schedule.dayOfWeek || 1; // Default to Monday
      const currentDay = nextRun.getDay();
      let daysUntilNext = targetDay - currentDay;
      
      if (daysUntilNext < 0 || (daysUntilNext === 0 && nextRun <= now)) {
        daysUntilNext += 7;
      }
      
      nextRun.setDate(nextRun.getDate() + daysUntilNext);
      break;

    case 'biweekly':
      const targetDayBi = this.schedule.dayOfWeek || 1;
      const currentDayBi = nextRun.getDay();
      let daysUntilNextBi = targetDayBi - currentDayBi;
      
      if (daysUntilNextBi < 0 || (daysUntilNextBi === 0 && nextRun <= now)) {
        daysUntilNextBi += 14;
      } else {
        daysUntilNextBi += (this.lastRun ? 14 : 0);
      }
      
      nextRun.setDate(nextRun.getDate() + daysUntilNextBi);
      break;

    case 'monthly':
      const targetDayOfMonth = this.schedule.dayOfMonth || 1;
      nextRun.setDate(targetDayOfMonth);
      
      if (nextRun <= now) {
        nextRun.setMonth(nextRun.getMonth() + 1);
      }
      break;

    case 'quarterly':
      const targetDayQuarterly = this.schedule.dayOfMonth || 1;
      nextRun.setDate(targetDayQuarterly);
      
      // Find next quarter start
      const currentMonth = nextRun.getMonth();
      const quarterStartMonths = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct
      let nextQuarterMonth = quarterStartMonths.find(m => m > currentMonth);
      
      if (!nextQuarterMonth) {
        nextQuarterMonth = 0; // January of next year
        nextRun.setFullYear(nextRun.getFullYear() + 1);
      }
      
      nextRun.setMonth(nextQuarterMonth);
      
      if (nextRun <= now) {
        nextRun.setMonth(nextRun.getMonth() + 3);
      }
      break;

    case 'custom':
      // For custom cron expressions, calculate manually or use a library
      // For now, default to daily
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
      }
      break;
  }

  return nextRun;
};

/**
 * Update next run date
 */
scheduledReportSchema.methods.updateNextRun = async function() {
  this.nextRun = this.calculateNextRun();
  await this.save();
  return this.nextRun;
};

/**
 * Mark report as executed
 */
scheduledReportSchema.methods.markExecuted = async function(success = true, error = null) {
  this.lastRun = new Date();
  this.runCount += 1;
  this.lastRunStatus = success ? 'success' : 'failed';
  this.lastRunError = error;
  
  if (this.active) {
    this.nextRun = this.calculateNextRun();
  }
  
  await this.save();
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get reports due for execution
 */
scheduledReportSchema.statics.getDueReports = async function() {
  const now = new Date();
  
  return await this.find({
    active: true,
    $or: [
      { nextRun: { $lte: now } },
      { nextRun: null }
    ]
  })
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName email');
};

/**
 * Get user's scheduled reports
 */
scheduledReportSchema.statics.getUserReports = async function(userId) {
  return await this.find({ createdBy: userId })
    .populate('createdBy', 'fullName email')
    .sort({ createdAt: -1 });
};

// Pre-save middleware to calculate nextRun on creation
scheduledReportSchema.pre('save', function(next) {
  if (this.isNew && !this.nextRun) {
    this.nextRun = this.calculateNextRun();
  }
  next();
});

const ScheduledReport = mongoose.model('ScheduledReport', scheduledReportSchema);

module.exports = ScheduledReport;