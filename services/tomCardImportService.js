/**
 * tomCardImportService.js
 * Parses Tom Card fuel purchase CSV → TomCardTransaction documents.
 * Links transactions to clusters/sites via TomCardMapping.
 *
 * BUG FIX: "The \"path\" argument must be of type string. Received undefined"
 *
 * Root cause: importTomCardFile(filePath, ...) called fs.readFileSync(filePath,
 * 'utf8') — it required a file path on disk. But tomCardRoutes.js calls
 * uploadTomCard.single('file'), and uploadTomCard is an alias for the shared
 * csvOrExcel multer instance in config/upload.js, which uses
 * multer.memoryStorage() — that storage engine only ever sets req.file.buffer,
 * never req.file.path. The route was passing req.file.path (always undefined
 * under memoryStorage) straight into fs.readFileSync, which threw immediately.
 *
 * Fix (same pattern as cmsImportService.js's importFromCSV addition): split
 * the shared parsing/import core out of the disk-reading wrapper and expose
 * a new importFromBuffer(buffer, userId, cycleKeyOverride, filename) entry
 * point that accepts the in-memory buffer the route already has. The
 * original importTomCardFile(filePath, ...) is kept, now as a thin wrapper
 * around the same core, for any other caller that still has a real file path.
 */
const csv     = require('csv-parse/sync');
const fs      = require('fs');
const path    = require('path');
const TomCardTransaction         = require('../models/TomCardTransaction');
const { TomCardMapping, TomCardUpload } = require('../models/TomCardMapping');
const DieselCycle                = require('../models/DieselCycle');
const logger  = require('../utils/logger');

// Station name → default cluster hint (geographic approximation)
// Override via TomCardMapping for precise site-level mapping
const STATION_CLUSTER_HINTS = {
  'TOTALENERGIES EDEA':     'Edea',
  'TOTAL WOURI 2':          'Bonaberi 1',
  'TOTALENERGIES CARREFOUR':'Bonaberi 2',
  'TOTALENERGIES FOCH':     'Bonaberi 2',
  'TOTALENERGIES BEPANDA':  'Bonaberi 2',
};

/**
 * Parse a date string in DD/MM/YYYY or MM/DD/YYYY format.
 */
function parseDate(str) {
  if (!str) return null;
  // Try DD/MM/YYYY (most common in Cameroon TotalEnergies statements)
  const parts = str.split('/');
  if (parts.length === 3) {
    const d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2]);
    if (d > 12) return new Date(y, m - 1, d); // definitely DD/MM/YYYY
    return new Date(y, m - 1, d); // assume DD/MM/YYYY
  }
  return new Date(str);
}

/**
 * Shared core: parses CSV text (already decoded from a buffer or read from
 * disk — caller's choice), creates the TomCardUpload record, bulk-writes
 * TomCardTransaction docs, and finalises the upload record.
 *
 * @param {string} csvText            - raw CSV content (already decoded)
 * @param {string} userId             - uploader's ObjectId
 * @param {string|null} cycleKeyOverride
 * @param {string} filename           - original filename, for TomCardUpload/logs
 * @returns {Object} import summary
 */
