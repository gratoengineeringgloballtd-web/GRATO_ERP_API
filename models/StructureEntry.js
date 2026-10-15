// models/StructureEntry.js
// Runtime additions to the organisation structure. The hardcoded
// config/departmentStructure.js remains the base; entries here extend it so
// people created from the IT console get a working approval chain without a
// code change. Looked up by config/dynamicStructure.js.
const mongoose = require('mongoose');

const structureEntrySchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  position: { type: String, required: true, trim: true },
  reportsTo: { type: String, lowercase: true, trim: true, default: null }, // supervisor email
  hierarchyLevel: { type: Number, default: 1, min: 1, max: 6 },
  canSupervise: { type: [String], default: [] },
  approvalAuthority: {
    type: String,
    enum: ['staff', 'supervisor', 'coordinator', 'head', 'manager'],
    default: 'staff'
  },
  isDepartmentHead: { type: Boolean, default: false },
  // 'base' = imported copy of config/departmentStructure.js; 'runtime' = added from the console.
  source: { type: String, enum: ['base', 'runtime'], default: 'runtime' },
  // For base copies: false until someone edits the entry. Only runtime or edited entries
  // override the structure file, so importing changes nothing by itself.
  edited: { type: Boolean, default: false },
  notes: { type: String, default: '' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('StructureEntry', structureEntrySchema);
