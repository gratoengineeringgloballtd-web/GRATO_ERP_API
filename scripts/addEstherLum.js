require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas\n');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

async function addFloraKidzeven() {
  try {
    console.log('👤 ADDING NEW USER: FLORA KIDZEVEN');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    const email = 'flora.kidzeven@gratoglobal.com';
    const password = 'FlorA@GraTo#1';
    const fullName = 'Flora Kidzeven';

    const existing = await User.findOne({ email });
    if (existing) {
      console.log('⚠️  User already exists:', existing.fullName);
      console.log('   Email:', existing.email);
      console.log('   Department:', existing.department);
      console.log('   Position:', existing.position);
      process.exit(0);
    }

    const supervisorEmail = 'lukong.lambert@gratoglobal.com';
    const supervisor = await User.findOne({ email: supervisorEmail });

    if (!supervisor) {
      console.error('❌ Supervisor not found:', supervisorEmail);
      process.exit(1);
    }

    const department = supervisor.department || 'Business Development & Supply Chain';
    const position = 'Supply Chain Staff';
    const hierarchyLevel = Math.max(1, (supervisor.hierarchyLevel || 3) - 1);

    const newUser = new User({
      email,
      password,
      fullName,
      role: 'employee',
      department,
      position,
      supervisor: supervisor._id,
      departmentHead: supervisor.departmentHead || supervisor.supervisor || null,
      hierarchyLevel,
      isActive: true
    });

    await newUser.save();

    // Add to supervisor direct reports (if not already)
    if (supervisor.directReports) {
      const alreadyLinked = supervisor.directReports.some(
        (id) => id.toString() === newUser._id.toString()
      );
      if (!alreadyLinked) {
        supervisor.directReports.push(newUser._id);
        await supervisor.save();
      }
    }

    console.log('✅ User created successfully!\n');

    console.log('📊 USER DETAILS');
    console.log('='.repeat(80));
    console.log(`Email              : ${newUser.email}`);
    console.log(`Full Name          : ${newUser.fullName}`);
    console.log(`Department         : ${newUser.department}`);
    console.log(`Position           : ${newUser.position}`);
    console.log(`Role               : ${newUser.role}`);
    console.log(`Supervisor         : ${supervisor.fullName} (${supervisor.email})`);
    console.log('='.repeat(80) + '\n');

    console.log('🔐 LOGIN CREDENTIALS');
    console.log('='.repeat(80));
    console.log(`Email              : ${email}`);
    console.log(`Password           : ${password}`);
    console.log('='.repeat(80) + '\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Failed to add user:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  addFloraKidzeven();
}

module.exports = { addFloraKidzeven };