async function importCore(csvText, userId, cycleKeyOverride, filename) {
  const start = Date.now();
  const errors = [], warnings = [];
  let imported = 0, duplicates = 0;

  // Load all card mappings into memory for fast lookup
  const mappings = await TomCardMapping.find({ is_active: true }).lean();
  const cardMap  = {};
  for (const m of mappings) {
    cardMap[String(m.card_num)] = m;
  }

  // Parse CSV
  let records;
  try {
    // Handle BOM
    const cleaned = csvText.replace(/^\uFEFF/, '');
    records = csv.parse(cleaned, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: ';',  // TotalEnergies uses semicolons
    });
    // Fallback: try comma
    if (!records[0]?.['Card num.'] && !records[0]?.['card num.']) {
      records = csv.parse(cleaned, { columns: true, skip_empty_lines: true, trim: true });
    }
  } catch (e) {
    throw new Error(`CSV parse failed: ${e.message}`);
  }

  if (!records.length) throw new Error('File is empty or unreadable');

  // Detect date range for upload record
  const dates = records.map(r => parseDate(r['Date'])).filter(Boolean);
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));

  const upload = await TomCardUpload.create({
    filename,
    original_filename: filename,
    cycle_key: cycleKeyOverride || DieselCycle.getCycleKeyForDate(maxDate),
    date_range_start: minDate,
    date_range_end:   maxDate,
    status: 'processing',
    uploaded_by: userId,
  });

  const ops = [];
  let totalLiters = 0, totalCFA = 0;

  for (const row of records) {
    const cardNum   = String(row['Card num.'] || row['Card Num'] || '').trim();
    const dateRaw   = row['Date'] || row['date'] || '';
    const txDate    = parseDate(dateRaw);
    if (!cardNum || !txDate || isNaN(txDate)) { errors.push(`Skipping row — bad card/date: ${JSON.stringify(row)}`); continue; }

    const cycleKey  = cycleKeyOverride || DieselCycle.getCycleKeyForDate(txDate);
    const qty       = parseFloat(row['Quantity'] || 0);
    const amount    = parseFloat(row['Amount']   || 0);
    const station   = String(row['Place'] || '').trim().toUpperCase();
    const receiptNum = String(row['Receipt num.'] || row['receipt num'] || `${cardNum}-${dateRaw}-${qty}`).trim();

    // Determine mapping
    const mapping   = cardMap[cardNum];
    const cluster   = mapping?.cluster || STATION_CLUSTER_HINTS[station] || null;
    const siteId    = mapping?.site_ids?.[0] || null;
    const mapConf   = mapping ? 'mapped' : (cluster ? 'station_match' : 'unlinked');

    totalLiters += qty;
    totalCFA    += amount;

    ops.push({
      updateOne: {
        filter: { receipt_num: receiptNum, card_num: cardNum },
        update: { $setOnInsert: {
          card_num:        cardNum,
          card_name:       row['Card name']         || '',
          card_type:       row['Card type']         || '',
          customer_num:    row['Customer num.']     || '',
          customer:        row['Customer']          || '',
          date:            txDate,
          hour:            row['Hour']              || '',
          driver_code:     row['Driver code']       || '',
          registration_num: row['Registration num.']|| '',
          receipt_num:     receiptNum,
          product_code:    row['Product code']      || '',
          product:         row['Product']           || '',
          unit_price:      parseFloat(row['Unit price'] || 0),
          quantity_l:      qty,
          amount_cfa:      amount,
          currency:        row['Currency']          || 'XAF',
          station_num:     row['Station num.']      || '',
          station_name:    row['Place']             || '',
          invoice_num:     row['Invoice num.']      || '',
          cycle_key:       cycleKey,
          site_id:         siteId,
          cluster:         cluster,
          mapping_confidence: mapConf,
          reconciled:      false,
          upload_id:       upload._id,
          uploaded_by:     userId,
        }},
        upsert: true,
      }
    });
    imported++;
  }

  const result = await TomCardTransaction.bulkWrite(ops, { ordered: false });
  duplicates = result.upsertedCount < imported ? imported - result.upsertedCount : 0;

  const ms = Date.now() - start;
  await TomCardUpload.findByIdAndUpdate(upload._id, {
    status:           'completed',
    rows_in_file:     records.length,
    rows_imported:    result.upsertedCount,
    rows_duplicate:   duplicates,
    total_liters:     totalLiters,
    total_amount_cfa: totalCFA,
    errors, warnings,
    processed_at: new Date(),
  });

  logger.info(`TomCard import: ${result.upsertedCount} new, ${duplicates} dups, ${ms}ms`);
  return {
    upload_id:     upload._id,
    rows_imported: result.upsertedCount,
    rows_duplicate: duplicates,
    total_liters:  totalLiters,
    total_amount_cfa: totalCFA,
    errors, warnings,
  };
}

/**
 * Original contract — reads a CSV file from disk by path. Kept for any
 * other existing caller that still has a real file path. Delegates to
 * importCore().
 */
async function importTomCardFile(filePath, userId, cycleKeyOverride = null) {
  const filename = path.basename(filePath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`Failed to read file: ${e.message}`);
  }
  return importCore(raw, userId, cycleKeyOverride, filename);
}

/**
 * NEW contract — accepts an in-memory Buffer or string directly (no disk
 * I/O). This is what tomCardRoutes.js should call, since its multer
 * instance (uploadTomCard, an alias of csvOrExcel) uses memoryStorage and
 * only ever populates req.file.buffer, never req.file.path.
 *
 * @param {Buffer|string} input
 * @param {string} userId
 * @param {string|null} [cycleKeyOverride]
 * @param {string} [filename]
 */
async function importFromBuffer(input, userId, cycleKeyOverride = null, filename = 'tomcard.csv') {
  const csvText = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  return importCore(csvText, userId, cycleKeyOverride, filename);
}

module.exports = { importTomCardFile, importFromBuffer };

