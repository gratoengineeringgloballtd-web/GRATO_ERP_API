'use strict';

const multer = require('multer');
const path   = require('path');

// ── Storage: always memory — routes handle buffer directly ────────────────────
const memoryStorage = multer.memoryStorage();

// ── File filters ──────────────────────────────────────────────────────────────

/** Accept only CSV */
function csvFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.csv' || file.mimetype === 'text/csv' || file.mimetype === 'application/csv') {
    cb(null, true);
  } else {
    cb(new Error('Only CSV files are accepted'), false);
  }
}

/** Accept only Excel (.xlsx / .xls) */
function excelFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const excelMimes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // .xlsx
    'application/vnd.ms-excel',                                             // .xls
    'application/octet-stream',                                             // generic binary
  ];
  if (['.xlsx', '.xls'].includes(ext) || excelMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files (.xlsx, .xls) are accepted'), false);
  }
}

/** Accept CSV OR Excel — used by CMS and GRATO routes */
function csvOrExcelFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = ['.csv', '.xlsx', '.xls'];
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Only CSV or Excel files are accepted (got ${ext || 'unknown'})`), false);
  }
}

// ── Multer instances ──────────────────────────────────────────────────────────
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

const csvOnly = multer({
  storage:    memoryStorage,
  limits:     { fileSize: MAX_SIZE },
  fileFilter: csvFilter,
});

const excelOnly = multer({
  storage:    memoryStorage,
  limits:     { fileSize: MAX_SIZE },
  fileFilter: excelFilter,
});

const csvOrExcel = multer({
  storage:    memoryStorage,
  limits:     { fileSize: MAX_SIZE },
  fileFilter: csvOrExcelFilter,
});

// ── Default export: csvOrExcel so existing `require('../config/upload')` works ─
module.exports = csvOrExcel;

// Named exports for routes that need a specific type
module.exports.csvOnly    = csvOnly;
module.exports.excelOnly  = excelOnly;
module.exports.csvOrExcel = csvOrExcel;

// Legacy aliases — routes that destructure a named instance by the old export name
module.exports.uploadCms     = csvOrExcel;   // cmsUploadRoutes (if not yet patched)
module.exports.uploadTomCard = csvOrExcel;   // tomCardRoutes: accepts CSV + Excel statements

// Filter functions (exposed for testing or custom multer instances)
module.exports.csvFilter        = csvFilter;
module.exports.excelFilter      = excelFilter;
module.exports.csvOrExcelFilter = csvOrExcelFilter;




