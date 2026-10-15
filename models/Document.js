const mongoose = require('mongoose');

const CATEGORIES = ['contract', 'certificate', 'licence', 'insurance', 'invoice', 'report', 'letter', 'policy', 'id_document', 'medical', 'disciplinary', 'payslip', 'other'];

const fileSchema = new mongoose.Schema({
  name: String, url: String, publicId: String, size: Number, mimetype: String,
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: false });

const DocumentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  category: { type: String, enum: CATEGORIES, default: 'other' },
  reference: { type: String, trim: true },
  tags: [{ type: String, trim: true }],
  documentDate: Date,

  // general = company library, linked = attached to a record, employee = HR employee file
  scope: { type: String, enum: ['general', 'linked', 'employee'], default: 'general' },
  linkedTo: {
    model: { type: String, trim: true },   // Supplier, Customer, Project, ...
    id: { type: mongoose.Schema.Types.ObjectId },
    label: { type: String, trim: true }
  },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  employeeCanView: { type: Boolean, default: false },

  visibility: { type: String, enum: ['company', 'department', 'private'], default: 'department' },
  department: String,
  sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  file: fileSchema,
  versions: [fileSchema],

  // Expiry and reminders
  expiryDate: Date,
  reminderDays: { type: [Number], default: [60, 30, 7] },
  remindersSent: [Number],
  notifyUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Retention
  retentionYears: Number,
  retainUntil: Date,
  retentionStatus: { type: String, enum: ['active', 'due', 'archived'], default: 'active' },
  archivedAt: Date,
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  generatedFromTemplate: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentTemplate' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

DocumentSchema.index({ title: 'text', description: 'text', reference: 'text', tags: 'text' });
DocumentSchema.index({ scope: 1, employee: 1 });
DocumentSchema.index({ 'linkedTo.model': 1, 'linkedTo.id': 1 });
DocumentSchema.index({ expiryDate: 1 });
DocumentSchema.index({ retentionStatus: 1, retainUntil: 1 });

DocumentSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('Document', DocumentSchema);
