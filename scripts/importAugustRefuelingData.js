/**
 * importAugustRefuelingData.js
 * PowerGen_API/scripts/importAugustRefuelingData.js
 *
 * Imports the August 2026 refueling activity recorded on the spreadsheet
 * BEFORE the app went live. Creates FuelConsumption records (for liters_used
 * tracking) and FuelRequest records (for the approval/budget trail) so that
 * the dashboard, fuel planning engine, and CMS planning all have accurate
 * starting data for the remainder of the August cycle.
 *
 * SOURCE FILE: August_Refueling_Details_50per_Budget_updated_28_07_2026.xlsx
 *   Sheet1 columns:
 *     A  = IHS Site ID (primary key)
 *     B  = Region
 *     C  = Cluster
 *     D  = Site ID IHS (same as A, use as fallback)
 *     F  = Site Name
 *     G  = Topology
 *     H  = Site Priority
 *     M  = Tank Capacity (L)
 *     N  = CMS RH (MTD generator run hours from CMS)
 *     O  = MTD RH (month-to-date run hours, field data)
 *     P  = RH/Day (average run hours per day)
 *     Q  = Qty Left / Current Tank Level (L)
 *     R  = Date of Last Visit
 *     S  = Data Entry CPH (field-measured consumption per hour)
 *     T  = CCPH (contractual consumption per hour)
 *     V  = Litres DELIVERED on 26-Jul-2026 (CONFIRMED)
 *     W  = Litres DELIVERED on 27-Jul-2026 Douala sites (CONFIRMED)
 *     X  = Litres DELIVERED on 27-Jul-2026 Edea/Pouma sites (CONFIRMED)
 *     Y  = Litres PLANNED for 28-Jul-2026 Douala (in-progress)
 *     Z  = Litres PLANNED for 28-Jul-2026 Edea/Pouma (in-progress)
 *
 * WHAT IT CREATES:
 *   1. FuelConsumption records — one per confirmed delivery (V, W, X columns)
 *      Sets liters_actually_added and updates SiteBudget.liters_used
 *   2. FuelRequest records — one per planned/in-progress delivery (Y, Z)
 *      Status = 'approved' (has been planned but not yet confirmed as done)
 *   3. SiteBudget updates — liters_used and last_visit_stock_l from col Q
 *
 * USAGE:
 *   node scripts/importAugustRefuelingData.js --file path/to/file.xlsx
 *   node scripts/importAugustRefuelingData.js --file path/to/file.xlsx --dry-run
 *   node scripts/importAugustRefuelingData.js --file path/to/file.xlsx --skip-fuel-request
 *
 * SAFE TO RE-RUN: uses upsert logic, will not create duplicates.
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const path     = require('path');
const fs       = require('fs');
let XLSX;
try { XLSX = require('xlsx'); } catch { XLSX = require('exceljs'); }

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const isDryRun    = args.includes('--dry-run');
const skipFR      = args.includes('--skip-fuel-request');
const fileIdx     = args.indexOf('--file');
const XLSX_FILE   = fileIdx > -1
  ? path.resolve(args[fileIdx + 1])
  : path.resolve(__dirname, './August_Refueling_Details_50per_Budget_updated_28_07_2026.xlsx');

const CYCLE_KEY   = '2026-08';
const XAF_PER_L   = 828;

// ── Delivery columns ──────────────────────────────────────────────────────────
// Each entry: { colIndex (1-based), date, status, label }
const DELIVERY_COLS = [
  { col: 22, date: new Date('2026-07-26'), status: 'refueled',  label: '26-Jul (confirmed)' },
  { col: 23, date: new Date('2026-07-27'), status: 'refueled',  label: '27-Jul Douala (confirmed)' },
  { col: 24, date: new Date('2026-07-27'), status: 'refueled',  label: '27-Jul Edea/Pouma (confirmed)' },
  { col: 25, date: new Date('2026-07-28'), status: 'approved',  label: '28-Jul Douala (planned/in-progress)' },
  { col: 26, date: new Date('2026-07-28'), status: 'approved',  label: '28-Jul Edea/Pouma (planned/in-progress)' },
];

function toNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

function toStr(v) {
  return v == null ? '' : String(v).trim();
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function run() {
  // ── Validate file ────────────────────────────────────────────────────────
  if (!fs.existsSync(XLSX_FILE)) {
    console.error('File not found:', XLSX_FILE);
    console.error('Usage: node scripts/importAugustRefuelingData.js --file /path/to/file.xlsx');
    process.exit(1);
  }

  // ── Connect ──────────────────────────────────────────────────────────────
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI not set in .env'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  console.log('Mode:  ', isDryRun ? 'DRY RUN (no writes)' : 'LIVE IMPORT');
  console.log('File:  ', XLSX_FILE);
  console.log('Cycle: ', CYCLE_KEY);
  console.log();

  // ── Load models ──────────────────────────────────────────────────────────
  const SiteBudget     = require('../models/SiteBudget');
  const FuelRequest    = require('../models/FuelRequest');
  const FuelConsumption= require('../models/FuelConsumption');
  const Site           = require('../models/Site');
  const User           = require('../models/User');

  // Find the admin/diesel_manager user to attribute the import to
  const importUser = await User.findOne({
    role: { $in: ['admin', 'diesel_manager'] }
  }).select('_id email').lean();
  const importerId = importUser?._id || null;
  console.log('Importing as:', importUser?.email || 'unknown (no admin user found)');

  // ── Read spreadsheet ─────────────────────────────────────────────────────
  console.log('\nReading spreadsheet...');
  const wb = XLSX.readFile(XLSX_FILE, { cellDates: true, dateNF: 'yyyy-mm-dd' });
  const ws = wb.Sheets['Sheet1'];
  if (!ws) { console.error('Sheet1 not found'); process.exit(1); }

  // Convert sheet to array of arrays (1-indexed rows)
  const rows = XLSX.utils.sheet_to_json(ws, {
    header:  1,
    raw:     false,
    dateNF:  'yyyy-mm-dd',
    defval:  null,
  });

  // Row 2 (index 1) = headers, data starts at row 3 (index 2)
  const dataRows = rows.slice(2).filter(r => r && r.some(v => v != null));
  console.log(`Found ${dataRows.length} data rows`);

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = {
    sites_processed:      0,
    budget_updated:       0,
    fuel_consumption_created: 0,
    fuel_request_created: 0,
    fuel_request_skipped: 0,
    total_liters_confirmed: 0,
    total_liters_planned:   0,
    errors:               [],
  };

  // ── Process each site row ─────────────────────────────────────────────────
  for (const row of dataRows) {
    // Col indices are 0-based in the array (spreadsheet col A = index 0)
    const siteIdA   = toStr(row[0]);   // Col A — IHS Site ID
    const siteIdD   = toStr(row[3]);   // Col D — IHS Site ID (fallback)
    const site_id   = siteIdA || siteIdD;
    if (!site_id || !site_id.startsWith('IHS_')) continue;

    const region    = toStr(row[1]);
    const cluster   = toStr(row[2]);
    const siteName  = toStr(row[5]);
    const topology  = toStr(row[6]);
    const priority  = toStr(row[7]);

    // Raw spreadsheet values
    const tankCap   = toNum(row[12]);  // Col M
    const cms_rh    = toNum(row[13]);  // Col N — CMS RH (MTD)
    const mtd_rh    = toNum(row[14]);  // Col O — MTD RH
    const rh_per_day= toNum(row[15]);  // Col P
    const qty_left  = toNum(row[16]);  // Col Q — current tank level
    const visitDate = parseDate(row[17]); // Col R — date of last data entry
    const cph_field = toNum(row[18]);  // Col S — field CPH
    const ccph      = toNum(row[19]);  // Col T — contractual CPH

    stats.sites_processed++;

    // ── 1. Update SiteBudget with field data ────────────────────────────────
    try {
      const sb = await SiteBudget.findOne({ site_id, cycle_key: CYCLE_KEY });
      if (sb) {
        const updateData = {};
        // Current tank level from spreadsheet (most recent field observation)
        if (qty_left != null && qty_left >= 0) {
          updateData.last_visit_stock_l = qty_left;
        }
        // CMS run hours from field entry
        if (cms_rh != null) updateData.cms_rh_mtd  = cms_rh;
        if (mtd_rh != null) updateData.mtd_rh       = mtd_rh;
        if (rh_per_day != null) updateData.rh_per_day = rh_per_day;
        if (cph_field != null && !isNaN(cph_field)) updateData.ccph_field = cph_field;
        if (visitDate)          updateData.last_visit_date = visitDate;
        if (tankCap != null && !isNaN(tankCap)) updateData.Tank_Capacity = tankCap;

        if (!isDryRun && Object.keys(updateData).length > 0) {
          await SiteBudget.updateOne({ _id: sb._id }, { $set: updateData });
          stats.budget_updated++;
        } else if (isDryRun) {
          stats.budget_updated++;
        }
      }
    } catch (e) {
      stats.errors.push(`SiteBudget update ${site_id}: ${e.message}`);
    }

    // ── 2. Process delivery columns ─────────────────────────────────────────
    for (const dcol of DELIVERY_COLS) {
      const rawVal = row[dcol.col - 1]; // col index is 1-based, array is 0-based
      const liters = toNum(rawVal);

      // Skip null, zero, or negative values (negatives are data entry notes)
      if (liters == null || liters <= 0) continue;

      const isConfirmed = dcol.status === 'refueled';

      if (isConfirmed) {
        // ── Create FuelConsumption record (actual delivery) ──────────────
        stats.total_liters_confirmed += liters;

        try {
          // Check for duplicate: same site + same date + same liters
          const existingFC = await FuelConsumption.findOne({
            site_id,
            cycle_key:     CYCLE_KEY,
            record_date:   dcol.date,
            'fuel_data.fuel_added': liters,
          });

          if (existingFC) {
            // Already imported
            continue;
          }

          const fcDoc = {
            site_id,
            cycle_key:    CYCLE_KEY,
            record_date:  dcol.date,
            visit_date:   dcol.date,
            submitted_at: new Date(),
            technician:   importerId,
            status:       'completed',
            source:       'spreadsheet_import',
            import_note:  `Imported from August spreadsheet (${dcol.label})`,
            fuel_data: {
              fuel_added:            liters,
              fuel_found:            qty_left || 0,
              closing_level:         (qty_left || 0) + liters,
              tank_capacity:         tankCap || null,
              consumption_rate_cph:  cph_field || ccph || null,
            },
            site_name:    siteName,
            cluster,
            region,
          };

          if (!isDryRun) {
            await FuelConsumption.create(fcDoc);

            // Update SiteBudget.liters_used
            const sb = await SiteBudget.findOne({ site_id, cycle_key: CYCLE_KEY });
            if (sb) {
              await SiteBudget.updateOne({ _id: sb._id }, {
                $inc: { liters_used: liters },
                $set: { last_visit_date: dcol.date, last_visit_stock_l: qty_left || 0 },
              });
            }
          }
          stats.fuel_consumption_created++;

        } catch (e) {
          stats.errors.push(`FuelConsumption ${site_id} ${dcol.label}: ${e.message}`);
        }

      } else if (!skipFR) {
        // ── Create FuelRequest for planned/in-progress deliveries ────────
        stats.total_liters_planned += liters;

        try {
          // Check if a FuelRequest for this site already exists this cycle
          const existingFR = await FuelRequest.findOne({
            site_id,
            cycle_key:  CYCLE_KEY,
            status:     { $in: ['approved', 'scheduled', 'purchase_made', 'refueled', 'completed'] },
          });

          if (existingFR) {
            stats.fuel_request_skipped++;
            continue;
          }

          // Also skip if already imported from this spreadsheet
          const importedFR = await FuelRequest.findOne({
            site_id,
            cycle_key: CYCLE_KEY,
            auto_generated: true,
            import_note:   { $regex: 'spreadsheet_import' },
          });
          if (importedFR) { stats.fuel_request_skipped++; continue; }

          const sb = await SiteBudget.findOne({ site_id, cycle_key: CYCLE_KEY }).lean();

          const frDoc = {
            site_id,
            site_name:        siteName,
            cluster,
            region,
            cycle_key:        CYCLE_KEY,
            liters_requested: liters,
            liters_approved:  liters,  // Pre-approved — from the spreadsheet plan
            xaf_requested:    Math.round(liters * (sb?.xaf_per_liter || XAF_PER_L)),
            xaf_approved:     Math.round(liters * (sb?.xaf_per_liter || XAF_PER_L)),
            urgency:          'high',
            status:           'scheduled',  // Planned but not yet executed
            request_reason:   `Pre-cycle delivery planned before app launch. Spreadsheet source: ${dcol.label}.`,
            current_fuel_level: qty_left || null,
            tank_capacity:    tankCap || null,
            requested_by_name:'Spreadsheet Import',
            auto_generated:   true,
            import_note:      `spreadsheet_import|${dcol.label}|${new Date().toISOString()}`,
            // Skip the approval chain — already approved offline
            approvalChain: [{
              level:      1, name: 'Minka Kevin',
              email:      'minka.kevin@gratoglobal.com',
              status:     'approved',
              approved_at: dcol.date,
              comment:    'Pre-approved via spreadsheet',
            }],
          };

          if (!isDryRun) {
            await FuelRequest.create(frDoc);
          }
          stats.fuel_request_created++;

        } catch (e) {
          stats.errors.push(`FuelRequest ${site_id} ${dcol.label}: ${e.message}`);
        }
      }
    }
  }

  // ── Print summary ─────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('─'.repeat(60));
  console.log(`Sites processed:               ${stats.sites_processed}`);
  console.log(`SiteBudget records updated:    ${stats.budget_updated}`);
  console.log();
  console.log('CONFIRMED DELIVERIES (26–27 Jul):');
  console.log(`  FuelConsumption records:     ${stats.fuel_consumption_created}`);
  console.log(`  Total litres recorded:       ${stats.total_liters_confirmed.toLocaleString()}L`);
  console.log(`  liters_used updated on:      SiteBudget documents`);
  console.log();
  console.log('PLANNED DELIVERIES (28 Jul — in progress):');
  console.log(`  FuelRequest records created: ${stats.fuel_request_created}`);
  console.log(`  FuelRequest records skipped: ${stats.fuel_request_skipped} (already existed)`);
  console.log(`  Total litres planned:        ${stats.total_liters_planned.toLocaleString()}L`);
  console.log();

  if (stats.errors.length > 0) {
    console.log(`ERRORS (${stats.errors.length}):`);
    stats.errors.slice(0, 20).forEach(e => console.log('  ❌', e));
    if (stats.errors.length > 20) console.log(`  ... and ${stats.errors.length - 20} more`);
  } else {
    console.log('No errors ✅');
  }

  if (isDryRun) {
    console.log('\n⚠️  DRY RUN — no data was written. Remove --dry-run to commit.');
  } else {
    console.log('\n✅ Data imported successfully.');
    console.log('   The dashboard, fuel planning engine, and reconciliation');
    console.log('   will now reflect the pre-launch deliveries for August 2026.');
    console.log('\nNext steps:');
    console.log('  1. Verify: GET /api/site-budget/2026-08/aggregate');
    console.log('  2. Check dashboard shows liters_used > 0 for delivered sites');
    console.log('  3. Use the app normally — these records will not conflict');
    console.log('     with new deliveries entered through the app.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});