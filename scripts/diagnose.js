require('dotenv').config();
const mongoose = require('mongoose');
const Maintenance = require('../models/Maintenance');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management');
  console.log('✓ Connected\n');

  // Try different query approaches to find the issue
  const t1 = await Maintenance.countDocuments({ 'generators_checked.brand': { $exists: true } });
  console.log('generators_checked.brand $exists true:', t1);

  const t2 = await Maintenance.countDocuments({ 'generators_checked.brand': { $type: 'string' } });
  console.log('generators_checked.brand $type string:', t2);

  const t3 = await Maintenance.countDocuments({ 'generators_checked.brand': 'IPT TRION' });
  console.log('generators_checked.brand == IPT TRION:', t3);

  // Raw aggregate to see what the field looks like from Mongo's perspective
  const agg = await Maintenance.aggregate([
    { $limit: 3 },
    { $project: {
      site_id: 1,
      gen0_brand: { $arrayElemAt: ['$generators_checked.brand', 0] },
      gen0_serial: { $arrayElemAt: ['$generators_checked.serial_number', 0] },
      gen0_kva: { $arrayElemAt: ['$generators_checked.kva', 0] },
      gen_count: { $size: { $ifNull: ['$generators_checked', []] } },
    }}
  ]);
  console.log('\nAggregate sample:');
  agg.forEach(d => console.log(JSON.stringify(d)));

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });