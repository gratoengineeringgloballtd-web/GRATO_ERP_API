const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');

async function createTestUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management');
    
    console.log('Creating test users...');

    // First, create non-technician users
    const nonTechUsers = [
      {
        email: 'supervisor@example.com',
        password: 'password123',
        fullName: 'Jane Supervisor',
        role: 'supervisor',
        phone: '+237687654321',
        isActive: true
      },
      {
        email: 'admin@example.com',
        password: 'password123',
        fullName: 'Admin User',
        role: 'admin',
        phone: '+237665432109',
        isActive: true
      },
      {
        email: 'analyst@example.com',
        password: 'password123',
        fullName: 'Sarah Analyst',
        role: 'analyst',
        phone: '+237676543210',
        isActive: true
      }
    ];

    const createdUsers = {};

    for (const userData of nonTechUsers) {
      const existingUser = await User.findOne({ email: userData.email });
      
      if (existingUser) {
        console.log(`User ${userData.email} already exists`);
        createdUsers[userData.role] = existingUser;
        continue;
      }

      const user = new User(userData);
      await user.save();
      createdUsers[userData.role] = user;
      
      console.log(`✓ Created user: ${userData.email} (${userData.role})`);
    }

    // Now create technicians with supervisor reference
    const supervisorId = createdUsers.supervisor?._id;

    const techUsers = [
      {
        email: 'technician@example.com',
        password: 'password123',
        fullName: 'John Technician',
        role: 'technician',
        phone: '+237612345678',
        isActive: true,
        supervisor: supervisorId, // Assign supervisor
        specializations: ['generator', 'maintenance']
      },
      {
        email: 'technician2@example.com',
        password: 'password123',
        fullName: 'Mike Tech',
        role: 'technician',
        phone: '+237698765432',
        isActive: true,
        supervisor: supervisorId, // Assign supervisor
        specializations: ['electrical', 'power_system']
      }
    ];

    for (const userData of techUsers) {
      const existingUser = await User.findOne({ email: userData.email });
      
      if (existingUser) {
        console.log(`User ${userData.email} already exists`);
        continue;
      }

      const user = new User(userData);
      await user.save();
      
      console.log(`✓ Created user: ${userData.email} (${userData.role})`);
    }

    console.log('\nTest users created successfully!');
    console.log('\nYou can now login with:');
    console.log('Admin: admin@example.com / password123');
    console.log('Supervisor: supervisor@example.com / password123');
    console.log('Technician: technician@example.com / password123');
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating users:', error);
    process.exit(1);
  }
}

createTestUsers();