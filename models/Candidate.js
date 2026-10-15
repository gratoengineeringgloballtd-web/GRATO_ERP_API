const mongoose = require('mongoose');

const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];

const feedbackSchema = new mongoose.Schema({
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  byName: String,
  score: { type: Number, min: 1, max: 5, required: true },
  recommendation: { type: String, enum: ['strong_yes', 'yes', 'no', 'strong_no'], required: true },
  comments: { type: String, trim: true },
  at: { type: Date, default: Date.now }
}, { _id: true });

const interviewSchema = new mongoose.Schema({
  round: { type: Number, default: 1 },
  mode: { type: String, enum: ['in_person', 'phone', 'video'], default: 'in_person' },
  scheduledAt: { type: Date, required: true },
  durationMinutes: { type: Number, default: 60 },
  location: { type: String, trim: true },       // room or meeting link
  panel: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['scheduled', 'done', 'cancelled'], default: 'scheduled' },
  feedback: [feedbackSchema]
}, { _id: true });

const CandidateSchema = new mongoose.Schema({
  opening: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOpening', required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  source: { type: String, enum: ['website', 'referral', 'linkedin', 'agency', 'walk_in', 'other'], default: 'other' },
  currentEmployer: { type: String, trim: true },
  expectedSalary: { type: Number, min: 0 },
  cv: { name: String, url: String, publicId: String, size: Number, mimetype: String },
  stage: { type: String, enum: STAGES, default: 'applied' },
  rejectionReason: String,
  notes: [{ text: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, byName: String, at: { type: Date, default: Date.now } }],
  stageHistory: [{ stage: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
  interviews: [interviewSchema],

  offer: {
    position: String,
    salary: Number,
    startDate: Date,
    notes: String,
    aboveBand: Boolean,
    status: { type: String, enum: ['none', 'draft', 'sent', 'accepted', 'declined'], default: 'none' },
    sentAt: Date,
    respondedAt: Date
  },

  onboarding: {
    itRequestedAt: Date,
    hiredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    salaryProfileCreated: { type: Boolean, default: false }
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

CandidateSchema.index({ opening: 1, stage: 1 });
CandidateSchema.index({ 'interviews.panel': 1, 'interviews.scheduledAt': 1 });
CandidateSchema.statics.STAGES = STAGES;

module.exports = mongoose.model('Candidate', CandidateSchema);
