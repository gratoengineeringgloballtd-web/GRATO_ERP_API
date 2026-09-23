const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/grato';
console.log('Connecting to MongoDB...');
mongoose.connect(mongoUri);

const Site = require('../models/Site');

async function checkGeneratorData() {
  try {
    console.log('Checking generator data in database...\n');

    // Find sites with multiple generators
    const sitesWithMultipleGens = await Site.find({
      'Generators_Details.1': { $exists: true }
    }).select('IHS_ID_SITE Site_Name Number_of_Generators Generators_Details').limit(10);

    console.log(`Found ${sitesWithMultipleGens.length} sites with multiple generators:\n`);

    sitesWithMultipleGens.forEach(site => {
      console.log(`Site: ${site.Site_Name} (${site.IHS_ID_SITE})`);
      console.log(`  Number_of_Generators field: ${site.Number_of_Generators}`);
      console.log(`  Generators_Details array length: ${site.Generators_Details?.length || 0}`);
      if (site.Generators_Details) {
        site.Generators_Details.forEach((gen, idx) => {
          console.log(`  Generator ${idx + 1}: ${gen.brand || 'N/A'} - ${gen.serial_number || 'N/A'} (${gen.kva || 0} KVA)`);
        });
      }
      console.log('');
    });

    // Sample check: show a few sites
    const sampleSites = await Site.find({})
      .select('IHS_ID_SITE Site_Name Number_of_Generators Generators_Details')
      .limit(5);

    console.log('\n--- Sample of 5 sites ---');
    sampleSites.forEach(site => {
      console.log(`${site.Site_Name}: ${site.Generators_Details?.length || 0} generators in array (field says: ${site.Number_of_Generators})`);
    });

    // Count statistics
    const totalSites = await Site.countDocuments({});
    const sitesWithGen1 = await Site.countDocuments({ 'Generators_Details.0': { $exists: true } });
    const sitesWithGen2 = await Site.countDocuments({ 'Generators_Details.1': { $exists: true } });

    console.log('\n--- Statistics ---');
    console.log(`Total sites: ${totalSites}`);
    console.log(`Sites with at least 1 generator: ${sitesWithGen1}`);
    console.log(`Sites with at least 2 generators: ${sitesWithGen2}`);

    mongoose.connection.close();
  } catch (error) {
    console.error('Error checking data:', error);
    mongoose.connection.close();
  }
}

checkGeneratorData();
