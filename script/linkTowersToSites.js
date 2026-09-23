const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Suppress mongoose warnings for this script
mongoose.set('strictQuery', false);

const Site = require('../models/Site');
const Tower = require('../models/Tower');

async function linkTowersToSites() {
  try {
    console.log('🚀 Starting Tower-Site Linking Migration...\n');
    
    // Connect to database
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Get all towers
    console.log('📋 Fetching towers...');
    const towers = await Tower.find({}).lean();
    console.log(`   Found ${towers.length} towers\n`);

    if (towers.length === 0) {
      console.log('⚠️  No towers found in database');
      await mongoose.disconnect();
      return;
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const errors = [];

    console.log('🔗 Linking towers to sites...\n');

    for (const tower of towers) {
      try {
        // Extract site code from tower ID
        // Pattern: TOWERBNB004 -> IHS_BNB_004
        const match = tower._id.match(/TOWER([A-Z]{3})(\d{3})/);
        
        if (!match) {
          console.log(`⚠️  Skipping ${tower._id} - doesn't match expected pattern`);
          skipCount++;
          continue;
        }

        const siteCode = match[1]; // e.g., "BNB"
        const siteNumber = match[2]; // e.g., "004"
        const ihsId = `IHS_${siteCode}_${siteNumber}`; // e.g., "IHS_BNB_004"

        // Check if site exists
        const site = await Site.findOne({ IHS_ID_SITE: ihsId });
        
        if (!site) {
          console.log(`⚠️  Site ${ihsId} not found for tower ${tower._id}`);
          skipCount++;
          continue;
        }

        // Update Site to reference Tower
        await Site.updateOne(
          { IHS_ID_SITE: ihsId },
          { 
            $set: { 
              tower_reference: tower._id,
              tower_name: tower.name || tower._id
            } 
          }
        );

        // Update Tower to include IHS_ID_SITE
        await Tower.updateOne(
          { _id: tower._id },
          { 
            $set: { 
              IHS_ID_SITE: ihsId,
              site_name: site.Site_Name || ihsId
            } 
          }
        );

        console.log(`✅ ${tower._id} ↔️  ${ihsId}`);
        successCount++;

      } catch (error) {
        console.error(`❌ Error linking ${tower._id}: ${error.message}`);
        errors.push({ tower: tower._id, error: error.message });
        errorCount++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully linked: ${successCount}`);
    console.log(`⚠️  Skipped: ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📝 Total towers processed: ${towers.length}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(err => {
        console.log(`   - ${err.tower}: ${err.error}`);
      });
    }

    // Verify the changes
    console.log('\n🔍 Verifying changes...');
    const towersWithSiteId = await Tower.countDocuments({ IHS_ID_SITE: { $exists: true, $ne: null } });
    const sitesWithTowerRef = await Site.countDocuments({ tower_reference: { $exists: true, $ne: null } });
    
    console.log(`   Towers with IHS_ID_SITE: ${towersWithSiteId}`);
    console.log(`   Sites with tower_reference: ${sitesWithTowerRef}`);

    console.log('\n✅ Migration completed successfully!\n');

    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the migration
linkTowersToSites();