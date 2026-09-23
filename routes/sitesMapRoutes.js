'use strict';

const express = require('express');
const router = express.Router();

const Site = require('../models/Site');
const { planAllSites } = require('../services/fuelPlanningService');
const { authenticateToken, requireRole } = require('../middlewares/authMiddleware');
const { getGeofenceStatus } = require('../utils/geofence');
const asyncHandler = require('../middlewares/asyncHandler');
const logger = require('../utils/logger');

/**
 * GET /api/diesel/sites-map/:cycle_key
 *
 * All sites with valid coordinates, annotated with this cycle's fuel
 * urgency (reusing fuelPlanningService's existing prediction logic rather
 * than duplicating it) — powers the web live-map page.
 */
router.get('/:cycle_key',
  authenticateToken,
  requireRole(['diesel_manager', 'admin', 'supervisor', 'finance', 'head_of_business', 'ceo']),
  asyncHandler(async (req, res) => {
    const { cycle_key } = req.params;

    const [sites, plan] = await Promise.all([
      Site.find({
        Latitude:  { $ne: null, $exists: true },
        Longitude: { $ne: null, $exists: true },
      })
        .select('IHS_ID_SITE Site_Name GRATO_Cluster Region Latitude Longitude Geofence_Radius_M Fuel_Quantity_Found Tank_Capacity_1 SiteStatusType')
        .lean(),
      planAllSites(cycle_key, {}).catch(err => {
        logger.warn(`[SitesMap] planAllSites failed, map will show without urgency data: ${err.message}`);
        return { sites: [] };
      }),
    ]);

    const urgencyBySite = new Map(plan.sites.map(p => [p.site_id, p]));

    const mapSites = sites.map(s => {
      const prediction = urgencyBySite.get(s.IHS_ID_SITE);
      return {
        site_id:   s.IHS_ID_SITE,
        name:      s.Site_Name || s.IHS_ID_SITE,
        cluster:   s.GRATO_Cluster || null,
        region:    s.Region || null,
        lat:       s.Latitude,
        lng:       s.Longitude,
        geofence_radius_m: s.Geofence_Radius_M || 150,
        current_fuel_level: s.Fuel_Quantity_Found ?? null,
        tank_capacity:      s.Tank_Capacity_1 ?? null,
        urgency:         prediction?.urgency ?? 'unknown',
        days_to_empty:   prediction?.days_to_empty ?? null,
        status_type:     s.SiteStatusType || null,
      };
    });

    res.json({
      success: true,
      data: mapSites,
      cycle_key: plan.cycle_key || cycle_key,
      total: mapSites.length,
    });
  })
);

/**
 * POST /api/diesel/sites-map/verify-location
 *
 * Used by the mobile app's check-in step: "am I actually at this site?"
 * Compares the technician's current GPS position against the target
 * site's stored coordinates and its geofence radius.
 *
 * Body: { site_id, latitude, longitude }
 */
router.post('/verify-location',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { site_id, latitude, longitude } = req.body;

    if (site_id === undefined || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'site_id, latitude, and longitude are required' });
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, error: 'Invalid latitude/longitude' });
    }

    const site = await Site.findOne({ IHS_ID_SITE: site_id })
      .select('IHS_ID_SITE Site_Name Latitude Longitude Geofence_Radius_M')
      .lean();

    if (!site) {
      return res.status(404).json({ success: false, error: `Site ${site_id} not found` });
    }

    if (site.Latitude == null || site.Longitude == null) {
      // The site itself has no coordinates on file — this isn't the
      // technician's fault, and shouldn't block them from working.
      // Distinct response shape so the mobile app can show "location
      // verification unavailable for this site" rather than a failure.
      return res.json({
        success: true,
        data: {
          verifiable: false,
          reason: 'Site has no coordinates on file — location cannot be verified.',
          site_id: site.IHS_ID_SITE,
          site_name: site.Site_Name,
        },
      });
    }

    const radius = site.Geofence_Radius_M || 150;
    const status = getGeofenceStatus(lat, lng, site.Latitude, site.Longitude, radius);

    res.json({
      success: true,
      data: {
        verifiable: true,
        isInside: status.isInside,
        distanceMeters: status.distanceMeters,
        radiusMeters: status.radiusMeters,
        site_id: site.IHS_ID_SITE,
        site_name: site.Site_Name,
      },
    });
  })
);

module.exports = router;
