require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Search for users with 'Carmel' in their name
    const users = await User.find({
      fullName: new RegExp('Carmel', 'i')
    }).select('_id fullName email position department signature');
    
    console.log('👤 Users matching "Carmel":');
    console.log('='.repeat(80));
    
    if (users.length === 0) {
      console.log('❌ No users found with "Carmel" in their name\n');
      process.exit(0);
    }
    
    users.forEach((user, i) => {
      console.log(`${i + 1}. ${user.fullName}`);
      console.log(`   ID: ${user._id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Position: ${user.position}`);
      console.log(`   Department: ${user.department}`);
      console.log(`   Has Signature: ${user.signature && user.signature.url ? '✅ Yes' : '❌ No'}`);
      console.log('');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
