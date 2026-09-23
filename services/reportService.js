/**
 * reportService.js
 * Generates Excel reports for the diesel reconciliation system.
 * Three report types:
 *   - Cycle Report:   one sheet per cluster, all sites, full KPI breakdown
 *   - Site Report:    deep-dive for one site — KPIs, daily CMS log, field visits
 *   - Tom Card Report: all fuel purchase transactions with cluster mapping totals
 */

const ExcelJS           = require('exceljs');
const CycleReconciliation = require('../models/CycleReconciliation');
const CmsDailyRecord    = require('../models/CmsDailyRecord');
const FieldVisitRecord  = require('../models/FieldVisitRecord');
const TomCardTransaction = require('../models/TomCardTransaction');
const DieselCycle       = require('../models/DieselCycle');
const SiteBudget        = require('../models/SiteBudget');

// ─── Style helpers ────────────────────────────────────────────────────────────

const COLORS = {
  headerBg:   'FF1F3864',   // dark navy
  headerFont: 'FFFFFFFF',   // white
  subBg:      'FFD6E4F0',   // light blue
  alertRed:   'FFFFC7CE',
  alertAmber: 'FFFFEB9C',
  alertGreen: 'FFC6EFCE',
  rowAlt:     'FFF2F7FB',
  clusterBg:  'FF2E75B6',   // mid-blue for cluster header rows
};

function headerStyle(bgHex = COLORS.headerBg) {
  return {
    font:      { bold: true, color: { argb: COLORS.headerFont }, name: 'Arial', size: 10 },
    fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: bgHex } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border:    thinBorder(),
  };
}

function cellStyle(altRow = false) {
  return {
    font:      { name: 'Arial', size: 9 },
    fill:      altRow
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.rowAlt } }
      : { type: 'pattern', pattern: 'none' },
    alignment: { vertical: 'middle' },
    border:    thinBorder(),
  };
}

function thinBorder() {
  const s = { style: 'thin', color: { argb: 'FFD0D0D0' } };
  return { top: s, left: s, bottom: s, right: s };
}

function alertFill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function fmtNum(v, dec = 0) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Number(v).toFixed(dec);
}

function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (Number(v) * 100).toFixed(1) + '%';
}

function applyRowColor(row, argb) {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  });
}

// ─── Cycle Report ─────────────────────────────────────────────────────────────

/**
 * Full cycle report — one sheet per cluster.
 * Columns: Site ID | Site Name | Topology | DG KVA | CCPH |
 *          Budget RH | Final RH | RH Src | CMS RH | Field RH | RH Var% |
 *          Budget L | Contractual L | CMS Cons L | Field Cons L | Cons Var% | Cons Status |
 *          Tom Card L | Refuel CMS Var | Theft L |
 *          Grid Avail% | Grid Target% | Zero Grid h |
 *          Alert Count | Alerts
 */
