// update_password.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = 'mongodb+srv://gratoportal_db_user:a7wfYqQKmZQV8oVS@cluster0.ankyh1e.mongodb.net/generator-management';
const email = 'alioum.moussa@gratoglobal.com';
const newPassword = 'qe9VR27L';

async function updatePassword() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false, collection: 'users' }));

  const hash = await bcrypt.hash(newPassword, 12); // 12 rounds as in your .env
  const result = await User.updateOne({ email }, { $set: { password: hash } });

  console.log('Update result:', result);
  await mongoose.disconnect();
}

updatePassword().catch(console.error);