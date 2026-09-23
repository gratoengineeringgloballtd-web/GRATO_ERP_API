// scripts/setupUserRoles.js
// Run with: node scripts/setupUserRoles.js

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Cluster = require('../models/Cluster');

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}✗ ${msg}${colors.reset}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}`),
  section: (msg) => console.log(`${colors.bright}${msg}${colors.reset}`)
};

// Default users for each role
const defaultUsers = [
  {
    fullName: 'System Administrator',
    email: 'admin@generator.cm',
    password: 'Admin@2025',
    role: 'admin',
    phone: '+237670000001',
    isActive: true,
    specializations: ['system_management', 'user_management']
  },
  {
    fullName: 'John Supervisor',
    email: 'supervisor@generator.cm',
    password: 'Super@2025',
    role: 'supervisor',
    phone: '+237670000002',
    isActive: true,
    specializations: ['team_management', 'approval_workflows']
  },
  {
    fullName: 'Mike Technician',
    email: 'technician@generator.cm',
    password: 'Tech@2025',
    role: 'technician',
    phone: '+237670000003',
    isActive: true,
    specializations: ['preventive_maintenance', 'generator_repair']
  },
  {
    fullName: 'Sarah Diesel Manager',
    email: 'diesel@generator.cm',
    password: 'Diesel@2025',
    role: 'diesel_manager',
    phone: '+237670000004',
    isActive: true,
    specializations: ['fuel_management', 'logistics']
  },
  {
    fullName: 'David Data Collector',
    email: 'data@generator.cm',
    password: 'Data@2025',
    role: 'data_collector',
    phone: '+237670000005',
    isActive: true,
    specializations: ['data_analysis', 'reporting']
  },
  {
    fullName: 'Emma Analyst',
    email: 'analyst@generator.cm',
    password: 'Analyst@2025',
    role: 'analyst',
    phone: '+237670000006',
    isActive: true,
    specializations: ['data_analytics', 'business_intelligence']
  },
  {
    fullName: 'Olivia Operations',
    email: 'operations@generator.cm',
    password: 'Ops@2025',
    role: 'operations',
    phone: '+237670000007',
    isActive: true,
    specializations: ['reporting', 'data_analysis']
  }
];

// Additional technicians for testing
const additionalTechnicians = [
  {
    fullName: 'Alioum Moussa',
    email: 'alioum.moussa@generator.cm',
    password: 'Tech@2025',
    role: 'technician',
    phone: '+237670000010',
    isActive: true,
    specializations: ['preventive_maintenance', 'emergency_repair']
  },
  {
    fullName: 'Paul Biya',
    email: 'paul.biya@generator.cm',
    password: 'Tech@2025',
    role: 'technician',
    phone: '+237670000011',
    isActive: true,
    specializations: ['preventive_maintenance', 'fuel_systems']
  },
  {
    fullName: 'Jean Pierre',
    email: 'jean.pierre@generator.cm',
    password: 'Tech@2025',
    role: 'technician',
    phone: '+237670000012',
    isActive: true,
    specializations: ['electrical_systems', 'generator_repair']
  }
];

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    log.success('Connected to MongoDB');
  } catch (error) {
    log.error('MongoDB connection failed: ' + error.message);
    process.exit(1);
  }
};

// Create a single user
const createUser = async (userData) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      log.warning(`User ${userData.email} already exists - skipping`);
      return existingUser;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    // Create user
    const user = new User({
      ...userData,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await user.save();
    log.success(`Created user: ${userData.fullName} (${userData.role})`);
    return user;
  } catch (error) {
    log.error(`Failed to create user ${userData.email}: ${error.message}`);
    return null;
  }
};

// Create default cluster for testing
const createDefaultCluster = async (supervisorId, technicianIds, createdById) => {
  try {
    const existingCluster = await Cluster.findOne({ name: 'Test Cluster 1' });
    if (existingCluster) {
      log.warning('Default cluster already exists - skipping');
      return existingCluster;
    }

    const cluster = new Cluster({
      // Required fields
      name: 'Test Cluster 1',
      code: 'TC001',
      region: 'Littoral',
      created_by: createdById,
      
      // Geographic information (required)
      coverage_area: {
        center: {
          latitude: 4.0511, // Douala, Cameroon coordinates
          longitude: 9.7679
        },
        radius: 50, // 50km radius
        boundaries: [
          { latitude: 4.1, longitude: 9.7 },
          { latitude: 4.1, longitude: 9.9 },
          { latitude: 3.9, longitude: 9.9 },
          { latitude: 3.9, longitude: 9.7 }
        ]
      },
      
      // Administrative information
      supervisor: supervisorId,
      assigned_technicians: technicianIds.map((id, index) => ({
        technician: id,
        assigned_date: new Date(),
        role: index === 0 ? 'primary' : 'secondary',
        specializations: ['generator', 'maintenance']
      })),
      
      // Operational statistics (defaults)
      stats: {
        total_towers: 0,
        active_towers: 0,
        total_generators: 0,
        operational_generators: 0,
        total_ac_units: 0,
        total_power_systems: 0,
        pending_maintenance: 0,
        active_alerts: 0
      },
      
      // Performance metrics (defaults)
      performance: {
        average_uptime: 99,
        average_response_time: 2,
        maintenance_completion_rate: 95,
        customer_satisfaction: 4.5
      },
      
      // Contact information
      contact_info: {
        office_address: 'Douala, Littoral Region',
        phone: '+237670000002',
        email: 'cluster1@generator.cm'
      },
      
      // Status
      status: 'active',
      health_score: 100,
      
      // Description
      description: 'Test cluster for development and testing purposes'
    });

    await cluster.save();
    log.success('Created default cluster: Test Cluster 1');
    log.info(`  Region: Littoral`);
    log.info(`  Code: TC001`);
    log.info(`  Technicians: ${technicianIds.length}`);
    return cluster;
  } catch (error) {
    log.error(`Failed to create cluster: ${error.message}`);
    console.error('Cluster validation errors:', error.errors);
    return null;
  }
};

// Update Site collection to assign technicians
const assignTechniciansToSites = async (technicians) => {
  try {
    const Site = mongoose.model('Site');
    const sites = await Site.find({}).limit(20);

    if (sites.length === 0) {
      log.warning('No sites found to assign technicians');
      return;
    }

    let assignmentCount = 0;
    for (let i = 0; i < sites.length; i++) {
      const technician = technicians[i % technicians.length];
      sites[i].Technician_Name = technician.fullName;
      sites[i].technician_id = technician._id;
      await sites[i].save();
      assignmentCount++;
    }

    log.success(`Assigned technicians to ${assignmentCount} sites`);
  } catch (error) {
    log.warning('Could not assign technicians to sites (Site model may not exist yet)');
  }
};

// Print login credentials
const printCredentials = (users) => {
  log.header();
  log.section('LOGIN CREDENTIALS');
  log.header();

  console.log('\n');
  users.forEach(user => {
    const roleColors = {
      admin: colors.red,
      supervisor: colors.blue,
      technician: colors.green,
      diesel_manager: colors.yellow,
      data_collector: colors.cyan,
      analyst: colors.reset
    };

    const color = roleColors[user.role] || colors.reset;
    console.log(`${color}${user.role.toUpperCase().padEnd(20)}${colors.reset}${user.email.padEnd(35)}${colors.bright}${user.password}${colors.reset}`);
  });

  console.log('\n');
  log.warning('IMPORTANT: Change these passwords after first login!');
  log.info('All passwords follow the format: Role@2025');
  console.log('\n');
};

// Role permissions matrix
const printRolePermissions = () => {
  log.header();
  log.section('ROLE PERMISSIONS MATRIX');
  log.header();

  const permissions = [
    { role: 'admin', permissions: 'Full system access, user management, all CRUD operations' },
    { role: 'supervisor', permissions: 'Approve/reject maintenance, view team sites, assign tasks' },
    { role: 'technician', permissions: 'Submit site visits, view assigned sites, update maintenance' },
    { role: 'diesel_manager', permissions: 'Manage fuel requests, approve deliveries, view consumption' },
    { role: 'data_collector', permissions: 'View all data, export reports, data quality checks' },
    { role: 'analyst', permissions: 'Read-only access, analytics, generate reports' }
  ];

  console.log('\n');
  permissions.forEach(p => {
    console.log(`${colors.bright}${p.role.toUpperCase()}${colors.reset}`);
    console.log(`  ${p.permissions}\n`);
  });
};

// Main setup function
const setupUserRoles = async () => {
  try {
    log.header();
    log.section('GENERATOR MANAGEMENT SYSTEM - USER ROLES SETUP');
    log.header();

    // Connect to database
    await connectDB();

    log.info('Starting user creation...\n');

    // Create all default users
    const createdUsers = [];
    const allUsers = [...defaultUsers, ...additionalTechnicians];

    for (const userData of allUsers) {
      const user = await createUser(userData);
      if (user) {
        createdUsers.push({ ...userData, _id: user._id });
      }
    }

    log.info('\nUsers created successfully!\n');

    // Get specific users for cluster creation
    const supervisor = createdUsers.find(u => u.role === 'supervisor');
    const technicians = createdUsers.filter(u => u.role === 'technician');

    if (supervisor && technicians.length > 0) {
      log.info('Creating default cluster...');
      await createDefaultCluster(
        supervisor._id,
        technicians.map(t => t._id)
      );
    }

    // Assign technicians to sites
    if (technicians.length > 0) {
      log.info('Assigning technicians to sites...');
      await assignTechniciansToSites(technicians);
    }

    // Print credentials and permissions
    printCredentials(allUsers);
    printRolePermissions();

    // Print statistics
    log.header();
    log.section('SETUP SUMMARY');
    log.header();
    console.log('\n');
    console.log(`Total Users Created: ${colors.bright}${createdUsers.length}${colors.reset}`);
    console.log(`  - Admins: ${createdUsers.filter(u => u.role === 'admin').length}`);
    console.log(`  - Supervisors: ${createdUsers.filter(u => u.role === 'supervisor').length}`);
    console.log(`  - Technicians: ${createdUsers.filter(u => u.role === 'technician').length}`);
    console.log(`  - Diesel Managers: ${createdUsers.filter(u => u.role === 'diesel_manager').length}`);
    console.log(`  - Data Collectors: ${createdUsers.filter(u => u.role === 'data_collector').length}`);
    console.log(`  - Analysts: ${createdUsers.filter(u => u.role === 'analyst').length}`);
    console.log(`  - Operations: ${createdUsers.filter(u => u.role === 'operations').length}`);
    console.log('\n');

    log.success('Setup completed successfully!');
    log.info('You can now start the server and login with the credentials above');
    console.log('\n');

  } catch (error) {
    log.error('Setup failed: ' + error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    log.info('Database connection closed');
  }
};

// Run setup
setupUserRoles();


