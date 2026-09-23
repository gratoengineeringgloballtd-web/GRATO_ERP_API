const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// User schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  phone: String,
  role: {
    type: String,
    enum: ['admin', 'supervisor', 'technician', 'analyst', 'operations'],
    default: 'technician'
  },
  userType: {
    type: String,
    enum: ['admin', 'supervisor', 'technician', 'analyst', 'operations']
  },
  isActive: { type: Boolean, default: true },
  employeeId: String,
  department: String,
  position: String,
  location: String,
  // Technician fields
  technicianId: String,
  specializations: [String],
  certifications: [Object],
  assignedClusters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Cluster' }],
  assignedTowers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tower' }],
  currentTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Maintenance' }],
  completedTasks: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  // Supervisor fields
  supervisorId: String,
  supervisedTechnicians: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  supervisedClusters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Cluster' }],
  managementLevel: String,
  // Analyst fields
  analystId: String,
  analysisSpecializations: [String],
  createdAt: { type: Date, default: Date.now }
}, { strict: false });

const User = mongoose.model('User', userSchema);

// Test users data
const testUsers = [
  // Admin users
  {
    username: 'admin',
    email: 'admin@grato.com',
    password: 'Admin@123',
    fullName: 'System Administrator',
    phone: '+237670000001',
    role: 'admin',
    userType: 'admin',
    department: 'IT Management',
    position: 'System Administrator',
    location: 'Douala HQ'
  },
  {
    username: 'admin2',
    email: 'admin2@grato.com',
    password: 'Admin@123',
    fullName: 'John Admin',
    phone: '+237670000002',
    role: 'admin',
    userType: 'admin',
    department: 'Operations',
    position: 'Operations Director',
    location: 'Yaounde'
  },

  // Supervisor users
  {
    username: 'supervisor1',
    email: 'supervisor1@grato.com',
    password: 'Super@123',
    fullName: 'Marie Supervisor',
    phone: '+237670000011',
    role: 'supervisor',
    userType: 'supervisor',
    department: 'Field Operations',
    position: 'Field Supervisor',
    location: 'Douala',
    managementLevel: 'senior'
  },
  {
    username: 'supervisor2',
    email: 'supervisor2@grato.com',
    password: 'Super@123',
    fullName: 'Paul Ngwe',
    phone: '+237670000012',
    role: 'supervisor',
    userType: 'supervisor',
    department: 'Field Operations',
    position: 'Regional Supervisor',
    location: 'Yaounde',
    managementLevel: 'lead'
  },
  {
    username: 'supervisor3',
    email: 'supervisor3@grato.com',
    password: 'Super@123',
    fullName: 'Sarah Kande',
    phone: '+237670000013',
    role: 'supervisor',
    userType: 'supervisor',
    department: 'Field Operations',
    position: 'Junior Supervisor',
    location: 'Bafoussam',
    managementLevel: 'junior'
  },

  // Technician users
  {
    username: 'tech1',
    email: 'tech1@grato.com',
    password: 'Tech@123',
    fullName: 'Emmanuel Fon',
    phone: '+237670000021',
    role: 'technician',
    userType: 'technician',
    department: 'Maintenance',
    position: 'Senior Technician',
    location: 'Douala',
    specializations: ['generator', 'power_system', 'electrical'],
    completedTasks: 45,
    rating: 4.5
  },
  {
    username: 'tech2',
    email: 'tech2@grato.com',
    password: 'Tech@123',
    fullName: 'Jean Biya',
    phone: '+237670000022',
    role: 'technician',
    userType: 'technician',
    department: 'Maintenance',
    position: 'Technician',
    location: 'Yaounde',
    specializations: ['ac_unit', 'maintenance'],
    completedTasks: 32,
    rating: 4.2
  },
  {
    username: 'tech3',
    email: 'tech3@grato.com',
    password: 'Tech@123',
    fullName: 'Alice Mbarga',
    phone: '+237670000023',
    role: 'technician',
    userType: 'technician',
    department: 'Maintenance',
    position: 'Junior Technician',
    location: 'Bafoussam',
    specializations: ['generator', 'mechanical'],
    completedTasks: 18,
    rating: 4.0
  },
  {
    username: 'tech4',
    email: 'tech4@grato.com',
    password: 'Tech@123',
    fullName: 'David Tagne',
    phone: '+237670000024',
    role: 'technician',
    userType: 'technician',
    department: 'Maintenance',
    position: 'Technician',
    location: 'Douala',
    specializations: ['power_system', 'electrical', 'maintenance'],
    completedTasks: 28,
    rating: 4.3
  },
  {
    username: 'tech5',
    email: 'tech5@grato.com',
    password: 'Tech@123',
    fullName: 'Grace Njoya',
    phone: '+237670000025',
    role: 'technician',
    userType: 'technician',
    department: 'Maintenance',
    position: 'Senior Technician',
    location: 'Yaounde',
    specializations: ['generator', 'ac_unit', 'maintenance'],
    completedTasks: 52,
    rating: 4.7
  },

  // Analyst users
  {
    username: 'analyst1',
    email: 'analyst1@grato.com',
    password: 'Analyst@123',
    fullName: 'Robert Kamdem',
    phone: '+237670000031',
    role: 'analyst',
    userType: 'analyst',
    department: 'Data Analytics',
    position: 'Senior Data Analyst',
    location: 'Douala HQ',
    analysisSpecializations: ['outage', 'performance', 'predictive']
  },
  {
    username: 'analyst2',
    email: 'analyst2@grato.com',
    password: 'Analyst@123',
    fullName: 'Linda Fotso',
    phone: '+237670000032',
    role: 'analyst',
    userType: 'analyst',
    department: 'Data Analytics',
    position: 'Data Analyst',
    location: 'Yaounde',
    analysisSpecializations: ['maintenance', 'cost', 'reporting']
  },
  {
    username: 'analyst3',
    email: 'analyst3@grato.com',
    password: 'Analyst@123',
    fullName: 'Peter Nkeng',
    phone: '+237670000033',
    role: 'analyst',
    userType: 'analyst',
    department: 'Data Analytics',
    position: 'Junior Analyst',
    location: 'Douala HQ',
    analysisSpecializations: ['performance', 'reporting']
  }
];

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

