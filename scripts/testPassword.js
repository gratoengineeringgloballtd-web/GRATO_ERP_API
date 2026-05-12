require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected');

    const user = await User.findOne({
      email: 'tom@gratoengineering.com'
    });

    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }

    // plain password only
    user.password = 'cEo01@Grato#';

    await user.save();

    console.log('✅ Password reset successful');
    process.exit(0);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();