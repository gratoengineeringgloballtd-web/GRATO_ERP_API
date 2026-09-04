require('dotenv').config();
const mongoose = require('mongoose');
const DocumentSection = require('../models/DocumentSection');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  // Bypass Mongoose casting entirely - go straight to the raw driver to see exactly
  // what's stored, byte for byte.
  const raw = await mongoose.connection.db.collection('documentsections').find({}).toArray();
  raw.forEach(doc => {
    console.log(JSON.stringify({
      label: doc.label,
      isFolder: doc.isFolder,
      scope: doc.scope,
      scopeType: typeof doc.scope,
      scopeCharCodes: doc.scope ? [...doc.scope].map(c => c.charCodeAt(0)) : null
    }));
  });

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
