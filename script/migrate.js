#!/usr/bin/env node

/**
 * Enhanced Data Migration CLI Script with Detailed Debugging
 * Usage: node scripts/migrate.js [options]
 * 
 * Options:
 *   --dry-run           Preview changes without committing
 *   --update-existing   Update existing records
 *   --entity=<name>     Migrate specific entity (clusters|supervisors|technicians|towers|generators|all)
 *   --validate          Validate readiness before migration
 *   --rollback          Rollback all migrations (requires confirmation)
 *   --verify            Verify relationships after migration
 */

const mongoose = require('mongoose');
const readline = require('readline');
const dataMigrationService = require('../services/dataMigrationService');
const logger = require('../utils/logger');
require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  updateExisting: args.includes('--update-existing'),
  validate: args.includes('--validate'),
  rollback: args.includes('--rollback'),
  verify: args.includes('--verify'),
  entity: 'all'
};

// Get entity type if specified
const entityArg = args.find(arg => arg.startsWith('--entity='));
if (entityArg) {
  options.entity = entityArg.split('=')[1];
}

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to prompt user
const prompt = (question) => {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

const printHeader = (text) => {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(60)}`);
  console.log(`  ${text}`);
  console.log(`${'='.repeat(60)}${colors.reset}\n`);
};

const printSuccess = (text) => {
  console.log(`${colors.green}✓${colors.reset} ${text}`);
};

const printWarning = (text) => {
  console.log(`${colors.yellow}⚠${colors.reset} ${text}`);
};

const printError = (text) => {
  console.log(`${colors.red}✗${colors.reset} ${text}`);
};

const printInfo = (text) => {
  console.log(`${colors.cyan}ℹ${colors.reset} ${text}`);
};

const printDebug = (text) => {
  console.log(`${colors.dim}${text}${colors.reset}`);
};

// Validation function
async function validateMigration() {
  printHeader('Validating Migration Readiness');

  const Site = require('../models/Site');
  const User = require('../models/User');

  const checks = [];
  let passed = true;

  // Check 1: Admin user
  const admin = await User.findOne({ role: 'admin' });
  if (admin) {
    printSuccess(`Admin user found: ${admin.email}`);
    checks.push({ name: 'Admin User', passed: true });
  } else {
    printError('No admin user found');
    checks.push({ name: 'Admin User', passed: false });
    passed = false;
  }

  // Check 2: Sites data
  const sitesCount = await Site.countDocuments({});
  if (sitesCount > 0) {
    printSuccess(`Found ${sitesCount} sites`);
    checks.push({ name: 'Sites Data', passed: true });
  } else {
    printError('No sites found');
    checks.push({ name: 'Sites Data', passed: false });
    passed = false;
  }

  // Check 3: Site IDs
  const sitesWithoutId = await Site.countDocuments({ 
    IHS_ID_SITE: { $in: [null, ''] } 
  });
  if (sitesWithoutId === 0) {
    printSuccess('All sites have IDs');
    checks.push({ name: 'Site IDs', passed: true });
  } else {
    printWarning(`${sitesWithoutId} sites missing IHS_ID_SITE`);
    checks.push({ name: 'Site IDs', passed: true });
  }

  // Check 4: Clusters
  const sitesWithClusters = await Site.countDocuments({ 
    GRATO_Cluster: { $nin: [null, ''] } 
  });
  const sitesWithoutCluster = sitesCount - sitesWithClusters;
  
  if (sitesWithoutCluster === 0) {
    printSuccess('All sites have cluster assignments');
  } else {
    printWarning(`${sitesWithoutCluster} sites without clusters (will be skipped)`);
  }

  // Check 5: Supervisors
  const sitesWithSupervisors = await Site.countDocuments({ 
    $or: [
      { SBC_Supervisor: { $nin: [null, ''] } },
      { IHS_supervisor_name: { $nin: [null, ''] } }
    ]
  });
  printInfo(`${sitesWithSupervisors} sites have supervisor assignments`);

  // Check 6: Technicians
  const sitesWithTechnicians = await Site.countDocuments({ 
    Technician_Name: { $nin: [null, ''] } 
  });
  printInfo(`${sitesWithTechnicians} sites have technician assignments`);

  // Check 7: Coordinates
  const sitesWithoutCoords = await Site.countDocuments({
    $or: [
      { Latitude: { $in: [null, 0] } },
      { Longitude: { $in: [null, 0] } }
    ]
  });
  if (sitesWithoutCoords === 0) {
    printSuccess('All sites have coordinates');
  } else {
    printWarning(`${sitesWithoutCoords} sites without coordinates (defaults will be used)`);
  }

  console.log();
  return passed;
}

// Preview function
async function showPreview() {
  printHeader('Migration Preview');

  const Site = require('../models/Site');
  const User = require('../models/User');
  const Cluster = require('../models/Cluster');
  const Tower = require('../models/Tower');
  const Generator = require('../models/Generator');

  // Count unique values from sites
  const [
    totalSites,
    uniqueClusters,
    uniqueSupervisors,
    uniqueTechnicians,
    sitesWithGens
  ] = await Promise.all([
    Site.countDocuments({}),
    Site.distinct('GRATO_Cluster').then(c => c.filter(x => x).length),
    Site.aggregate([
      {
        $group: {
          _id: {
            $ifNull: ['$SBC_Supervisor', '$IHS_supervisor_name']
          }
        }
      },
      { $match: { _id: { $ne: null } } },
      { $count: 'total' }
    ]).then(r => r[0]?.total || 0),
    Site.distinct('Technician_Name').then(n => n.filter(x => x).length),
    Site.countDocuments({ Generators_Details: { $exists: true, $ne: [] } })
  ]);

  // Count existing records
  const [
    existingClusters,
    existingSupervisors,
    existingTechnicians,
    existingTowers,
    existingGenerators
  ] = await Promise.all([
    Cluster.countDocuments({}),
    User.countDocuments({ role: 'supervisor' }),
    User.countDocuments({ role: 'technician' }),
    Tower.countDocuments({}),
    Generator.countDocuments({})
  ]);

  // Calculate generators
  const sitesWithGenData = await Site.find({ 
    Generators_Details: { $exists: true, $ne: [] } 
  }).select('Generators_Details').lean();

  const totalGenerators = sitesWithGenData.reduce((sum, site) => 
    sum + (site.Generators_Details?.length || 0), 0
  );

  console.log(`${colors.bright}Source Data (Sites):${colors.reset}`);
  console.log(`  Total Sites:              ${totalSites}`);
  console.log(`  Unique Clusters:          ${uniqueClusters}`);
  console.log(`  Unique Supervisors:       ${uniqueSupervisors}`);
  console.log(`  Unique Technicians:       ${uniqueTechnicians}`);
  console.log(`  Sites with Generators:    ${sitesWithGens}`);
  console.log(`  Total Generators:         ${totalGenerators}`);

  console.log(`\n${colors.bright}Current Normalized Data:${colors.reset}`);
  console.log(`  Clusters:                 ${existingClusters}`);
  console.log(`  Supervisors:              ${existingSupervisors}`);
  console.log(`  Technicians:              ${existingTechnicians}`);
  console.log(`  Towers:                   ${existingTowers}`);
  console.log(`  Generators:               ${existingGenerators}`);

  console.log(`\n${colors.bright}Migration Impact:${colors.reset}`);
  console.log(`  Clusters to create:       ${Math.max(0, uniqueClusters - existingClusters)}`);
  console.log(`  Supervisors to create:    ${Math.max(0, uniqueSupervisors - existingSupervisors)}`);
  console.log(`  Technicians to create:    ${Math.max(0, uniqueTechnicians - existingTechnicians)}`);
  console.log(`  Towers to create:         ${Math.max(0, totalSites - existingTowers)}`);
  console.log(`  Generators to create:     ${Math.max(0, totalGenerators - existingGenerators)}`);

  if (options.updateExisting) {
    console.log(`\n${colors.yellow}Update mode enabled: Existing records will be updated${colors.reset}`);
  }

  console.log();
}

// Verify relationships after migration
async function verifyRelationships() {
  printHeader('Verifying Relationships');

  const User = require('../models/User');
  const Cluster = require('../models/Cluster');
  const Tower = require('../models/Tower');

  // Check supervisors
  const supervisors = await User.find({ role: 'supervisor' });
  
  console.log(`${colors.bright}Supervisor Relationships:${colors.reset}`);
  for (const sup of supervisors) {
    const clusters = await Cluster.find({ supervisor: sup._id });
    const towers = await Tower.find({ supervisor: sup._id });
    
    console.log(`\n  ${sup.fullName}:`);
    console.log(`    supervisedClusters: ${sup.supervisedClusters?.length || 0}`);
    console.log(`    assignedClusters:   ${sup.assignedClusters?.length || 0}`);
    console.log(`    assignedTowers:     ${sup.assignedTowers?.length || 0}`);
    console.log(`    supervisedTechs:    ${sup.supervisedTechnicians?.length || 0}`);
    console.log(`    ${colors.dim}(DB: ${clusters.length} clusters, ${towers.length} towers)${colors.reset}`);
    
    // Verify consistency
    if (sup.supervisedClusters?.length !== clusters.length) {
      printWarning(`      Mismatch: supervisedClusters array (${sup.supervisedClusters?.length}) != actual clusters (${clusters.length})`);
    } else {
      printSuccess(`      ✓ Clusters match`);
    }
  }

  // Check technicians
  const technicians = await User.find({ role: 'technician' }).limit(5);
  
  console.log(`\n${colors.bright}Technician Relationships (showing first 5):${colors.reset}`);
  for (const tech of technicians) {
    console.log(`\n  ${tech.fullName}:`);
    console.log(`    assignedClusters: ${tech.assignedClusters?.length || 0}`);
    console.log(`    assignedTowers:   ${tech.assignedTowers?.length || 0}`);
    
    if (tech.assignedClusters?.length > 0) {
      const cluster = await Cluster.findById(tech.assignedClusters[0]);
      if (cluster) {
        printDebug(`      Sample cluster: ${cluster.name}`);
      }
    }
  }

  // Check clusters
  const clusters = await Cluster.find({}).limit(5);
  
  console.log(`\n${colors.bright}Cluster Relationships (showing first 5):${colors.reset}`);
  for (const cluster of clusters) {
    const towers = await Tower.countDocuments({ cluster_id: cluster._id });
    const supervisor = cluster.supervisor ? await User.findById(cluster.supervisor) : null;
    
    console.log(`\n  ${cluster.name}:`);
    console.log(`    Supervisor:       ${supervisor?.fullName || 'None'}`);
    console.log(`    Assigned Techs:   ${cluster.assigned_technicians?.length || 0}`);
    console.log(`    Towers in DB:     ${towers}`);
    console.log(`    Stats total:      ${cluster.stats?.total_towers || 0}`);
  }

  console.log();
}

// Rollback function
async function performRollback() {
  printHeader('Migration Rollback');

  printWarning('This will DELETE all migrated data!');
  printWarning('The following will be removed:');
  console.log('  - All Clusters');
  console.log('  - All Supervisors');
  console.log('  - All Technicians');
  console.log('  - All Towers');
  console.log('  - All Generators');
  console.log();

  const confirmation = await prompt('Type "DELETE ALL" to confirm rollback: ');

  if (confirmation !== 'DELETE ALL') {
    printError('Rollback cancelled');
    return;
  }

  const secondConfirmation = await prompt('Are you absolutely sure? (yes/no): ');

  if (secondConfirmation.toLowerCase() !== 'yes') {
    printError('Rollback cancelled');
    return;
  }

  const User = require('../models/User');
  const Cluster = require('../models/Cluster');
  const Tower = require('../models/Tower');
  const Generator = require('../models/Generator');

  console.log('\nDeleting data...');

  const results = {
    generators: (await Generator.deleteMany({})).deletedCount,
    towers: (await Tower.deleteMany({})).deletedCount,
    technicians: (await User.deleteMany({ role: 'technician' })).deletedCount,
    supervisors: (await User.deleteMany({ role: 'supervisor' })).deletedCount,
    clusters: (await Cluster.deleteMany({})).deletedCount
  };

  console.log('\nRollback completed:');
  console.log(`  Deleted ${results.generators} generators`);
  console.log(`  Deleted ${results.towers} towers`);
  console.log(`  Deleted ${results.technicians} technicians`);
  console.log(`  Deleted ${results.supervisors} supervisors`);
  console.log(`  Deleted ${results.clusters} clusters`);

  printSuccess('Rollback completed successfully');
}

// Migration function
async function performMigration() {
  if (options.dryRun) {
    printHeader('DRY RUN MODE - No changes will be made');
  } else {
    printHeader('Starting Migration');
  }

  let results;

  try {
    results = await dataMigrationService.migrateAllFromSites(options);
  } catch (error) {
    printError(`Migration failed: ${error.message}`);
    console.error(error.stack);
    throw error;
  }

  // Print results
  printHeader('Migration Results');

  const entities = ['supervisors', 'technicians', 'clusters', 'towers', 'generators'];
  
  for (const entity of entities) {
    if (!results[entity]) continue;
    
    const result = results[entity];
    console.log(`\n${colors.bright}${entity.toUpperCase()}:${colors.reset}`);
    printSuccess(`Created: ${result.created}`);
    printSuccess(`Updated: ${result.updated}`);

    if (result.errors && result.errors.length > 0) {
      printError(`Errors: ${result.errors.length}`);
      if (result.errors.length <= 5) {
        result.errors.forEach(err => {
          console.log(`  ${colors.red}→${colors.reset} ${JSON.stringify(err)}`);
        });
      } else {
        console.log(`  ${colors.red}→${colors.reset} First 5 errors:`);
        result.errors.slice(0, 5).forEach(err => {
          console.log(`    ${JSON.stringify(err)}`);
        });
        console.log(`  ${colors.dim}... and ${result.errors.length - 5} more${colors.reset}`);
      }
    }
  }

  // Show assignment results
  if (results.assignments) {
    console.log(`\n${colors.bright}ASSIGNMENTS:${colors.reset}`);
    printSuccess(`Supervisor → Clusters: ${results.assignments.supervisorClusters}`);
    printSuccess(`Supervisor → Towers: ${results.assignments.supervisorTowers}`);
    printSuccess(`Technician → Clusters: ${results.assignments.technicianClusters}`);
    printSuccess(`Technician → Towers: ${results.assignments.technicianTowers}`);
    
    if (results.assignments.errors && results.assignments.errors.length > 0) {
      printError(`Assignment Errors: ${results.assignments.errors.length}`);
    }
  }

  // Calculate totals
  const totalCreated = entities.reduce((sum, e) => sum + (results[e]?.created || 0), 0);
  const totalUpdated = entities.reduce((sum, e) => sum + (results[e]?.updated || 0), 0);
  const totalErrors = entities.reduce((sum, e) => sum + (results[e]?.errors?.length || 0), 0) +
                      (results.assignments?.errors?.length || 0);

  console.log();
  printInfo(`Total Created: ${totalCreated}`);
  printInfo(`Total Updated: ${totalUpdated}`);
  if (totalErrors > 0) {
    printWarning(`Total Errors: ${totalErrors}`);
  }

  if (options.dryRun) {
    console.log();
    printWarning('This was a DRY RUN - no changes were made');
    printInfo('Run without --dry-run to perform actual migration');
  } else {
    console.log();
    printSuccess('Migration completed successfully!');
    
    if (options.verify) {
      await verifyRelationships();
    } else {
      printInfo('Run with --verify to check relationships');
    }
  }
}

// Main function
async function main() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-mgmt');
    printSuccess('Connected to MongoDB');

    // Handle rollback
    if (options.rollback) {
      await performRollback();
      rl.close();
      await mongoose.disconnect();
      return;
    }

    // Handle verify only
    if (options.verify && !options.validate) {
      await verifyRelationships();
      rl.close();
      await mongoose.disconnect();
      return;
    }

    // Validation
    if (options.validate || !options.dryRun) {
      const isValid = await validateMigration();

      if (!isValid && !options.dryRun) {
        printError('Validation failed. Please fix errors before proceeding.');
        printInfo('Run with --dry-run to see what would happen');
        rl.close();
        await mongoose.disconnect();
        return;
      }
    }

    // Show preview
    await showPreview();

    // Confirm if not dry run
    if (!options.dryRun) {
      console.log();
      const confirm = await prompt('Proceed with migration? (yes/no): ');

      if (confirm.toLowerCase() !== 'yes') {
        printWarning('Migration cancelled');
        rl.close();
        await mongoose.disconnect();
        return;
      }
    }

    // Perform migration
    await performMigration();

    rl.close();
    await mongoose.disconnect();
    printSuccess('Disconnected from MongoDB');

  } catch (error) {
    printError(`Migration failed: ${error.message}`);
    console.error(error.stack);
    rl.close();
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run main function
main();


