const mongoose = require('mongoose');
const Maintenance = require('./models/Maintenance');

mongoose.connect('mongodb://localhost:27017/grato')
  .then(async () => {
    try {
      const maintenance = await Maintenance.find({}).limit(3);
      
      if (maintenance.length > 0) {
        console.log('=== CHECKING MAINTENANCE RECORDS ===\n');
        
        maintenance.forEach((record, idx) => {
          console.log(`Record ${idx + 1}:`);
          
          if (record.equipment_checks && record.equipment_checks.generator_checks) {
            record.equipment_checks.generator_checks.forEach((gen, genIdx) => {
              if (gen.photos && gen.photos.length > 0) {
                console.log(`  Generator ${genIdx + 1} photos:`, gen.photos);
              }
            });
          }
          
          if (record.equipment_checks && record.equipment_checks.grid_checks) {
            if (record.equipment_checks.grid_checks.meter_photos && 
                record.equipment_checks.grid_checks.meter_photos.length > 0) {
              console.log(`  Grid checks meter_photos:`, 
                record.equipment_checks.grid_checks.meter_photos);
            }
          }
          
          if (record.equipment_checks && record.equipment_checks.cleaning_checks) {
            if (record.equipment_checks.cleaning_checks.photos && 
                record.equipment_checks.cleaning_checks.photos.length > 0) {
              console.log(`  Cleaning checks photos:`, 
                record.equipment_checks.cleaning_checks.photos);
            }
          }
          
          console.log('');
        });
      } else {
        console.log('No maintenance records found');
      }
    } catch (err) {
      console.error('Error:', err.message);
    } finally {
      process.exit(0);
    }
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
