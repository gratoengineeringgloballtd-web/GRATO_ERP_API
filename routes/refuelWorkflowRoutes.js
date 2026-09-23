// ─────────────────────────────────────────────────────────────────────────
// PASTE TARGET: routes/refuelWorkflow.js (wherever this file lives)
// Full replacement. Changes from your original:
//   1. POST /start now accepts `client_id` and is idempotent on it -- a
//      queued "start" that gets retried after already succeeding (response
//      lost mid-flight) returns the existing record instead of creating a
//      duplicate FuelConsumption-adjacent workflow row.
//   2. NEW: PATCH /by-client/:clientId/status -- lets the mobile app patch
//      a workflow status even when it only knows the client-generated id
//      (i.e. the workflow was created while offline and the "start" queue
//      item hasn't synced yet, so no real _id exists server-side). Finds
//      the record by client_id instead of _id; if the record doesn't exist
//      yet either, it creates a minimal one so the status still lands
//      somewhere rather than being silently dropped.
//   3. GET /:id also checks client_id as a fallback lookup, so a status
//      screen reading by whichever id it currently has still works.
// Everything else is unchanged.
//
// Requires: add `client_id: { type: String, index: true, sparse: true }`
// to your FuelConsumption schema (same field used elsewhere for refuel
// submission idempotency -- if you already added it for that, nothing
// further needed here).
// ─────────────────────────────────────────────────────────────────────────

const express        = require('express');
const router         = express.Router();
const mongoose       = require('mongoose');
const FuelConsumption = require('../models/FuelConsumption');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger         = require('../utils/logger');

// ── POST /api/refuel-workflow/start ──────────────────────────────────────────
router.post(
  '/start',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const { siteId, technicianId, taskId, client_id } = req.body;

      if (!siteId) {
        return res.status(400).json({ success: false, error: 'siteId is required' });
      }

      const userId = req.user.userId || req.user._id;

      console.log('[refuel-workflow/start] siteId:', siteId, 'userId:', userId, 'taskId:', taskId, 'client_id:', client_id);

      // ── Idempotency: a queued start retried after already succeeding ────────
      if (client_id) {
        const existingByClientId = await FuelConsumption.findOne({ client_id });
        if (existingByClientId) {
          console.log('[refuel-workflow/start] Duplicate start ignored (client_id match):', existingByClientId._id);
          return res.json({ success: true, data: existingByClientId, resumed: true });
        }
      }

      // ── Resume: find the most recent non-completed record for this site ──
      const existing = await FuelConsumption.findOne({
        site_id:          siteId,
        workflow_status:  { $nin: ['completed', 'cancelled'] },
        refuel_submitted: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (existing) {
        console.log('[refuel-workflow/start] Resuming existing record:', existing._id, 'status:', existing.workflow_status);
        return res.json({ success: true, data: existing, resumed: true });
      }

      // ── Create: new initiated record with minimal required fields ──────────
      const newRecord = new FuelConsumption({
        client_id,
        site_id:          siteId,
        recorded_by:      userId,
        record_date:      new Date(),
        period:           'daily',
        workflow_status:  'initiated',
        refuel_submitted: false,
        workflow_history: [{
          status:    'initiated',
          timestamp: new Date(),
          meta:      { technicianId: userId, taskId: taskId || null }
        }],
        workflow_last_updated: new Date(),
        fuel_data: {
          opening_level: 0,
          closing_level: 0,
          fuel_added:    0,
          fuel_consumed: 0,
          tank_capacity: 5000,
        },
        source: 'site_visit',
        maintenance_reference: taskId && mongoose.Types.ObjectId.isValid(taskId)
          ? taskId
          : undefined,
      });

      await newRecord.save();
      console.log('[refuel-workflow/start] Created new record:', newRecord._id);

      return res.status(201).json({ success: true, data: newRecord, resumed: false });

    } catch (error) {
      logger.error('[refuel-workflow/start] error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to start workflow' });
    }
  }
);