async function generateCycleReport(cycle_key) {
  const cycle = await DieselCycle.findOne({ cycle_key });
  if (!cycle) throw new Error(`Cycle ${cycle_key} not found`);

  const recons = await CycleReconciliation
    .find({ cycle_key })
    .sort({ cluster: 1, site_id: 1 })
    .lean();

  // Group by cluster
  const byCluster = {};
  for (const r of recons) {
    const cl = r.cluster || 'Unknown';
    if (!byCluster[cl]) byCluster[cl] = [];
    byCluster[cl].push(r);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'PowerGen Diesel System';
  wb.created  = new Date();

  // ── Summary sheet ──────────────────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary', { tabColor: { argb: 'FF1F3864' } });
  summary.mergeCells('A1:F1');
  const titleCell = summary.getCell('A1');
  titleCell.value     = `Diesel Cycle Report — ${cycle.label}`;
  titleCell.font      = { bold: true, size: 14, name: 'Arial', color: { argb: COLORS.headerFont } };
  titleCell.fill      = alertFill(COLORS.headerBg);
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summary.getRow(1).height = 30;

  const sHeaders = ['Cluster', 'Sites', 'Total Budget (L)', 'Total Contractual (L)', 'Total CMS Cons (L)', 'Alert Sites'];
  const sHRow = summary.getRow(3);
  sHeaders.forEach((h, i) => {
    const cell = sHRow.getCell(i + 1);
    cell.value = h;
    Object.assign(cell, headerStyle());
  });
  summary.columns = [
    { key: 'cluster', width: 20 },
    { key: 'sites',   width: 10 },
    { key: 'budget',  width: 20 },
    { key: 'contract',width: 22 },
    { key: 'cms',     width: 22 },
    { key: 'alerts',  width: 14 },
  ];

  let sRow = 4;
  for (const [cl, sites] of Object.entries(byCluster)) {
    const row = summary.getRow(sRow++);
    row.getCell(1).value = cl;
    row.getCell(2).value = sites.length;
    row.getCell(3).value = sites.reduce((s, r) => s + (r.budget_liters || 0), 0);
    row.getCell(4).value = sites.reduce((s, r) => s + (r.contractual_consumption || 0), 0);
    row.getCell(5).value = sites.reduce((s, r) => s + (r.cms_consumption || 0), 0);
    row.getCell(6).value = sites.filter(r => r.alert_count > 0).length;
    row.eachCell({ includeEmpty: true }, c => Object.assign(c, cellStyle(sRow % 2 === 0)));
    row.getCell(3).numFmt = '#,##0';
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).numFmt = '#,##0';
  }

  // ── One sheet per cluster ──────────────────────────────────────────────────
  const columns = [
    { header: 'Site ID',        key: 'site_id',       width: 16 },
    { header: 'Site Name',      key: 'site_name',     width: 22 },
    { header: 'Topology',       key: 'topology',      width: 14 },
    { header: 'DG KVA',        key: 'dg_kva',        width: 10 },
    { header: 'CCPH (L/h)',    key: 'ccph',           width: 11 },
    { header: 'Budget RH',     key: 'budgeted_rh',   width: 11 },
    { header: 'Final RH',      key: 'final_rh',      width: 11 },
    { header: 'RH Source',     key: 'rh_source',     width: 13 },
    { header: 'CMS RH',       key: 'cms_rh',         width: 11 },
    { header: 'Field RH',     key: 'field_rh',       width: 11 },
    { header: 'RH Var%',      key: 'rh_var_pct',    width: 10 },
    { header: 'Budget (L)',   key: 'budget_liters',  width: 13 },
    { header: 'Contractual (L)', key: 'contractual', width: 16 },
    { header: 'CMS Cons (L)', key: 'cms_cons',      width: 15 },
    { header: 'Field Cons (L)',key: 'field_cons',    width: 15 },
    { header: 'Cons Var%',    key: 'cons_var_pct',  width: 11 },
    { header: 'Cons Status',  key: 'cons_status',   width: 13 },
    { header: 'Tom Card (L)', key: 'tomcard',       width: 14 },
    { header: 'Refuel vs CMS', key: 'refuel_var',   width: 15 },
    { header: 'Theft (L)',    key: 'theft',          width: 12 },
    { header: 'Grid Avail%',  key: 'grid_avail',    width: 13 },
    { header: 'Grid Target%', key: 'grid_target',   width: 13 },
    { header: 'Zero Grid h',  key: 'zero_grid',     width: 13 },
    { header: 'Alert Count',  key: 'alert_count',   width: 12 },
    { header: 'Active Alerts',key: 'alerts',        width: 35 },
  ];

  for (const [cl, sites] of Object.entries(byCluster)) {
    const ws = wb.addWorksheet(cl.substring(0, 31), { tabColor: { argb: COLORS.clusterBg } });
    ws.columns = columns;

    // Title row
    ws.mergeCells(`A1:Y1`);
    const t = ws.getCell('A1');
    t.value     = `${cl} — ${cycle.label}  (${sites.length} sites)`;
    t.font      = { bold: true, size: 12, color: { argb: COLORS.headerFont }, name: 'Arial' };
    t.fill      = alertFill(COLORS.clusterBg);
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    // Header row
    const hRow = ws.getRow(2);
    hRow.height = 36;
    columns.forEach((col, i) => {
      const cell = hRow.getCell(i + 1);
      cell.value = col.header;
      Object.assign(cell, headerStyle());
    });

    let rowIdx = 3;
    for (const r of sites) {
      const activeAlerts = r.alerts
        ? Object.entries(r.alerts).filter(([, v]) => v).map(([k]) => k).join(', ')
        : '';

      const row = ws.getRow(rowIdx);
      row.height = 18;

      const vals = [
        r.site_id, r.site_name, r.topology, r.dg_kva,
        r.ccph,
        r.budgeted_rh    !== null ? +fmtNum(r.budgeted_rh, 1)    : null,
        r.final_rh       !== null ? +fmtNum(r.final_rh, 1)       : null,
        r.rh_source,
        r.cms_rh         !== null ? +fmtNum(r.cms_rh, 1)         : null,
        r.field_rh       !== null ? +fmtNum(r.field_rh, 1)       : null,
        r.rh_variance_pct !== null ? r.rh_variance_pct           : null,
        r.budget_liters,
        r.contractual_consumption !== null ? +fmtNum(r.contractual_consumption, 0) : null,
        r.cms_consumption !== null ? +fmtNum(r.cms_consumption, 0)   : null,
        r.field_consumption_actual !== null ? +fmtNum(r.field_consumption_actual, 0) : null,
        r.cons_variance_pct !== null ? r.cons_variance_pct       : null,
        r.cons_status,
        r.tomcard_purchased !== null ? +fmtNum(r.tomcard_purchased, 0) : null,
        r.refuel_field_vs_cms_var !== null ? +fmtNum(r.refuel_field_vs_cms_var, 0) : null,
        r.theft_liters   !== null ? +fmtNum(r.theft_liters, 0)   : null,
        r.grid_avail_actual !== null ? r.grid_avail_actual       : null,
        r.grid_avail_target !== null ? r.grid_avail_target       : null,
        r.zero_grid_max_streak,
        r.alert_count,
        activeAlerts,
      ];

      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v !== undefined ? v : null;
        Object.assign(cell, cellStyle(rowIdx % 2 === 0));
      });

      // Number formats
      row.getCell(11).numFmt = '0.0%';   // RH Var%
      row.getCell(16).numFmt = '0.0%';   // Cons Var%
      row.getCell(21).numFmt = '0.0%';   // Grid Avail%
      row.getCell(22).numFmt = '0.0%';   // Grid Target%

      // Alert colouring
      if (r.alerts?.theft_suspected) applyRowColor(row, COLORS.alertRed);
      else if (r.alerts?.low_fuel)   applyRowColor(row, COLORS.alertRed);
      else if (r.alert_count > 2)    applyRowColor(row, COLORS.alertAmber);
      else if (r.alert_count === 0)  applyRowColor(row, COLORS.alertGreen);

      // Cons status cell
      const consCell = row.getCell(17);
      if (r.cons_status === 'over')  consCell.fill = alertFill(COLORS.alertRed);
      if (r.cons_status === 'under') consCell.fill = alertFill(COLORS.alertAmber);
      if (r.cons_status === 'ok')    consCell.fill = alertFill(COLORS.alertGreen);

      rowIdx++;
    }

    // Totals row
    const totRow = ws.getRow(rowIdx);
    totRow.getCell(1).value = 'CLUSTER TOTAL';
    totRow.getCell(1).font  = { bold: true, name: 'Arial', size: 10 };
    totRow.getCell(12).value = sites.reduce((s, r) => s + (r.budget_liters || 0), 0);
    totRow.getCell(13).value = sites.reduce((s, r) => s + (r.contractual_consumption || 0), 0);
    totRow.getCell(14).value = sites.reduce((s, r) => s + (r.cms_consumption || 0), 0);
    totRow.getCell(15).value = sites.reduce((s, r) => s + (r.field_consumption_actual || 0), 0);
    totRow.eachCell({ includeEmpty: true }, c => {
      c.fill = alertFill(COLORS.subBg);
      c.font = { bold: true, name: 'Arial', size: 9 };
      c.border = thinBorder();
    });
    [12, 13, 14, 15].forEach(col => { ws.getRow(rowIdx).getCell(col).numFmt = '#,##0'; });

    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
    ws.autoFilter = { from: 'A2', to: `Y2` };
  }

  return wb;
}

