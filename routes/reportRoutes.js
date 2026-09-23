
/**
 * reportRoutes.js
 */
const express = require('express');
const r1      = express.Router();
const { generateCycleReport, generateTomCardReport, generateSiteReport, streamToResponse } = require('../services/reportService');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const asyncHandler = require('../middlewares/asyncHandler');
const ROLES = ['diesel_manager', 'data_collector', 'admin'];
 
r1.get('/cycle/:cycle_key/excel', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const wb = await generateCycleReport(req.params.cycle_key);
  await streamToResponse(wb, res, `Cycle_Report_${req.params.cycle_key}.xlsx`);
}));
 
r1.get('/site/:site_id/:cycle_key/excel', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const wb = await generateSiteReport(req.params.site_id, req.params.cycle_key);
  await streamToResponse(wb, res, `Site_${req.params.site_id}_${req.params.cycle_key}.xlsx`);
}));
 
r1.get('/tomcard/:cycle_key/excel', authenticateToken, requireRole(ROLES), asyncHandler(async (req, res) => {
  const wb = await generateTomCardReport(req.params.cycle_key);
  await streamToResponse(wb, res, `TomCard_${req.params.cycle_key}.xlsx`);
}));
 
module.exports = { reportRoutes: r1 };