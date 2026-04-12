const mongoose = require('mongoose');
require('dotenv').config();

async function cleanupDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Remove any documents with null applicationId
    const result = await mongoose.connection.db.collection('supplieronboardingapplications').deleteMany({
      applicationId: null
    });
    
    console.log('Deleted', result.deletedCount, 'documents with null applicationId');
    
    // Also remove any documents where applicationId is undefined or empty
    const result2 = await mongoose.connection.db.collection('supplieronboardingapplications').deleteMany({
      $or: [
        { applicationId: { $exists: false } },
        { applicationId: '' },
        { applicationId: undefined }
      ]
    });
    
    console.log('Deleted', result2.deletedCount, 'documents with missing applicationId');
    
    // Drop and recreate the applicationId index to ensure it works properly
    try {
      await mongoose.connection.db.collection('supplieronboardingapplications').dropIndex('applicationId_1');
      console.log('Dropped existing applicationId index');
    } catch (err) {
      console.log('No existing applicationId index to drop');
    }
    
    await mongoose.connection.close();
    console.log('Database cleanup completed');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

cleanupDatabase();