/**
 * fuelRequestRoutes.js
 * routes/fuelRequestRoutes.js
 *
 * Mount at:  app.use('/api/fuel-requests', require('./routes/fuelRequestRoutes'));
 *
 * ROUTE ORDER MATTERS — Express matches top-to-bottom.
 * All named static paths (/pending-for-me, /scheduled-for-me, /budget-alerts)
 * MUST come before the /:id wildcard.
 */

'use strict';

const express   = require('express');
const router    = express.Router();
const mongoose  = require('mongoose');

const FuelRequest  = require('../models/FuelRequest');
const SiteBudget   = require('../models/SiteBudget');
const Site         = require('../models/Site');
const User         = require('../models/User');
const { sendEmail } = require('../services/emailService');
const asyncHandler = require('../middlewares/asyncHandler');
const { APPROVAL_CHAIN,
  getFuelRequestApprovalChain,
  getNextStatus,
  FINANCE_OFFICER,
  FUEL_PRICE_PER_LITER,
} = require('../config/fuelRequestApprovalChain');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const logger = require('../utils/logger');

// ── Look up an approver's CURRENT email by role from the live, DB-backed
// APPROVAL_CHAIN (config/fuelRequestApprovalChain.js) instead of scattering
// hardcoded email literals through this file — those literals would go
// stale the moment an admin updates an approver via ApprovalChainConfig.
function emailFor(role) {
  const step = APPROVAL_CHAIN.find(s => s.role === role);
  return step?.email || null;
}
function emailsFor(...roles) {
  return roles.map(emailFor).filter(Boolean);
}

