/**
 * migrate-clusters.js
 * 
 * One-time migration script that creates Cluster documents for every unique
 * GRATO_Cluster value found in the Site collection.
 * 
 * Safe to run multiple times — skips clusters that already have a document.
 * 
 * Usage:
 *   node scripts/migrate-clusters.js
 * 
 * Or from project root:
 *   node migrate-clusters.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Site = require('../models/Site');
const Cluster = require('../models/Cluster');
const User = require('../models/User');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;

async function run() {
  if (!MONGO_URI) {
    console.error('❌ No MongoDB URI found. Set MONGODB_URI in your .env file.');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected.\n');

  // ── 1. Find an admin user to use as created_by ─────────────────────────────
  const adminUser = await User.findOne({ role: 'admin' }).lean();
  if (!adminUser) {
    console.error('❌ No admin user found. Cannot set created_by. Aborting.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`👤 Using admin: ${adminUser.fullName || adminUser.email} (${adminUser._id})\n`);

  // ── 2. Aggregate all unique GRATO_Cluster values from Site collection ───────
  const clusterAggregation = await Site.aggregate([
    { $match: { GRATO_Cluster: { $exists: true, $ne: null, $ne: '' } } },
    {
      $group: {
        _id: '$GRATO_Cluster',
        region: { $first: '$Region' },
        totalSites: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  console.log(`📊 Found ${clusterAggregation.length} unique cluster names in Site collection:\n`);
  clusterAggregation.forEach(c => console.log(`   - ${c._id} (${c.totalSites} sites, region: ${c.region || 'Unknown'})`));
  console.log('');

  // ── 3. Find which ones already have a Cluster document ─────────────────────
  const existingDocs = await Cluster.find({
    name: { $in: clusterAggregation.map(c => c._id) },
  }).lean();

  const existingNames = new Set(existingDocs.map(d => d.name));
  console.log(`✅ Already have Cluster documents for: ${existingDocs.length > 0 ? [...existingNames].join(', ') : 'none'}\n`);

  // ── 4. Create missing Cluster documents ────────────────────────────────────
  const toCreate = clusterAggregation.filter(c => !existingNames.has(c._id));
  console.log(`🆕 Will create ${toCreate.length} new Cluster document(s)...\n`);

  let created = 0;
  let failed = 0;

  for (const clusterData of toCreate) {
    const name = clusterData._id;
    const region = clusterData.region || 'Unknown';

    // Generate a unique code from the name (max 10 chars, uppercase, no spaces)
    let code = name.replace(/\s+/g, '_').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 10);

    // If code already exists, append a number suffix
    const existingCode = await Cluster.findOne({ code });
    if (existingCode) {
      code = code.slice(0, 8) + '_' + (Math.floor(Math.random() * 90) + 10);
    }

    try {
      const doc = await Cluster.create({
        name,
        code,
        region,
        description: `Auto-migrated cluster from Site data (${clusterData.totalSites} sites)`,
        coverage_area: {
          center: { latitude: 0, longitude: 0 },
          radius: 50,
        },
        status: 'active',
        created_by: adminUser._id,
        last_updated_by: adminUser._id,
      });

      console.log(`   ✅ Created: "${name}" → _id: ${doc._id} (code: ${code})`);
      created++;
    } catch (err) {
      console.error(`   ❌ Failed to create "${name}": ${err.message}`);
      failed++;
    }
  }

  // ── 5. Summary ──────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log(`📋 Migration Summary:`);
  console.log(`   Total clusters in Site data : ${clusterAggregation.length}`);
  console.log(`   Already existed             : ${existingDocs.length}`);
  console.log(`   Newly created               : ${created}`);
  console.log(`   Failed                      : ${failed}`);
  console.log('─────────────────────────────────────\n');

  if (failed === 0) {
    console.log('🎉 Migration complete! All clusters now have database records.');
    console.log('   You can now assign supervisors and technicians to them.\n');
  } else {
    console.log('⚠️  Migration finished with some errors. Check the output above.\n');
  }

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB.');
  process.exit(0);
}

run().catch(err => {
  console.error('💥 Unexpected error:', err);
  mongoose.disconnect();
  process.exit(1);
});