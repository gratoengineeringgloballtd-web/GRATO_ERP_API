/**
 * cmsImportService.js
 * Parses daily ERS/CMS CSV uploads → CmsDailyRecord documents.
 * After insert, triggers zero-grid streak update and reconciliation.
 *
 * BUG FIX: "cmsImportService.importFromCSV is not a function"
 *
 * Root cause: cmsUploadRoutes.js calls `cmsImportService.importFromCSV(buffer,
 * cycle_key, userId)`, but this module only ever exported `importCmsFile
 * (filePath, userId)` — a different name, a different signature (file path
 * vs in-memory buffer, no cycle_key param), and a different responsibility
 * split (importCmsFile already creates/finalises its own CmsUpload document
 * internally, while the route ALSO tried to create one afterward — a
 * guaranteed double-write that would throw on CmsUpload's unique data_date
 * index the moment importFromCSV existed and succeeded).
 *
 * Fix: extract the shared CSV-parsing/row-mapping/streak-update core into
 * importCore(csvText, userId, providedCycleKey, filename), and expose it
 * through two entry points:
 *   - importCmsFile(filePath, userId)            ← original contract, kept
 *     for any other existing callers; reads the file from disk itself.
 *   - importFromCSV(input, providedCycleKey, userId) ← new contract used by
 *     cmsUploadRoutes.js; accepts a Buffer or string directly (no disk I/O),
 *     and accepts an OPTIONAL cycle_key from the upload form purely as a
 *     sanity cross-check — the cycle_key actually written to records is
 *     always derived from the file's own "Day" column via
 *     DieselCycle.getCycleKeyForDate, exactly like importCmsFile already did,
 *     so a wrong dropdown selection in the UI can never mis-file a day's
 *     data into the wrong cycle. If providedCycleKey disagrees with the
 *     derived one, a warning is added to the result instead of failing.
 *
 * Both entry points return the same {total, imported, skipped, errors,
 * warnings, ...} shape; CmsUpload lifecycle (create on start, finalise on
 * completion) is owned entirely by importCore — callers (the route) must
 * NOT create their own CmsUpload record on top of this.
 */
const csv      = require('csv-parse/sync');
const fs       = require('fs');
const path     = require('path');
const CmsDailyRecord = require('../models/CmsDailyRecord');
const CmsUpload      = require('../models/CmsUpload');
const DieselCycle    = require('../models/DieselCycle');
const DieselAlert    = require('../models/DieselAlert');
const logger   = require('../utils/logger');

// ERS column name → model field
const ERS_MAP = {
  'RegionName':                          'region',
  'SiteName':                            'site_id',
  'ProjectStatus':                       'project_status',
  'PowerTopology':                       'power_topology',
  'Day':                                 'record_date',
  'Grid RH':                             'grid_rh',
  'Grid KWh':                            'grid_kwh',
  'Grid Availability Hr':                'grid_availability_hr',
  'Gen RH':                              'gen_rh',
  'Gen KWh':                             'gen_kwh',
  'Generator Working H':                 'generator_working_h',
  'SiteOnBattery RH':                    'site_on_battery_rh',
  'BatteryCharge KWh':                   'battery_charge_kwh',
  'BatteryDischarge KWh':                'battery_discharge_kwh',
  'Solar RH':                            'solar_rh',
  'SolarWithBB RH':                      'solar_with_bb_rh',
  'SolarWithGrid RH':                    'solar_with_grid_rh',
  'SolarWithGen RH':                     'solar_with_gen_rh',
  'Solar KWh':                           'solar_kwh',
  'TotalPower RH':                       'total_power_rh',
  'TotalPower KWh':                      'total_power_kwh',
  'SiteDown H':                          'site_down_h',
  'Total Hours':                         'total_hours',
  'No Comm. H':                          'no_comm_h',
  'Network Availability H':              'network_availability_h',
  'AVG Tenants KW':                      'avg_tenants_kw',
  'AVG TotalDC KW':                      'avg_total_dc_kw',
  'PUE':                                 'pue',
  'PUE Status':                          'pue_status',
  'FuelConsumption L (W Drop)':          'fuel_consumption_with_drop',
  'FuelConsumption L (W/O Drop)':        'fuel_consumption_without_drop',
  'Fuel Drop L':                         'fuel_drop_l',
  'Refuel L':                            'refuel_l',
  'FuelConsumptionRate L/h (W/O Drop)':  'fuel_consumption_rate',
  'Fuel Level L':                        'fuel_level_l',
};

