require('dotenv').config();
const mongoose = require('mongoose');
const Part = require('../models/Part');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected for duplicate removal...');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const removeDuplicateParts = async () => {
  try {
    console.log('🔍 Searching for duplicate parts...');

    // Find all duplicates based on part_number
    const duplicates = await Part.aggregate([
      {
        $group: {
          _id: '$part_number',
          count: { $sum: 1 },
          ids: { $push: '$_id' },
          names: { $push: '$name' },
          dates: { $push: '$createdAt' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!');
      return { duplicatesFound: 0, partsDeleted: 0 };
    }

    console.log(`\n📊 Found ${duplicates.length} duplicate part numbers:`);
    
    let totalDeleted = 0;
    const deletionSummary = [];

    for (const dup of duplicates) {
      // Sort by creation date (keep the most recent)
      const sortedItems = dup.ids
        .map((id, index) => ({
          id,
          name: dup.names[index],
          date: dup.dates[index]
        }))
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      // The first item is the most recent, keep it
      const toKeep = sortedItems[0];
      const toDelete = sortedItems.slice(1);

      console.log(`\n  Part Number: ${dup._id}`);
      console.log(`  Total copies: ${dup.count}`);
      console.log(`  Keeping: ${toKeep.name} (${toKeep.id}) - Created: ${new Date(toKeep.date).toLocaleString()}`);
      console.log(`  Deleting ${toDelete.length} duplicate(s):`);

      for (const item of toDelete) {
        console.log(`    - ${item.name} (${item.id}) - Created: ${new Date(item.date).toLocaleString()}`);
      }

      // Delete the duplicates
      const idsToDelete = toDelete.map(item => item.id);
      const deleteResult = await Part.deleteMany({ _id: { $in: idsToDelete } });
      
      totalDeleted += deleteResult.deletedCount;

      deletionSummary.push({
        partNumber: dup._id,
        kept: toKeep.id,
        deleted: deleteResult.deletedCount
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ DUPLICATE REMOVAL COMPLETED');
    console.log('='.repeat(60));
    console.log(`📋 Summary:`);
    console.log(`   Duplicate part numbers found: ${duplicates.length}`);
    console.log(`   Total parts deleted: ${totalDeleted}`);
    console.log(`   Parts remaining: ${await Part.countDocuments()}`);
    
    return {
      duplicatesFound: duplicates.length,
      partsDeleted: totalDeleted,
      summary: deletionSummary
    };

  } catch (error) {
    console.error('❌ Error removing duplicates:', error);
    throw error;
  }
};

const verifyNoDuplicates = async () => {
  try {
    console.log('\n🔍 Verifying no duplicates remain...');
    
    const remainingDuplicates = await Part.aggregate([
      {
        $group: {
          _id: '$part_number',
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    if (remainingDuplicates.length === 0) {
      console.log('✅ Verification passed: No duplicates found!');
      return true;
    } else {
      console.log(`⚠️  Warning: ${remainingDuplicates.length} duplicates still exist!`);
      return false;
    }
  } catch (error) {
    console.error('❌ Error during verification:', error);
    return false;
  }
};

const showPartStats = async () => {
  try {
    const totalParts = await Part.countDocuments();
    const categories = await Part.distinct('category');
    
    console.log('\n📊 Current Parts Statistics:');
    console.log(`   Total parts: ${totalParts}`);
    console.log(`   Unique categories: ${categories.length}`);
    
    const categoryStats = await Part.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    console.log('\n   Parts by category:');
    categoryStats.forEach(cat => {
      console.log(`     ${cat._id}: ${cat.count}`);
    });
    
  } catch (error) {
    console.error('❌ Error getting stats:', error);
  }
};

const main = async () => {
  try {
    console.log('🚀 Starting duplicate parts removal process...\n');
    
    await connectDB();
    
    // Show initial stats
    await showPartStats();
    
    console.log('\n' + '='.repeat(60));
    console.log('REMOVING DUPLICATES');
    console.log('='.repeat(60));
    
    // Remove duplicates
    const result = await removeDuplicateParts();
    
    // Verify no duplicates remain
    await verifyNoDuplicates();
    
    // Show final stats
    await showPartStats();
    
    console.log('\n✅ Process completed successfully!');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Process failed:', error);
    process.exit(1);
  }
};

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  removeDuplicateParts,
  verifyNoDuplicates,
  main
};