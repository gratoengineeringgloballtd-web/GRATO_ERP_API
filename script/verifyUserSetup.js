require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Cluster = require('../models/Cluster');

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
  header: () => console.log(`\n${colors.bright}${colors.blue}${'='.repeat(60)}${colors.reset}`),
  section: (msg) => console.log(`${colors.bright}${msg}${colors.reset}`)
};

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

const verifyUsers = async () => {
  log.header();
  log.section('USER VERIFICATION');
  log.header();

  const requiredRoles = ['admin', 'supervisor', 'technician', 'diesel_manager', 'data_collector', 'analyst', 'operations'];
  const results = {
    total: 0,
    byRole: {},
    active: 0,
    inactive: 0,
    missingRoles: []
  };

  try {
    // Get all users
    const users = await User.find({});
    results.total = users.length;

    // Count by role
    for (const role of requiredRoles) {
      const count = users.filter(u => u.role === role).length;
      results.byRole[role] = count;
      
      if (count === 0) {
        results.missingRoles.push(role);
      }
    }

    // Count active/inactive
    results.active = users.filter(u => u.isActive).length;
    results.inactive = users.filter(u => !u.isActive).length;

    // Print results
    console.log('\n📊 User Statistics:');
    console.log(`   Total Users: ${colors.bright}${results.total}${colors.reset}`);
    console.log(`   Active: ${colors.green}${results.active}${colors.reset}`);
    console.log(`   Inactive: ${results.inactive > 0 ? colors.yellow : colors.reset}${results.inactive}${colors.reset}`);
    console.log('\n📋 Users by Role:');
    
    for (const [role, count] of Object.entries(results.byRole)) {
      const status = count > 0 ? colors.green + '✓' : colors.red + '✗';
      console.log(`   ${status} ${role.padEnd(20)} ${colors.bright}${count}${colors.reset}`);
    }

    // Check for missing roles
    if (results.missingRoles.length > 0) {
      log.warning('\n⚠ Missing Roles:');
      results.missingRoles.forEach(role => {
        console.log(`   - ${role}`);
      });
      log.info('\nRun: node scripts/setupUserRoles.js to create missing users');
    } else {
      log.success('\n✓ All required roles are present!');
    }

    // List all users
    console.log('\n👥 User List:');
    users.forEach((user, index) => {
      const statusIcon = user.isActive ? '🟢' : '🔴';
      console.log(`   ${statusIcon} ${(index + 1).toString().padStart(2)}. ${user.fullName.padEnd(30)} ${user.email.padEnd(35)} [${user.role}]`);
    });

  } catch (error) {
    log.error('User verification failed: ' + error.message);
  }

  return results;
};

