/**
 * TankLevelReading.js
 *
 * One document per site per reading date, from the daily RMS/telemetry
 * tank-level export (columns: RegionName, SiteName, Component, Location,
 * Value, Column1 (timestamp), Device, etc. — distinct from the existing
 * CMS/ERS daily import, which is a different source/format feeding
 * CmsDailyRecord).
 *
 * The source file can carry MULTIPLE rows per site:
 *   - Location='Quant' + Device in ('Fuel','EyeSiteP Fuel') → an actual
 *     tank quantity reading in liters. A site with more than one physical
 *     tank has one such row per tank (distinguished by
 *     ControllerComponentExtention) — these are summed into fuel_level_l.
 *   - Location='Cover' + Device in ('Alert','TSS Energy Card') → a
 *     sensor/cover status flag, NOT a fuel quantity. Always value 0 with
 *     no timestamp. Excluded entirely from fuel_level_l.
 *   - Value of -1 (or any negative number) → sensor error / no reading,
 *     not a literal negative fuel level. Excluded from the sum; if EVERY
 *     tank at a site reads this way, the whole reading is flagged
 *     'sensor_error' rather than silently recorded as 0 or a small number.
 */
const mongoose = require('mongoose');

const tankReadingSchema = new mongoose.Schema({
  site_id:      { type: String, required: true, index: true }, // normalized, matches Site.IHS_ID_SITE
  site_name:    String,   // raw name as it appeared in the file (may carry the M/O operator suffix)
  region:       String,
  cluster:      String,   // filled in from Site lookup at import time, for filtering/reporting

  reading_date: { type: String, required: true, index: true }, // YYYY-MM-DD, the calendar day this reading represents
  reading_time: Date,      // most recent tank's timestamp (Column1), when available
  cycle_key:    { type: String, index: true },

  fuel_level_l: { type: Number, default: null }, // sum of all valid tank readings at this site; null if sensor_error
  tank_count:   { type: Number, default: 0 },     // how many distinct tanks contributed
  tanks: [{
    controller_ext: String,
    value_l:        Number,
    timestamp:      Date,
    device:         String,
  }],

  status: {
    type: String,
    enum: ['ok', 'sensor_error', 'no_reading'],
    default: 'ok',
  },

  site_status_type: String, // 'On Air' / 'Decommissioned' / 'ATP RMS Installation' — passed through for context
  upload_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'TankLevelUpload' },
}, { timestamps: true });

// One reading per site per day — re-uploading the same day's file updates
// in place rather than duplicating (matches the CMS daily-import pattern).
tankReadingSchema.index({ site_id: 1, reading_date: 1 }, { unique: true });

/**
 * Latest reading for a site, regardless of date — used to populate
 * Site.Fuel_Quantity_Found with the freshest available telemetry value.
 */
tankReadingSchema.statics.latestForSite = function (site_id) {
  return this.findOne({ site_id }).sort({ reading_date: -1 }).lean();
};

module.exports = mongoose.model('TankLevelReading', tankReadingSchema);
