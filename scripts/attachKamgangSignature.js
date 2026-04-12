require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const User = require('../models/User');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGO uri');

  await mongoose.connect(uri);

  const email = 'kamgang.junior@gratoglobal.com';
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error('User not found: ' + email);

  const source = path.join(__dirname, '..', 'public', 'signatures', 'Kamgang-removebg-preview.png');
  if (!fs.existsSync(source)) throw new Error('Signature source not found: ' + source);

  const signaturesDir = path.join(__dirname, '..', 'uploads', 'user-signatures');
  await fsp.mkdir(signaturesDir, { recursive: true });

  const ext = path.extname(source).toLowerCase() || '.png';
  const filename = `${user._id.toString()}_signature_${Date.now()}${ext}`;
  const dest = path.join(signaturesDir, filename);

  await fsp.copyFile(source, dest);
  const stats = await fsp.stat(dest);

  user.signature = {
    url: `/uploads/user-signatures/${filename}`,
    localPath: dest,
    filename,
    originalName: path.basename(source),
    format: ext.slice(1),
    size: stats.size,
    uploadedAt: new Date()
  };

  await user.save();

  console.log('✅ Signature attached:');
  console.log(JSON.stringify({
    user: user.fullName,
    email: user.email,
    signature: user.signature
  }, null, 2));

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('❌', error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