const verifyClusters = async () => {
  log.header();
  log.section('CLUSTER VERIFICATION');
  log.header();

  try {
    const clusters = await Cluster.find({})
      .populate('supervisor', 'fullName email')
      .populate('assigned_technicians.technician', 'fullName email');

    console.log(`\n📍 Total Clusters: ${colors.bright}${clusters.length}${colors.reset}\n`);

    if (clusters.length === 0) {
      log.warning('No clusters found. Run setup script to create default cluster.');
      return;
    }

    clusters.forEach((cluster, index) => {
      console.log(`${index + 1}. ${colors.bright}${cluster.cluster_name}${colors.reset}`);
      console.log(`   Region: ${cluster.region}`);
      console.log(`   Supervisor: ${cluster.supervisor?.fullName || 'None'}`);
      console.log(`   Technicians: ${cluster.assigned_technicians?.length || 0}`);
      console.log(`   Active: ${cluster.active ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
      console.log('');
    });

  } catch (error) {
    log.error('Cluster verification failed: ' + error.message);
  }
};

const verifyTechnicianAssignments = async () => {
  log.header();
  log.section('TECHNICIAN ASSIGNMENTS');
  log.header();

  try {
    const technicians = await User.find({ role: 'technician' });
    
    console.log(`\n🔧 Total Technicians: ${colors.bright}${technicians.length}${colors.reset}\n`);

    for (const tech of technicians) {
      const siteCount = tech.assigned_sites?.length || 0;
      const clusterAssigned = tech.assigned_cluster ? '✓' : '✗';
      
      console.log(`${tech.fullName.padEnd(30)} Sites: ${siteCount.toString().padStart(3)}  Cluster: ${clusterAssigned}`);
    }

  } catch (error) {
    log.error('Technician assignment verification failed: ' + error.message);
  }
};

const verifyPermissions = async () => {
  log.header();
  log.section('ROLE PERMISSIONS CHECK');
  log.header();

  console.log('\n🔐 Testing permission checks...\n');

  try {
    const testCases = [
      { role: 'admin', resource: 'all', expected: true },
      { role: 'supervisor', resource: 'sites', expected: true },
      { role: 'technician', resource: 'fuel', expected: false },
      { role: 'diesel_manager', resource: 'fuel', expected: true },
      { role: 'data_collector', resource: 'exports', expected: true },
      { role: 'analyst', resource: 'analytics', expected: true }
    ];

    for (const test of testCases) {
      const user = await User.findOne({ role: test.role });
      
      if (user) {
        const canAccess = user.canAccess(test.resource);
        const result = canAccess === test.expected;
        const icon = result ? colors.green + '✓' : colors.red + '✗';
        
        console.log(`   ${icon} ${test.role.padEnd(20)} → ${test.resource.padEnd(15)} ${result ? 'PASS' : 'FAIL'}${colors.reset}`);
      }
    }

  } catch (error) {
    log.error('Permission verification failed: ' + error.message);
  }
};

const verifyLoginReadiness = async () => {
  log.header();
  log.section('LOGIN READINESS CHECK');
  log.header();

  const checks = {
    usersExist: false,
    allRolesPresent: false,
    adminExists: false,
    passwordsHashed: false
  };

  try {
    const users = await User.find({});
    checks.usersExist = users.length > 0;
    
    const roles = ['admin', 'supervisor', 'technician', 'diesel_manager', 'data_collector', 'analyst'];
    checks.allRolesPresent = roles.every(role => users.some(u => u.role === role));
    
    checks.adminExists = users.some(u => u.role === 'admin');
    
    // Check if passwords are hashed (bcrypt hashes start with $2)
    checks.passwordsHashed = users.every(u => u.password.startsWith('$2'));

    console.log('\n✔ Readiness Checks:\n');
    console.log(`   Users exist: ${checks.usersExist ? colors.green + '✓' : colors.red + '✗'}${colors.reset}`);
    console.log(`   All roles present: ${checks.allRolesPresent ? colors.green + '✓' : colors.red + '✗'}${colors.reset}`);
    console.log(`   Admin exists: ${checks.adminExists ? colors.green + '✓' : colors.red + '✗'}${colors.reset}`);
    console.log(`   Passwords hashed: ${checks.passwordsHashed ? colors.green + '✓' : colors.red + '✗'}${colors.reset}`);

    const allReady = Object.values(checks).every(v => v);
    
    if (allReady) {
      log.success('\n✓ System is ready for login!');
      console.log('\nYou can now:');
      console.log('  1. Start the server: npm run dev');
      console.log('  2. Login with credentials from setupUserRoles.js');
      console.log('  3. Test each role\'s functionality\n');
    } else {
      log.warning('\n⚠ System is NOT ready for login');
      console.log('\nPlease run: node scripts/setupUserRoles.js\n');
    }

  } catch (error) {
    log.error('Login readiness check failed: ' + error.message);
  }
};

const generateTestReport = async () => {
  log.header();
  log.section('TEST SUMMARY REPORT');
  log.header();

  try {
    const stats = await User.getRoleStats();
    
    console.log('\n📈 Role Statistics:\n');
    stats.forEach(stat => {
      console.log(`   ${stat._id.toUpperCase()}`);
      console.log(`      Total: ${stat.total}`);
      console.log(`      Active: ${stat.active}`);
      console.log(`      Avg Rating: ${stat.avg_rating?.toFixed(2) || 'N/A'}`);
      console.log('');
    });

  } catch (error) {
    log.warning('Could not generate statistics (may need sample data)');
  }
};

const runVerification = async () => {
  try {
    log.header();
    log.section('GENERATOR MANAGEMENT - USER SETUP VERIFICATION');
    log.header();

    await connectDB();

    // Run all verifications
    await verifyUsers();
    await verifyClusters();
    await verifyTechnicianAssignments();
    await verifyPermissions();
    await verifyLoginReadiness();
    await generateTestReport();

    log.header();
    log.success('Verification Complete!');
    log.header();

  } catch (error) {
    log.error('Verification failed: ' + error.message);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    log.info('Database connection closed');
  }
};

// Run verification
runVerification();