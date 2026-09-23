const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

mongoose.set('strictQuery', false);

const User = require('../models/User');
const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
const GeneratorUpdate = require('../models/GeneratorUpdate');

async function testSupervisorGenerators() {
  try {
    console.log('🚀 Testing Supervisor Generators Endpoint Logic\n');
    
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find a supervisor
    const supervisor = await User.findOne({ 
      $or: [{ role: 'supervisor' }, { userType: 'supervisor' }] 
    }).select('_id fullName assignedClusters').lean();

    if (!supervisor) {
      console.log('❌ No supervisor found in database');
      process.exit(1);
    }

    console.log('👤 Testing with Supervisor:', supervisor.fullName);
    console.log('   ID:', supervisor._id);
    console.log('   Assigned Clusters:', supervisor.assignedClusters?.length || 0);
    console.log('');

    // Get clusters
    const clusters = await Cluster.find({
      _id: { $in: supervisor.assignedClusters || [] }
    }).select('towers name').lean();

    console.log('📂 Clusters:', clusters.length);
    
    const towerIds = [...new Set(clusters.flatMap(c => c.towers || []))];
    console.log('🗼 Towers:', towerIds.length);
    console.log('');

    if (towerIds.length === 0) {
      console.log('⚠️ Supervisor has no towers assigned');
      process.exit(0);
    }

    // Get towers with site IDs
    const towers = await Tower.find({ _id: { $in: towerIds } })
      .select('_id name IHS_ID_SITE')
      .lean();

    const siteIds = towers.map(t => t.IHS_ID_SITE).filter(Boolean);
    console.log('🏢 Sites with IHS_ID:', siteIds.length);
    
    if (siteIds.length < towers.length) {
      console.log(`⚠️ Warning: ${towers.length - siteIds.length} towers missing IHS_ID_SITE`);
    }
    console.log('');

    // Check approved generator updates
    const approvedUpdates = await GeneratorUpdate.find({
      site_id: { $in: siteIds },
      status: 'approved'
    }).select('site_id model serial_number status').lean();

    console.log('⚡ Approved Generator Updates:', approvedUpdates.length);
    console.log('');

    if (approvedUpdates.length === 0) {
      console.log('❌ No approved generator updates found!');
      console.log('');
      console.log('💡 Possible issues:');
      console.log('   1. No generator updates submitted');
      console.log('   2. Updates not approved yet');
      console.log('   3. Site IDs in updates don\'t match tower IHS_ID_SITE');
      console.log('');
      
      // Check if there are ANY updates
      const anyUpdates = await GeneratorUpdate.countDocuments();
      console.log(`   Total updates in DB: ${anyUpdates}`);
      
      if (anyUpdates > 0) {
        const sampleUpdate = await GeneratorUpdate.findOne().select('site_id status').lean();
        console.log(`   Sample update: site_id="${sampleUpdate.site_id}", status="${sampleUpdate.status}"`);
        
        // Check if site_id matches
        const matchingSite = siteIds.includes(sampleUpdate.site_id);
        console.log(`   Does sample site_id match supervisor's sites? ${matchingSite ? 'YES ✅' : 'NO ❌'}`);
      }
      
      process.exit(1);
    }

    // Get latest update per site
    const latestUpdates = await GeneratorUpdate.aggregate([
      {
        $match: {
          site_id: { $in: siteIds },
          status: 'approved'
        }
      },
      {
        $sort: { reviewed_at: -1, submitted_at: -1 }
      },
      {
        $group: {
          _id: '$site_id',
          latestUpdate: { $first: '$$ROOT' }
        }
      }
    ]);

    console.log('📊 Latest updates per site:', latestUpdates.length);
    console.log('');

    // Build generators
    const generators = latestUpdates.map(doc => {
      const update = doc.latestUpdate;
      const tower = towers.find(t => t.IHS_ID_SITE === update.site_id);
      
      if (!tower) return null;

      const genId = update.new_generator_id || 
                   update.existing_generator_id || 
                   `GEN${update.site_id.replace(/[^A-Z0-9]/g, '')}`;

      return {
        _id: genId,
        model: update.model,
        serial_number: update.serial_number,
        tower_id: tower._id,
        tower_name: tower.name,
        site_id: update.site_id,
        status: update.generator_status
      };
    }).filter(Boolean);

    console.log('✅ Generators that would be returned:', generators.length);
    console.log('');

    if (generators.length > 0) {
      console.log('📦 Sample Generators:');
      generators.slice(0, 3).forEach((gen, idx) => {
        console.log(`   ${idx + 1}. ID: ${gen._id}`);
        console.log(`      Model: ${gen.model}`);
        console.log(`      Serial: ${gen.serial_number}`);
        console.log(`      Tower: ${gen.tower_name}`);
        console.log(`      Site: ${gen.site_id}`);
        console.log('');
      });
    }

    console.log('='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Supervisor ID: ${supervisor._id}`);
    console.log(`Clusters: ${clusters.length}`);
    console.log(`Towers: ${towerIds.length}`);
    console.log(`Sites with IHS_ID: ${siteIds.length}`);
    console.log(`Approved Updates: ${approvedUpdates.length}`);
    console.log(`Final Generators: ${generators.length}`);
    console.log('');

    if (generators.length > 0) {
      console.log('✅ SUCCESS: Endpoint should return generators!');
      console.log('');
      console.log('Next steps:');
      console.log('1. Update the getSupervisorGenerators function');
      console.log('2. Restart your server');
      console.log('3. Test in browser');
    } else {
      console.log('❌ ISSUE: No generators would be returned');
      console.log('');
      console.log('Check the warnings above for issues');
    }

    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

testSupervisorGenerators();