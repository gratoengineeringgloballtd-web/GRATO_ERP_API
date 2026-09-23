// scripts/sync-tower-assignments.js
// Run this to sync technician tower assignments with actual Site IHS_ID_SITE values

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Site = require('../models/Site');
const Cluster = require('../models/Cluster');

async function syncTowerAssignments() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all technicians
    const technicians = await User.find({ role: 'technician' });
    console.log(`Found ${technicians.length} technicians`);

    // Get all sites
    const allSites = await Site.find({}).select('_id IHS_ID_SITE Site_Name Region').lean();
    console.log(`Found ${allSites.length} sites`);

    if (allSites.length === 0) {
      console.log('ERROR: No sites found in database. Import sites first.');
      await mongoose.disconnect();
      return;
    }

    let updatedCount = 0;
    let errorCount = 0;

    for (const tech of technicians) {
      console.log(`\nProcessing: ${tech.fullName}`);
      
      try {
        // Strategy 1: Assign sites based on clusters
        let assignedSiteIds = [];
        
        if (tech.assignedClusters && tech.assignedClusters.length > 0) {
          console.log(`  - Has ${tech.assignedClusters.length} assigned clusters`);
          
          // Get clusters
          const clusters = await Cluster.find({
            _id: { $in: tech.assignedClusters }
          }).select('name region').lean();
          
          // Find sites in those cluster regions
          const clusterRegions = clusters.map(c => c.region).filter(r => r);
          
          if (clusterRegions.length > 0) {
            const sitesInRegions = await Site.find({
              Region: { $in: clusterRegions }
            }).select('IHS_ID_SITE').lean();
            
            assignedSiteIds = sitesInRegions.map(s => s.IHS_ID_SITE);
            console.log(`  - Found ${assignedSiteIds.length} sites in cluster regions`);
          }
        }
        
        // Strategy 2: If no clusters, assign some random sites for testing
        if (assignedSiteIds.length === 0) {
          // Assign 5-10 random sites for testing
          const randomCount = Math.floor(Math.random() * 6) + 5; // 5-10 sites
          const randomSites = allSites
            .sort(() => 0.5 - Math.random())
            .slice(0, randomCount);
          
          assignedSiteIds = randomSites.map(s => s.IHS_ID_SITE);
          console.log(`  - Assigned ${assignedSiteIds.length} random sites for testing`);
        }
        
        // Update technician
        await User.updateOne(
          { _id: tech._id },
          { $set: { assignedTowers: assignedSiteIds } }
        );
        
        console.log(`  ✓ Updated with ${assignedSiteIds.length} tower assignments`);
        console.log(`  Sample IDs: ${assignedSiteIds.slice(0, 3).join(', ')}`);
        updatedCount++;
        
      } catch (error) {
        console.error(`  ✗ Error updating ${tech.fullName}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n=================================');
    console.log('Sync Complete!');
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log('=================================\n');

    // Verify the update
    const sampleTech = await User.findOne({ role: 'technician' })
      .select('fullName assignedTowers')
      .lean();
    
    if (sampleTech?.assignedTowers && sampleTech.assignedTowers.length > 0) {
      console.log('Verification - Sample technician:');
      console.log(`Name: ${sampleTech.fullName}`);
      console.log(`Assigned towers: ${sampleTech.assignedTowers.length}`);
      console.log(`Sample tower IDs: ${sampleTech.assignedTowers.slice(0, 3).join(', ')}`);
      
      // Check if these IDs exist in Site collection
      const siteCheck = await Site.findOne({ 
        IHS_ID_SITE: sampleTech.assignedTowers[0] 
      }).select('IHS_ID_SITE Site_Name').lean();
      
      if (siteCheck) {
        console.log(`✓ Verified: Tower ID exists in Site collection`);
        console.log(`  Site: ${siteCheck.Site_Name} (${siteCheck.IHS_ID_SITE})`);
      } else {
        console.log(`✗ Warning: Tower ID not found in Site collection`);
      }
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');

  } catch (error) {
    console.error('Sync error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the sync
syncTowerAssignments();