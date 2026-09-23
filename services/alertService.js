/**
 * alertService.js
 * Creates / updates DieselAlert documents from reconciliation results.
 * Calls emailNotificationService for critical alerts.
 */
const DieselAlert = require('../models/DieselAlert');
const emailService = require('./emailNotificationService');
const logger = require('../utils/logger');

const SEVERITY_MAP = {
  low_fuel:              'critical',
  zero_grid_24h:         'high',
  consumption_over_ccph: 'high',
  refuel_mismatch:       'medium',
  tomcard_mismatch:      'medium',
  missing_grato:         'medium',
  missing_cms:           'medium',
  faulty_meter:          'low',
  theft_suspected:       'critical',
  rh_mismatch:           'medium',
  missing_tank_capacity: 'low',
};

const EMAIL_ON = new Set(['low_fuel', 'theft_suspected', 'missing_grato', 'missing_cms', 'zero_grid_24h']);

/**
 * Process alerts from a reconciliation doc.
 * Creates/updates a DieselAlert for each active flag.
 * Resolves previously-open alerts whose flag is now false.
 */
async function processAlerts(recon) {
  const {
    site_id, site_name, cluster, region, cycle_key,
    alerts,
    cms_consumption, contractual_consumption, cons_variance_pct,
    field_fuel_added, cms_refuel_total, tomcard_purchased,
    refuel_field_vs_cms_var, refuel_field_vs_card_var,
    theft_liters, gap_cph_variation,
    zero_grid_max_streak, faulty_meter_days,
    rh_variance_pct, cms_days_covered, cms_days_expected,
    low_fuel_threshold_l,
  } = recon;

  const alertDefs = [
    {
      flag: 'low_fuel',
      type: 'LOW_FUEL',
      title: `⚠️ Low Fuel — ${site_name || site_id}`,
      message: `Site ${site_id} has critically low fuel level. Immediate refuelling required.`,
      data:  { site_id, cluster },
    },
    {
      flag: 'zero_grid_24h',
      type: 'ZERO_GRID_24H',
      title: `⚡ Zero Grid 24h+ — ${site_name || site_id}`,
      message: `Site ${site_id} has had no grid for ${zero_grid_max_streak}+ consecutive hours. Generator running continuously.`,
      data:  { streak_hours: zero_grid_max_streak, site_id, cluster },
    },
    {
      flag: 'consumption_over_ccph',
      type: 'CONSUMPTION_OVER_CCPH',
      title: `📈 Over CCPH — ${site_name || site_id}`,
      message: `Consumption at ${site_id} is ${Math.round((cons_variance_pct || 0) * 100)}% above contractual rate. Actual: ${Math.round(cms_consumption || 0)}L vs budgeted ${Math.round(contractual_consumption || 0)}L.`,
      data:  { cons_variance_pct, cms_consumption, contractual_consumption, site_id, cluster },
    },
    {
      flag: 'refuel_mismatch',
      type: 'REFUEL_MISMATCH_CMS',
      title: `🔄 Refuel Mismatch (CMS) — ${site_name || site_id}`,
      message: `Field reported ${Math.round(field_fuel_added || 0)}L added but CMS detected ${Math.round(cms_refuel_total || 0)}L. Difference: ${Math.round(refuel_field_vs_cms_var || 0)}L.`,
      data:  { field_fuel_added, cms_refuel_total, variance: refuel_field_vs_cms_var, site_id, cluster },
    },
    {
      flag: 'tomcard_mismatch',
      type: 'REFUEL_MISMATCH_TOMCARD',
      title: `💳 Tom Card Mismatch — ${site_name || site_id}`,
      message: `Field reported ${Math.round(field_fuel_added || 0)}L added but Tom Card shows ${Math.round(tomcard_purchased || 0)}L purchased. Difference: ${Math.round(refuel_field_vs_card_var || 0)}L.`,
      data:  { field_fuel_added, tomcard_purchased, variance: refuel_field_vs_card_var, site_id, cluster },
    },
    {
      flag: 'missing_grato',
      type: 'MISSING_GRATO',
      title: `📋 Missing Field Data — ${site_name || site_id}`,
      message: `No GRATO field visit record found for site ${site_id} in cycle ${cycle_key}. Please ensure technician submits visit data.`,
      data:  { site_id, cluster, cycle_key },
    },
    {
      flag: 'missing_cms',
      type: 'MISSING_CMS',
      title: `📡 Missing CMS Data — ${site_name || site_id}`,
      message: `Site ${site_id} has only ${cms_days_covered} of ${cms_days_expected} expected CMS records in cycle ${cycle_key}.`,
      data:  { cms_days_covered, cms_days_expected, site_id, cluster, cycle_key },
    },
    {
      flag: 'faulty_meter',
      type: 'FAULTY_METER',
      title: `🔧 Faulty Meter — ${site_name || site_id}`,
      message: `Generator hour meter was FAULTY for ${faulty_meter_days} visit(s) at site ${site_id}. CMS Gen RH used as fallback.`,
      data:  { faulty_meter_days, site_id, cluster },
    },
    {
      flag: 'theft_suspected',
      type: 'THEFT_SUSPECTED',
      title: `🚨 Theft Suspected — ${site_name || site_id}`,
      message: `Site ${site_id}: theft flag=${Math.round(theft_liters || 0)}L, gap variation=${Math.round(gap_cph_variation || 0)}L. Immediate investigation required.`,
      data:  { theft_liters, gap_cph_variation, site_id, cluster },
    },
    {
      flag: 'rh_mismatch',
      type: 'RH_MISMATCH',
      title: `📊 RH Mismatch — ${site_name || site_id}`,
      message: `CMS and field meter disagree on run hours at site ${site_id}. Variance: ${Math.round((rh_variance_pct || 0) * 100)}%.`,
      data:  { rh_variance_pct, site_id, cluster },
    },
    {
      flag: 'missing_tank_capacity',
      type: 'MISSING_TANK_CAPACITY',
      title: `🛢️ Tank Capacity Missing — ${site_name || site_id}`,
      message: `Site ${site_id} has no tank capacity on file — its low-fuel alert is using a flat ${low_fuel_threshold_l ?? '500'}L fallback instead of a site-specific threshold. Add the tank capacity to get an accurate low-fuel alert.`,
      data:  { site_id, cluster },
    },
  ];

  const emailQueue = [];

  for (const def of alertDefs) {
    const isActive = alerts[def.flag];

    if (isActive) {
      try {
        const alert = await DieselAlert.upsertAlert({
          alert_type: def.type,
          severity:   SEVERITY_MAP[def.flag] || 'medium',
          site_id, site_name, cluster, region, cycle_key,
          title:   def.title,
          message: def.message,
          data:    def.data,
          status:  'open',
        });

        // Queue email if not yet sent and this type triggers email
        if (!alert.email_sent && EMAIL_ON.has(def.flag)) {
          emailQueue.push({ alert, def });
        }
      } catch (err) {
        logger.error(`Alert upsert failed [${def.type}] site=${site_id}: ${err.message}`);
      }
    } else {
      // Auto-resolve if alert was open and condition no longer holds
      try {
        const dedup_key = `${def.type}:${site_id}:${cycle_key}`;
        await DieselAlert.findOneAndUpdate(
          { dedup_key, status: 'open' },
          { $set: { status: 'resolved', resolved_at: new Date(), resolution_note: 'Auto-resolved: condition cleared' } }
        );
      } catch (_) {}
    }
  }

  // Send emails (non-blocking)
  if (emailQueue.length > 0) {
    emailService.sendAlertEmails(emailQueue).catch(err =>
      logger.error(`Email queue error: ${err.message}`)
    );
  }
}

/**
 * Fire a one-off system alert (import error, cycle closed, generator moved, etc.)
 */
async function fireSystemAlert(type, severity, title, message, data = {}, cycleKey = null) {
  try {
    const alert = await DieselAlert.upsertAlert({
      alert_type: type,
      severity,
      title,
      message,
      data,
      cycle_key: cycleKey,
      status: 'open',
    });

    if (['IMPORT_ERROR', 'THEFT_SUSPECTED'].includes(type)) {
      await emailService.sendSystemAlert(alert);
    }
    return alert;
  } catch (err) {
    logger.error(`fireSystemAlert failed [${type}]: ${err.message}`);
  }
}

module.exports = { processAlerts, fireSystemAlert };