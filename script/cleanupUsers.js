const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');

async function cleanupUsers() {
  try {
    if (process.env.ALLOW_USER_CLEANUP !== 'true') {
      console.error('\n⚠️ Aborting: cleanupUsers must be run with ALLOW_USER_CLEANUP=true environment variable to avoid accidental data loss.');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management');
    
    console.log('Cleaning up users...');
    
    // Delete all users (guarded by ALLOW_USER_CLEANUP)
    const result = await User.deleteMany({});
    console.log(`✓ Deleted ${result.deletedCount} users`);
    
    // Drop indexes to fix duplicate key issues
    await User.collection.dropIndexes();
    console.log('✓ Dropped all indexes');
    
    console.log('\n✅ Cleanup complete! Now run createTestUser.js');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupUsers();