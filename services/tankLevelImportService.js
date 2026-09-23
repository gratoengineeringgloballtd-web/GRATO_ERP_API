/**
 * tankLevelImportService.js
 *
 * Parses the daily RMS/telemetry tank-level export (see
 * models/TankLevelReading.js for the full column-shape explanation) and
 * upserts one TankLevelReading per site per day.
 *
 * On successful import, also refreshes Site.Fuel_Quantity_Found for every
 * site with a valid ('ok' status) reading — this is the freshest,
 * highest-frequency current-fuel-level source available (daily telemetry
 * vs. field-visit snapshots that go stale between visits), so it becomes
 * the live "current level" the rest of the app already reads from
 * (mobile home screen, fuel request creation, fuel planning).
 */

'use strict';

const csv = require('csv-parse/sync');
const Site = require('../models/Site');
const TankLevelReading = require('../models/TankLevelReading');
const TankLevelUpload = require('../models/TankLevelUpload');
const DieselCycle = require('../models/DieselCycle');

const VALID_QUANT_DEVICES = new Set(['Fuel', 'EyeSiteP Fuel']);

function normaliseSiteId(rawName) {
  if (!rawName) return null;
  return String(rawName).replace(/[MO]$/, '').trim();
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

/**
 * Groups raw CSV rows by (normalized) site, keeping only the real
 * quantity readings, and sums valid tank values per site.
 */
function groupBySite(rows) {
  const bySite = new Map();

  for (const row of rows) {
    const rawSiteName = row.SiteName;
    const siteId = normaliseSiteId(rawSiteName);
    if (!siteId) continue;

    // Only "Quant" rows from a real fuel-sensor device are actual
    // readings. "Cover"/"Alert"/"TSS Energy Card" rows are sensor/cover
    // status flags (always value 0, no timestamp) — not fuel quantities.
    if (row.Location !== 'Quant' || !VALID_QUANT_DEVICES.has(row.Device)) continue;

    if (!bySite.has(siteId)) {
      bySite.set(siteId, {
        site_id: siteId,
        raw_name: rawSiteName,
        region: row.RegionName || null,
        site_status_type: row.SiteStatusType || null,
        tanks: [],
      });
    }
    const entry = bySite.get(siteId);
    const value = toNum(row.Value);
    entry.tanks.push({
      controller_ext: row.ControllerComponentExtention || null,
      value_l: value,
      timestamp: toDate(row.Column1),
      device: row.Device,
    });
  }

  return bySite;
}

/**
 * Import a tank-level CSV buffer/string.
 *
 * @param {Buffer|string} fileInput
 * @param {string} readingDate - YYYY-MM-DD this file represents (required —
 *   the file itself carries per-row timestamps but no single "as-of" date
 *   header, so like the Site Budget upload, the caller must supply it)
 * @param {string} uploadedById
 * @param {string} filename
 */
async function importTankLevelFile(fileInput, readingDate, uploadedById, filename = 'tank-levels.csv') {
  const start = Date.now();
  const text = Buffer.isBuffer(fileInput) ? fileInput.toString('utf8') : fileInput;

  const uploadDoc = await TankLevelUpload.create({
    filename,
    reading_date: readingDate,
    status: 'processing',
    uploaded_by: uploadedById,
  });

  const errors = [];
  const warnings = [];
  let rowsTotal = 0;
  let sitesOk = 0;
  let sitesSensorError = 0;
  let sitesSkipped = 0;

  try {
    const rawRows = csv.parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    rowsTotal = rawRows.length;

    const bySite = groupBySite(rawRows);

    // Look up every referenced site in one query, and derive cycle_key
    // from the reading date rather than trusting client input.
    const siteIds = [...bySite.keys()];
    const sites = await Site.find({ IHS_ID_SITE: { $in: siteIds } })
      .select('IHS_ID_SITE GRATO_Cluster Tank_Capacity_1')
      .lean();
    const siteById = new Map(sites.map(s => [s.IHS_ID_SITE, s]));
    const cycleKey = DieselCycle.getCycleKeyForDate(new Date(readingDate));

    const bulkOps = [];
    const siteFuelUpdates = []; // { site_id, fuel_level_l } for the Site.Fuel_Quantity_Found refresh

    for (const [siteId, entry] of bySite) {
      const site = siteById.get(siteId);
      if (!site) {
        sitesSkipped++;
        warnings.push(`Site ${siteId} (raw "${entry.raw_name}") not found in Site collection — reading skipped.`);
        continue;
      }

      const validValues = entry.tanks.filter(t => t.value_l !== null && t.value_l >= 0);
      const latestTimestamp = entry.tanks
        .map(t => t.timestamp)
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;

      let fuel_level_l = null;
      let status = 'no_reading';
      if (validValues.length > 0) {
        fuel_level_l = validValues.reduce((s, t) => s + t.value_l, 0);
        status = 'ok';
        sitesOk++;
      } else if (entry.tanks.length > 0) {
        // Every tank at this site reported an error code (e.g. -1) or was
        // otherwise unusable — a real, flaggable data-quality event, not
        // silently treated as 0L.
        status = 'sensor_error';
        sitesSensorError++;
      } else {
        sitesSkipped++;
      }

      bulkOps.push({
        updateOne: {
          filter: { site_id: siteId, reading_date: readingDate },
          update: {
            $set: {
              site_id: siteId,
              site_name: entry.raw_name,
              region: entry.region,
              cluster: site.GRATO_Cluster || null,
              reading_date: readingDate,
              reading_time: latestTimestamp,
              cycle_key: cycleKey,
              fuel_level_l,
              tank_count: entry.tanks.length,
              tanks: entry.tanks,
              status,
              site_status_type: entry.site_status_type,
              upload_id: uploadDoc._id,
            },
          },
          upsert: true,
        },
      });

      if (status === 'ok') {
        siteFuelUpdates.push({ site_id: siteId, fuel_level_l });
      }
    }

    if (bulkOps.length > 0) {
      await TankLevelReading.bulkWrite(bulkOps, { ordered: false });
    }

    // Refresh Site.Fuel_Quantity_Found with the freshest telemetry value
    // for every site with a valid reading. Non-fatal if this step fails —
    // the TankLevelReading records themselves (the source of truth) are
    // already saved above regardless.
    let sitesRefreshed = 0;
    try {
      if (siteFuelUpdates.length > 0) {
        const siteBulkOps = siteFuelUpdates.map(u => ({
          updateOne: {
            filter: { IHS_ID_SITE: u.site_id },
            update: { $set: { Fuel_Quantity_Found: u.fuel_level_l, Fuel_Level_Source: 'tank_telemetry', Fuel_Level_Updated_At: new Date() } },
          },
        }));
        const result = await Site.bulkWrite(siteBulkOps, { ordered: false });
        sitesRefreshed = (result.modifiedCount || 0) + (result.upsertedCount || 0);
      }
    } catch (siteUpdateErr) {
      warnings.push(`Site.Fuel_Quantity_Found refresh failed (readings were still saved): ${siteUpdateErr.message}`);
    }

    await TankLevelUpload.findByIdAndUpdate(uploadDoc._id, {
      status: errors.length > 0 ? 'failed' : 'completed',
      cycle_key: cycleKey,
      rows_total: rowsTotal,
      sites_ok: sitesOk,
      sites_sensor_error: sitesSensorError,
      sites_skipped: sitesSkipped,
      errors,
      warnings,
      processed_at: new Date(),
    });

    return {
      upload_id: uploadDoc._id,
      cycle_key: cycleKey,
      rows_total: rowsTotal,
      sites_ok: sitesOk,
      sites_sensor_error: sitesSensorError,
      sites_skipped: sitesSkipped,
      sites_refreshed: sitesRefreshed,
      errors,
      warnings,
      elapsed_ms: Date.now() - start,
    };
  } catch (err) {
    await TankLevelUpload.findByIdAndUpdate(uploadDoc._id, {
      status: 'failed',
      errors: [err.message],
      processed_at: new Date(),
    });
    throw err;
  }
}

module.exports = { importTankLevelFile, normaliseSiteId };
