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

// All users data structure following your exact hierarchy
const usersData = {
  // ============================================
  // LEVEL 5 - PRESIDENT / HEAD OF BUSINESS
  // ============================================
  kelvin: {
    email: 'kelvin.eyong@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. E.T Kelvin',
    role: 'admin',
    department: 'Business Development & Supply Chain',
    position: 'President / Head of Business',
    hierarchyLevel: 5,
    isActive: true,
    approvalCapacities: ['business_head', 'direct_supervisor']
  },

  // ============================================
  // LEVEL 4 - DEPARTMENT HEADS
  // ============================================
  bruiline: {
    email: 'bruiline.tsitoh@gratoglobal.com',
    password: 'password123',
    fullName: 'Mrs. Bruiline Tsitoh',
    role: 'hr',
    department: 'HR & Admin',
    position: 'HR & Admin Head',
    hierarchyLevel: 4,
    isActive: true,
    approvalCapacities: ['department_head', 'direct_supervisor'],
    supervisorEmail: 'kelvin.eyong@gratoglobal.com'
  },

  didier: {
    email: 'didier.oyong@gratoengineering.com',
    password: 'password123',
    fullName: 'Mr. Didier Oyong',
    role: 'technical',
    department: 'Technical',
    position: 'Technical Director',
    hierarchyLevel: 4,
    isActive: true,
    approvalCapacities: ['department_head', 'direct_supervisor', 'technical_director'],
    supervisorEmail: 'kelvin.eyong@gratoglobal.com'
  },

  // ============================================
  // LEVEL 3 - COORDINATORS & MANAGERS
  // ============================================
  lukong: {
    email: 'lukong.lambert@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. Lukong Lambert',
    role: 'supply_chain',
    department: 'Business Development & Supply Chain',
    position: 'Supply Chain Coordinator',
    hierarchyLevel: 3,
    isActive: true,
    approvalCapacities: ['direct_supervisor', 'supply_chain_coordinator'],
    supervisorEmail: 'kelvin.eyong@gratoglobal.com',
    departmentHeadEmail: 'kelvin.eyong@gratoglobal.com'
  },

  ranibell: {
    email: 'ranibellmambo@gratoengineering.com',
    password: 'password123',
    fullName: 'Ms. Ranibell Mambo',
    role: 'finance',
    department: 'Business Development & Supply Chain',
    position: 'Finance Officer',
    hierarchyLevel: 3,
    isActive: true,
    approvalCapacities: ['finance_officer'],
    supervisorEmail: 'kelvin.eyong@gratoglobal.com',
    departmentHeadEmail: 'kelvin.eyong@gratoglobal.com'
  },

  joel: {
    email: 'joel@gratoengineering.com',
    password: 'password123',
    fullName: 'Mr. Joel Wamba',
    role: 'technical',
    department: 'Technical',
    position: 'Project Manager',
    hierarchyLevel: 3,
    isActive: true,
    approvalCapacities: ['direct_supervisor', 'project_manager'],
    supervisorEmail: 'didier.oyong@gratoengineering.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  kevin: {
    email: 'minka.kevin@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. Kevin Minka',
    role: 'employee',
    department: 'Technical',
    position: 'Diesel Coordinator',
    hierarchyLevel: 3,
    isActive: true,
    approvalCapacities: ['direct_supervisor'],
    supervisorEmail: 'didier.oyong@gratoengineering.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  ovo: {
    email: 'bechem.mbu@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. Ovo Bechem',
    role: 'hse',
    department: 'Technical',
    position: 'HSE Coordinator',
    hierarchyLevel: 3,
    isActive: true,
    approvalCapacities: ['direct_supervisor', 'hse_coordinator'],
    supervisorEmail: 'didier.oyong@gratoengineering.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  pascal: {
    email: 'pascal.rodrique@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. Pascal Assam',
    role: 'technical',
    department: 'Technical',
    position: 'Operations Manager',
    hierarchyLevel: 3,
    isActive: true,
    approvalCapacities: ['direct_supervisor', 'operations_manager'],
    supervisorEmail: 'didier.oyong@gratoengineering.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  yerla: {
    email: 'verla.ivo@gratoengineering.com',
    password: 'password123',
    fullName: 'Mr. Yerla Ivo',
    role: 'employee',
    department: 'Technical',
    position: 'Head of Refurbishment',
    hierarchyLevel: 3,
    isActive: true,
    approvalCapacities: ['department_head', 'direct_supervisor'],
    supervisorEmail: 'didier.oyong@gratoengineering.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  // ============================================
  // LEVEL 2 - SUPERVISORS & COORDINATORS
  // ============================================
  pryde: {
    email: 'pryde.mua@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. Pryde Mua',
    role: 'buyer',
    department: 'supply_chain',
    position: 'Warehouse Coordinator/Buyer',
    hierarchyLevel: 2,
    isActive: true,
    approvalCapacities: ['direct_supervisor'],
    supervisorEmail: 'lukong.lambert@gratoglobal.com',
    departmentHeadEmail: 'kelvin.eyong@gratoglobal.com',
    buyerDetails: {
      specializations: ['Equipment', 'Hardware', 'Maintenance_Supplies'],
      maxOrderValue: 5000000,
      workload: {
        currentAssignments: 0,
        monthlyTarget: 50
      },
      performance: {
        completedOrders: 0,
        averageProcessingTime: 0,
        customerSatisfactionRating: 5
      },
      availability: {
        isAvailable: true
      }
    }
  },

  christabel: {
    email: 'christabel@gratoengineering.com',
    password: 'password123',
    fullName: 'Ms. Christabel Mangwi',
    role: 'project',
    department: 'Business Development & Supply Chain',
    position: 'Order Management Assistant/Buyer',
    hierarchyLevel: 2,
    isActive: true,
    supervisorEmail: 'lukong.lambert@gratoglobal.com',
    departmentHeadEmail: 'kelvin.eyong@gratoglobal.com'
  },

  carmel: {
    email: 'carmel.dafny@gratoglobal.com',
    password: 'password123',
    fullName: 'Carmel Dafny',
    role: 'employee',
    department: 'HR & Admin',
    position: 'Receptionist',
    hierarchyLevel: 2,
    isActive: true,
    supervisorEmail: 'bruiline.tsitoh@gratoglobal.com',
    departmentHeadEmail: 'bruiline.tsitoh@gratoglobal.com'
  },

  marcel: {
    email: 'marcel.ngong@gratoglobal.com',
    password: 'password123',
    fullName: 'Marcel',
    role: 'it',
    department: 'HR & Admin',
    position: 'IT Staff',
    hierarchyLevel: 2,
    isActive: true,
    supervisorEmail: 'bruiline.tsitoh@gratoglobal.com',
    departmentHeadEmail: 'bruiline.tsitoh@gratoglobal.com'
  },

  che: {
    email: 'che.earnest@gratoengineering.com',
    password: 'password123',
    fullName: 'Mr. Che Earnest',
    role: 'employee',
    department: 'HR & Admin',
    position: 'Office Driver/Logistics Assistant',
    hierarchyLevel: 2,
    isActive: true,
    supervisorEmail: 'bruiline.tsitoh@gratoglobal.com',
    departmentHeadEmail: 'bruiline.tsitoh@gratoglobal.com'
  },

  ndi: {
    email: 'ndi.belther@gratoengineering.com',
    password: 'password123',
    fullName: 'Ms. Ndi Belther',
    role: 'employee',
    department: 'HR & Admin',
    position: 'House Maid',
    hierarchyLevel: 2,
    isActive: true,
    supervisorEmail: 'bruiline.tsitoh@gratoglobal.com',
    departmentHeadEmail: 'bruiline.tsitoh@gratoglobal.com'
  },

  felix: {
    email: 'felix.tientcheu@gratoglobal.com',
    password: 'password123',
    fullName: 'Felix Tientcheu',
    role: 'technical',
    department: 'Technical',
    position: 'Site Supervisor',
    hierarchyLevel: 2,
    isActive: true,
    approvalCapacities: ['direct_supervisor'],
    supervisorEmail: 'pascal.rodrique@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  joseph: {
    email: 'joseph.tayou@gratoglobal.com',
    password: 'password123',
    fullName: 'Joseph TAYOU',
    role: 'technical',
    department: 'Technical',
    position: 'Site Supervisor',
    hierarchyLevel: 2,
    isActive: true,
    approvalCapacities: ['direct_supervisor'],
    supervisorEmail: 'pascal.rodrique@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  bemba: {
    email: 'bemba.essack@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. Bemba Essack',
    role: 'employee',
    department: 'Technical',
    position: 'Data Collector',
    hierarchyLevel: 2,
    isActive: true,
    supervisorEmail: 'pascal.rodrique@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  rodrigue: {
    email: 'rodrigue.nono@gratoglobal.com',
    password: 'password123',
    fullName: 'Mr. Rodrigue Nono',
    role: 'technical',
    department: 'Technical',
    position: 'NOC Coordinator',
    hierarchyLevel: 2,
    isActive: true,
    approvalCapacities: ['direct_supervisor'],
    supervisorEmail: 'pascal.rodrique@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  // ============================================
  // LEVEL 1 - EMPLOYEES (FIELD TECHNICIANS & OPERATORS)
  // ============================================
  aghangu: {
    email: 'aghangu.marie@gratoengineering.com',
    password: 'password123',
    fullName: 'Ms. Aghangu Marie',
    role: 'employee',
    department: 'Business Development & Supply Chain',
    position: 'Warehouse Assistant',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'pryde.mua@gratoglobal.com',
    departmentHeadEmail: 'kelvin.eyong@gratoglobal.com'
  },

  // Felix's Team
  danickFelix: {
    email: 'djiyap.danick@gratoglobal.com',
    password: 'password123',
    fullName: 'Danick Djiyap',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'felix.tientcheu@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  djackba: {
    email: 'djackba.marcel@gratoglobal.com',
    password: 'password123',
    fullName: 'Djackba Marcel',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'felix.tientcheu@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  kenfackFelix: {
    email: 'kenfack.jacques@gratoglobal.com',
    password: 'password123',
    fullName: 'Kenfack Jacques',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'felix.tientcheu@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  paulFelix: {
    email: 'paul.nyomb@gratoglobal.com',
    password: 'password123',
    fullName: 'Paul EM Nyomb',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'felix.tientcheu@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  edidieFelix: {
    email: 'dedidie.francois@gratoglobal.com',
    password: 'password123',
    fullName: 'EDIDIE François',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'felix.tientcheu@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  // Joseph's Team
  boris: {
    email: 'kamgang.junior@gratoglobal.com',
    password: 'password123',
    fullName: 'Boris Kamgang',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'joseph.tayou@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  sunday: {
    email: 'sunday@gratoglobal.com',
    password: 'password123',
    fullName: 'Sunday',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'joseph.tayou@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  urich: {
    email: 'ulrich.vitrand@gratoglobal.com',
    password: 'password123',
    fullName: 'Urich MOUMI',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'joseph.tayou@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  abeeb: {
    email: 'abeeb@gratoglobal.com',
    password: 'password123',
    fullName: 'Abeeb',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'joseph.tayou@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  berthin: {
    email: 'mba.berthin@gratoglobal.com',
    password: 'password123',
    fullName: 'Berthin DEFFO',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'joseph.tayou@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  allassane: {
    email: 'allassane@gratoglobal.com',
    password: 'password123',
    fullName: 'Allassane',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'joseph.tayou@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  alioum: {
    email: 'alioum.moussa@gratoglobal.com',
    password: 'password123',
    fullName: 'Alioum Moussa',
    role: 'employee',
    department: 'Technical',
    position: 'Field Technician',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'joseph.tayou@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  // Rodrigue's NOC Team
  junior: {
    email: 'junior.mukudi@gratoglobal.com',
    password: 'password123',
    fullName: 'Junior Mukudi',
    role: 'employee',
    department: 'Technical',
    position: 'NOC Operator',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'rodrigue.nono@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  wilfried: {
    email: 'kamegni.wilfried@gratoglobal.com',
    password: 'password123',
    fullName: 'Wilfried Kamegni',
    role: 'employee',
    department: 'Technical',
    position: 'NOC Operator',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'rodrigue.nono@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  yves: {
    email: 'yossa.yves@gratoglobal.com',
    password: 'password123',
    fullName: 'Yves Yossa',
    role: 'employee',
    department: 'Technical',
    position: 'NOC Operator',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'rodrigue.nono@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  ervine: {
    email: 'ervine.mbezele@gratoglobal.com',
    password: 'password123',
    fullName: 'Ervine Mbezele',
    role: 'employee',
    department: 'Technical',
    position: 'NOC Operator',
    hierarchyLevel: 1,
    isActive: true,
    supervisorEmail: 'rodrigue.nono@gratoglobal.com',
    departmentHeadEmail: 'didier.oyong@gratoengineering.com'
  },

  // ============================================
  // SYSTEM ADMIN (No hierarchy)
  // ============================================
  systemAdmin: {
    email: 'admin@gratoengineering.com',
    password: 'admin123',
    fullName: 'System Administrator',
    role: 'admin',
    department: 'Executive',
    position: 'N/A',
    hierarchyLevel: 1,
    isActive: true
  }
};

async function seedAllUsers() {
  try {
    console.log('🌱 SEEDING ALL USERS');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    // Ask for confirmation
    const args = process.argv.slice(2);
    if (!args.includes('--force') && !args.includes('-f')) {
      console.log('⚠️  WARNING: This will DELETE all existing users and create new ones!\n');
      console.log('To proceed, run: node scripts/seedCompleteUsers.js --force\n');
      process.exit(0);
    }

    // Clear existing users (except suppliers if specified)
    const clearSuppliers = args.includes('--clear-suppliers');
    
    if (clearSuppliers) {
      console.log('🗑️  Deleting ALL users (including suppliers)...');
      await User.deleteMany({});
    } else {
      console.log('🗑️  Deleting all non-supplier users...');
      await User.deleteMany({ role: { $ne: 'supplier' } });
    }
    
    console.log('✅ Cleared existing users\n');

    // Create users map for reference
    const createdUsers = {};

    // PHASE 1: Create all users without relationships
    console.log('📝 PHASE 1: Creating users...\n');

    for (const [key, userData] of Object.entries(usersData)) {
      const { supervisorEmail, departmentHeadEmail, ...userFields } = userData;
      
      const user = new User(userFields);
      await user.save();
      
      createdUsers[userData.email] = user;
      console.log(`✅ Created: ${userData.fullName} (${userData.email})`);
    }

    console.log(`\n✅ Phase 1 Complete: ${Object.keys(createdUsers).length} users created\n`);

    // PHASE 2: Establish supervisor and department head relationships
    console.log('🔗 PHASE 2: Establishing relationships...\n');

    for (const [key, userData] of Object.entries(usersData)) {
      const user = createdUsers[userData.email];
      
      if (!user) continue;

      let updated = false;

      // Set supervisor
      if (userData.supervisorEmail) {
        const supervisor = createdUsers[userData.supervisorEmail];
        if (supervisor) {
          user.supervisor = supervisor._id;
          
          // Add to supervisor's direct reports
          if (!supervisor.directReports.includes(user._id)) {
            supervisor.directReports.push(user._id);
            await supervisor.save();
          }
          
          updated = true;
          console.log(`   ${user.fullName} → Supervisor: ${supervisor.fullName}`);
        }
      }

      // Set department head
      if (userData.departmentHeadEmail && userData.departmentHeadEmail !== userData.supervisorEmail) {
        const deptHead = createdUsers[userData.departmentHeadEmail];
        if (deptHead) {
          user.departmentHead = deptHead._id;
          updated = true;
          console.log(`   ${user.fullName} → Dept Head: ${deptHead.fullName}`);
        }
      }

      // Build hierarchy path
      if (user.supervisor) {
        const path = [];
        let current = user.supervisor;
        
        while (current && path.length < 10) { // Prevent infinite loops
          path.push(current.toString());
          const supervisor = await User.findById(current).select('supervisor');
          current = supervisor?.supervisor;
        }
        
        user.hierarchyPath = path;
        updated = true;
      }

      if (updated) {
        await user.save();
      }
    }

    console.log('\n✅ Phase 2 Complete: Relationships established\n');

    // PHASE 3: Display summary
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(80) + '\n');

    const stats = {
      total: await User.countDocuments({ role: { $ne: 'supplier' } }),
      active: await User.countDocuments({ role: { $ne: 'supplier' }, isActive: true }),
      withSupervisor: await User.countDocuments({
        role: { $ne: 'supplier' },
        supervisor: { $exists: true, $ne: null }
      }),
      withDeptHead: await User.countDocuments({
        role: { $ne: 'supplier' },
        departmentHead: { $exists: true, $ne: null }
      })
    };

    console.log(`Total Users Created    : ${stats.total}`);
    console.log(`Active Users           : ${stats.active}`);
    console.log(`With Supervisor        : ${stats.withSupervisor}`);
    console.log(`With Department Head   : ${stats.withDeptHead}`);

    // Count by department
    const byDept = await User.aggregate([
      { $match: { role: { $ne: 'supplier' }, isActive: true } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('\nUsers by Department:');
    byDept.forEach(dept => {
      console.log(`   ${(dept._id || 'Unknown').padEnd(35)}: ${dept.count}`);
    });

    // Show hierarchy levels
    const byLevel = await User.aggregate([
      { $match: { role: { $ne: 'supplier' }, isActive: true } },
      { $group: { _id: '$hierarchyLevel', count: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    ]);

    console.log('\nUsers by Hierarchy Level:');
    byLevel.forEach(level => {
      console.log(`   Level ${level._id}: ${level.count}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ ALL USERS SEEDED SUCCESSFULLY!\n');
    console.log('Login Credentials:');
    console.log('  Email: Any user email from above');
    console.log('  Password: password123\n');
    console.log('To view all users, run:');
    console.log('  node scripts/getAllUsers.js --detailed\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  seedAllUsers();
}

module.exports = { seedAllUsers, usersData };