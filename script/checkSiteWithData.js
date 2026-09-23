require('dotenv').config();
const mongoose = require('mongoose');
const Site = require('../models/Site');

async function checkSiteWithData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected\n');

    // Find a site that HAS Solar_System data
    const siteWithSolar = await Site.findOne({ 
      'Solar_System': { $exists: true, $ne: null }
    }).lean();

    if (siteWithSolar) {
      console.log('=== SITE WITH SOLAR DATA ===');
      console.log('Site:', siteWithSolar.Site_Name);
      console.log('IHS_ID:', siteWithSolar.IHS_ID_SITE);
      console.log('\n--- Solar System ---');
      console.log('Solar_System exists:', !!siteWithSolar.Solar_System);
      if (siteWithSolar.Solar_System) {
        console.log('Installed:', siteWithSolar.Solar_System.installed);
        console.log('Panel Count:', siteWithSolar.Solar_System.panel_count);
        console.log('Total Capacity:', siteWithSolar.Solar_System.total_capacity);
      }
      
      console.log('\n--- AC System ---');
      console.log('AC_System exists:', !!siteWithSolar.AC_System);
      if (siteWithSolar.AC_System) {
        console.log('Unit Count:', siteWithSolar.AC_System.count);
        console.log('Units:', siteWithSolar.AC_System.units?.length || 0);
      }
      
      console.log('\n--- Load Readings ---');
      console.log('Load_Readings exists:', !!siteWithSolar.Load_Readings);
      if (siteWithSolar.Load_Readings) {
        console.log('Phase 1:', siteWithSolar.Load_Readings.phase_1_amps);
        console.log('Avg Load on DG:', siteWithSolar.Load_Readings.avg_load_on_dg_kw);
      }
      
      console.log('\n--- Grid Power ---');
      console.log('ENEO_Working:', siteWithSolar.ENEO_Working);
      console.log('ENEO_Meter_Number:', siteWithSolar.ENEO_Meter_Number);
      console.log('Phase_Type:', siteWithSolar.Phase_Type);
      console.log('Grid_Availability:', siteWithSolar.Grid_Availability);
      
      console.log('\n--- Generators ---');
      console.log('Generators_Details count:', siteWithSolar.Generators_Details?.length || 0);
      if (siteWithSolar.Generators_Details?.length > 0) {
        siteWithSolar.Generators_Details.forEach((gen, i) => {
          console.log(`Gen ${i + 1}: ${gen.brand} - ${gen.serial_number} (${gen.kva} KVA)`);
        });
      }
    } else {
      console.log('No sites found with Solar data');
    }

    // Check stats
    console.log('\n=== STATISTICS ===');
    const stats = {
      totalSites: await Site.countDocuments(),
      withSolar: await Site.countDocuments({ 'Solar_System': { $exists: true, $ne: null } }),
      withAC: await Site.countDocuments({ 'AC_System': { $exists: true, $ne: null } }),
      withLoads: await Site.countDocuments({ 'Load_Readings': { $exists: true, $ne: null } }),
      withEneo: await Site.countDocuments({ 'ENEO_Meter_Number': { $exists: true, $ne: '' } }),
      withGridAvail: await Site.countDocuments({ 'Grid_Availability': { $exists: true, $ne: '' } }),
      with2Gens: await Site.countDocuments({ 'Generators_Details.1': { $exists: true } })
    };
    
    console.log('Total Sites:', stats.totalSites);
    console.log('Sites with Solar:', stats.withSolar);
    console.log('Sites with AC:', stats.withAC);
    console.log('Sites with Load Readings:', stats.withLoads);
    console.log('Sites with ENEO Meter:', stats.withEneo);
    console.log('Sites with Grid Availability:', stats.withGridAvail);
    console.log('Sites with 2 Generators:', stats.with2Gens);

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSiteWithData();
