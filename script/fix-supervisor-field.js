// script/quick-fix.js
require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Grato:aR8IAXUrOrg1Hz2T@cluster0.x64ib.mongodb.net/generator-management';

async function quickFix() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const db = mongoose.connection.db;
    
    // Update non-technician users
    const result = await db.collection('users').updateMany(
      { role: { $ne: 'technician' } },
      { $set: { supervisor: null } }
    );
    
    console.log(`✅ Updated ${result.modifiedCount} users`);
    
    // Verify
    const supervisors = await db.collection('users').find({ 
      role: 'supervisor' 
    }).toArray();
    
    console.log('\nSupervisors:', supervisors.map(s => ({
      name: s.fullName,
      email: s.email,
      supervisor: s.supervisor
    })));
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

quickFix();