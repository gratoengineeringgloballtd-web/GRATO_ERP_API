/**
 * DieselCycle.js
 * Represents one billing/work cycle (26th → 25th of following month).
 * Every KPI, consumption, and reconciliation is anchored to a cycle.
 */
const mongoose = require('mongoose');

const dieselCycleSchema = new mongoose.Schema({
  // e.g. "2026-05" means 26 Apr 2026 → 25 May 2026
  cycle_key: { type: String, required: true, unique: true, index: true }, // "YYYY-MM"
  label: { type: String, required: true },        // "May 2026 Cycle"
  start_date: { type: Date, required: true },     // 2026-04-26T00:00:00
  end_date:   { type: Date, required: true },     // 2026-05-25T23:59:59
  days_in_cycle: { type: Number, required: true },// 30 or 31

  status: {
    type: String,
    enum: ['open', 'closed', 'archived'],
    default: 'open'
  },
  closed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  closed_at: Date,
  notes: String,
}, { timestamps: true });

/**
 * Derive the cycle key for any date.
 * If day >= 26 → cycle belongs to the FOLLOWING month.
 * If day < 26  → cycle belongs to the CURRENT month.
 */
dieselCycleSchema.statics.getCycleKeyForDate = function (date = new Date()) {
  const d = new Date(date);
  let year = d.getFullYear();
  let month = d.getMonth(); // 0-based
  if (d.getDate() >= 26) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
};

dieselCycleSchema.statics.getOrCreateCurrent = async function () {
  const key = this.getCycleKeyForDate(new Date());
  let cycle = await this.findOne({ cycle_key: key });
  if (!cycle) {
    const [year, month] = key.split('-').map(Number);
    // start: 26th of previous month
    const start = new Date(year, month - 2, 26, 0, 0, 0);
    // end: 25th of this month
    const end = new Date(year, month - 1, 25, 23, 59, 59);
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    cycle = await this.create({
      cycle_key: key,
      label: `${monthNames[month - 1]} ${year} Cycle`,
      start_date: start,
      end_date: end,
      days_in_cycle: days,
    });
  }
  return cycle;
};

module.exports = mongoose.model('DieselCycle', dieselCycleSchema);