// ── PATCH /api/refuel-workflow/:id/status ─────────────────────────────────────
router.patch(
  '/:id/status',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const { id }           = req.params;
      const { status, meta } = req.body;

      if (!status) {
        return res.status(400).json({ success: false, error: 'status is required' });
      }

      const record = await FuelConsumption.findById(id);
      if (!record) {
        return res.status(404).json({ success: false, error: 'Workflow record not found' });
      }

      applyStatusPatch(record, status, meta);
      await record.save();
      console.log(`[refuel-workflow] Patched status="${status}" on record ${id}`);

      return res.json({ success: true, data: record });

    } catch (error) {
      logger.error('[refuel-workflow/status] error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to update status' });
    }
  }
);

// ── NEW: PATCH /api/refuel-workflow/by-client/:clientId/status ───────────────
// Used when the mobile app only has the client-generated id -- either
// because it created this workflow entirely offline and the "start" queue
// item hasn't synced yet, or because it's simpler for a queued item to
// always resolve by client_id rather than track which id it eventually got.
router.patch(
  '/by-client/:clientId/status',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const { clientId } = req.params;
      const { status, meta, siteId } = req.body;

      if (!status) {
        return res.status(400).json({ success: false, error: 'status is required' });
      }

      let record = await FuelConsumption.findOne({ client_id: clientId });

      if (!record) {
        // The "start" for this workflow hasn't synced yet (queue processes
        // in order, so this shouldn't normally happen -- but if it does,
        // e.g. a status patch got queued before its start for any reason,
        // create a minimal record now rather than dropping the status).
        if (!siteId) {
          return res.status(404).json({
            success: false,
            error: 'Workflow not found for client_id, and no siteId provided to create one',
          });
        }
        const userId = req.user.userId || req.user._id;
        record = new FuelConsumption({
          client_id: clientId,
          site_id: siteId,
          recorded_by: userId,
          record_date: new Date(),
          period: 'daily',
          workflow_status: 'initiated',
          refuel_submitted: false,
          workflow_history: [],
          fuel_data: { opening_level: 0, closing_level: 0, fuel_added: 0, fuel_consumed: 0, tank_capacity: 5000 },
          source: 'site_visit',
        });
      }

      applyStatusPatch(record, status, meta);
      await record.save();
      console.log(`[refuel-workflow] Patched status="${status}" on record ${record._id} (by client_id ${clientId})`);

      return res.json({ success: true, data: record });

    } catch (error) {
      logger.error('[refuel-workflow/by-client/status] error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to update status' });
    }
  }
);

function applyStatusPatch(record, status, meta) {
  // First-write-wins per status, same as before.
  const alreadyRecorded = record.workflow_history.some(h => h.status === status);
  if (!alreadyRecorded) {
    record.workflow_history.push({
      status,
      timestamp: new Date(),
      meta:      meta || {}
    });
    record.workflow_status       = status;
    record.workflow_last_updated = new Date();

    if (status === 'completed') {
      record.refuel_submitted = true;
    }
  }
}

// ── GET /api/refuel-workflow/:id ──────────────────────────────────────────────
// Also accepts a client_id in the same param slot as a fallback, so a
// screen that only has the client-generated id (not yet synced to a real
// _id) can still look the workflow up.
router.get(
  '/:id',
  authenticateToken,
  requireRole(['technician', 'fuel', 'diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { id } = req.params;
      let record = mongoose.Types.ObjectId.isValid(id)
        ? await FuelConsumption.findById(id).lean()
        : null;

      if (!record) {
        record = await FuelConsumption.findOne({ client_id: id }).lean();
      }

      if (!record) {
        return res.status(404).json({ success: false, error: 'Record not found' });
      }
      return res.json({ success: true, data: record });
    } catch (error) {
      logger.error('[refuel-workflow/get] error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ── GET /api/refuel-workflow/site/:siteId/active ──────────────────────────────
router.get(
  '/site/:siteId/active',
  authenticateToken,
  requireRole(['technician', 'fuel']),
  async (req, res) => {
    try {
      const record = await FuelConsumption.findOne({
        site_id:          req.params.siteId,
        workflow_status:  { $nin: ['completed', 'cancelled'] },
        refuel_submitted: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ success: true, data: record || null });
    } catch (error) {
      logger.error('[refuel-workflow/site/active] error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;