// ─── Site Deep-Dive Report ────────────────────────────────────────────────────

async function generateSiteReport(site_id, cycle_key) {
  const [recon, dailyRecords, visits, budget] = await Promise.all([
    CycleReconciliation.findOne({ site_id, cycle_key }).lean(),
    CmsDailyRecord.find({ site_id, cycle_key }).sort({ record_date: 1 }).lean(),
    FieldVisitRecord.find({ site_id, cycle_key }).sort({ current_visit_date: 1 }).lean(),
    SiteBudget.findOne({ site_id, cycle_key }).lean(),
  ]);

  const cycle = await DieselCycle.findOne({ cycle_key });
  const wb    = new ExcelJS.Workbook();
  wb.creator  = 'PowerGen Diesel System';
  wb.created  = new Date();

  // ── Sheet 1: KPI Summary ──────────────────────────────────────────────────
  const kpi = wb.addWorksheet('KPI Summary', { tabColor: { argb: COLORS.headerBg } });
  kpi.columns = [{ width: 30 }, { width: 22 }, { width: 22 }];

  const addKpiTitle = (text, bgArgb = COLORS.headerBg) => {
    kpi.mergeCells(`A${kpi.rowCount + 1}:C${kpi.rowCount + 1}`);
    const row  = kpi.lastRow;
    row.height = 26;
    const cell = row.getCell(1);
    cell.value = text;
    cell.font  = { bold: true, size: 12, name: 'Arial', color: { argb: COLORS.headerFont } };
    cell.fill  = alertFill(bgArgb);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  };

  const addKpiRow = (label, value, format = null) => {
    const r   = kpi.addRow([label, value, null]);
    r.height  = 20;
    const lc  = r.getCell(1);
    const vc  = r.getCell(2);
    lc.font   = { bold: true, name: 'Arial', size: 10 };
    lc.fill   = alertFill(COLORS.subBg);
    lc.border = thinBorder();
    vc.font   = { name: 'Arial', size: 10 };
    vc.border = thinBorder();
    if (format) vc.numFmt = format;
    lc.alignment = { vertical: 'middle' };
    vc.alignment = { vertical: 'middle' };
  };

  addKpiTitle(`Site Deep-Dive — ${site_id}  (${recon?.site_name || ''})  |  ${cycle?.label || cycle_key}`);

  kpi.addRow([]);
  addKpiTitle('Site Identity', COLORS.clusterBg);
  addKpiRow('Site ID',      site_id);
  addKpiRow('Site Name',    recon?.site_name || budget?.site_name || '—');
  addKpiRow('Cluster',      recon?.cluster   || budget?.cluster   || '—');
  addKpiRow('Region',       recon?.region    || budget?.region    || '—');
  addKpiRow('Topology',     recon?.topology  || budget?.topology  || '—');
  addKpiRow('DG KVA',       recon?.dg_kva    || budget?.dg_kva    || '—');
  addKpiRow('Generator ID', recon?.generator_id || '—');
  addKpiRow('Mid-Cycle Swap', recon?.had_mid_cycle_swap ? 'YES' : 'No');

  kpi.addRow([]);
  addKpiTitle('Run Hours', COLORS.clusterBg);
  addKpiRow('Budgeted RH',  fmtNum(recon?.budgeted_rh, 1));
  addKpiRow('Final RH',     fmtNum(recon?.final_rh, 1));
  addKpiRow('RH Source',    recon?.rh_source || '—');
  addKpiRow('CMS RH',       fmtNum(recon?.cms_rh, 1));
  addKpiRow('Field RH',     fmtNum(recon?.field_rh, 1));
  addKpiRow('RH Variance%', fmtPct(recon?.rh_variance_pct));
  addKpiRow('Faulty Meter Visits', recon?.faulty_meter_days ?? '—');

  kpi.addRow([]);
  addKpiTitle('Fuel & Consumption', COLORS.clusterBg);
  addKpiRow('CCPH (L/h)',              fmtNum(recon?.ccph, 2));
  addKpiRow('Budget (L)',              fmtNum(recon?.budget_liters, 0));
  addKpiRow('Contractual Cons (L)',    fmtNum(recon?.contractual_consumption, 0));
  addKpiRow('CMS Consumption (L)',     fmtNum(recon?.cms_consumption, 0));
  addKpiRow('Field Cons Actual (L)',   fmtNum(recon?.field_consumption_actual, 0));
  addKpiRow('Cons Variance%',          fmtPct(recon?.cons_variance_pct));
  addKpiRow('Cons Status',             recon?.cons_status?.toUpperCase() || '—');
  addKpiRow('Opening Stock (L)',       fmtNum(recon?.field_fuel_found, 0));
  addKpiRow('Total Refuelled (L)',     fmtNum(recon?.field_fuel_added, 0));
  addKpiRow('Closing Stock (L)',       fmtNum(recon?.field_fuel_left, 0));
  addKpiRow('CMS Refuel Total (L)',    fmtNum(recon?.cms_refuel_total, 0));
  addKpiRow('Tom Card Purchased (L)', fmtNum(recon?.tomcard_purchased, 0));
  addKpiRow('Theft Detected (L)',      fmtNum(recon?.theft_liters, 0));

  kpi.addRow([]);
  addKpiTitle('Grid & Alerts', COLORS.clusterBg);
  addKpiRow('Grid Avail (Actual)',  fmtPct(recon?.grid_avail_actual));
  addKpiRow('Grid Avail (Target)', fmtPct(recon?.grid_avail_target));
  addKpiRow('Max Zero-Grid Streak (h)', recon?.zero_grid_max_streak ?? '—');
  addKpiRow('Alert Count',          recon?.alert_count ?? 0);

  if (recon?.alerts) {
    for (const [flag, active] of Object.entries(recon.alerts)) {
      addKpiRow(`  ${flag}`, active ? '🚨 ACTIVE' : '✅ clear');
    }
  }

  // ── Sheet 2: Daily CMS Log ─────────────────────────────────────────────────
  const cms = wb.addWorksheet('Daily CMS Log', { tabColor: { argb: '00B050' } });
  const cmsCols = [
    { header: 'Date',             key: 'date',     width: 14 },
    { header: 'Gen RH (h)',      key: 'gen_rh',   width: 13 },
    { header: 'Fuel Level (L)', key: 'fuel_lvl', width: 14 },
    { header: 'Consumed (L)',   key: 'consumed', width: 14 },
    { header: 'Refuel (L)',     key: 'refuel',   width: 12 },
    { header: 'Grid Avail (h)', key: 'grid_h',   width: 14 },
    { header: 'Zero Grid h',   key: 'zero_grid',width: 13 },
    { header: 'Power Topology',key: 'topology', width: 18 },
  ];
  cms.columns = cmsCols;
  const cmsHRow = cms.getRow(1);
  cmsHRow.height = 28;
  cmsCols.forEach((c, i) => {
    const cell = cmsHRow.getCell(i + 1);
    cell.value = c.header;
    Object.assign(cell, headerStyle());
  });

  dailyRecords.forEach((d, idx) => {
    const r = cms.addRow([
      d.record_date ? new Date(d.record_date).toISOString().slice(0, 10) : '—',
      d.gen_rh_hours    ?? null,
      d.fuel_level_l    ?? null,
      d.fuel_consumed_l ?? null,
      d.refuel_l        ?? null,
      d.grid_availability_hr ?? null,
      d.consecutive_zero_grid_hours ?? null,
      d.power_topology  ?? '—',
    ]);
    r.height = 17;
    r.eachCell({ includeEmpty: true }, c => Object.assign(c, cellStyle(idx % 2 !== 0)));
    if (d.fuel_level_l !== null && d.fuel_level_l < 500) {
      r.getCell(3).fill = alertFill(COLORS.alertRed);
    }
  });

  cms.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  cms.autoFilter = { from: 'A1', to: 'H1' };

  // ── Sheet 3: Field Visits ──────────────────────────────────────────────────
  const fv = wb.addWorksheet('Field Visits', { tabColor: { argb: 'FF7030A0' } });
  const fvCols = [
    { header: 'Visit Date',     key: 'date',        width: 14 },
    { header: 'NBR Days',      key: 'nbr_days',    width: 10 },
    { header: 'Field RH (h)', key: 'field_rh',   width: 13 },
    { header: 'Final RH (h)', key: 'final_rh',   width: 13 },
    { header: 'Meter Faulty', key: 'faulty',      width: 14 },
    { header: 'Fuel Found (L)',key: 'fuel_found', width: 14 },
    { header: 'Fuel Added (L)',key: 'fuel_added', width: 14 },
    { header: 'Fuel Left (L)', key: 'fuel_left',  width: 14 },
    { header: 'Gap CPH Var',  key: 'gap_cph',    width: 13 },
    { header: 'Theft (L)',    key: 'theft',       width: 12 },
    { header: 'Recon Status', key: 'recon',       width: 16 },
    { header: 'Technician',   key: 'tech',        width: 18 },
  ];
  fv.columns = fvCols;
  const fvHRow = fv.getRow(1);
  fvHRow.height = 28;
  fvCols.forEach((c, i) => {
    const cell = fvHRow.getCell(i + 1);
    cell.value = c.header;
    Object.assign(cell, headerStyle());
  });

  visits.forEach((v, idx) => {
    const r = fv.addRow([
      v.current_visit_date ? new Date(v.current_visit_date).toISOString().slice(0, 10) : '—',
      v.nbr_days             ?? null,
      v.field_rh             ?? null,
      v.final_rh             ?? null,
      v.meter_is_faulty ? 'YES' : 'No',
      v.fuel_qty_found       ?? null,
      v.fuel_qty_added       ?? null,
      v.fuel_qty_left        ?? null,
      v.gap_cph_variation    ?? null,
      v.theft_l              ?? null,
      v.reconciliation_status ?? '—',
      v.technician_name       ?? '—',
    ]);
    r.height = 17;
    r.eachCell({ includeEmpty: true }, c => Object.assign(c, cellStyle(idx % 2 !== 0)));
    if (v.meter_is_faulty)   r.getCell(5).fill = alertFill(COLORS.alertAmber);
    if ((v.theft_l || 0) > 0) r.getCell(10).fill = alertFill(COLORS.alertRed);
  });

  fv.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  return wb;
}