const NUM_FIELDS = new Set([
  'gen_rh','grid_rh','grid_availability_hr','fuel_consumption_without_drop',
  'fuel_consumption_with_drop','fuel_drop_l','refuel_l','fuel_consumption_rate',
  'fuel_level_l','site_on_battery_rh','solar_rh','total_power_rh','site_down_h',
  'total_hours','no_comm_h','avg_tenants_kw','avg_total_dc_kw','pue',
  'grid_kwh','gen_kwh','battery_charge_kwh','battery_discharge_kwh',
]);

/**
 * Normalise site IDs from CMS (strip trailing M/O suffixes).
 * ERS uses IHS_BNB_001M, our DB uses IHS_BNB_001.
 */
function normaliseSiteId(rawName) {
  if (!rawName) return null;
  return rawName.replace(/[MO]$/, '').trim();
}

/**
 * Shared core: parses CSV text, derives the cycle key from the file's own
 * "Day" column, creates the CmsUpload record, bulk-writes CmsDailyRecord
 * docs, updates zero-grid streaks, and finalises the CmsUpload record.
 *
 * @param {string} csvText           - raw CSV content (already decoded)
 * @param {string} userId            - uploader's ObjectId
 * @param {string|null} providedCycleKey - cycle_key the user selected in the
 *                                          upload form, if any. Used only as
 *                                          a cross-check; never overrides the
 *                                          cycle_key derived from the file.
 * @param {string} filename          - original filename, for CmsUpload/logs
 * @returns {Object} import summary
 */
async function importCore(csvText, userId, providedCycleKey, filename) {
  const start = Date.now();
  const errors = [];
  const warnings = [];
  let sitesProcessed = 0, sitesSkipped = 0;

  // ── Parse CSV ──────────────────────────────────────────────────────────────
  let records;
  try {
    records = csv.parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    throw new Error(`CSV parse failed: ${e.message}`);
  }

  if (!records.length) throw new Error('CSV file is empty');

  // Detect data date from first row
  const rawDate = records[0]['Day'];
  if (!rawDate) throw new Error('CSV has no "Day" column');
  const dataDate = new Date(rawDate);
  if (isNaN(dataDate)) throw new Error(`Invalid date: ${rawDate}`);

  // Determine cycle from the file's own date — authoritative, never
  // overridden by the form's cycle_key (see header note for why).
  const cycleKey = DieselCycle.getCycleKeyForDate(dataDate);
  if (providedCycleKey && providedCycleKey !== cycleKey) {
    warnings.push(
      `Selected cycle "${providedCycleKey}" does not match the cycle derived ` +
      `from this file's date (${rawDate} → "${cycleKey}"). Data was filed ` +
      `under "${cycleKey}".`
    );
  }

  // ── Check duplicate ────────────────────────────────────────────────────────
  const existingUpload = await CmsUpload.findOne({ data_date: dataDate });
  if (existingUpload && existingUpload.status === 'completed') {
    throw new Error(`CMS data for ${rawDate} already imported (upload: ${existingUpload._id})`);
  }

  // ── Create upload record ───────────────────────────────────────────────────
  const upload = await CmsUpload.create({
    filename,
    original_filename: filename,
    data_date: dataDate,
    cycle_key: cycleKey,
    status: 'processing',
    uploaded_by: userId,
  });

  // ── Process rows ───────────────────────────────────────────────────────────
  const ops = [];

  for (const row of records) {
    const rawSiteId = row['SiteName'];
    const siteId    = normaliseSiteId(rawSiteId);
    if (!siteId) { warnings.push(`Skipping row with empty SiteName`); sitesSkipped++; continue; }

    const doc = {
      site_id:         siteId,
      site_name_cms:   rawSiteId,
      record_date:     dataDate,
      cycle_key:       cycleKey,
      upload_id:       upload._id,
      uploaded_by:     userId,
      source_filename: filename,
    };

    // Map all ERS columns
    for (const [ersCol, modelField] of Object.entries(ERS_MAP)) {
      const val = row[ersCol];
      if (val === undefined || val === null || val === '') continue;
      doc[modelField] = NUM_FIELDS.has(modelField) ? parseFloat(val) || 0 : val;
    }

    // Set zero_grid_flag
    doc.zero_grid_flag = (doc.grid_availability_hr || 0) === 0;

    ops.push({
      updateOne: {
        filter: { site_id: siteId, record_date: dataDate },
        update: { $set: doc },
        upsert: true,
      }
    });
    sitesProcessed++;
  }

  // Bulk write
  if (ops.length) await CmsDailyRecord.bulkWrite(ops, { ordered: false });

  // ── Update zero-grid consecutive streaks ───────────────────────────────────
  await updateZeroGridStreaks(cycleKey, dataDate, warnings);

  // ── Finalise upload record ────────────────────────────────────────────────
  const processingMs = Date.now() - start;
  await CmsUpload.findByIdAndUpdate(upload._id, {
    status:           'completed',
    sites_in_file:    records.length,
    sites_processed:  sitesProcessed,
    sites_skipped:    sitesSkipped,
    errors,
    warnings,
    processed_at:     new Date(),
    processing_time_ms: processingMs,
    reconciliation_triggered: true,
  });

  logger.info(`CMS import done: ${sitesProcessed} sites, ${cycleKey}, ${processingMs}ms`);

  return {
    upload_id:        upload._id,
    cycle_key:        cycleKey,
    data_date:        dataDate,
    // Route-facing aliases (cmsUploadRoutes.js / CmsUploadPage.tsx expect
    // total/imported/skipped/errors to build their response & UI panel).
    total:            records.length,
    imported:         sitesProcessed,
    skipped:          sitesSkipped,
    sites_processed:  sitesProcessed,
    sites_skipped:    sitesSkipped,
    errors,
    warnings,
    processing_time_ms: processingMs,
  };
}