async function generateEmployeeId(role) {
  const prefix = role.substring(0, 3).toUpperCase();
  const timestamp = Date.now().toString().slice(-3);
  const random = Math.floor(Math.random() * 900) + 100;
  return `${prefix}${timestamp}${random}`;
}

async function createTestUsers() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/generator_management');
    console.log('✓ Connected to MongoDB\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('          CREATING TEST USERS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const userData of testUsers) {
      try {
        // Check if user already exists
        const existingUser = await User.findOne({ 
          $or: [
            { email: userData.email },
            { username: userData.username }
          ]
        });

        if (existingUser) {
          console.log(`⊘ Skipped: ${userData.email} (already exists)`);
          skipped++;
          continue;
        }

        // Hash password
        const hashedPassword = await hashPassword(userData.password);

        // Generate employee ID if not provided
        const employeeId = userData.employeeId || await generateEmployeeId(userData.role);

        // Generate role-specific IDs
        let roleSpecificId = null;
        if (userData.role === 'technician') {
          const timestamp = Date.now().toString().slice(-3);
          roleSpecificId = `TECH${userData.fullName.substring(0, 3).toUpperCase()}${timestamp}`;
        } else if (userData.role === 'supervisor') {
          const timestamp = Date.now().toString().slice(-3);
          roleSpecificId = `SUP${userData.fullName.substring(0, 3).toUpperCase()}${timestamp}`;
        } else if (userData.role === 'analyst') {
          const timestamp = Date.now().toString().slice(-3);
          roleSpecificId = `ANL${userData.fullName.substring(0, 3).toUpperCase()}${timestamp}`;
        }

        // Create user object
        const userObject = {
          ...userData,
          password: hashedPassword,
          employeeId,
          isActive: true
        };

        // Add role-specific ID
        if (userData.role === 'technician' && roleSpecificId) {
          userObject.technicianId = roleSpecificId;
        } else if (userData.role === 'supervisor' && roleSpecificId) {
          userObject.supervisorId = roleSpecificId;
        } else if (userData.role === 'analyst' && roleSpecificId) {
          userObject.analystId = roleSpecificId;
        }

        // Create and save user
        const user = new User(userObject);
        await user.save();

        console.log(`✓ Created: ${userData.email}`);
        console.log(`  Role: ${userData.role}`);
        console.log(`  Password: ${userData.password}`);
        console.log(`  Employee ID: ${employeeId}`);
        if (roleSpecificId) {
          console.log(`  ${userData.role} ID: ${roleSpecificId}`);
        }
        console.log();

        created++;

      } catch (error) {
        console.error(`✗ Error creating ${userData.email}:`, error.message);
        errors++;
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('          SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total users to create: ${testUsers.length}`);
    console.log(`Successfully created: ${created}`);
    console.log(`Skipped (already exist): ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log();

    // Display user type breakdown
    const userCounts = await User.aggregate([
      { $group: { _id: '$userType', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('          USER TYPE BREAKDOWN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    userCounts.forEach(({ _id, count }) => {
      console.log(`${_id}: ${count} users`);
    });
    console.log();

    // Display test credentials
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('          TEST CREDENTIALS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const groupedUsers = {
      admin: testUsers.filter(u => u.role === 'admin'),
      supervisor: testUsers.filter(u => u.role === 'supervisor'),
      technician: testUsers.filter(u => u.role === 'technician'),
      analyst: testUsers.filter(u => u.role === 'analyst')
    };

    Object.entries(groupedUsers).forEach(([role, users]) => {
      console.log(`\n${role.toUpperCase()}S:`);
      users.forEach(user => {
        console.log(`  Email: ${user.email}`);
        console.log(`  Password: ${user.password}`);
        console.log(`  Name: ${user.fullName}`);
        console.log();
      });
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n✓ Test users creation complete!');
    console.log('\nYou can now login with any of the above credentials.');

  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the function
createTestUsers();