// ─── Tom Card Report ──────────────────────────────────────────────────────────

async function generateTomCardReport(cycle_key) {
  const [transactions, cycle] = await Promise.all([
    TomCardTransaction.find({ cycle_key }).sort({ transaction_date: 1, cluster: 1 }).lean(),
    DieselCycle.findOne({ cycle_key }),
  ]);

  const wb   = new ExcelJS.Workbook();
  wb.creator = 'PowerGen Diesel System';
  wb.created = new Date();

  // ── Sheet 1: All Transactions ──────────────────────────────────────────────
  const ws = wb.addWorksheet('Transactions', { tabColor: { argb: COLORS.headerBg } });

  ws.mergeCells('A1:K1');
  const titleCell     = ws.getCell('A1');
  titleCell.value     = `Tom Card Transactions — ${cycle?.label || cycle_key}  (${transactions.length} records)`;
  titleCell.font      = { bold: true, size: 13, name: 'Arial', color: { argb: COLORS.headerFont } };
  titleCell.fill      = alertFill(COLORS.headerBg);
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  const txCols = [
    { header: 'Date',          key: 'date',     width: 14 },
    { header: 'Card Number',  key: 'card',     width: 16 },
    { header: 'Site ID',      key: 'site_id',  width: 16 },
    { header: 'Site Name',    key: 'site_name',width: 22 },
    { header: 'Cluster',      key: 'cluster',  width: 16 },
    { header: 'Region',       key: 'region',   width: 14 },
    { header: 'Station',      key: 'station',  width: 22 },
    { header: 'Qty (L)',      key: 'qty',      width: 12 },
    { header: 'Unit Price',   key: 'price',    width: 13 },
    { header: 'Total (XAF)', key: 'total',    width: 16 },
    { header: 'Reconciled',   key: 'recon',    width: 13 },
  ];
  ws.columns = txCols;

  const hRow = ws.getRow(2);
  hRow.height = 30;
  txCols.forEach((c, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = c.header;
    Object.assign(cell, headerStyle());
  });

  transactions.forEach((t, idx) => {
    const r = ws.addRow([
      t.transaction_date ? new Date(t.transaction_date).toISOString().slice(0, 10) : '—',
      t.card_number     ?? '—',
      t.site_id         ?? '—',
      t.site_name       ?? '—',
      t.cluster         ?? '—',
      t.region          ?? '—',
      t.station_name    ?? '—',
      t.quantity_l      ?? null,
      t.unit_price      ?? null,
      t.total_amount    ?? null,
      t.reconciled ? 'Yes' : 'No',
    ]);
    r.height = 17;
    r.eachCell({ includeEmpty: true }, c => Object.assign(c, cellStyle(idx % 2 !== 0)));
    r.getCell(8).numFmt  = '#,##0.0';
    r.getCell(9).numFmt  = '#,##0';
    r.getCell(10).numFmt = '#,##0';
    if (!t.reconciled) r.getCell(11).fill = alertFill(COLORS.alertAmber);
  });

  // Totals
  const totRow    = ws.addRow([]);
  totRow.height   = 20;
  totRow.getCell(1).value = 'TOTAL';
  totRow.getCell(8).value = transactions.reduce((s, t) => s + (t.quantity_l   || 0), 0);
  totRow.getCell(10).value= transactions.reduce((s, t) => s + (t.total_amount || 0), 0);
  totRow.eachCell({ includeEmpty: true }, c => {
    c.font   = { bold: true, name: 'Arial', size: 10 };
    c.fill   = alertFill(COLORS.subBg);
    c.border = thinBorder();
  });
  totRow.getCell(8).numFmt  = '#,##0.0';
  totRow.getCell(10).numFmt = '#,##0';

  ws.views      = [{ state: 'frozen', xSplit: 0, ySplit: 2 }];
  ws.autoFilter = { from: 'A2', to: 'K2' };

  // ── Sheet 2: Cluster Summary ───────────────────────────────────────────────
  const cs = wb.addWorksheet('Cluster Summary', { tabColor: { argb: COLORS.clusterBg } });
  cs.columns = [
    { width: 20 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 18 },
  ];

  const csHRow = cs.getRow(1);
  csHRow.height = 28;
  ['Cluster', 'Transactions', 'Sites', 'Total Qty (L)', 'Total Value (XAF)'].forEach((h, i) => {
    const cell = csHRow.getCell(i + 1);
    cell.value = h;
    Object.assign(cell, headerStyle());
  });

  // Group by cluster
  const byCluster = {};
  for (const t of transactions) {
    const cl = t.cluster || 'Unknown';
    if (!byCluster[cl]) byCluster[cl] = [];
    byCluster[cl].push(t);
  }

  let csIdx = 2;
  for (const [cl, txs] of Object.entries(byCluster).sort()) {
    const r = cs.getRow(csIdx++);
    r.height = 18;
    const sites = new Set(txs.map(t => t.site_id)).size;
    r.getCell(1).value = cl;
    r.getCell(2).value = txs.length;
    r.getCell(3).value = sites;
    r.getCell(4).value = txs.reduce((s, t) => s + (t.quantity_l   || 0), 0);
    r.getCell(5).value = txs.reduce((s, t) => s + (t.total_amount || 0), 0);
    r.eachCell({ includeEmpty: true }, c => Object.assign(c, cellStyle(csIdx % 2 === 0)));
    r.getCell(4).numFmt = '#,##0.0';
    r.getCell(5).numFmt = '#,##0';
  }

  return wb;
}