/**
 * Original contract — reads a CSV file from disk by path.
 * Kept for any existing callers outside cmsUploadRoutes.js that still
 * invoke this with a file path. Delegates to importCore().
 *
 * @param {string} filePath - absolute path to uploaded CSV
 * @param {string} userId   - uploader's ObjectId
 * @returns {Object}        - upload summary
 */
async function importCmsFile(filePath, userId) {
  const filename = path.basename(filePath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`Failed to read file: ${e.message}`);
  }
  return importCore(raw, userId, null, filename);
}

/**
 * NEW contract — accepts an in-memory Buffer or string directly (no disk
 * I/O), used by cmsUploadRoutes.js for both CSV uploads and XLSX uploads
 * that have already been converted to CSV text by the route.
 *
 * @param {Buffer|string} input        - raw CSV content
 * @param {string|null} cycle_key      - cycle_key selected in the upload
 *                                        form; used only as a cross-check
 *                                        (see importCore for details)
 * @param {string} userId              - uploader's ObjectId
 * @param {string} [filename]          - original filename, for logs/records
 * @returns {Object}                   - upload summary
 */
async function importFromCSV(input, cycle_key, userId, filename = 'upload.csv') {
  const csvText = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  return importCore(csvText, userId, cycle_key || null, filename);
}

/**
 * For each site, recalculate how many consecutive hours the grid has been 0.
 * Looks at the last N daily records ordered by date.
 */
async function updateZeroGridStreaks(cycleKey, dataDate, warnings = []) {
  // Get all sites that have at least one record for this cycle
  const sites = await CmsDailyRecord.distinct('site_id', { cycle_key: cycleKey });

  for (const siteId of sites) {
    // Get records for this site in this cycle, ordered by date desc
    const recs = await CmsDailyRecord
      .find({ site_id: siteId, cycle_key: cycleKey })
      .sort({ record_date: -1 })
      .select('record_date grid_availability_hr zero_grid_flag consecutive_zero_grid_hours')
      .lean();

    // Count consecutive zero-grid days from the most recent record backwards
    let streak = 0;
    for (const r of recs) {
      if (r.zero_grid_flag) {
        // Each daily record represents ~24h of data from CMS
        streak += (r.grid_availability_hr === 0 ? 24 : 0);
      } else {
        break;
      }
    }

    // Update the most recent record with the streak value
    if (recs.length) {
      await CmsDailyRecord.findByIdAndUpdate(recs[0]._id, {
        consecutive_zero_grid_hours: streak,
      });

      // Fire alert if streak >= 24
      if (streak >= 24) {
        await DieselAlert.upsertAlert({
          alert_type: 'ZERO_GRID_24H',
          severity:   streak >= 72 ? 'critical' : 'high',
          site_id:    siteId,
          cycle_key:  cycleKey,
          title:      `Zero Grid Alert — ${siteId}`,
          message:    `Site ${siteId} has had no grid for ${streak} consecutive hours.`,
          data:       { streak_hours: streak, as_of: dataDate },
        });
      }
    }
  }
}

module.exports = { importCmsFile, importFromCSV, updateZeroGridStreaks };

