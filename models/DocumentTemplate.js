const mongoose = require('mongoose');

const DocumentTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  category: { type: String, default: 'letter' },
  description: { type: String, trim: true },
  subject: { type: String, trim: true },          // document title, may use {{placeholders}}
  body: { type: String, required: true },         // plain text with {{placeholders}}
  placeholders: [String],                         // derived from subject + body
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const PH = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
DocumentTemplateSchema.statics.extract = (text) => [...new Set([...String(text || '').matchAll(PH)].map((m) => m[1]))];
DocumentTemplateSchema.statics.render = (text, values) => String(text || '').replace(PH, (_, k) => (values[k] !== undefined && values[k] !== null && values[k] !== '' ? String(values[k]) : `[${k}]`));

module.exports = mongoose.model('DocumentTemplate', DocumentTemplateSchema);
