#!/usr/bin/env node

/**
 * Manual Assignment Script
 * Run this to assign technicians to towers and clusters
 * after the main migration is complete
 * 
 * Usage: node scripts/assignTechnicians.js
 */

const mongoose = require('mongoose');
const Site = require('../models/Site');
const User = require('../models/User');
const Tower = require('../models/Tower');
const Cluster = require('../models/Cluster');
const logger = require('../utils/logger');
require('dotenv').config();

async function assignTechniciansToTowers() {
  console.log('\n🔄 Starting technician-to-tower assignment...\n');
  
  const sites = await Site.find({ Technician_Name: { $ne: null } }).lean();
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  for (const site of sites) {
    if (!site.Technician_Name || !site.IHS_ID_SITE) {
      skipCount++;
      continue;
    }

    try {
      // Generate tower ID
      const siteIdClean = site.IHS_ID_SITE.replace(/^IHS_/, '').replace(/_/g, '');
      const letters = siteIdClean.match(/[A-Z]+/)?.[0] || 'UNK';
      const numbers = siteIdClean.match(/\d+/)?.[0] || '000';
      const letterPart = letters.substring(0, 3).padEnd(3, 'X');
      const numberPart = numbers.padStart(3, '0').slice(-3);
      const towerId = `TOWER${letterPart}${numberPart}`;

      const tower = await Tower.findById(towerId);
      
      if (!tower) {
        console.log(`⚠️  Tower ${towerId} not found`);
        skipCount++;
        continue;
      }

      const technician = await User.findOne({
        fullName: site.Technician_Name,
        role: 'technician'
      });

      if (!technician) {
        console.log(`⚠️  Technician "${site.Technician_Name}" not found`);
        skipCount++;
        continue;
      }

      // Check if already assigned
      const alreadyAssigned = tower.assigned_technicians.some(
        at => at.technician_id && at.technician_id.toString() === technician._id.toString()
      );

      if (alreadyAssigned) {
        skipCount++;
        continue;
      }

      // Assign technician to tower
      tower.assigned_technicians.push({
        technician_id: technician._id,
        assignment_type: 'primary',
        assigned_date: new Date()
      });
      await tower.save({ validateBeforeSave: false });

      // Assign tower to technician
      if (!technician.assignedTowers) technician.assignedTowers = [];
      if (!technician.assignedTowers.some(t => t.toString() === tower._id.toString())) {
        technician.assignedTowers.push(tower._id);
        await technician.save();
      }

      successCount++;
      if (successCount % 50 === 0) {
        console.log(`✓ Processed ${successCount} assignments...`);
      }
    } catch (error) {
      errorCount++;
      console.error(`✗ Error with site ${site.IHS_ID_SITE}: ${error.message}`);
    }
  }

  console.log('\n📊 Tower Assignment Results:');
  console.log(`   ✓ Success: ${successCount}`);
  console.log(`   ⊘ Skipped: ${skipCount}`);
  console.log(`   ✗ Errors: ${errorCount}\n`);
  
  return { successCount, skipCount, errorCount };
}

async function assignTechniciansToClusters() {
  console.log('🔄 Starting technician-to-cluster assignment...\n');
  
  const technicians = await User.find({ role: 'technician' });
  
  let successCount = 0;
  let skipCount = 0;

  for (const technician of technicians) {
    try {
      if (!technician.assignedTowers || technician.assignedTowers.length === 0) {
        skipCount++;
        continue;
      }

      // Get towers
      const towers = await Tower.find({ _id: { $in: technician.assignedTowers } });
      
      // Get unique clusters
      const clusterIds = [...new Set(towers.map(t => t.cluster_id.toString()))];

      // Assign to each cluster
      for (const clusterId of clusterIds) {
        const cluster = await Cluster.findById(clusterId);
        
        if (!cluster) continue;

        // Check if already assigned
        const alreadyAssigned = cluster.assigned_technicians.some(
          at => at.technician.toString() === technician._id.toString()
        );

        if (!alreadyAssigned) {
          cluster.assigned_technicians.push({
            technician: technician._id,
            assigned_date: new Date(),
            role: 'primary',
            specializations: technician.specializations || ['generator', 'maintenance']
          });
          await cluster.save();
        }

        // Add cluster to technician
        if (!technician.assignedClusters) technician.assignedClusters = [];
        if (!technician.assignedClusters.some(c => c.toString() === clusterId)) {
          technician.assignedClusters.push(clusterId);
        }
      }

      await technician.save();
      successCount++;
    } catch (error) {
      console.error(`✗ Error assigning ${technician.fullName}: ${error.message}`);
    }
  }

  console.log('📊 Cluster Assignment Results:');
  console.log(`   ✓ Success: ${successCount} technicians assigned to clusters`);
  console.log(`   ⊘ Skipped: ${skipCount} technicians (no towers)\n`);
  
  return { successCount, skipCount };
}

async function printSummary() {
  console.log('📈 Final Summary:\n');
  
  const [
    totalTechnicians,
    techniciansWithTowers,
    techniciansWithClusters,
    totalClusters,
    clustersWithTechs
  ] = await Promise.all([
    User.countDocuments({ role: 'technician' }),
    User.countDocuments({ role: 'technician', assignedTowers: { $exists: true, $ne: [] } }),
    User.countDocuments({ role: 'technician', assignedClusters: { $exists: true, $ne: [] } }),
    Cluster.countDocuments({}),
    Cluster.countDocuments({ 'assigned_technicians.0': { $exists: true } })
  ]);

  console.log(`Total Technicians: ${totalTechnicians}`);
  console.log(`Technicians with Towers: ${techniciansWithTowers}`);
  console.log(`Technicians with Clusters: ${techniciansWithClusters}`);
  console.log(`\nTotal Clusters: ${totalClusters}`);
  console.log(`Clusters with Technicians: ${clustersWithTechs}`);
  console.log();
}

async function main() {
  try {
    console.log('\n🚀 Manual Technician Assignment Tool\n');
    console.log('Connecting to MongoDB...');
    
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-mgmt');
    console.log('✓ Connected to MongoDB\n');

    // Run assignments
    const towerResults = await assignTechniciansToTowers();
    const clusterResults = await assignTechniciansToClusters();
    
    // Print summary
    await printSummary();

    console.log('✅ Assignment complete!\n');
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Assignment failed:', error.message);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

main();