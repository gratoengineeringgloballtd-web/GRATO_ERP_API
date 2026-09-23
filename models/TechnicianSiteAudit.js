const mongoose = require('mongoose');

const TechnicianSiteAuditSchema = new mongoose.Schema({
  site_id_ihs: { type: String, required: true },
  id_operator: String,
  name_site: String,
  topology: String,
  indoor_outdoor: String,
  sbc: String,
  number_of_gen: String,
  generator_brand: String,
  engine_brand: String,
  alternator_brand: String,
  generator_capacity_kva: String,
  // ...add all other fields from Template.csv as needed
  comments: String,
  timeline_to_close_issues: String,
  overall_site_status: String,
  sbc_feedback: String,
  final_site_status: String,
  date: String,
  photos: [Object],
  notes: String,
  section_scores: Object,
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
}, { timestamps: true });

module.exports = mongoose.model('TechnicianSiteAudit', TechnicianSiteAuditSchema);
