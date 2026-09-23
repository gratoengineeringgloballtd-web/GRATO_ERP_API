#!/usr/bin/env node

/**
 * Clear Sites Data Script
 * Usage: node scripts/clearSites.js
 * 
 * WARNING: This will delete ALL sites data!
 */

const mongoose = require('mongoose');
const readline = require('readline');
const Site = require('../models/Site');
require('dotenv').config();

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
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
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

const printHeader = (text) => {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(60)}`);
  console.log(`  ${text}`);
  console.log(`${'='.repeat(60)}${colors.reset}\n`);
};

async function clearSites() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-mgmt');
    printSuccess('Connected to MongoDB');

    // Count current sites
    const sitesCount = await Site.countDocuments({});
    
    printHeader('Clear Sites Data');
    
    if (sitesCount === 0) {
      printWarning('No sites found in database');
      rl.close();
      await mongoose.disconnect();
      return;
    }

    printWarning(`Found ${sitesCount} sites in database`);
    printWarning('This action will DELETE ALL sites data!');
    console.log();

    // First confirmation
    const firstConfirm = await prompt('Type "DELETE ALL SITES" to confirm: ');
    
    if (firstConfirm !== 'DELETE ALL SITES') {
      printError('Operation cancelled');
      rl.close();
      await mongoose.disconnect();
      return;
    }

    // Second confirmation
    const secondConfirm = await prompt('Are you absolutely sure? This cannot be undone! (yes/no): ');
    
    if (secondConfirm.toLowerCase() !== 'yes') {
      printError('Operation cancelled');
      rl.close();
      await mongoose.disconnect();
      return;
    }

    // Delete all sites
    console.log('\nDeleting all sites...');
    const result = await Site.deleteMany({});
    
    printHeader('Deletion Complete');
    printSuccess(`Successfully deleted ${result.deletedCount} sites`);
    
    // Verify deletion
    const remainingSites = await Site.countDocuments({});
    if (remainingSites === 0) {
      printSuccess('Verified: Site collection is now empty');
    } else {
      printWarning(`Warning: ${remainingSites} sites still remain in database`);
    }

    rl.close();
    await mongoose.disconnect();
    printSuccess('Disconnected from MongoDB');

  } catch (error) {
    printError(`Operation failed: ${error.message}`);
    console.error(error);
    rl.close();
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
clearSites();