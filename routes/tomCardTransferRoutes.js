/**
 * tomCardTransferRoutes.js
 * PowerGen_API/routes/tomCardTransferRoutes.js
 *
 * Tom Card fuel transfer operations:
 *   1. Transfer litres from one cluster's card to another
 *   2. Auto-match Tom Card transactions to FuelRequest disbursements
 *   3. Reconcile deficits when budget is added or transfers arrive
 *
 * MOUNT IN app.js:
 *   app.use('/api/tomcard-transfers', require('./routes/tomCardTransferRoutes'));
 */
'use strict';

const express    = require('express');
const router     = express.Router();
const mongoose   = require('mongoose');
const SiteBudget = require('../models/SiteBudget');
const { auditLog } = require('../models/AuditLog');
const FuelRequest= require('../models/FuelRequest');
const TomCardTransaction = require('../models/TomCardTransaction');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger     = require('../utils/logger');
const { sendEmail } = require('../services/emailService');

const TRANSFER_ROLES = ['diesel_manager', 'finance', 'admin'];

// ─────────────────────────────────────────────────────────────────────────────
// POST / — Transfer fuel allocation from one card/cluster to another
// ─────────────────────────────────────────────────────────────────────────────
router.post('/',
  authenticateToken,
  requireRole(TRANSFER_ROLES),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const {
        cycle_key,
        from_cluster, from_card_number,
        to_cluster,   to_card_number,
        liters,
        reason,
        fuel_request_id, // optional: link transfer to a specific FuelRequest
      } = req.body;

      if (!cycle_key || !from_cluster || !to_cluster || !liters || liters <= 0) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, error: 'cycle_key, from_cluster, to_cluster, liters are required' });
      }
      if (from_cluster === to_cluster && from_card_number === to_card_number) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, error: 'Source and destination must be different' });
      }

      // Find source SiteBudget (aggregate for cluster)
      const sourceBudgets = await SiteBudget.find({
        cycle_key,
        cluster: from_cluster,
        ...(from_card_number ? { card_number: from_card_number } : {}),
      }).session(session);

      if (!sourceBudgets.length) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, error: `No budget found for cluster ${from_cluster} in cycle ${cycle_key}` });
      }

      // Calculate available from source
      const totalEffective = sourceBudgets.reduce((s, sb) => {
        const xfIn  = (sb.transfers_in  || []).reduce((a, t) => a + t.liters, 0);
        const xfOut = (sb.transfers_out || []).reduce((a, t) => a + t.liters, 0);
        return s + (sb.budget_liters || 0) + xfIn - xfOut + (sb.liters_balance_returned || 0) - (sb.liters_used || 0) - (sb.liters_committed || 0);
      }, 0);

      if (totalEffective < liters) {
        await session.abortTransaction();
        return res.status(422).json({
          success: false,
          error:   `Insufficient available balance. Available: ${totalEffective.toFixed(1)}L, Requested: ${liters}L`,
          available: totalEffective,
        });
      }

      // Find destination budgets
      const destBudgets = await SiteBudget.find({
        cycle_key,
        cluster: to_cluster,
        ...(to_card_number ? { card_number: to_card_number } : {}),
      }).session(session);

      if (!destBudgets.length) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, error: `No budget found for destination cluster ${to_cluster}` });
      }

      const transferAt = new Date();
      const by = req.user.userId;

      // Apply transfer_out to source (distribute proportionally across sites)
      let remaining = liters;
      for (const sb of sourceBudgets) {
        if (remaining <= 0) break;
        const xfIn  = (sb.transfers_in  || []).reduce((a, t) => a + t.liters, 0);
        const xfOut = (sb.transfers_out || []).reduce((a, t) => a + t.liters, 0);
        const avail = (sb.budget_liters || 0) + xfIn - xfOut + (sb.liters_balance_returned || 0) - (sb.liters_used || 0) - (sb.liters_committed || 0);
        const take  = Math.min(avail, remaining);
        if (take <= 0) continue;
        sb.transfers_out = sb.transfers_out || [];
        sb.transfers_out.push({ to_cluster, to_card: to_card_number || '', liters: take, at: transferAt, by, note: reason || `Transfer to ${to_cluster}` });
        await sb.save({ session });
        remaining -= take;
      }

      // Apply transfer_in to destination
      const perDest = liters / destBudgets.length;
      for (const sb of destBudgets) {
        sb.transfers_in = sb.transfers_in || [];
        sb.transfers_in.push({ from_cluster, from_card: from_card_number || '', liters: perDest, at: transferAt, by, note: reason || `Transfer from ${from_cluster}` });
        // If this destination was in deficit, check if transfer resolves it
        if (sb.in_deficit) {
          const newEffective = (sb.budget_liters || 0)
            + sb.transfers_in.reduce((s, t) => s + t.liters, 0)
            - sb.transfers_out.reduce((s, t) => s + t.liters, 0)
            + (sb.liters_balance_returned || 0);
          if (newEffective >= (sb.liters_used || 0) + (sb.liters_committed || 0)) {
            sb.in_deficit     = false;
            sb.deficit_liters = 0;
            sb.deficit_resolution = 'transfer_in';
            sb.deficit_resolved_at = transferAt;
          }
        }
        await sb.save({ session });
      }

      // If linked to a FuelRequest, update its card_transfer fields
      if (fuel_request_id && mongoose.Types.ObjectId.isValid(fuel_request_id)) {
        await FuelRequest.findByIdAndUpdate(fuel_request_id, {
          card_transfer_from:    from_card_number || from_cluster,
          card_transfer_cluster: from_cluster,
          card_transfer_liters:  liters,
          card_transfer_at:      transferAt,
          card_transfer_by:      by,
        }, { session });
      }

      await session.commitTransaction();

      // Notify relevant parties
      setImmediate(() => sendEmail({
        to: ['minka.kevin@gratoglobal.com', 'ranibellmambo@gratoengineering.com'],
        subject: `💳 Tom Card Transfer — ${liters}L from ${from_cluster} → ${to_cluster} (${cycle_key})`,
        html: `<p><strong>${liters}L</strong> transferred from <strong>${from_cluster}</strong>
               (card: ${from_card_number || 'all'}) to <strong>${to_cluster}</strong>
               (card: ${to_card_number || 'all'}) for cycle <strong>${cycle_key}</strong>.</p>
               <p>Reason: ${reason || 'Not specified'}</p>
               <p>Actioned by: ${req.user.email}</p>`,
      }).catch(() => {}));

      auditLog({ action: 'tomcard.transfer', entityType: 'SiteBudget', actor: req.user, cycleKey: cycle_key, metadata: { from_cluster, to_cluster, liters, reason } }).catch(()=>{});
      logger.info(`[TomCardTransfer] ${liters}L: ${from_cluster} → ${to_cluster} (cycle ${cycle_key}) by ${req.user.email}`);

      return res.json({
        success: true,
        message: `${liters}L successfully transferred from ${from_cluster} to ${to_cluster}`,
        data: { liters, from_cluster, to_cluster, cycle_key, at: transferAt },
      });

    } catch (err) {
      await session.abortTransaction();
      logger.error('[TomCardTransfer] Error:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /history/:cycle_key — All transfers for a cycle
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history/:cycle_key',
  authenticateToken,
  requireRole(['diesel_manager', 'finance', 'admin', 'head_of_business', 'ceo']),
  async (req, res) => {
    try {
      const budgets = await SiteBudget.find({ cycle_key: req.params.cycle_key })
        .select('site_id site_name cluster card_number transfers_in transfers_out')
        .lean();

      const history = [];
      for (const sb of budgets) {
        for (const t of sb.transfers_in  || []) history.push({ direction: 'in',  cluster: sb.cluster, site_id: sb.site_id, ...t });
        for (const t of sb.transfers_out || []) history.push({ direction: 'out', cluster: sb.cluster, site_id: sb.site_id, ...t });
      }
      history.sort((a, b) => new Date(b.at) - new Date(a.at));

      return res.json({ success: true, data: history, count: history.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /deficits/:cycle_key — All sites in deficit for a cycle
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deficits/:cycle_key',
  authenticateToken,
  requireRole(['diesel_manager', 'finance', 'admin', 'head_of_business', 'ceo']),
  async (req, res) => {
    try {
      const deficits = await SiteBudget.find({
        cycle_key: req.params.cycle_key,
        in_deficit: true,
      }).lean();

      const enriched = deficits.map(sb => ({
        ...sb,
        liters_remaining: (sb.budget_liters || 0) - (sb.liters_used || 0) - (sb.liters_committed || 0),
        deficit_xaf:      Math.round((sb.deficit_liters || 0) * (sb.xaf_per_liter || 828)),
      }));

      return res.json({ success: true, data: enriched, count: enriched.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /reconcile-deficit — Resolve a deficit (budget added or transfer resolved it)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reconcile-deficit',
  authenticateToken,
  requireRole(['finance', 'admin']),
  async (req, res) => {
    try {
      const { site_id, cycle_key, resolution, notes } = req.body;
      const sb = await SiteBudget.findOne({ site_id, cycle_key });
      if (!sb) return res.status(404).json({ success: false, error: 'SiteBudget not found' });
      if (!sb.in_deficit) return res.json({ success: true, message: 'No deficit to reconcile' });

      sb.in_deficit          = false;
      sb.deficit_liters      = 0;
      sb.deficit_resolution  = resolution || 'written_off';
      sb.deficit_resolved_at = new Date();
      await sb.save();

      // Mark linked FuelRequests as deficit-resolved
      await FuelRequest.updateMany(
        { site_id, cycle_key, in_deficit: true },
        { $set: {
          in_deficit:            false,
          deficit_resolved_at:   new Date(),
          deficit_resolved_by:   req.user.userId,
          deficit_resolution:    resolution || 'written_off',
          deficit_notes:         notes,
        }}
      );

      logger.info(`[TomCardTransfer] Deficit reconciled: site=${site_id} cycle=${cycle_key} resolution=${resolution}`);
      return res.json({ success: true, message: `Deficit for ${site_id} reconciled (${resolution})` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /auto-match — Manually trigger Tom Card auto-match for a cycle
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auto-match',
  authenticateToken,
  requireRole(['diesel_manager', 'finance', 'admin']),
  async (req, res) => {
    try {
      const { cycle_key } = req.body;
      if (!cycle_key) return res.status(400).json({ success: false, error: 'cycle_key required' });

      const disbursed = await FuelRequest.find({
        cycle_key,
        'disbursement.payment_method': 'tom_card',
        tomcard_transaction_id: null,
      });

      let matched = 0;
      for (const fr of disbursed) {
        if (!fr.disbursement?.actual_xaf || !fr.tom_card_number) continue;
        const txn = await TomCardTransaction.findOne({
          card_num:   fr.tom_card_number,
          cycle_key,
          reconciled: false,
          amount_cfa: {
            $gte: fr.disbursement.actual_xaf * 0.98,
            $lte: fr.disbursement.actual_xaf * 1.02,
          },
        }).sort({ date: -1 });

        if (txn) {
          fr.tomcard_transaction_id = txn._id;
          txn.reconciled            = true;
          txn.site_id               = fr.site_id;
          txn.reconciliation_note   = `Auto-matched to FuelRequest ${fr._id}`;
          await Promise.all([fr.save(), txn.save()]);
          matched++;
        }
      }

      return res.json({
        success: true,
        message: `Auto-match complete: ${matched}/${disbursed.length} requests matched`,
        matched, total: disbursed.length,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
