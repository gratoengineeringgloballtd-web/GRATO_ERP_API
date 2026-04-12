const analyticAccountSchema = new mongoose.Schema({
  code:     { type: String, required: true, unique: true, trim: true, uppercase: true },
  name:     { type: String, required: true, trim: true },
  type:     { type: String, enum: ['cost_centre','project','department','product'], default: 'cost_centre' },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnalyticAccount', default: null },
  isActive: { type: Boolean, default: true },
  budget:   { type: Number, default: 0 }
}, { timestamps: true });
 
module.exports = mongoose.model('AnalyticAccount', analyticAccountSchema);