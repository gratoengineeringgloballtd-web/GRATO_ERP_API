#!/usr/bin/env node

/**
 * Standalone Relationship Verification Script
 * Usage: node scripts/verifyRelationships.js
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Cluster = require('../models/Cluster');
const Tower = require('../models/Tower');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function printHeader(text) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(60)}`);
  console.log(`  ${text}`);
  console.log(`${'='.repeat(60)}${colors.reset}\n`);
}

function printSuccess(text) {
  console.log(`${colors.green}✓${colors.reset} ${text}`);
}

function printWarning(text) {
  console.log(`${colors.yellow}⚠${colors.reset} ${text}`);
}

function printError(text) {
  console.log(`${colors.red}✗${colors.reset} ${text}`);
}

function printInfo(text) {
  console.log(`${colors.cyan}ℹ${colors.reset} ${text}`);
}

async function verifyRelationships() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-mgmt');
    printSuccess('Connected to MongoDB\n');

    // ===== SUPERVISOR VERIFICATION =====
    printHeader('SUPERVISOR RELATIONSHIPS');

    const supervisors = await User.find({ role: 'supervisor' });
    
    for (const supervisor of supervisors) {
      console.log(`\n${colors.bright}${supervisor.fullName}${colors.reset}`);
      console.log(`  Email: ${supervisor.email}`);
      console.log(`  ID: ${supervisor._id}`);
      
      // Get actual clusters from DB
      const actualClusters = await Cluster.find({ supervisor: supervisor._id });
      const actualTowers = await Tower.find({ supervisor: supervisor._id });
      
      console.log(`\n  ${colors.bright}Array Fields:${colors.reset}`);
      console.log(`    supervisedClusters:    ${supervisor.supervisedClusters?.length || 0}`);
      console.log(`    assignedClusters:      ${supervisor.assignedClusters?.length || 0}`);
      console.log(`    assignedTowers:        ${supervisor.assignedTowers?.length || 0}`);
      console.log(`    supervisedTechnicians: ${supervisor.supervisedTechnicians?.length || 0}`);
      
      console.log(`\n  ${colors.bright}Database Counts:${colors.reset}`);
      console.log(`    Clusters (supervisor field): ${actualClusters.length}`);
      console.log(`    Towers (supervisor field):   ${actualTowers.length}`);
      
      // Verify clusters
      if (actualClusters.length > 0) {
        console.log(`\n  ${colors.bright}Clusters Breakdown:${colors.reset}`);
        
        for (const cluster of actualClusters) {
          const towersInCluster = await Tower.countDocuments({ cluster_id: cluster._id });
          const techsInCluster = cluster.assigned_technicians?.length || 0;
          
          console.log(`    - ${cluster.name} (${cluster.code})`);
          console.log(`      Towers: ${towersInCluster}`);
          console.log(`      Assigned Technicians: ${techsInCluster}`);
          
          if (techsInCluster > 0) {
            console.log(`      ${colors.dim}Technicians:${colors.reset}`);
            for (const at of cluster.assigned_technicians) {
              const tech = await User.findById(at.technician);
              if (tech) {
                console.log(`        • ${tech.fullName}`);
              }
            }
          }
        }
      }
      
      // Validation checks
      console.log(`\n  ${colors.bright}Validation:${colors.reset}`);
      
      if (supervisor.supervisedClusters?.length === actualClusters.length) {
        printSuccess(`    supervisedClusters matches DB clusters`);
      } else {
        printError(`    supervisedClusters (${supervisor.supervisedClusters?.length}) ≠ DB clusters (${actualClusters.length})`);
      }
      
      if (supervisor.assignedClusters?.length === actualClusters.length) {
        printSuccess(`    assignedClusters matches DB clusters`);
      } else {
        printError(`    assignedClusters (${supervisor.assignedClusters?.length}) ≠ DB clusters (${actualClusters.length})`);
      }
      
      if (supervisor.assignedTowers?.length === actualTowers.length) {
        printSuccess(`    assignedTowers matches DB towers`);
      } else {
        printError(`    assignedTowers (${supervisor.assignedTowers?.length}) ≠ DB towers (${actualTowers.length})`);
      }
      
      // Count expected technicians
      let expectedTechs = new Set();
      for (const cluster of actualClusters) {
        if (cluster.assigned_technicians) {
          cluster.assigned_technicians.forEach(at => {
            if (at.technician) expectedTechs.add(at.technician.toString());
          });
        }
      }
      
      if (supervisor.supervisedTechnicians?.length === expectedTechs.size) {
        printSuccess(`    supervisedTechnicians matches cluster technicians`);
      } else {
        printError(`    supervisedTechnicians (${supervisor.supervisedTechnicians?.length}) ≠ cluster technicians (${expectedTechs.size})`);
      }
    }

    // ===== TECHNICIAN VERIFICATION =====
    printHeader('TECHNICIAN RELATIONSHIPS (First 10)');

    const technicians = await User.find({ role: 'technician' }).limit(10);
    
    for (const tech of technicians) {
      console.log(`\n${colors.bright}${tech.fullName}${colors.reset}`);
      console.log(`  Email: ${tech.email}`);
      
      console.log(`\n  ${colors.bright}Array Fields:${colors.reset}`);
      console.log(`    assignedClusters: ${tech.assignedClusters?.length || 0}`);
      console.log(`    assignedTowers:   ${tech.assignedTowers?.length || 0}`);
      
      if (tech.assignedClusters && tech.assignedClusters.length > 0) {
        console.log(`\n  ${colors.bright}Assigned Clusters:${colors.reset}`);
        for (const clusterId of tech.assignedClusters) {
          const cluster = await Cluster.findById(clusterId);
          if (cluster) {
            const supervisor = cluster.supervisor ? await User.findById(cluster.supervisor) : null;
            console.log(`    - ${cluster.name} (Supervisor: ${supervisor?.fullName || 'None'})`);
          }
        }
      }
      
      if (tech.assignedTowers && tech.assignedTowers.length > 0) {
        console.log(`\n  ${colors.bright}Assigned Towers: ${tech.assignedTowers.length} total${colors.reset}`);
        const sampleTowers = await Tower.find({ 
          _id: { $in: tech.assignedTowers.slice(0, 3) } 
        });
        console.log(`    Sample (first 3):`);
        for (const tower of sampleTowers) {
          console.log(`    - ${tower._id} (${tower.name})`);
        }
      }
    }

    // ===== CLUSTER VERIFICATION =====
    printHeader('CLUSTER RELATIONSHIPS');

    const clusters = await Cluster.find({});
    
    for (const cluster of clusters) {
      const supervisor = cluster.supervisor ? await User.findById(cluster.supervisor) : null;
      const towers = await Tower.countDocuments({ cluster_id: cluster._id });
      
      console.log(`\n${colors.bright}${cluster.name}${colors.reset} (${cluster.code})`);
      console.log(`  Supervisor: ${supervisor?.fullName || 'None'}`);
      console.log(`  Assigned Technicians: ${cluster.assigned_technicians?.length || 0}`);
      console.log(`  Towers in DB: ${towers}`);
      console.log(`  Stats total_towers: ${cluster.stats?.total_towers || 0}`);
      
      if (cluster.assigned_technicians && cluster.assigned_technicians.length > 0) {
        console.log(`\n  ${colors.bright}Technicians:${colors.reset}`);
        for (const at of cluster.assigned_technicians) {
          const tech = await User.findById(at.technician);
          if (tech) {
            console.log(`    - ${tech.fullName} (${at.role || 'primary'})`);
          }
        }
      }
      
      // Validation
      if (towers === cluster.stats?.total_towers) {
        printSuccess(`  Tower count matches stats`);
      } else {
        printWarning(`  Tower count (${towers}) ≠ stats (${cluster.stats?.total_towers})`);
      }
    }

    // ===== SUMMARY =====
    printHeader('SUMMARY');

    const totalSupervisors = await User.countDocuments({ role: 'supervisor' });
    const totalTechnicians = await User.countDocuments({ role: 'technician' });
    const totalClusters = await Cluster.countDocuments({});
    const totalTowers = await Tower.countDocuments({});
    
    const supervisorsWithClusters = await User.countDocuments({ 
      role: 'supervisor',
      supervisedClusters: { $exists: true, $ne: [] }
    });
    
    const supervisorsWithTowers = await User.countDocuments({ 
      role: 'supervisor',
      assignedTowers: { $exists: true, $ne: [] }
    });
    
    const supervisorsWithTechs = await User.countDocuments({ 
      role: 'supervisor',
      supervisedTechnicians: { $exists: true, $ne: [] }
    });
    
    const techniciansWithClusters = await User.countDocuments({ 
      role: 'technician',
      assignedClusters: { $exists: true, $ne: [] }
    });
    
    const techniciansWithTowers = await User.countDocuments({ 
      role: 'technician',
      assignedTowers: { $exists: true, $ne: [] }
    });
    
    console.log(`${colors.bright}Entity Counts:${colors.reset}`);
    console.log(`  Supervisors:  ${totalSupervisors}`);
    console.log(`  Technicians:  ${totalTechnicians}`);
    console.log(`  Clusters:     ${totalClusters}`);
    console.log(`  Towers:       ${totalTowers}`);
    
    console.log(`\n${colors.bright}Relationship Coverage:${colors.reset}`);
    console.log(`  Supervisors with clusters:          ${supervisorsWithClusters}/${totalSupervisors}`);
    console.log(`  Supervisors with towers:            ${supervisorsWithTowers}/${totalSupervisors}`);
    console.log(`  Supervisors with technicians:       ${supervisorsWithTechs}/${totalSupervisors}`);
    console.log(`  Technicians with clusters:          ${techniciansWithClusters}/${totalTechnicians}`);
    console.log(`  Technicians with towers:            ${techniciansWithTowers}/${totalTechnicians}`);
    
    // Check for orphaned records
    const clustersWithoutSupervisor = await Cluster.countDocuments({ 
      supervisor: { $in: [null, undefined] }
    });
    
    const towersWithoutCluster = await Tower.countDocuments({ 
      cluster_id: { $in: [null, undefined] }
    });
    
    if (clustersWithoutSupervisor > 0 || towersWithoutCluster > 0) {
      console.log(`\n${colors.bright}${colors.yellow}Orphaned Records:${colors.reset}`);
      if (clustersWithoutSupervisor > 0) {
        printWarning(`  ${clustersWithoutSupervisor} clusters without supervisor`);
      }
      if (towersWithoutCluster > 0) {
        printWarning(`  ${towersWithoutCluster} towers without cluster`);
      }
    } else {
      console.log(`\n${colors.green}No orphaned records found${colors.reset}`);
    }

    await mongoose.disconnect();
    printSuccess('\nDisconnected from MongoDB');

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  }
}

verifyRelationships();