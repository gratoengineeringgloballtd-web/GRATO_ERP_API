require('dotenv').config();
const mongoose = require('mongoose');
const DocumentSection = require('../models/DocumentSection');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('Connected to:', mongoose.connection.db.databaseName);

  const total = await DocumentSection.countDocuments();
  const folders = await DocumentSection.countDocuments({ isFolder: true, scope: 'global' });
  const globalSections = await DocumentSection.countDocuments({ isFolder: false, scope: 'global' });

  console.log('Total DocumentSection records:', total);
  console.log('Global folders:', folders);
  console.log('Global sections:', globalSections);

  if (total === 0) {
    console.log('\n>>> CONFIRMED: seed script has never run against this database. Run: npm run seed:document-folders');
  } else {
    console.log('\n>>> Data exists. Listing folders:');
    const list = await DocumentSection.find({ isFolder: true }).select('key label scope employeeId');
    list.forEach(f => console.log(' -', f.label, `(${f.key})`, f.scope, f.employeeId || ''));
  }

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