// ─── Stream workbook to HTTP response ─────────────────────────────────────────

async function streamToResponse(workbook, res, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache');
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = {
  generateCycleReport,
  generateSiteReport,
  generateTomCardReport,
  streamToResponse,
};










// /**
//  * generatorSwapService.js
//  * Handles generator moves/replacements.
//  * Integrates with existing GeneratorUpdate model → GeneratorAssignmentLedger.
//  * Triggers re-reconciliation for affected cycles after every swap.
//  */
// const GeneratorAssignmentLedger = require('../models/GeneratorAssignmentLedger');
// const SiteBudget                = require('../models/SiteBudget');
// const DieselCycle               = require('../models/DieselCycle');
// const alertService              = require('./alertService');
// const reconciliationService     = require('./reconciliationService');
// const logger                    = require('../utils/logger');

// /**
//  * Record a new generator assignment when a site gets its first generator.
//  */
// async function assignGenerator({ site_id, site_name, cluster, region, generator_id, generator_brand, dg_kva, assigned_at, assigned_reason, recorded_by, generator_update_ref }) {
//   // Close any existing active assignment first (shouldn't exist, but safety net)
//   await GeneratorAssignmentLedger.closeActiveAssignment(
//     site_id,
//     assigned_at,
//     recorded_by,
//     'Replaced by new assignment'
//   );

//   // Get CCPH from SiteBudget for the current cycle
//   const cycleKey = DieselCycle.getCycleKeyForDate(assigned_at);
//   const budget   = await SiteBudget.findOne({ site_id, cycle_key: cycleKey }).lean();

//   const ledgerEntry = await GeneratorAssignmentLedger.create({
//     site_id, site_name, cluster, region,
//     generator_id, generator_brand, dg_kva,
//     ccph:           budget?.ccph || null,
//     assigned_at:    assigned_at || new Date(),
//     assigned_reason: assigned_reason || 'Initial assignment',
//     is_active:      true,
//     cycles_affected: [cycleKey],
//     recorded_by,
//     generator_update_ref,
//   });

//   logger.info(`[GenSwap] Assigned ${generator_id} to site ${site_id} (cycle ${cycleKey})`);
//   return ledgerEntry;
// }

// /**
//  * Record a generator swap (old gen removed, new gen installed).
//  * Called when supervisor approves a GeneratorUpdate of type 'new_generator'.
//  */
// async function swapGenerator({
//   site_id, site_name, cluster, region,
//   old_generator_id,
//   new_generator_id, new_generator_brand, new_dg_kva,
//   swap_date, swap_reason,
//   recorded_by, generator_update_ref,
// }) {
//   const swapAt   = new Date(swap_date || Date.now());
//   const cycleKey = DieselCycle.getCycleKeyForDate(swapAt);

//   // 1. Close the old assignment
//   const closed = await GeneratorAssignmentLedger.closeActiveAssignment(
//     site_id,
//     swapAt,
//     recorded_by,
//     swap_reason || `Replaced by ${new_generator_id}`
//   );

//   if (closed) {
//     // Add this cycle to its cycles_affected if not already there
//     await GeneratorAssignmentLedger.findByIdAndUpdate(closed._id, {
//       $addToSet: { cycles_affected: cycleKey },
//     });
//   }

//   // 2. Get CCPH from budget (new generator may have different CCPH)
//   const budget = await SiteBudget.findOne({ site_id, cycle_key: cycleKey }).lean();

//   // 3. Open new assignment
//   const newEntry = await GeneratorAssignmentLedger.create({
//     site_id, site_name, cluster, region,
//     generator_id:    new_generator_id,
//     generator_brand: new_generator_brand,
//     dg_kva:          new_dg_kva,
//     ccph:            budget?.ccph || null,
//     assigned_at:     swapAt,
//     assigned_reason: swap_reason || `Replaced ${old_generator_id || 'previous generator'}`,
//     is_active:       true,
//     cycles_affected: [cycleKey],
//     recorded_by,
//     generator_update_ref,
//   });

//   // 4. Alert
//   await alertService.fireSystemAlert(
//     'GENERATOR_MOVED',
//     'info',
//     `Generator Swap — ${site_name || site_id}`,
//     `Generator ${old_generator_id || 'previous'} replaced by ${new_generator_id} at site ${site_id} on ${swapAt.toLocaleDateString()}.`,
//     { site_id, cluster, old_generator_id, new_generator_id, swap_date: swapAt },
//     cycleKey
//   );

//   // 5. Re-run reconciliation for this cycle (swap affects pro-rated CCPH)
//   setImmediate(async () => {
//     try {
//       await reconciliationService.runForCycle(cycleKey, site_id);
//       logger.info(`[GenSwap] Re-reconciled ${site_id} for cycle ${cycleKey}`);
//     } catch (err) {
//       logger.error(`[GenSwap] Re-reconciliation failed: ${err.message}`);
//     }
//   });

//   logger.info(`[GenSwap] Swapped ${old_generator_id} → ${new_generator_id} at ${site_id}`);
//   return { closed, newEntry };
// }

// /**
//  * Get the full assignment history for a site (for the GeneratorLedger page).
//  */
// async function getSiteHistory(site_id) {
//   return GeneratorAssignmentLedger.find({ site_id })
//     .sort({ assigned_at: -1 })
//     .populate('recorded_by', 'fullName')
//     .populate('removed_by',  'fullName')
//     .lean();
// }

// /**
//  * Get all sites that currently have no active generator assignment.
//  * These are data gaps that need attention.
//  */
// async function getSitesWithoutGenerator() {
//   const activeSiteIds = await GeneratorAssignmentLedger.distinct('site_id', { is_active: true });
//   return activeSiteIds; // Consumer compares this list against all known sites
// }

// module.exports = { assignGenerator, swapGenerator, getSiteHistory, getSitesWithoutGenerator };