// ── Cycle key helper (safe — no DieselCycle model dependency) ─────────────────
function currentCycleKey(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Try DieselCycle static first, fall back to inline helper
async function resolveCycleKey() {
  try {
    const DieselCycle = require('../models/DieselCycle');
    if (typeof DieselCycle.getCycleKeyForDate === 'function') {
      return DieselCycle.getCycleKeyForDate(new Date());
    }
  } catch (_) { /* model not available */ }
  return currentCycleKey();
}

// ── Enrich docs from lean() with computed fields ──────────────────────────────
// lean() strips Mongoose virtuals so we add them back manually.
function enrichDoc(doc) {
  if (!doc) return doc;
  const approved  = doc.approvalChain?.filter(s => s.status === 'approved').length || 0;
  const total     = doc.approvalChain?.length || 1;
  doc.approval_progress_pct = Math.round((approved / total) * 100);
  doc.displayId   = `FUEL-${doc._id.toString().slice(-6).toUpperCase()}`;
  // xaf_requested/xaf_approved are real persisted fields — the model's
  // pre-save hook (models/FuelRequest.js) already computes them using the
  // site's real per-cycle fuel rate (SiteBudget.xaf_per_liter when set,
  // else the fleet default). This used to unconditionally RECOMPUTE and
  // overwrite them here using the flat fleet constant, silently discarding
  // the accurate site-specific figure on every list/get response. Now only
  // backfills when genuinely absent (records saved before this field existed).
  if (doc.xaf_requested == null) {
    doc.xaf_requested = Math.round((doc.liters_requested || 0) * (doc.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER));
  }
  if (doc.liters_approved != null && doc.xaf_approved == null) {
    doc.xaf_approved = Math.round(doc.liters_approved * (doc.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER));
  }
  doc.is_fully_approved = ['approved','scheduled','purchase_made','partially_refueled','refueled','completed'].includes(doc.status);
  return doc;
}

// ── Email: notify next approver ───────────────────────────────────────────────
async function notifyApprover(step, doc) {
  if (!step?.approver?.email) return;
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const link    = `${baseUrl}/diesel/fuel-requests?approve=${doc._id}`;
  try {
    await sendEmail({
      to:      step.approver.email,
      subject: `⛽ Fuel Request Approval Required — ${doc.site_name || doc.site_id}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <div style="background:#1a1a2e;color:#fff;padding:20px;border-radius:8px 8px 0 0">
            <h2 style="margin:0">⛽ Fuel Refueling Request</h2>
            <p style="margin:4px 0 0;font-size:13px;opacity:.8">Level ${step.level} — ${step.approver.role}</p>
          </div>
          <div style="background:#f9f9f9;padding:20px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb">
            <p>Dear <strong>${step.approver.name}</strong>,</p>
            <p>A fuel refueling request requires your approval.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:8px;font-weight:600;color:#555;width:40%">Request ID</td>
                  <td style="padding:8px">FUEL-${doc._id.toString().slice(-6).toUpperCase()}</td></tr>
              <tr style="background:#fff"><td style="padding:8px;font-weight:600;color:#555">Site</td>
                  <td style="padding:8px">${doc.site_name || doc.site_id}</td></tr>
              <tr><td style="padding:8px;font-weight:600;color:#555">Cluster</td>
                  <td style="padding:8px">${doc.cluster || '—'}</td></tr>
              <tr style="background:#fff"><td style="padding:8px;font-weight:600;color:#555">Litres Requested</td>
                  <td style="padding:8px"><strong>${doc.liters_requested} L</strong></td></tr>
              <tr><td style="padding:8px;font-weight:600;color:#555">XAF Equivalent</td>
                  <td style="padding:8px">XAF ${Math.round((doc.liters_requested || 0) * (doc.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER)).toLocaleString()}</td></tr>
              <tr style="background:#fff"><td style="padding:8px;font-weight:600;color:#555">Urgency</td>
                  <td style="padding:8px"><strong>${(doc.urgency || 'medium').toUpperCase()}</strong></td></tr>
              <tr><td style="padding:8px;font-weight:600;color:#555">Reason</td>
                  <td style="padding:8px">${doc.request_reason}</td></tr>
              <tr style="background:#fff"><td style="padding:8px;font-weight:600;color:#555">Current Fuel Level</td>
                  <td style="padding:8px">${doc.current_fuel_level ?? '—'} L (${doc.fuel_percentage_at_request ?? '—'}%)</td></tr>
              <tr><td style="padding:8px;font-weight:600;color:#555">Budget Remaining</td>
                  <td style="padding:8px">${doc.budget_snapshot?.budget_liters_remaining ?? '—'} L</td></tr>
            </table>
            <a href="${link}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">
              Review &amp; Approve →
            </a>
            <p style="color:#888;font-size:11px;margin-top:20px">Or copy: ${link}</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    logger.error(`[FuelRequest] notifyApprover failed for ${step.approver.email}: ${err.message}`);
  }
}

// ── Email: notify requester of outcome ───────────────────────────────────────
async function notifyRequester(doc, approved) {
  try {
    const requester = await User.findById(doc.requested_by).select('email fullName').lean();
    if (!requester?.email) return;
    const rejectedStep = doc.approvalChain?.find(s => s.status === 'rejected');
    await sendEmail({
      to:      requester.email,
      subject: approved
        ? `✅ Fuel Request Approved — ${doc.site_name}`
        : `❌ Fuel Request Rejected — ${doc.site_name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <h2>${approved ? '✅ Fuel Request Approved' : '❌ Fuel Request Rejected'}</h2>
          <p>Dear ${requester.fullName},</p>
          <p>Your fuel request for <strong>${doc.site_name || doc.site_id}</strong>
             has been <strong>${approved ? 'approved' : 'rejected'}</strong>.</p>
          <ul>
            <li><strong>Request ID:</strong> FUEL-${doc._id.toString().slice(-6).toUpperCase()}</li>
            <li><strong>Litres Requested:</strong> ${doc.liters_requested} L</li>
            ${approved && doc.liters_approved != null ? `<li><strong>Litres Approved:</strong> ${doc.liters_approved} L</li>` : ''}
            ${!approved && rejectedStep?.comments ? `<li><strong>Reason:</strong> ${rejectedStep.comments}</li>` : ''}
          </ul>
          ${approved
            ? '<p>The site will be scheduled for refueling. You will receive notification once a refueler is assigned.</p>'
            : '<p>Please contact your supervisor if you have questions.</p>'
          }
        </div>
      `,
    });
  } catch (err) {
    logger.error(`[FuelRequest] notifyRequester failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① POST / — create a new fuel request
// Web:    diesel_manager, admin
// Mobile: technician, fuel
// ─────────────────────────────────────────────────────────────────────────────
router.post('/',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'technician', 'fuel']),
  async (req, res) => {
    try {
      const {
        site_id, liters_requested, request_reason, urgency,
        current_fuel_level, tank_capacity, assigned_to, scheduled_date,
        client_id, request_source,
      } = req.body;

      // Idempotency — mobile offline queue may retry
      if (client_id) {
        const existing = await FuelRequest.findOne({ client_id }).lean();
        if (existing) {
          return res.status(200).json({ success: true, message: 'Already created', data: enrichDoc(existing) });
        }
      }

      if (!site_id)                       return res.status(400).json({ success: false, error: 'site_id is required' });
      if (!liters_requested || Number(liters_requested) <= 0)
        return res.status(400).json({ success: false, error: 'liters_requested must be > 0' });
      if (!request_reason?.trim())        return res.status(400).json({ success: false, error: 'request_reason is required' });

      // Resolve site — accept either IHS_ID_SITE or Mongo _id
      const site = await Site.findOne({
        $or: [
          { IHS_ID_SITE: site_id },
          { _id: mongoose.Types.ObjectId.isValid(site_id) ? new mongoose.Types.ObjectId(site_id) : null },
        ],
      }).select('Site_Name GRATO_Cluster Region IHS_ID_SITE Fuel_Quantity_Found Tank_Capacity_1').lean();
      if (!site) return res.status(404).json({ success: false, error: `Site not found: ${site_id}` });

      const cycle_key = await resolveCycleKey();

      // Budget snapshot
      const budget = await SiteBudget.findOne({ site_id: site.IHS_ID_SITE, cycle_key })
        .select('_id budget_liters budget_xaf').lean();

      const inFlightAgg = await FuelRequest.aggregate([
        {
          $match: {
            site_id:    site.IHS_ID_SITE,
            cycle_key,
            status:     { $nin: ['denied'] },
          },
        },
        { $group: { _id: null, total: { $sum: '$liters_requested' } } },
      ]);
      const litersInFlight       = inFlightAgg[0]?.total || 0;
      const budgetLitersTotal    = budget?.budget_liters || 0;
      const budgetLitersRemaining = Math.max(0, budgetLitersTotal - litersInFlight);

      // Budget near-exhaustion alert
      if (budget && budgetLitersRemaining < 50) {
        setImmediate(() => {
          sendEmail({
            to:      emailsFor('Diesel Coordinator', 'Operations Manager'),
            subject: `⚠️ Budget Alert — ${site.Site_Name} < 50 L remaining (${cycle_key})`,
            html:    `<p>Site <strong>${site.Site_Name}</strong> has only <strong>${budgetLitersRemaining.toFixed(0)} L</strong> remaining of its ${budgetLitersTotal} L cycle budget.</p>`,
          }).catch(() => {});
        });
      }

      const refuelCount = await FuelRequest.countCycleRefuels(site.IHS_ID_SITE, cycle_key);
      const chain       = getFuelRequestApprovalChain(Number(liters_requested));

      const fuelLevel = Number(current_fuel_level ?? site.Fuel_Quantity_Found ?? 0);
      const capacity  = Number(tank_capacity      ?? site.Tank_Capacity_1    ?? 0);
      const pct       = capacity > 0 ? Math.round((fuelLevel / capacity) * 100) : 0;

      const doc = new FuelRequest({
        client_id,
        site_id:            site.IHS_ID_SITE,
        site_name:          site.Site_Name,
        cluster:            site.GRATO_Cluster,
        region:             site.Region,
        cycle_key,
        liters_requested:   Number(liters_requested),
        urgency:            urgency || 'medium',
        request_reason:     request_reason.trim(),
        requested_by:       req.user.userId,
        requested_at:       new Date(),
        request_source:     request_source || (req.headers['x-platform'] === 'mobile' ? 'mobile' : 'web'),
        current_fuel_level: fuelLevel,
        tank_capacity:      capacity,
        fuel_percentage_at_request: pct,
        approvalChain:      chain,
        status:             'pending_diesel_coordinator',
        site_budget_id:     budget?._id,
        budget_snapshot: {
          budget_liters_total:     budgetLitersTotal,
          budget_liters_used:      litersInFlight,
          budget_liters_remaining: budgetLitersRemaining,
        },
        cycle_refuel_count: refuelCount,
        // Optional: pre-assign a technician if the manager already knows who'll do it
        ...(assigned_to    && { assigned_to }),
        ...(scheduled_date && { scheduled_date: new Date(scheduled_date) }),
      });

      await doc.save();
      setImmediate(() => notifyApprover(chain[0], doc));

      logger.info(`[FuelRequest] Created ${doc._id} for ${site.IHS_ID_SITE} (${liters_requested}L) by ${req.user.userId}`);
      return res.status(201).json({ success: true, data: enrichDoc(doc.toObject()) });

    } catch (err) {
      logger.error('[FuelRequest] POST / error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ② GET / — list with filters
// ─────────────────────────────────────────────────────────────────────────────
router.get('/',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor', 'technician', 'fuel', 'finance', 'head_of_business', 'ceo']),
  async (req, res) => {
    try {
      const { status, cycle_key, site_id, urgency, page = 1, limit = 50 } = req.query;

      const filter = {};
      if (status) {
        filter.status = status.includes(',')
          ? { $in: status.split(',').map(s => s.trim()) }
          : status;
      }
      if (cycle_key) filter.cycle_key = cycle_key;
      if (site_id)   filter.site_id   = site_id;
      if (urgency)   filter.urgency   = urgency;

      // Technicians/fuel only see their own requests
      if (['technician', 'fuel'].includes(req.user.role)) {
        filter.requested_by = req.user.userId;
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [docs, total] = await Promise.all([
        FuelRequest.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate('requested_by', 'fullName email role')
          .populate('assigned_to',  'fullName email phone')
          .lean(),
        FuelRequest.countDocuments(filter),
      ]);

      return res.json({
        success: true,
        data:    docs.map(enrichDoc),
        pagination: {
          current:  parseInt(page),
          pageSize: parseInt(limit),
          total,
          pages:    Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (err) {
      logger.error('[FuelRequest] GET / error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ③ GET /pending-for-me — approvals waiting for the authenticated user
// MUST be before GET /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pending-for-me',
  authenticateToken,
  async (req, res) => {
    try {
      const email = req.user.email?.toLowerCase();
      if (!email) return res.status(400).json({ success: false, error: 'User email not found on token' });

      const candidates = await FuelRequest.find({
        approvalChain: {
          $elemMatch: { 'approver.email': email, status: 'pending' },
        },
        status: { $nin: ['approved', 'denied', 'refueled', 'completed'] },
      })
        .populate('requested_by', 'fullName email')
        .lean();

      // Filter: only where ALL previous levels are approved
      const actionable = candidates.filter(doc => {
        const myStep = doc.approvalChain.find(
          s => s.approver.email?.toLowerCase() === email && s.status === 'pending'
        );
        if (!myStep) return false;
        return doc.approvalChain
          .filter(s => s.level < myStep.level)
          .every(s => s.status === 'approved');
      });

      return res.json({
        success: true,
        data:    actionable.map(enrichDoc),
        count:   actionable.length,
      });
    } catch (err) {
      logger.error('[FuelRequest] GET /pending-for-me error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ④ GET /scheduled-for-me — approved/scheduled requests for the refueler
// MUST be before GET /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/scheduled-for-me',
  authenticateToken,
  requireRole(['technician', 'fuel', 'diesel_manager', 'admin']),
  async (req, res) => {
    try {
      // For technicians: show requests assigned to them OR raised by them that are now scheduled
      // This catches both: (a) diesel manager explicitly assigned them, (b) auto-assigned on approval
      let filter;
      if (['technician', 'fuel'].includes(req.user.role)) {
        filter = {
          status: { $in: ['approved', 'scheduled', 'purchase_made', 'partially_refueled'] },
          $or: [
            { assigned_to:  req.user.userId },
            { requested_by: req.user.userId, status: { $in: ['scheduled', 'purchase_made', 'partially_refueled'] } },
          ],
        };
      } else {
        filter = { status: { $in: ['approved', 'scheduled', 'purchase_made', 'partially_refueled'] } };
      }

      const docs = await FuelRequest.find(filter)
        .sort({ urgency: -1, scheduled_date: 1 })
        .populate('requested_by', 'fullName')
        .lean();

      // Enrich with live site details
      const enriched = await Promise.all(
        docs.map(async d => {
          const site = await Site.findOne({ IHS_ID_SITE: d.site_id })
            .select('Site_Name Region GRATO_Cluster Fuel_Quantity_Found Tank_Capacity_1 Latitude Longitude Fuel_Level_Source')
            .lean();
          // Schema field is Tank_Capacity_1 — alias to Tank_Capacity on the
          // way out so existing consumers of this response shape keep working,
          // now with the real value instead of always-undefined.
          const site_details = site ? { ...site, Tank_Capacity: site.Tank_Capacity_1 } : site;
          return { ...enrichDoc(d), site_details };
        }),
      );

      return res.json({ success: true, data: enriched, count: enriched.length });
    } catch (err) {
      logger.error('[FuelRequest] GET /scheduled-for-me error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ GET /budget-alerts — sites with < threshold L remaining in current cycle
// MUST be before GET /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/budget-alerts',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor', 'finance', 'head_of_business', 'ceo']),
  async (req, res) => {
    try {
      const cycle_key = await resolveCycleKey();
      const thresh    = parseFloat(req.query.threshold_liters) || 50;

      // Sum all non-denied requests per site for this cycle
      const usedAgg = await FuelRequest.aggregate([
        { $match: { cycle_key, status: { $nin: ['denied'] } } },
        { $group: { _id: '$site_id', liters_in_flight: { $sum: '$liters_requested' } } },
      ]);
      const usedMap = new Map(usedAgg.map(r => [r._id, r.liters_in_flight]));

      const budgets = await SiteBudget.find({ cycle_key })
        .select('site_id site_name cluster budget_liters budget_xaf')
        .lean();

      const alerts = budgets
        .map(b => {
          const used      = usedMap.get(b.site_id) || 0;
          const remaining = Math.max(0, (b.budget_liters || 0) - used);
          return {
            site_id:          b.site_id,
            site_name:        b.site_name,
            cluster:          b.cluster,
            cycle_key,
            budget_liters:    b.budget_liters,
            budget_xaf:       b.budget_xaf,
            liters_used:      used,
            liters_remaining: remaining,
            pct_remaining:    b.budget_liters > 0 ? Math.round((remaining / b.budget_liters) * 100) : 0,
            alert_level:      remaining <= 0 ? 'exhausted' : remaining < 20 ? 'critical' : 'warning',
          };
        })
        .filter(b => b.liters_remaining < thresh)
        .sort((a, b) => a.liters_remaining - b.liters_remaining);

      return res.json({ success: true, data: alerts, count: alerts.length, cycle_key });
    } catch (err) {
      logger.error('[FuelRequest] GET /budget-alerts error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ GET /site/:site_id/cycle/:cycle_key — full lifecycle for one site × cycle
// MUST be before GET /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/site/:site_id/cycle/:cycle_key',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor', 'finance', 'head_of_business', 'ceo']),
  async (req, res) => {
    try {
      const { site_id, cycle_key } = req.params;

      const [requests, budget] = await Promise.all([
        FuelRequest.find({ site_id, cycle_key })
          .sort({ createdAt: -1 })
          .populate('requested_by', 'fullName email')
          .populate('assigned_to',  'fullName email phone')
          .lean(),
        SiteBudget.findOne({ site_id, cycle_key }).lean(),
      ]);

      const totalRequested = requests.reduce((s, r) => s + (r.liters_requested     || 0), 0);
      const totalApproved  = requests.reduce((s, r) => s + (r.liters_approved      || 0), 0);
      const totalRefueled  = requests.reduce((s, r) => s + (r.liters_actually_added || 0), 0);
      const refuelCount    = requests.filter(r => ['refueled','completed'].includes(r.status)).length;

      return res.json({
        success: true,
        data: {
          site_id, cycle_key,
          budget: budget || null,
          summary: {
            budget_liters:     budget?.budget_liters || 0,
            budget_xaf:        budget?.budget_xaf    || 0,
            total_requested:   totalRequested,
            total_approved:    totalApproved,
            total_refueled:    totalRefueled,
            remaining_budget:  Math.max(0, (budget?.budget_liters || 0) - totalRefueled),
            refuel_count:      refuelCount,
            over_refuel_alert: refuelCount > 3,
          },
          requests: requests.map(enrichDoc),
        },
      });
    } catch (err) {
      logger.error('[FuelRequest] GET /site/:id/cycle/:key error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
router.get('/sites',
  authenticateToken,
  requireRole(['technician', 'fuel', 'diesel_manager', 'admin', 'supervisor']),
  async (req, res) => {
    try {
      const { region, cluster, search } = req.query;
      const query = {};
      if (region)  query.Region        = region;
      if (cluster) query.GRATO_Cluster  = cluster;
      if (search) {
        const re = new RegExp(search, 'i');
        query.$or = [{ IHS_ID_SITE: re }, { Site_Name: re }];
      }
      const sites = await Site.find(query)
        .select('IHS_ID_SITE Site_Name GRATO_Cluster Region Fuel_Quantity_Found Tank_Capacity_1 Latitude Longitude is_fueling_site')
        .sort({ Site_Name: 1 })
        .limit(300)
        .lean();

      return res.json({
        success: true,
        count: sites.length,
        data: sites.map(s => ({
          _id: s._id,
          site_id: s.IHS_ID_SITE,
          name:    s.Site_Name,
          IHS_ID_SITE:         s.IHS_ID_SITE,
          GRATO_Cluster:       s.GRATO_Cluster,
          Region:              s.Region,
          Fuel_Quantity_Found: s.Fuel_Quantity_Found,
          // Schema field is Tank_Capacity_1 — output name kept as Tank_Capacity
          // for API-contract stability (mobile's Site type expects this key).
          Tank_Capacity:       s.Tank_Capacity_1,
          Latitude:            s.Latitude,
          Longitude:           s.Longitude,
          is_fueling_site:     s.is_fueling_site,
        })),
      });
    } catch (err) {
      logger.error('[FuelRequest] GET /sites error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);





// ─────────────────────────────────────────────────────────────────────────────
// ⑦ GET /:id — single request detail  (wildcard — MUST be last among GETs)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id',
  authenticateToken,
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid request ID' });
      }
      const doc = await FuelRequest.findById(req.params.id)
        .populate('requested_by', 'fullName email role phone')
        .populate('assigned_to',  'fullName email phone')
        .lean();
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });

      // Enrich with linked FuelConsumption and FuelPurchase so the frontend
      // can display workflow data, dip-stick readings, photos, and truck details
      let fuelConsumption = null;
      let fuelPurchase    = null;
      try {
        const FuelConsumption = require('../models/FuelConsumption');
        const FuelPurchase    = require('../models/FuelPurchase');

        if (doc.fuel_consumption_id) {
          // Direct link (preferred)
          fuelConsumption = await FuelConsumption.findById(doc.fuel_consumption_id).lean();
        }
        if (!fuelConsumption && doc.site_id && ['refueled','completed'].includes(doc.status)) {
          // Fallback: find the most recent consumption record for this site
          // (handles records created before the fuel_consumption_id link was implemented)
          fuelConsumption = await FuelConsumption
            .findOne({ site_id: doc.site_id })
            .sort({ createdAt: -1 })
            .lean();
        }

        if (doc.fuel_purchase_id) {
          fuelPurchase = await FuelPurchase.findById(doc.fuel_purchase_id).lean();
        }
        if (!fuelPurchase && fuelConsumption) {
          // Fallback: find purchase via consumption record reference
          const FuelPurchaseModel = require('../models/FuelPurchase');
          fuelPurchase = await FuelPurchaseModel
            .findOne({ 'allocations.fuel_consumption_id': fuelConsumption._id })
            .lean();
        }
      } catch (e) { logger.warn('[FuelRequest] GET /:id enrichment error:', e.message); }

      const enriched = enrichDoc(doc);
      enriched.fuel_consumption = fuelConsumption;
      enriched.fuel_purchase    = fuelPurchase;
      return res.json({ success: true, data: enriched });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id/emergency-approve
//
// Emergency override — bypasses all pending chain levels.
// Allowed roles: admin, head_of_business, ceo only.
//
// Rules:
//   • Marks every pending chain level as approved (with override note).
//   • Records the overrider as decidedBy on each skipped step.
//   • If liters_approved not supplied, defaults to liters_requested.
//   • Budget guard still runs — deficit zone still applies.
//   • Full audit trail: each step gets override_reason + overridden_by.
//   • Email fires to all chain members + requester explaining the override.
//   • Only works on requests that are NOT yet fully approved/refueled/denied.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/emergency-approve',
  authenticateToken,
  requireRole(['admin', 'head_of_business', 'ceo']),
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id))
        return res.status(400).json({ success: false, error: 'Invalid ID' });

      const { liters_approved: litresOverride, override_reason, comments } = req.body;
      if (!override_reason?.trim())
        return res.status(400).json({ success: false, error: 'override_reason is required for emergency approval' });

      const doc = await FuelRequest.findById(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });

      // Cannot override a request that is already in a terminal state
      const terminalStatuses = ['approved', 'denied', 'refueled', 'completed'];
      if (terminalStatuses.includes(doc.status))
        return res.status(400).json({
          success: false,
          error: `Cannot emergency-approve — request is already "${doc.status}"`,
        });

      const overrider = await User.findById(req.user.userId).select('fullName email role').lean();
      const now       = new Date();
      const nowTime   = now.toLocaleTimeString('en-GB');

      // Collect which steps were pending (for the audit email)
      const skippedSteps = [];

      // Mark ALL pending chain levels as approved with override metadata
      doc.approvalChain.forEach((step, idx) => {
        if (step.status === 'pending') {
          skippedSteps.push({ level: step.level, name: step.approver.name, role: step.approver.role });
          doc.approvalChain[idx].status          = 'approved';
          doc.approvalChain[idx].comments        = `EMERGENCY OVERRIDE by ${overrider?.fullName || req.user.email}: ${override_reason}`;
          doc.approvalChain[idx].actionDate      = now;
          doc.approvalChain[idx].actionTime      = nowTime;
          doc.approvalChain[idx].decidedBy       = req.user.userId;
          doc.approvalChain[idx].override_reason = override_reason;
          doc.approvalChain[idx].overridden_by   = req.user.userId;
        }
      });

      // Set liters_approved (Finance step logic applies even in override)
      doc.liters_approved = litresOverride != null ? Number(litresOverride) : doc.liters_requested;

      // Always record a finance_decision so the disbursement flow works
      if (!doc.finance_decision?.decision) {
        doc.finance_decision = {
          decision:        'approved',
          comments:        `Emergency override — ${override_reason}`,
          approved_liters: doc.liters_approved,
          decision_date:   now,
          decided_by:      req.user.userId,
        };
      }

      // Budget guard (same logic as normal Finance approval)
      try {
        const sb = await SiteBudget.findOne({ site_id: doc.site_id, cycle_key: doc.cycle_key });
        if (sb) {
          const xfIn      = (sb.transfers_in  || []).reduce((s, t) => s + t.liters, 0);
          const xfOut     = (sb.transfers_out || []).reduce((s, t) => s + t.liters, 0);
          const returned  = sb.liters_balance_returned || 0;
          const effective = (sb.budget_liters || 0) + xfIn - xfOut + returned;
          const alreadyUsed = (sb.liters_used || 0) + (sb.liters_committed || 0);
          const remaining   = effective - alreadyUsed;
          const toCommit    = doc.liters_approved;

          if (toCommit > remaining) {
            const deficit      = toCommit - Math.max(0, remaining);
            doc.in_deficit     = true;
            doc.deficit_liters = deficit;
            sb.in_deficit      = true;
            sb.deficit_liters  = (sb.deficit_liters || 0) + deficit;
            logger.warn(`[FuelRequest] EMERGENCY DEFICIT: site=${doc.site_id} approving ${toCommit}L, only ${remaining.toFixed(1)}L available`);
          }
          sb.liters_committed = (sb.liters_committed || 0) + toCommit;
          await sb.save();
        }
      } catch (sbErr) {
        logger.error('[FuelRequest] Emergency budget guard failed (non-fatal):', sbErr.message);
      }

      doc.status = 'approved';

      // Record the override at document level for top-level audit trail
      doc.emergency_override = {
        overridden_by:   req.user.userId,
        overrider_name:  overrider?.fullName || req.user.email,
        overrider_role:  overrider?.role,
        override_reason,
        overridden_at:   now,
        skipped_levels:  skippedSteps.map(s => s.level),
      };

      await doc.save();

      // Email every chain member + requester explaining what happened
      const allEmails = APPROVAL_CHAIN.map(s => s.email);
      const skippedNames = skippedSteps.map(s => `L${s.level} ${s.name} (${s.role})`).join(', ');
      setImmediate(() => {
        notifyRequester(doc, true);
        // Slack alert for emergency override (high visibility)
        const { sendSlackAlert } = require('../services/slackService');
        sendSlackAlert({
          title:  'Emergency Override — ' + (doc.site_name || doc.site_id),
          text:   'Approval bypassed by ' + (overrider?.fullName || req.user.email) + ' (' + (overrider?.role || 'unknown') + ')\nReason: ' + override_reason,
          color:  'danger',
          fields: [
            { label: 'Site',           value: doc.site_name || doc.site_id, short: true },
            { label: 'Litres approved',value: String(doc.liters_approved),  short: true },
            { label: 'Levels skipped', value: skippedSteps.map(function(s){ return 'L' + s.level + ' ' + s.name; }).join(', '), short: false },
          ],
        }).catch(function(){});
        sendEmail({
          to: allEmails,
          subject: `🚨 Emergency Approval — ${doc.site_name} by ${overrider?.fullName || req.user.email}`,
          html: `<p><strong>Emergency approval</strong> was issued for fuel request
                 <strong>FUEL-${doc._id.toString().slice(-6).toUpperCase()}</strong>
                 (${doc.site_name}, ${doc.liters_approved}L) by
                 <strong>${overrider?.fullName || req.user.email}</strong>
                 (${overrider?.role}).</p>
                 <p><strong>Reason:</strong> ${override_reason}</p>
                 <p><strong>Levels bypassed:</strong> ${skippedNames || 'None (request was already at override level)'}</p>
                 <p>Please acknowledge and arrange disbursement. The refueler will be notified separately.</p>`,
        }).catch(() => {});
      });

      auditLog({ action: 'fuel_request.emergency_override', entityType: 'FuelRequest', entityId: doc._id, actor: req.user, cycleKey: doc.cycle_key, metadata: { site: doc.site_name, override_reason, skipped_levels: skippedSteps.map(s => s.level) } }).catch(()=>{});
      logger.info(
        `[FuelRequest] EMERGENCY OVERRIDE: ${doc._id} by ${req.user.email} ` +
        `(${overrider?.role}) — skipped: ${skippedNames}`
      );

      return res.json({
        success:       true,
        data:          enrichDoc(doc.toObject()),
        skipped_steps: skippedSteps,
        message:       `Emergency approval granted. ${skippedSteps.length} chain level(s) bypassed.`,
      });

    } catch (err) {
      logger.error('[FuelRequest] PATCH /emergency-approve error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ PATCH /:id/approve
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/approve',
  authenticateToken,
  async (req, res) => {
    try {
      const { comments, liters_approved: litresOverride } = req.body;
      const user = await User.findById(req.user.userId).select('email fullName').lean();
      if (!user?.email) return res.status(401).json({ success: false, error: 'User not found' });

      const doc = await FuelRequest.findById(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });

      const email      = user.email.toLowerCase();
      const myStepIdx  = doc.approvalChain.findIndex(
        s => s.approver.email?.toLowerCase() === email && s.status === 'pending'
      );
      if (myStepIdx === -1)
        return res.status(403).json({ success: false, error: 'No pending approval step for you on this request' });

      const myStep = doc.approvalChain[myStepIdx];
      const prevOk = doc.approvalChain
        .filter(s => s.level < myStep.level)
        .every(s => s.status === 'approved');
      if (!prevOk)
        return res.status(400).json({ success: false, error: 'Previous approval levels not yet complete' });

      // Record this approval
      doc.approvalChain[myStepIdx].status     = 'approved';
      doc.approvalChain[myStepIdx].comments   = comments || '';
      doc.approvalChain[myStepIdx].actionDate = new Date();
      doc.approvalChain[myStepIdx].actionTime = new Date().toLocaleTimeString('en-GB');
      doc.approvalChain[myStepIdx].decidedBy  = req.user.userId;

      // Finance step: set liters_approved + budget guard + commit reservation
      // Identified by ROLE, not by comparing against the static default
      // email — that comparison would silently break the moment an admin
      // changes the Finance officer's email via ApprovalChainConfig, since
      // FINANCE_OFFICER here is only the hardcoded fallback default.
      if (myStep.approver.role === 'Finance Officer') {
        doc.liters_approved = litresOverride != null ? Number(litresOverride) : doc.liters_requested;
        doc.finance_decision = {
          decision:        'approved',
          comments:        comments || '',
          approved_liters: doc.liters_approved,
          decision_date:   new Date(),
          decided_by:      req.user.userId,
        };

        // ── Budget guard + deficit zone ──────────────────────────────────────────
        try {
          const sb = await SiteBudget.findOne({ site_id: doc.site_id, cycle_key: doc.cycle_key });
          if (sb) {
            const xfIn      = (sb.transfers_in  || []).reduce((s, t) => s + t.liters, 0);
            const xfOut     = (sb.transfers_out || []).reduce((s, t) => s + t.liters, 0);
            const returned  = sb.liters_balance_returned || 0;
            const effective = (sb.budget_liters || 0) + xfIn - xfOut + returned;
            const alreadyUsed = (sb.liters_used || 0) + (sb.liters_committed || 0);
            const remaining = effective - alreadyUsed;
            const toCommit  = doc.liters_approved;

            if (toCommit > remaining) {
              // Enter deficit — still approved, but flagged
              const deficit = toCommit - Math.max(0, remaining);
              doc.in_deficit     = true;
              doc.deficit_liters = deficit;
              sb.in_deficit     = true;
              sb.deficit_liters = (sb.deficit_liters || 0) + deficit;
              logger.warn(`[FuelRequest] DEFICIT APPROVAL: site=${doc.site_id} approving ${toCommit}L, only ${remaining.toFixed(1)}L available, deficit=${deficit.toFixed(1)}L`);
              const hobStep = doc.approvalChain.find(s => s.approver.role === 'Head of Business');
              setImmediate(() => sendEmail({
                to: [myStep.approver.email, hobStep?.approver?.email].filter(Boolean),
                subject: `⚠️ Budget Deficit — ${doc.site_name} (${deficit.toFixed(1)}L over budget)`,
                html: `<p>Fuel request for <strong>${doc.site_name}</strong> approved for <strong>${toCommit}L</strong>
                       but only <strong>${remaining.toFixed(1)}L</strong> remains in ${doc.cycle_key} budget.<br/>
                       Deficit: <strong>${deficit.toFixed(1)}L</strong> = XAF ${Math.round(deficit * (sb.xaf_per_liter||828)).toLocaleString()}<br/>
                       Action required: transfer fuel from another cluster or request budget extension.</p>`,
              }).catch(()=>{}));
            }

            // Reserve committed litres (will only become liters_used when refuel form submitted)
            sb.liters_committed = (sb.liters_committed || 0) + toCommit;
            await sb.save();
          }
        } catch (sbErr) {
          logger.error('[FuelRequest] Budget guard failed (non-fatal):', sbErr.message);
        }
      }

      const totalLevels = doc.approvalChain.length;
      const nextStatus  = getNextStatus(myStep.level, totalLevels, doc.liters_requested);
      doc.status        = nextStatus;

      // When fully approved, immediately transition to 'scheduled' so it
      // appears under Refueling Management on the ScheduledPage
      if (nextStatus === 'approved') {
        doc.status       = 'scheduled';
        doc.approved_at  = new Date();

        // Auto-assign: if the request was raised by a technician or fuel role
        // and no explicit refueler has been assigned yet, assign it back to
        // the requester so it appears on their mobile "scheduled for me" list.
        if (!doc.assigned_to && doc.requested_by) {
          const requester = await User.findById(doc.requested_by).select('role').lean();
          const mobileRoles = ['technician', 'fuel'];
          if (requester && mobileRoles.includes(requester.role)) {
            doc.assigned_to  = doc.requested_by;
            doc.assigned_at  = new Date();
            logger.info(`[FuelRequest] Auto-assigned ${doc._id} to requester ${doc.requested_by} (${requester.role})`);
          }
        }
      }

      // Activate next step
      const nextStep = doc.approvalChain.find(s => s.level === myStep.level + 1);
      if (nextStep) nextStep.assignedDate = new Date();

      await doc.save();

      // Notifications
      if (nextStatus === 'approved') {
        setImmediate(() => {
          notifyRequester(doc, true);
          const financeStep = doc.approvalChain.find(s => s.approver.role === 'Finance Officer');
          sendEmail({
            to:      financeStep?.approver?.email || FINANCE_OFFICER.email,
            subject: `💰 Fuel Request Fully Approved — ${doc.site_name} (${doc.liters_approved ?? doc.liters_requested} L)`,
            html:    `<p>Fuel request <strong>FUEL-${doc._id.toString().slice(-6).toUpperCase()}</strong> for
                      <strong>${doc.site_name}</strong> has been fully approved for
                      <strong>${doc.liters_approved ?? doc.liters_requested} L</strong>
                      (XAF ${Math.round((doc.liters_approved ?? doc.liters_requested) * (doc.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER)).toLocaleString()}).
                      Please assign a refueler.</p>`,
          }).catch(() => {});
        });
      } else if (nextStep) {
        setImmediate(async () => {
          notifyApprover(nextStep, doc);
          // Also send a push notification to the next approver
          try {
            const { sendPushToUser } = require('./technicians');
            const nextUser = await require('../models/User').findOne({ email: nextStep.approver.email }).lean();
            if (nextUser?._id) {
              await sendPushToUser(
                nextUser._id,
                '⛽ Fuel Request Needs Your Approval',
                `${doc.site_name} — ${doc.liters_requested}L (${doc.urgency?.toUpperCase() || 'NORMAL'} urgency). Tap to review.`,
                { type: 'fuel_approval', requestId: doc._id.toString() }
              );
            }
          } catch (e) { logger.warn('[FuelRequest] Push to approver failed:', e.message); }
        });
      }

      logger.info(`[FuelRequest] ${doc._id} approved at L${myStep.level} by ${email} → ${nextStatus}`);
      return res.json({ success: true, data: enrichDoc(doc.toObject()), nextStatus });

    } catch (err) {
      logger.error('[FuelRequest] PATCH /approve error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ PATCH /:id/reject
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/reject',
  authenticateToken,
  async (req, res) => {
    try {
      const { comments } = req.body;
      if (!comments?.trim())
        return res.status(400).json({ success: false, error: 'Comments (reason) are required when rejecting' });

      const user = await User.findById(req.user.userId).select('email fullName').lean();
      if (!user?.email) return res.status(401).json({ success: false, error: 'User not found' });

      const doc = await FuelRequest.findById(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });

      const email     = user.email.toLowerCase();
      const myStepIdx = doc.approvalChain.findIndex(
        s => s.approver.email?.toLowerCase() === email && s.status === 'pending'
      );
      if (myStepIdx === -1)
        return res.status(403).json({ success: false, error: 'No pending approval step for you' });

      doc.approvalChain[myStepIdx].status     = 'rejected';
      doc.approvalChain[myStepIdx].comments   = comments;
      doc.approvalChain[myStepIdx].actionDate = new Date();
      doc.approvalChain[myStepIdx].actionTime = new Date().toLocaleTimeString('en-GB');
      doc.approvalChain[myStepIdx].decidedBy  = req.user.userId;
      doc.status = 'denied';

      await doc.save();
      auditLog({ action: 'fuel_request.denied', entityType: 'FuelRequest', entityId: doc._id, actor: req.user, cycleKey: doc.cycle_key, metadata: { site: doc.site_name, reason: req.body.comments } }).catch(function(){});
      setImmediate(() => notifyRequester(doc, false));

      // ── Rollback liters_committed on denial ──────────────────────────────────
      setImmediate(async () => {
        try {
          const committed = doc.liters_approved || doc.liters_requested || 0;
          const sb = await SiteBudget.findOne({ site_id: doc.site_id, cycle_key: doc.cycle_key });
          if (sb && committed > 0) {
            sb.liters_committed = Math.max(0, (sb.liters_committed || 0) - committed);
            if (doc.in_deficit && doc.deficit_liters) {
              sb.deficit_liters = Math.max(0, (sb.deficit_liters || 0) - doc.deficit_liters);
              if (sb.deficit_liters === 0) sb.in_deficit = false;
            }
            await sb.save();
            logger.info(`[FuelRequest] Denial rollback: released ${committed}L for site ${doc.site_id}`);
          }
        } catch (e) { logger.error('[FuelRequest] Denial rollback:', e.message); }
      });

      logger.info(`[FuelRequest] ${doc._id} rejected at L${doc.approvalChain[myStepIdx].level} by ${email}`);
      return res.json({ success: true, data: enrichDoc(doc.toObject()) });

    } catch (err) {
      logger.error('[FuelRequest] PATCH /reject error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑩ PATCH /:id/assign — assign a refueler after full approval
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/assign',
  authenticateToken,
  requireRole(['diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { assigned_to, scheduled_date } = req.body;
      if (!assigned_to) return res.status(400).json({ success: false, error: 'assigned_to is required' });

      const doc = await FuelRequest.findById(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      if (doc.status !== 'approved')
        return res.status(400).json({
          success: false,
          error: `Cannot assign — status is "${doc.status}", must be "approved"`,
        });

      const refueler = await User.findById(assigned_to).select('fullName email').lean();
      if (!refueler) return res.status(404).json({ success: false, error: 'Refueler user not found' });

      doc.assigned_to    = assigned_to;
      doc.assigned_at    = new Date();
      doc.scheduled_date = scheduled_date ? new Date(scheduled_date) : undefined;
      doc.status         = 'scheduled';
      await doc.save();

      setImmediate(() => {
        sendEmail({
          to:      refueler.email,
          subject: `⛽ Refueling Task Assigned — ${doc.site_name}`,
          html:    `<p>Dear ${refueler.fullName},</p>
                   <p>You have been assigned to refuel <strong>${doc.site_name}</strong>.</p>
                   <ul>
                     <li><strong>Site:</strong> ${doc.site_name} (${doc.site_id})</li>
                     <li><strong>Cluster:</strong> ${doc.cluster || '—'}</li>
                     <li><strong>Litres Approved:</strong> ${doc.liters_approved ?? doc.liters_requested} L</li>
                     ${scheduled_date ? `<li><strong>Scheduled:</strong> ${new Date(scheduled_date).toLocaleDateString('en-GB')}</li>` : ''}
                   </ul>
                   <p>Please open the GRATO mobile app to activate this site for refueling.</p>`,
        }).catch(() => {});
      });

      logger.info(`[FuelRequest] ${doc._id} assigned to ${refueler.email} → scheduled`);

      // Push notification to the assigned refueler
      setImmediate(async () => {
        try {
          const { sendPushToUser } = require('./technicians');
          await sendPushToUser(
            assigned_to,
            '⛽ Refueling Task Assigned',
            `${doc.site_name} — ${doc.liters_approved ?? doc.liters_requested}L. Open the app to start.`,
            { type: 'fuel_assignment', requestId: doc._id.toString(), site_name: doc.site_name }
          );
        } catch (e) { logger.warn('[FuelRequest] Push to refueler failed:', e.message); }
      });

      return res.json({ success: true, data: enrichDoc(doc.toObject()) });

    } catch (err) {
      logger.error('[FuelRequest] PATCH /assign error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑪ PATCH /:id/link-refuel — close the lifecycle loop after actual refuel
// Called from technicianRoutes POST /refuel via linkRefuelToRequest()
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/link-refuel',
  authenticateToken,
  requireRole(['technician', 'fuel', 'diesel_manager', 'admin']),
  async (req, res) => {
    try {
      const { fuel_consumption_id, fuel_purchase_id, liters_actually_added } = req.body;
      const doc = await FuelRequest.findById(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });

      if (fuel_consumption_id) doc.fuel_consumption_id  = fuel_consumption_id;
      if (fuel_purchase_id)    doc.fuel_purchase_id     = fuel_purchase_id;
      if (liters_actually_added != null) doc.liters_actually_added = Number(liters_actually_added);
      doc.status = 'refueled';

      // Over-refuel count + alert
      const cycleCount       = await FuelRequest.countCycleRefuels(doc.site_id, doc.cycle_key);
      doc.cycle_refuel_count = cycleCount + 1;

      if (doc.cycle_refuel_count > 3 && !doc.over_refuel_alert_sent) {
        doc.over_refuel_alert_sent = true;
        setImmediate(() => {
          sendEmail({
            to: emailsFor('Diesel Coordinator', 'Operations Manager', 'Technical Director'),
            subject: `⚠️ Over-Refuel Alert — ${doc.site_name} refueled ${doc.cycle_refuel_count}× this cycle`,
            html:    `<p>Site <strong>${doc.site_name}</strong> has been refueled
                      <strong>${doc.cycle_refuel_count} times</strong> in cycle
                      <strong>${doc.cycle_key}</strong>, exceeding the 3-refuel threshold. Please investigate.</p>`,
          }).catch(() => {});
        });
      }

      await doc.save();
      return res.json({ success: true, data: enrichDoc(doc.toObject()) });

    } catch (err) {
      logger.error('[FuelRequest] PATCH /link-refuel error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id/cancel — cancel a request before it reaches Finance (L4)
//
// Allowed: original requester OR diesel_manager OR admin
// Allowed statuses: pending_l1, pending_l2, pending_l3 only
// Effect: releases liters_committed, marks status = 'cancelled'
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/cancel',
  authenticateToken,
  requireRole(['technician', 'fuel', 'diesel_manager', 'admin', 'supervisor']),
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ success: false, error: 'Invalid ID' });

    const doc = await FuelRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'Not found' });

    // Only the original requester or a manager can cancel
    const isRequester = doc.requested_by?.toString() === req.user.userId;
    const isManager   = ['diesel_manager', 'admin', 'supervisor'].includes(req.user.role);
    if (!isRequester && !isManager)
      return res.status(403).json({ success: false, error: 'Only the original requester or a manager can cancel this request.' });

    // Can only cancel before Finance approves (L1–L3 only)
    const cancelableStatuses = ['pending_l1', 'pending_l2', 'pending_l3'];
    if (!cancelableStatuses.includes(doc.status))
      return res.status(400).json({
        success: false,
        error: `Cannot cancel — request is already at status "${doc.status}". Contact Finance or HOB to reject it instead.`,
      });

    const { reason } = req.body;
    doc.status           = 'cancelled';
    doc.cancellation_reason = reason || 'Cancelled by requester';
    doc.cancelled_at     = new Date();
    doc.cancelled_by     = req.user.userId;
    await doc.save();

    // Release liters_committed if any was reserved
    setImmediate(async () => {
      try {
        const committed = doc.liters_approved || doc.liters_requested || 0;
        const sb = await SiteBudget.findOne({ site_id: doc.site_id, cycle_key: doc.cycle_key });
        if (sb && committed > 0) {
          sb.liters_committed = Math.max(0, (sb.liters_committed || 0) - committed);
          await sb.save();
          logger.info(`[FuelRequest] Cancellation: released ${committed}L committed for ${doc.site_id}`);
        }
      } catch (e) { logger.error('[FuelRequest] Cancel rollback failed:', e.message); }
    });

    logger.info(`[FuelRequest] ${doc._id} cancelled by ${req.user.email} (${req.user.role})`);
    return res.json({ success: true, message: 'Request cancelled successfully', data: enrichDoc(doc.toObject()) });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// linkRefuelToRequest — exported helper called by technicianRoutes POST /refuel
//
// BUSINESS RULES:
// 1. liters_used is ONLY updated here — on actual form submission, not on approval
// 2. Only liters_actually_added is deducted from SiteBudget.liters_used
// 3. If liters_actually_added < liters_approved → balance returned to SiteBudget
// 4. Balance is tracked (liters_balance_returned) for audit/reuse reference
// 5. Tom Card details from the form are saved to the FuelRequest record
// ─────────────────────────────────────────────────────────────────────────────
async function linkRefuelToRequest(site_id, technicianId, payload) {
  const {
    fuel_consumption_id, fuel_purchase_id,
    liters_actually_added,
    // Explicit signal from the technician: is this delivery finishing the
    // request (tank now full / fully delivered), or is there more to
    // come (this delivery only used what was available from an existing
    // purchase's leftover balance, and a follow-up trip is expected)?
    // Defaults to true for backward compatibility with any mobile client
    // that doesn't send it yet — preserves the original "always closes
    // the request" behavior rather than silently leaving old clients'
    // requests stuck open.
    delivery_complete,
    // Tom Card details (from refueling form)
    tom_card_number, tom_card_station, tom_card_receipt_num,
    tom_card_unit_price, tom_card_total_cfa,
  } = payload;

  try {
    const doc = await FuelRequest.findOne({
      site_id,
      // Include 'partially_refueled' so a follow-up delivery finds and
      // updates the SAME still-open request instead of failing to match
      // anything (or, worse, a fresh auto/manual request being raised
      // for the remainder and fragmenting the same need across two
      // separate FuelRequest documents).
      status: { $in: ['scheduled', 'purchase_made', 'approved', 'partially_refueled'] },
      $or: [
        { assigned_to: technicianId },
        { requested_by: technicianId },
      ],
    }).sort({ createdAt: -1 });

    if (!doc) {
      logger.info(`[FuelRequest] linkRefuelToRequest: no open request found for ${site_id}`);
      return null;
    }

    // ── 1. Link consumption and purchase records ──────────────────────────────
    // For a multi-delivery request, these end up pointing at the MOST
    // RECENT delivery's records — the full history of every delivery
    // (including every fuel_consumption_id/fuel_purchase_id) lives in
    // doc.deliveries below, so nothing is lost by this being "latest only".
    if (fuel_consumption_id) doc.fuel_consumption_id = fuel_consumption_id;
    if (fuel_purchase_id)    doc.fuel_purchase_id    = fuel_purchase_id;

    // ── 2. Record Tom Card details from the form ──────────────────────────────
    if (tom_card_number)    doc.tom_card_number     = tom_card_number;
    if (tom_card_station)   doc.tom_card_station    = tom_card_station;
    if (tom_card_receipt_num) doc.tom_card_receipt_num = tom_card_receipt_num;
    if (tom_card_unit_price)  doc.tom_card_unit_price  = tom_card_unit_price;
    if (tom_card_total_cfa)   doc.tom_card_total_cfa   = tom_card_total_cfa;

    const addedThisTrip = liters_actually_added != null ? Number(liters_actually_added) : 0;
    const approved       = doc.liters_approved || doc.liters_requested;
    const previousTotal   = doc.liters_actually_added || 0;
    const totalAdded      = previousTotal + addedThisTrip;
    // Backward-compatible default: no explicit signal = treat as final,
    // matching the original (pre-fix) behavior for any older client.
    const isFinalDelivery = delivery_complete !== false;

    doc.liters_actually_added = totalAdded; // cumulative, not overwritten
    doc.deliveries = doc.deliveries || [];
    doc.deliveries.push({
      liters_added:        addedThisTrip,
      delivered_at:         new Date(),
      fuel_consumption_id:  fuel_consumption_id || undefined,
      fuel_purchase_id:     fuel_purchase_id || undefined,
      delivered_by:         technicianId,
      was_final_delivery:   isFinalDelivery,
    });

    // A request is only genuinely complete when EITHER the technician
    // explicitly says so (tank full / nothing more to give) OR the
    // cumulative total already meets/exceeds what was approved — whichever
    // comes first. Otherwise it stays open as 'partially_refueled' so it
    // remains visible on the technician's active list instead of silently
    // disappearing with 30L still genuinely owed.
    const requestComplete = isFinalDelivery || totalAdded >= approved;
    doc.status = requestComplete ? 'refueled' : 'partially_refueled';

    // ── 3. Calculate balance returned ──────────────────────────────────────────
    // Only meaningful — and only ever released — once the request is
    // actually complete. A mid-flight partial delivery must NOT report or
    // release a "balance returned", since nothing has actually been
    // decided as unneeded yet; the remaining approved-but-undelivered
    // liters are still expected to be used on a follow-up trip.
    const balanceReturned = requestComplete ? Math.max(0, approved - totalAdded) : 0;
    if (requestComplete && balanceReturned > 0) {
      doc.liters_balance_returned = balanceReturned;
      doc.balance_return_reason   = `Tank capacity reached — ${balanceReturned.toFixed(1)}L returned to site budget`;
      doc.balance_returned_at     = new Date();
      logger.info(`[FuelRequest] ${doc._id}: ${totalAdded}L total added, ${balanceReturned}L returned to budget`);
    } else if (!requestComplete) {
      logger.info(`[FuelRequest] ${doc._id}: PARTIAL delivery — ${addedThisTrip}L added this trip (${totalAdded}/${approved}L total so far), ${(approved - totalAdded).toFixed(1)}L still owed and remains reserved.`);
    }

    // ── 4. Update SiteBudget — ONLY on actual form submission ─────────────────
    // Rules (fixed from the original single-delivery-only version):
    //   liters_used      += addedThisTrip           (what physically went in the tank, this trip)
    //   liters_committed -= addedThisTrip            (that much is no longer just "reserved", it's spent)
    //   liters_committed -= balanceReturned          (ONLY on the final delivery: release genuine unneeded surplus)
    // Critically: on a PARTIAL delivery, balanceReturned is 0, so the
    // remaining (approved - totalAdded) liters stay held in
    // liters_committed — protected from being consumed by some other
    // request in the meantime — until the follow-up delivery actually
    // happens or the technician marks the request complete.
    try {
      const sb = await SiteBudget.findOne({ site_id: doc.site_id, cycle_key: doc.cycle_key });
      if (sb) {
        sb.liters_used              = Math.max(0, (sb.liters_used || 0) + addedThisTrip);
        sb.liters_committed         = Math.max(0, (sb.liters_committed || 0) - addedThisTrip - balanceReturned);
        sb.liters_balance_returned  = (sb.liters_balance_returned || 0) + balanceReturned;

        // If we were in deficit, check if we should resolve it
        if (sb.in_deficit && sb.liters_used <= (sb.effective_budget_liters || sb.budget_liters || 0)) {
          sb.in_deficit     = false;
          sb.deficit_liters = 0;
        }

        await sb.save();
        logger.info(`[FuelRequest] SiteBudget updated: site=${doc.site_id} used=${sb.liters_used} committed=${sb.liters_committed} returned=${sb.liters_balance_returned}`);
      }
    } catch (sbErr) {
      logger.error(`[FuelRequest] SiteBudget update failed (non-fatal): ${sbErr.message}`);
    }

    // ── 5. Over-refuel alert ──────────────────────────────────────────────────
    // Only counts a completed refuel toward the cycle count — a partial
    // delivery isn't "a refuel" in the over-refuel-frequency sense yet,
    // it's one leg of a single refuel that's still in progress.
    if (requestComplete) {
      const cycleCount       = await FuelRequest.countCycleRefuels(doc.site_id, doc.cycle_key);
      doc.cycle_refuel_count = cycleCount + 1;

      if (doc.cycle_refuel_count > 3 && !doc.over_refuel_alert_sent) {
        doc.over_refuel_alert_sent = true;
        sendEmail({
          to: emailsFor('Diesel Coordinator', 'Operations Manager', 'Technical Director'),
          subject: `⚠️ Over-Refuel Alert — ${doc.site_name} (${doc.cycle_refuel_count}× this cycle)`,
          html: `<p>Site <strong>${doc.site_name}</strong> has been refueled <strong>${doc.cycle_refuel_count} times</strong> in ${doc.cycle_key}.</p>
                 <p>Most recent: ${totalAdded}L added (${approved}L was approved, ${balanceReturned}L returned).</p>`,
        }).catch(() => {});
      }
    }

    // ── 6. Auto-match Tom Card transaction ─────────────────────────────────────
    if (tom_card_number && tom_card_total_cfa && !doc.tomcard_transaction_id) {
      setImmediate(async () => {
        try {
          const TomCardTransaction = require('../models/TomCardTransaction');
          const match = await TomCardTransaction.findOne({
            card_num:   tom_card_number,
            cycle_key:  doc.cycle_key,
            reconciled: false,
            amount_cfa: { $gte: tom_card_total_cfa * 0.98, $lte: tom_card_total_cfa * 1.02 },
          }).sort({ date: -1 });
          if (match) {
            doc.tomcard_transaction_id = match._id;
            match.reconciled      = true;
            match.site_id         = doc.site_id;
            match.reconciliation_note = `Auto-matched to FuelRequest ${doc._id}`;
            await Promise.all([doc.save(), match.save()]);
            logger.info(`[FuelRequest] Auto-matched TomCard txn ${match._id} to request ${doc._id}`);
          }
        } catch (e) { logger.error('[FuelRequest] TomCard auto-match failed:', e.message); }
      });
    }

    await doc.save();
    logger.info(`[FuelRequest] Linked: request=${doc._id} site=${site_id} addedThisTrip=${addedThisTrip}L totalAdded=${totalAdded}L approved=${approved}L balance=${balanceReturned}L status=${doc.status}`);
    return doc;

  } catch (err) {
    logger.error(`[FuelRequest] linkRefuelToRequest error for ${site_id}: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑫ PATCH /:id/disburse — Finance records actual payment/disbursement
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/disburse',
  authenticateToken,
  requireRole(['finance', 'admin']),
  async (req, res) => {
    try {
      const { reference_number, actual_xaf, payment_method, disbursed_by } = req.body;
      if (!reference_number?.trim())
        return res.status(400).json({ success: false, error: 'reference_number is required' });

      if (!mongoose.Types.ObjectId.isValid(req.params.id))
        return res.status(400).json({ success: false, error: 'Invalid ID' });

      const doc = await FuelRequest.findById(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
      if (!['approved', 'scheduled'].includes(doc.status))
        return res.status(400).json({
          success: false,
          error: `Cannot disburse — status is "${doc.status}", must be "approved" or "scheduled"`,
        });

      const xaf = actual_xaf || (doc.liters_approved || doc.liters_requested) * (doc.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER);

      doc.disbursement = {
        reference_number: reference_number.trim(),
        actual_xaf:       xaf,
        payment_method:   payment_method || 'bank_transfer',
        disbursed_by:     disbursed_by || req.user.email,
        disbursed_at:     new Date(),
      };
      doc.disbursed_at = new Date();
      await doc.save();

      // Notify diesel manager + coordinator that funds are released
      setImmediate(() => {
        sendEmail({
          to: emailsFor('Diesel Coordinator', 'Operations Manager'),
          subject: `💰 Fuel Funds Disbursed — ${doc.site_name} (Ref: ${reference_number})`,
          html: `<p>Finance has disbursed <strong>XAF ${xaf.toLocaleString()}</strong>
                 for the fuel request at <strong>${doc.site_name}</strong>.<br/>
                 Reference: <strong>${reference_number}</strong> · Method: ${payment_method || 'bank_transfer'}.</p>
                 <p>Please proceed with fuel purchase and schedule the refueling trip.</p>`,
        }).catch(() => {});
      });

      logger.info(`[FuelRequest] ${doc._id} disbursed by ${req.user.email} ref=${reference_number} xaf=${xaf}`);
      return res.json({ success: true, data: enrichDoc(doc.toObject()) });
    } catch (err) {
      logger.error('[FuelRequest] PATCH /disburse error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ⑬ GET /finance-report/:cycle_key — Finance dashboard analytics endpoint
// ─────────────────────────────────────────────────────────────────────────────
router.get('/finance-report/:cycle_key',
  authenticateToken,
  requireRole(['finance', 'admin', 'head_of_business', 'ceo']),
  async (req, res) => {
    try {
      const { cycle_key } = req.params;
      const requests = await FuelRequest.find({ cycle_key })
        .populate('requested_by', 'fullName email')
        .populate('assigned_to', 'fullName email')
        .lean();

      const approved  = requests.filter(r => !r.status.startsWith('pending_') && r.status !== 'denied');
      const denied    = requests.filter(r => r.status === 'denied');
      const refueled  = requests.filter(r => ['refueled', 'completed'].includes(r.status));
      const disbursed = requests.filter(r => r.disbursed_at);

      const totalLRequested  = requests.reduce((s, r) => s + r.liters_requested, 0);
      const totalLApproved   = approved.reduce((s, r) => s + (r.liters_approved || r.liters_requested), 0);
      const totalLRefueled   = refueled.reduce((s, r) => s + (r.liters_actually_added || 0), 0);
      // Per-request rate (respects site-specific SiteBudget.xaf_per_liter),
      // not one flat multiplication across the whole cycle — sites can be on
      // different vendor rates in the same cycle.
      const totalXAFApproved = approved.reduce((s, r) =>
        s + (r.liters_approved || r.liters_requested) * (r.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER), 0);
      const totalXAFDisbursed= disbursed.reduce((s, r) => s + (r.disbursement?.actual_xaf || 0), 0);

      // Finance overrides (where Finance reduced amount)
      const overrides = approved.filter(r => r.liters_approved != null && r.liters_approved !== r.liters_requested);
      const liters_saved_by_finance = overrides.reduce((s, r) => s + (r.liters_requested - (r.liters_approved || 0)), 0);
      // Sum XAF saved per-request at each request's own rate, rather than
      // multiplying the pre-summed liters total by one flat rate — overrides
      // can span sites with different SiteBudget.xaf_per_liter values.
      const xaf_saved_by_finance = overrides.reduce((s, r) =>
        s + (r.liters_requested - (r.liters_approved || 0)) * (r.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER), 0);

      // Cluster breakdown
      const byCluster = {};
      requests.forEach(r => {
        const c = r.cluster || 'Unknown';
        if (!byCluster[c]) byCluster[c] = { count: 0, liters_requested: 0, liters_approved: 0, xaf: 0, refueled: 0 };
        byCluster[c].count++;
        byCluster[c].liters_requested += r.liters_requested;
        byCluster[c].liters_approved  += r.liters_approved || r.liters_requested;
        byCluster[c].xaf              += (r.liters_approved || r.liters_requested) * (r.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER);
        if (['refueled', 'completed'].includes(r.status)) byCluster[c].refueled++;
      });

      // Join SiteBudget aggregate for budget vs committed vs used
      const SiteBudget = require('../models/SiteBudget');
const { auditLog } = require('../models/AuditLog');
      const budgetAgg = await SiteBudget.aggregate([
        { $match: { cycle_key } },
        { $group: {
          _id:             '$cluster',
          budget_liters:   { $sum: '$budget_liters' },
          budget_xaf:      { $sum: '$budget_xaf' },
          liters_used:     { $sum: '$liters_used' },
          liters_committed:{ $sum: '$liters_committed' },
          deficit_liters:  { $sum: '$deficit_liters' },
          in_deficit:      { $max: '$in_deficit' },
          liters_balance_returned: { $sum: '$liters_balance_returned' },
          xaf_per_liter:   { $avg: '$xaf_per_liter' },
          sites:           { $sum: 1 },
        }},
        { $addFields: {
          liters_remaining: { $subtract: ['$budget_liters', { $add: ['$liters_used', '$liters_committed'] }] },
          utilisation_pct:  { $cond: [{ $gt: ['$budget_liters', 0] }, { $multiply: [{ $divide: ['$liters_used', '$budget_liters'] }, 100] }, 0] },
        }},
      ]);
      const totalBudgetL   = budgetAgg.reduce((s, c) => s + (c.budget_liters   || 0), 0);
      const totalBudgetXAF = budgetAgg.reduce((s, c) => s + (c.budget_xaf      || 0), 0);
      const totalLitersUsed= budgetAgg.reduce((s, c) => s + (c.liters_used     || 0), 0);
      const totalDeficit   = budgetAgg.reduce((s, c) => s + (c.deficit_liters  || 0), 0);
      const totalReturned  = budgetAgg.reduce((s, c) => s + (c.liters_balance_returned || 0), 0);

      return res.json({
        success: true,
        data: {
          cycle_key,
          summary: {
            total_requests:          requests.length,
            approved_count:          approved.length,
            denied_count:            denied.length,
            refueled_count:          refueled.length,
            disbursed_count:         disbursed.length,
            total_liters_requested:  totalLRequested,
            total_liters_approved:   totalLApproved,
            total_liters_refueled:   totalLRefueled,
            total_xaf_approved:      totalXAFApproved,
            total_xaf_disbursed:     totalXAFDisbursed,
            finance_override_count:  overrides.length,
            liters_saved_by_finance,
            xaf_saved_by_finance:    xaf_saved_by_finance,
            execution_efficiency_pct: totalLApproved > 0
              ? Math.round((totalLRefueled / totalLApproved) * 100) : 0,
            // Budget data from SiteBudget (authoritative)
            total_budget_liters:     totalBudgetL,
            total_budget_xaf:        totalBudgetXAF,
            total_liters_used:       totalLitersUsed,
            total_deficit_liters:    totalDeficit,
            total_balance_returned:  totalReturned,
            budget_utilisation_pct:  totalBudgetL > 0 ? Math.round((totalLitersUsed / totalBudgetL) * 100) : 0,
            committed_pct:           totalBudgetL > 0 ? Math.round((totalLApproved / totalBudgetL) * 100) : 0,
          },
          by_cluster:    byCluster,
          // Vendor breakdown — TOTAL vs TRADEX spend comparison
          by_vendor: (() => {
            const vendors = {};
            for (const r of requests) {
              const vendor = r.tom_card_station?.toLowerCase()?.includes('tradex') ? 'TRADEX' : 'TOTAL';
              if (!vendors[vendor]) vendors[vendor] = { requests: 0, liters_disbursed: 0, xaf_disbursed: 0, liters_approved: 0 };
              vendors[vendor].requests++;
              vendors[vendor].liters_approved   += r.liters_approved || r.liters_requested || 0;
              vendors[vendor].liters_disbursed  += r.liters_actually_added || 0;
              vendors[vendor].xaf_disbursed     += r.disbursement?.actual_xaf || 0;
            }
            return Object.entries(vendors).map(([vendor, stats]) => ({ vendor, ...stats }));
          })(),
          budget_by_cluster: budgetAgg,
          disbursements: disbursed.map(r => ({
            _id:              r._id,
            site_name:        r.site_name,
            cluster:          r.cluster,
            liters_approved:  r.liters_approved || r.liters_requested,
            xaf_disbursed:    r.disbursement?.actual_xaf,
            reference_number: r.disbursement?.reference_number,
            payment_method:   r.disbursement?.payment_method,
            disbursed_by:     r.disbursement?.disbursed_by,
            disbursed_at:     r.disbursement?.disbursed_at,
          })),
          overrides: overrides.map(r => ({
            _id:              r._id,
            site_name:        r.site_name,
            liters_requested: r.liters_requested,
            liters_approved:  r.liters_approved,
            liters_reduced:   r.liters_requested - (r.liters_approved || 0),
            xaf_saved:        (r.liters_requested - (r.liters_approved || 0)) * (r.fuel_price_per_liter_applied || FUEL_PRICE_PER_LITER),
          })),
        },
      });
    } catch (err) {
      logger.error('[FuelRequest] GET /finance-report error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);


module.exports        = router;

module.exports        = router;
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/fuel-requests/sites  — lightweight site list for mobile request-fuel
// Accessible to technician + fuel (unlike /api/fuel/sites which is diesel_manager only)
module.exports.linkRefuelToRequest = linkRefuelToRequest;