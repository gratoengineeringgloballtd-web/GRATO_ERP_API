require('dotenv').config();
const mongoose = require('mongoose');
const Cluster = require('../models/Cluster');
const User = require('../models/User');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`)
};

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/generator-management';
    await mongoose.connect(mongoURI);
    log.success('Connected to MongoDB');
  } catch (error) {
    log.error('MongoDB connection failed: ' + error.message);
    process.exit(1);
  }
};

const fixCluster = async () => {
  try {
    console.log('\n' + colors.bold + '='.repeat(60) + colors.reset);
    console.log(colors.bold + 'FIXING CLUSTER - FINAL VERSION' + colors.reset);
    console.log(colors.bold + '='.repeat(60) + colors.reset + '\n');

    await connectDB();

    // Get users
    const admin = await User.findOne({ role: 'admin' });
    const supervisor = await User.findOne({ role: 'supervisor' });
    const technicians = await User.find({ role: 'technician' });

    if (!admin) {
      log.error('Admin user not found. Run setupUserRoles.js first');
      process.exit(1);
    }

    if (!supervisor) {
      log.error('Supervisor user not found. Run setupUserRoles.js first');
      process.exit(1);
    }

    if (technicians.length === 0) {
      log.error('No technicians found. Run setupUserRoles.js first');
      process.exit(1);
    }

    log.info(`Found admin: ${admin.fullName}`);
    log.info(`Found supervisor: ${supervisor.fullName}`);
    log.info(`Found ${technicians.length} technicians`);

    // Delete existing test cluster if any
    const deletedCount = await Cluster.deleteMany({ code: { $in: ['TC001', 'TEST-001'] } });
    if (deletedCount.deletedCount > 0) {
      log.info(`Cleared ${deletedCount.deletedCount} existing test cluster(s)`);
    }

    // Create new cluster with all required fields
    // NOTE: Cluster specializations are DIFFERENT from User specializations
    const clusterData = {
      // Required fields
      name: 'Test Cluster 1',
      code: 'TC001',
      region: 'Littoral',
      created_by: admin._id,
      
      // Description
      description: 'Primary test cluster for Littoral region',
      
      // Geographic information (required)
      coverage_area: {
        center: {
          latitude: 4.0511,  // Douala coordinates
          longitude: 9.7679
        },
        radius: 50, // 50km coverage radius
        boundaries: [
          { latitude: 4.1, longitude: 9.7 },
          { latitude: 4.1, longitude: 9.9 },
          { latitude: 3.9, longitude: 9.9 },
          { latitude: 3.9, longitude: 9.7 }
        ]
      },
      
      // Administrative information
      supervisor: supervisor._id,
      // IMPORTANT: Cluster model uses different specializations enum than User model
      assigned_technicians: technicians.map((tech, index) => ({
        technician: tech._id,
        assigned_date: new Date(),
        role: index === 0 ? 'primary' : 'secondary',
        specializations: ['generator', 'maintenance'] // These are CLUSTER specializations, not USER
      })),
      
      // Operational statistics
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
      
      // Performance metrics
      performance: {
        average_uptime: 99,
        average_response_time: 2,
        maintenance_completion_rate: 95,
        customer_satisfaction: 4.5
      },
      
      // Contact information
      contact_info: {
        office_address: 'Douala Office, Littoral Region, Cameroon',
        phone: supervisor.phone || '+237670000002',
        email: supervisor.email || 'cluster1@generator.cm',
        emergency_contact: {
          name: admin.fullName,
          phone: admin.phone,
          email: admin.email
        }
      },
      
      // Operational settings
      settings: {
        working_hours: {
          start: '08:00',
          end: '17:00',
          timezone: 'Africa/Douala'
        },
        emergency_response: {
          enabled: true,
          max_response_time: 4
        },
        maintenance_windows: [
          {
            day: 'saturday',
            start_time: '08:00',
            end_time: '12:00',
            type: 'routine'
          }
        ]
      },
      
      // Status
      status: 'active',
      health_score: 100,
      
      // Tags
      tags: ['test', 'littoral', 'primary']
    };

    log.info('Creating cluster with complete configuration...');
    const cluster = new Cluster(clusterData);
    await cluster.save();

    log.success('Cluster created successfully!');
    console.log('\n' + colors.bold + 'Cluster Details:' + colors.reset);
    console.log(`  ID: ${cluster._id}`);
    console.log(`  Name: ${cluster.name}`);
    console.log(`  Code: ${cluster.code}`);
    console.log(`  Region: ${cluster.region}`);
    console.log(`  Supervisor: ${supervisor.fullName}`);
    console.log(`  Technicians in cluster: ${cluster.assigned_technicians.length}`);
    console.log(`  Status: ${cluster.status}`);
    console.log(`  Coverage: ${cluster.coverage_area.radius}km radius`);

    // Update technicians with cluster assignment
    // IMPORTANT: We do NOT modify User.specializations - only set assigned_cluster
    log.info('\nUpdating user assignments (assigned_cluster field only)...');
    
    let successCount = 0;
    for (const tech of technicians) {
      try {
        // Only update the assigned_cluster field
        tech.assigned_cluster = cluster._id;
        
        // Ensure specializations are set (if not already) - use VALID User model enums
        if (!tech.specializations || tech.specializations.length === 0) {
          tech.specializations = ['preventive_maintenance', 'generator_repair'];
        }
        
        await tech.save();
        successCount++;
        log.success(`  ✓ ${tech.fullName} assigned to cluster`);
      } catch (error) {
        log.error(`  ✗ Failed to assign ${tech.fullName}: ${error.message}`);
      }
    }

    // Update supervisor with cluster
    try {
      if (!supervisor.supervised_clusters) {
        supervisor.supervised_clusters = [];
      }
      
      // Add cluster if not already present
      if (!supervisor.supervised_clusters.includes(cluster._id)) {
        supervisor.supervised_clusters.push(cluster._id);
      }
      
      await supervisor.save();
      log.success(`  ✓ ${supervisor.fullName} assigned as supervisor`);
    } catch (error) {
      log.error(`  ✗ Failed to assign supervisor: ${error.message}`);
    }

    console.log('\n' + colors.green + colors.bold + '✓ Cluster setup complete!' + colors.reset);
    console.log(`\n${successCount} of ${technicians.length} technicians successfully assigned`);
    
    console.log('\n' + colors.bold + 'Summary:' + colors.reset);
    console.log(`  Cluster ID: ${cluster._id}`);
    console.log(`  Cluster Code: ${cluster.code}`);
    console.log(`  Supervisor: ${supervisor.fullName}`);
    console.log(`  Technicians: ${successCount} assigned`);
    
    console.log('\n' + colors.bold + 'Next Steps:' + colors.reset);
    console.log('  1. Verify setup: npm run verify:setup');
    console.log('  2. Start server: npm run dev');
    console.log('  3. Import site data');
    console.log('  4. Assign sites to cluster\n');

  } catch (error) {
    log.error('Cluster fix failed: ' + error.message);
    console.error('\nDetailed error:', error);
    
    if (error.errors) {
      console.log('\nValidation errors:');
      Object.keys(error.errors).forEach(key => {
        console.log(`  ${key}: ${error.errors[key].message}`);
      });
    }
    
    console.log('\n' + colors.yellow + 'If you continue to have issues:' + colors.reset);
    console.log('  1. Check models/Cluster.js - assigned_technicians.specializations enum');
    console.log('  2. Check models/User.js - specializations enum');
    console.log('  3. Run: node scripts/checkUserEnums.js');
  } finally {
    await mongoose.connection.close();
    log.info('\nDatabase connection closed');
  }
};

// Run the fix
fixCluster();

