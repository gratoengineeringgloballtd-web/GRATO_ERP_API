/**
 * geofence.js
 *
 * Distance/geofence math for the "verify I'm at the right site" mobile
 * check-in feature and the web live-map page. Pure functions, no DB or
 * request dependencies, so they're safely reusable from both.
 */

/**
 * Haversine great-circle distance between two coordinates.
 * @returns {number} distance in meters
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * @returns {boolean} true if pointLat/pointLon is within radiusMeters of centerLat/centerLon
 */
function isWithinGeofence(pointLat, pointLon, centerLat, centerLon, radiusMeters) {
  if ([pointLat, pointLon, centerLat, centerLon, radiusMeters].some(v => v === null || v === undefined || isNaN(v))) {
    return null; // can't evaluate — missing coordinates, distinct from a real false
  }
  return calculateDistanceMeters(pointLat, pointLon, centerLat, centerLon) <= radiusMeters;
}

/**
 * Full status object — used by the site-location-verification endpoint.
 */
function getGeofenceStatus(pointLat, pointLon, centerLat, centerLon, radiusMeters) {
  const distance = calculateDistanceMeters(pointLat, pointLon, centerLat, centerLon);
  return {
    isInside: distance <= radiusMeters,
    distanceMeters: Math.round(distance),
    radiusMeters,
  };
}

module.exports = { calculateDistanceMeters, isWithinGeofence, getGeofenceStatus };
