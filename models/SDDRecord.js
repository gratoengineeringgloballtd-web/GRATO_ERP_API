// models/SDDRecord.js
const mongoose = require('mongoose');
const { approvalStepSchema } = require('./shared/legalSubSchemas');

const sddAnswerSchema = new mongoose.Schema({
  sectionKey:   { type: String, required: true },
  questionKey:  { type: String, required: true },
  questionText: { type: String, required: true },
  answer:       { type: mongoose.Schema.Types.Mixed },
  answerText:   { type: String, trim: true, default: '' },
  notApplicable:{ type: Boolean, default: false },
  attachments:  [{
    name:       String,
    url:        String,
    publicId:   String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  score:   { type: Number, default: 0 },
  flagged: { type: Boolean, default: false }
}, { _id: false });

const sddRecordSchema = new mongoose.Schema({
  sddType:    { type: String, enum: ['internal', 'external'], required: true },

  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplierDetails: {
    name:    String,
    email:   String,
    country: String,
    contact: String
  },

  referenceNumber: { type: String, unique: true, trim: true },
  evaluationRef:   { type: String, trim: true, default: '' },

  answers: [sddAnswerSchema],

  totalQuestions:    { type: Number, default: 0 },
  answeredQuestions: { type: Number, default: 0 },
  yesCount:          { type: Number, default: 0 },
  noCount:           { type: Number, default: 0 },
  naCount:           { type: Number, default: 0 },
  score:             { type: Number, default: 0 },
  scoreBySection:    { type: mongoose.Schema.Types.Mixed, default: {} },

  unmetCriticalPoints: [{ type: String, trim: true }],

  status: {
    type: String,
    enum: ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'expired'],
    default: 'draft'
  },

  approvalChain:        [approvalStepSchema],
  approvalStatus:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  currentApprovalLevel: { type: Number, default: 1 },

  reviewerNotes:    { type: String, trim: true, default: '' },
  rejectionReason:  { type: String, trim: true, default: '' },

  submittedAt:     { type: Date },
  approvedAt:      { type: Date },
  expiryDate:      { type: Date },

  submittedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  submittedByName: { type: String, trim: true, default: '' },

  version:           { type: Number, default: 1 },
  previousVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SDDRecord', default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

sddRecordSchema.index({ sddType: 1, status: 1 });
sddRecordSchema.index({ supplierId: 1 });
sddRecordSchema.index({ referenceNumber: 1 });

// Auto-generate reference number
sddRecordSchema.pre('save', async function (next) {
  if (this.isNew && !this.referenceNumber) {
    const Counter = require('./Counter');
    const now    = new Date();
    const year   = now.getFullYear();
    const counter = await Counter.findByIdAndUpdate(
      `SDD-${year}`,
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    const prefix = this.sddType === 'internal' ? 'SDD-INT' : 'SDD-EXT';
    this.referenceNumber = `${prefix}-${year}-${String(counter.seq).padStart(4, '0')}`;
  }
  next();
});

// Auto-calculate score on save
sddRecordSchema.pre('save', function (next) {
  const answers = this.answers || [];
  this.totalQuestions    = answers.length;
  this.answeredQuestions = answers.filter(a => !a.notApplicable).length;
  this.yesCount          = answers.filter(a => a.answer === true || a.answer === 'yes').length;
  this.noCount           = answers.filter(a => a.answer === false || a.answer === 'no').length;
  this.naCount           = answers.filter(a => a.notApplicable).length;

  const scoreable = answers.filter(a => !a.notApplicable).length;
  this.score = scoreable > 0 ? Math.round((this.yesCount / scoreable) * 100) : 0;

  const sectionScores = {};
  answers.forEach(a => {
    if (!sectionScores[a.sectionKey]) sectionScores[a.sectionKey] = { yes: 0, total: 0 };
    if (!a.notApplicable) {
      sectionScores[a.sectionKey].total++;
      if (a.answer === true || a.answer === 'yes') sectionScores[a.sectionKey].yes++;
    }
  });
  Object.keys(sectionScores).forEach(key => {
    const s = sectionScores[key];
    sectionScores[key].score = s.total > 0 ? Math.round((s.yes / s.total) * 100) : 0;
  });
  this.scoreBySection = sectionScores;
  next();
});

module.exports = mongoose.model('SDDRecord', sddRecordSchema);