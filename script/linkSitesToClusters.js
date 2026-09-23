require('dotenv').config();
const mongoose = require('mongoose');
const Site = require('../models/Site');
const Tower = require('../models/Tower');
const Cluster = require('../models/Cluster');

const MONGODB_URI = 'mongodb+srv://Grato:aR8IAXUrOrg1Hz2T@cluster0.x64ib.mongodb.net/generator-management';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✓ MongoDB connected successfully\n');
  } catch (error) {
    console.error('✗ MongoDB connection error:', error.message);
    process.exit(1);
  }
}

async function linkSitesViaTowers() {
  try {
    console.log('========== LINKING SITES TO CLUSTERS VIA TOWERS ==========\n');

    // Get all towers with their cluster info
    const towers = await Tower.find({})
      .select('_id name cluster_id supervisor')
      .lean();

    console.log(`Found ${towers.length} towers in database`);

    if (towers.length === 0) {
      console.log('✗ No towers found to use as reference');
      return;
    }

    // Group towers by cluster
    const towersByCluster = {};
    towers.forEach(tower => {
      const clusterId = tower.cluster_id?.toString();
      if (clusterId) {
        if (!towersByCluster[clusterId]) {
          towersByCluster[clusterId] = [];
        }
        towersByCluster[clusterId].push(tower);
      }
    });

    console.log(`Towers organized by ${Object.keys(towersByCluster).length} clusters\n`);

    let totalLinked = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // For each cluster, link all unlinked sites to that cluster
    for (const [clusterId, clusterTowers] of Object.entries(towersByCluster)) {
      try {
        // Get cluster info
        const cluster = await Cluster.findById(clusterId).select('name code').lean();
        if (!cluster) continue;

        console.log(`Processing: ${cluster.name} (${clusterTowers.length} towers)`);

        // Strategy: Match unlinked sites by:
        // 1. GRATO_Cluster field matches cluster name
        // 2. No cluster reference set yet

        const unlinkedSites = await Site.find({
          $or: [
            { cluster: { $exists: false } },
            { cluster: null }
          ],
          GRATO_Cluster: cluster.name  // Match by cluster name
        });

        console.log(`  Found ${unlinkedSites.length} unlinked sites with GRATO_Cluster = "${cluster.name}"`);

        let linkedCount = 0;

        for (const site of unlinkedSites) {
          try {
            site.cluster = clusterId;
            await site.save();
            linkedCount++;
            totalLinked++;
          } catch (error) {
            console.log(`    ✗ Error updating ${site.IHS_ID_SITE}: ${error.message}`);
            totalErrors++;
          }
        }

        // Also try matching by cluster code as fallback
        if (linkedCount === 0 && cluster.code) {
          const codeMatchedSites = await Site.find({
            $or: [
              { cluster: { $exists: false } },
              { cluster: null }
            ],
            GRATO_Cluster: cluster.code
          });

          for (const site of codeMatchedSites) {
            try {
              site.cluster = clusterId;
              await site.save();
              linkedCount++;
              totalLinked++;
            } catch (error) {
              console.log(`    ✗ Error updating ${site.IHS_ID_SITE}: ${error.message}`);
              totalErrors++;
            }
          }
        }

        console.log(`  ✓ Linked: ${linkedCount}\n`);

      } catch (error) {
        console.log(`  ✗ Error processing cluster: ${error.message}\n`);
        totalErrors++;
      }
    }

    console.log('========== LINKING COMPLETE ==========');
    console.log(`✓ Linked: ${totalLinked}`);
    console.log(`⏭️  Skipped: ${totalSkipped}`);
    console.log(`✗ Errors: ${totalErrors}`);
    console.log('====================================\n');

    // Show final statistics
    const [linkedSites, unlinkedSites, totalSites] = await Promise.all([
      Site.countDocuments({ cluster: { $exists: true, $ne: null } }),
      Site.countDocuments({
        $or: [
          { cluster: { $exists: false } },
          { cluster: null }
        ]
      }),
      Site.countDocuments({})
    ]);

    console.log('Final Status:');
    console.log(`Total Sites: ${totalSites}`);
    console.log(`Linked Sites: ${linkedSites}`);
    console.log(`Unlinked Sites: ${unlinkedSites}`);
    console.log(`Coverage: ${((linkedSites / totalSites) * 100).toFixed(2)}%\n`);

    if (unlinkedSites > 0) {
      console.log('Sample of remaining unlinked sites:');
      const unlinked = await Site.find({
        $or: [
          { cluster: { $exists: false } },
          { cluster: null }
        ]
      })
        .select('IHS_ID_SITE Site_Name GRATO_Cluster')
        .limit(10)
        .lean();

      unlinked.forEach(site => {
        console.log(`  - ${site.IHS_ID_SITE}: "${site.Site_Name}" (GRATO_Cluster: "${site.GRATO_Cluster}")`);
      });

      if (unlinkedSites > 10) {
        console.log(`  ... and ${unlinkedSites - 10} more`);
      }
    }

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

async function main() {
  await connectDB();
  await linkSitesViaTowers();
  await mongoose.connection.close();
  console.log('Database connection closed');
  process.exit(0);
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});



