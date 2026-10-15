// config/dynamicStructure.js
// Synchronous, cached view of the StructureEntry collection so the (sync)
// findPersonByEmail helpers can fall back to people added at runtime.
// Loads when the DB connects, after every change (refresh()), and every 5 min.
const mongoose = require('mongoose');

let cache = new Map();   // effective entries: used by the lookups
let everything = [];     // every entry (for the admin editor)

// Runtime additions always apply; imported base copies only once edited.
const isEffective = (e) => e.source !== 'base' || e.edited === true;

const shape = (e) => ({
  email: e.email,
  name: e.name,
  position: e.position,
  reportsTo: e.reportsTo || null,
  hierarchyLevel: e.hierarchyLevel,
  canSupervise: e.canSupervise || [],
  approvalAuthority: e.approvalAuthority,
  department: e.department,
  isDepartmentHead: !!e.isDepartmentHead,
  dynamic: true,
  source: e.source || 'runtime',
  edited: !!e.edited
});

const refresh = async () => {
  try {
    if (mongoose.connection.readyState !== 1) return cache.size;
    const StructureEntry = require('../models/StructureEntry');
    const rows = await StructureEntry.find({}).lean();
    everything = rows.map(shape);
    cache = new Map(rows.filter(isEffective).map((r) => [r.email, shape(r)]));
    return cache.size;
  } catch (e) {
    console.error('dynamicStructure refresh failed:', e.message);
    return cache.size;
  }
};

const get = (email) => {
  const key = String(email || '').toLowerCase().trim();
  const hit = cache.get(key);
  return hit ? { ...hit } : null;
};

const all = () => everything.slice();

if (mongoose.connection.readyState === 1) refresh();
mongoose.connection.on('connected', refresh);
const timer = setInterval(refresh, 5 * 60 * 1000);
if (timer.unref) timer.unref();

// Test hook: seed the in-memory cache without a database.
const _testSeed = (rows) => {
  everything = rows.map(shape);
  cache = new Map(rows.filter(isEffective).map((r) => [String(r.email).toLowerCase(), shape(r)]));
};

module.exports = { get, all, refresh, _testSeed };
