const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const Site = require('../models/Site');

const checkData = async () => {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
        await mongoose.connect(uri);
        console.log('MongoDB Connected\n');

        // Check one site
        const site = await Site.findOne({}).lean();
        
        console.log('=== SAMPLE SITE DATA CHECK ===\n');
        console.log('Site:', site.Site_Name);
        console.log('IHS_ID:', site.IHS_ID_SITE);
        
        console.log('\n--- Grid Power (ENEO) ---');
        console.log('ENEO_Working:', site.ENEO_Working);
        console.log('ENEO_Meter_Number:', site.ENEO_Meter_Number);
        console.log('ENEO_SQ_Check:', site.ENEO_SQ_Check);
        console.log('Phase_Type:', site.Phase_Type);
        console.log('Grid_Availability:', site.Grid_Availability);
        
        console.log('\n--- Solar System ---');
        console.log('Solar_System exists:', !!site.Solar_System);
        if (site.Solar_System) {
            console.log('Installed:', site.Solar_System.installed);
            console.log('Panel Count:', site.Solar_System.panel_count);
        }
        
        console.log('\n--- AC System ---');
        console.log('AC_System exists:', !!site.AC_System);
        if (site.AC_System) {
            console.log('Count:', site.AC_System.count);
            console.log('Units:', site.AC_System.units?.length);
        }
        
        console.log('\n--- Load Readings ---');
        console.log('Load_Readings exists:', !!site.Load_Readings);
        if (site.Load_Readings) {
            console.log('Phase 1:', site.Load_Readings.phase_1_amps);
            console.log('Phase 2:', site.Load_Readings.phase_2_amps);
            console.log('Phase 3:', site.Load_Readings.phase_3_amps);
        }
        
        console.log('\n--- Generators ---');
        console.log('Number_of_Generators:', site.Number_of_Generators);
        console.log('Generators_Details count:', site.Generators_Details?.length);
        if (site.Generators_Details) {
            site.Generators_Details.forEach((gen, idx) => {
                console.log(`  Gen ${idx + 1}: ${gen.brand} - ${gen.kva} KVA`);
            });
        }
        
        // Count sites with data
        console.log('\n=== DATABASE STATISTICS ===\n');
        const totalSites = await Site.countDocuments();
        const sitesWithEneo = await Site.countDocuments({ ENEO_Meter_Number: { $exists: true, $ne: '' } });
        const sitesWithSolar = await Site.countDocuments({ 'Solar_System.installed': { $exists: true } });
        const sitesWithAC = await Site.countDocuments({ 'AC_System.count': { $gt: 0 } });
        const sitesWithLoads = await Site.countDocuments({ 'Load_Readings.phase_1_amps': { $exists: true } });
        const sitesWith2Gens = await Site.countDocuments({ Number_of_Generators: 2 });
        
        console.log('Total Sites:', totalSites);
        console.log('Sites with ENEO Meter:', sitesWithEneo);
        console.log('Sites with Solar Data:', sitesWithSolar);
        console.log('Sites with AC Data:', sitesWithAC);
        console.log('Sites with Load Readings:', sitesWithLoads);
        console.log('Sites with 2 Generators:', sitesWith2Gens);
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
};

checkData();
