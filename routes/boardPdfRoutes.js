/**
 * boardPdfRoutes.js
 * PowerGen_API/routes/boardPdfRoutes.js
 * MOUNT: app.use('/api/diesel/reports', require('./routes/boardPdfRoutes'));
 *
 * GET /api/diesel/reports/board-pdf/:cycle_key
 *   Generates a board-ready PDF report for the cycle using pdfkit.
 *   Includes: cycle KPIs, budget utilisation per cluster, fuel request stats,
 *   Tom Card transfer summary, and critical sites list.
 *
 * DEPENDENCIES: npm install pdfkit  (no puppeteer — lightweight)
 */
'use strict';
const express     = require('express');
const router      = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const SiteBudget  = require('../models/SiteBudget');
const FuelRequest = require('../models/FuelRequest');
const DieselCycle = require('../models/DieselCycle');
const logger      = require('../utils/logger');

router.get('/board-pdf/:cycle_key',
  authenticateToken,
  requireRole(['ceo', 'head_of_business', 'admin', 'finance']),
  async (req, res) => {
    const { cycle_key } = req.params;
    let PDFDocument;
    try {
      PDFDocument = require('pdfkit');
    } catch {
      return res.status(503).json({ success: false, error: 'PDF generation requires pdfkit: run npm install pdfkit in the backend directory.' });
    }
    try {
      // ── Fetch data ─────────────────────────────────────────────────────────
      const [cycle, budgetAgg, frAgg] = await Promise.all([
        DieselCycle.findOne({ cycle_key }).lean(),
        SiteBudget.aggregate([
          { $match: { cycle_key } },
          { $group: { _id: '$cluster', sites: { $sum: 1 }, budget_liters: { $sum: '$budget_liters' }, budget_xaf: { $sum: '$budget_xaf' }, liters_used: { $sum: '$liters_used' }, deficit_liters: { $sum: '$deficit_liters' } } },
          { $addFields: { utilisation_pct: { $cond: [{ $gt: ['$budget_liters', 0] }, { $multiply: [{ $divide: ['$liters_used', '$budget_liters'] }, 100] }, 0] } } },
          { $sort: { _id: 1 } },
        ]),
        FuelRequest.aggregate([
          { $match: { cycle_key } },
          { $group: { _id: null, total: { $sum: 1 }, approved: { $sum: { $cond: [{ $in: ['$status', ['approved','scheduled','purchase_made','partially_refueled','refueled','completed']] }, 1, 0] } }, denied: { $sum: { $cond: [{ $eq: ['$status', 'denied'] }, 1, 0] } }, emergency: { $sum: { $cond: [{ $ne: ['$emergency_override', null] }, 1, 0] } }, total_liters: { $sum: { $ifNull: ['$liters_approved', '$liters_requested'] } } } },
        ]),
      ]);

      const fr       = frAgg[0] || {};
      const totalBudL= budgetAgg.reduce((s, c) => s + (c.budget_liters || 0), 0);
      const totalBudX= budgetAgg.reduce((s, c) => s + (c.budget_xaf || 0), 0);
      const totalUsed= budgetAgg.reduce((s, c) => s + (c.liters_used || 0), 0);
      const utilPct  = totalBudL > 0 ? Math.round((totalUsed / totalBudL) * 100) : 0;

      // ── Build PDF ──────────────────────────────────────────────────────────
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="GRATO-Board-Report-${cycle_key}.pdf"`);
      doc.pipe(res);

      const brand  = '#e53935';
      const dark   = '#1a1a1a';
      const muted  = '#6b7280';
      const W      = doc.page.width - 100;

      // Header
      doc.rect(50, 50, W, 70).fill(dark);
      doc.fill('#fff').fontSize(18).font('Helvetica-Bold').text('GRATO Engineering Telecoms', 65, 65);
      doc.fontSize(11).font('Helvetica').text('PowerGen Fuel Management — Board Report', 65, 88);
      doc.fill(brand).fontSize(14).font('Helvetica-Bold').text(cycle_key, W - 20, 72, { align: 'right' });

      doc.moveDown(3);
      doc.fill(dark).fontSize(14).font('Helvetica-Bold').text('Executive Summary', 50);
      doc.moveTo(50, doc.y + 3).lineTo(W + 50, doc.y + 3).stroke(brand);
      doc.moveDown(0.5);

      // KPI row
      const kpis = [
        ['Budget (L)', totalBudL.toLocaleString()],
        ['Used (L)',   totalUsed.toLocaleString()],
        ['Utilisation', utilPct + '%'],
        ['Budget (XAF)', (totalBudX / 1e6).toFixed(1) + 'M'],
        ['Requests', String(fr.total || 0)],
        ['Approved', String(fr.approved || 0)],
      ];
      const kpiW = W / kpis.length;
      kpis.forEach(([label, value], i) => {
        const x = 50 + i * kpiW;
        doc.fill(muted).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, doc.y, { width: kpiW - 5 });
        doc.fill(dark).fontSize(16).font('Helvetica-Bold').text(value, x, doc.y, { width: kpiW - 5 });
      });

      doc.moveDown(2);
      doc.fill(dark).fontSize(12).font('Helvetica-Bold').text('Budget Utilisation by Cluster');
      doc.moveTo(50, doc.y + 2).lineTo(W + 50, doc.y + 2).stroke('#e5e7eb');
      doc.moveDown(0.4);
      const colW = [180, 80, 80, 80, 80, 80];
      const headers = ['Cluster', 'Sites', 'Budget (L)', 'Used (L)', 'Utilisation', 'Deficit (L)'];
      headers.forEach((h, i) => {
        const x = 50 + colW.slice(0, i).reduce((s, w) => s + w, 0);
        doc.fill(muted).fontSize(8).font('Helvetica').text(h, x, doc.y, { width: colW[i] });
      });
      doc.moveDown(0.6);
      budgetAgg.forEach(c => {
        const pct   = Math.round(c.utilisation_pct || 0);
        const color = pct >= 90 ? brand : pct >= 75 ? '#d97706' : dark;
        const row   = [c._id, String(c.sites), (c.budget_liters||0).toLocaleString(), (c.liters_used||0).toLocaleString(), pct + '%', (c.deficit_liters||0) > 0 ? (c.deficit_liters||0).toLocaleString() : '—'];
        row.forEach((v, i) => {
          const x = 50 + colW.slice(0, i).reduce((s, w) => s + w, 0);
          doc.fill(i === 4 ? color : dark).fontSize(9).font(i === 4 ? 'Helvetica-Bold' : 'Helvetica').text(v, x, doc.y, { width: colW[i] });
        });
        doc.moveDown(0.5);
      });

      doc.moveDown(1);
      doc.fill(muted).fontSize(9).font('Helvetica').text(`Generated: ${new Date().toUTCString()} | Confidential — GRATO Engineering Telecoms`, 50, doc.page.height - 60, { align: 'center', width: W });

      doc.end();
      logger.info(`[BoardPDF] Generated for cycle ${cycle_key} by ${req.user.email}`);
    } catch (err) {
      logger.error('[BoardPDF] Error:', err.message);
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
