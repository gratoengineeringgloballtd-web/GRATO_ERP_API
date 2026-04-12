// scripts/seedAllUsers.js - Complete User Seeding from Department Structure
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { DEPARTMENT_STRUCTURE, getAllAvailablePositions } = require('../config/departmentStructure');

/**
 * Comprehensive User Seeding Script
 * Creates ALL users from departmentStructure.js
 * 
 * Run with: node scripts/seedAllUsers.js
 */

// Validate environment
if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
  console.error('❌ ERROR: MongoDB URI not found in environment variables!');
  process.exit(1);
}

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || 'GratoEng2024!';

// Role determination logic
function determineRole(position, department, specialRole) {
  // Special roles from structure (buyer, finance, etc.)
  if (specialRole === 'buyer') {
    return 'buyer';
  }
  
  if (specialRole === 'finance') {
    return 'finance';
  }
  
  // Buyers
  if (position.includes('Buyer')) {
    return 'buyer';
  }
  
  // Finance
  if (position.includes('Finance') || position === 'Finance Officer') {
    return 'finance';
  }
  
  // IT
  if (position.includes('IT') || position === 'IT Staff') {
    return 'it';
  }
  
  // HSE
  if (position.includes('HSE')) {
    return 'hse';
  }
  
  // HR
  if (department === 'HR & Admin' && (position.includes('Head') || position.includes('HR'))) {
    return 'hr';
  }
  
  // Supply Chain
  if (department === 'Business Development & Supply Chain' && position.includes('Supply Chain Coordinator')) {
    return 'supply_chain';
  }
  
  // Technical Department Leadership
  if (department === 'Technical') {
    if (position.includes('Director')) return 'technical';
    if (position === 'Operations Manager' || position === 'Project Manager') return 'technical';
    if (position === 'Diesel Coordinator' || position === 'NOC Coordinator') return 'technical';
    if (position.includes('Head of Refurbishment')) return 'technical';
  }
  
  // Department heads and high-level positions
  if (position.includes('President') || position === 'President / Head of Business') {
    return 'admin';
  }
  
  if (position.includes('Head') && department !== 'Technical') {
    return 'hr'; // HR head
  }
  
  if (position.includes('Director')) {
    return 'admin';
  }
  
  // NOTE: Supervisor/Coordinator is a RELATIONSHIP, not a role!
  // Site Supervisors, NOC Coordinators, etc. are employees who happen to supervise others
  // Their role is 'employee' (or their specialized role), not 'supervisor'
  
  // Default to employee
  return 'employee';
}

// Get permissions based on role and capacities
function getPermissions(role, approvalCapacities, position) {
  const permissions = ['basic_access', 'view_own_data'];
  
  if (role === 'admin') {
    return [
      'all_access',
      'user_management',
      'team_management',
      'financial_approval',
      'executive_decisions',
      'system_settings'
    ];
  }
  
  if (role === 'finance') {
    permissions.push(
      'financial_approval',
      'budget_management',
      'invoice_processing',
      'financial_reports'
    );
  }
  
  if (approvalCapacities.includes('department_head') || approvalCapacities.includes('business_head')) {
    permissions.push(
      'team_management',
      'approvals',
      'team_data_access',
      'behavioral_evaluations',
      'performance_reviews'
    );
  }
  
  if (approvalCapacities.includes('direct_supervisor')) {
    permissions.push(
      'approvals',
      'team_data_access',
      'behavioral_evaluations'
    );
  }
  
  if (role === 'buyer') {
    permissions.push(
      'procurement',
      'vendor_management',
      'order_processing',
      'requisition_handling'
    );
  }
  
  if (role === 'hse') {
    permissions.push(
      'safety_management',
      'hse_approvals',
      'incident_reporting'
    );
  }
  
  permissions.push('submit_requests');
  
  return permissions;
}

// Find supervisor email from structure
function findSupervisorEmail(reportsTo, department) {
  if (!reportsTo) return null;
  
  // Check all departments
  for (const [deptKey, dept] of Object.entries(DEPARTMENT_STRUCTURE)) {
    // Check if reports to department head
    if (dept.head.email === reportsTo) {
      return dept.head.email;
    }
    
    // Check positions
    for (const [posKey, posData] of Object.entries(dept.positions)) {
      if (posData.email === reportsTo) {
        return posData.email;
      }
    }
  }
  
  return reportsTo; // Return as-is if it's already an email
}

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

// Create a single user
async function createUser(userData) {
  try {
    const {
      name,
      email,
      position,
      department,
      reportsTo,
      hierarchyLevel,
      approvalCapacities = [],
      specialRole,
      buyerConfig
    } = userData;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log(`  ⏩ Already exists: ${name}`);
      return existingUser;
    }

    // Determine role
    const role = determineRole(position, department, approvalCapacities);
    
    // Get permissions
    const permissions = getPermissions(role, approvalCapacities, position);

    // Prepare user data
    const newUserData = {
      email,
      password: DEFAULT_PASSWORD,
      fullName: name,
      role,
      department,
      position,
      hierarchyLevel,
      approvalCapacities,
      permissions,
      isActive: true
    };

    // Add buyer details if applicable
    if (specialRole === 'buyer' && buyerConfig) {
      newUserData.buyerDetails = {
        specializations: buyerConfig.specializations || [],
        maxOrderValue: buyerConfig.maxOrderValue || 1000000,
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
      };
    }

    // Create user
    const user = new User(newUserData);
    await user.save();
    
    console.log(`  ✅ Created: ${name} (${position})`);
    return user;

  } catch (error) {
    console.error(`  ❌ Error creating ${userData.name}:`, error.message);
    return null;
  }
}

// Update supervisor relationships
async function updateSupervisorRelationships() {
  console.log('\n🔗 Updating supervisor relationships...\n');
  
  const allPositions = getAllAvailablePositions();
  let successCount = 0;
  let errorCount = 0;

  for (const posData of allPositions) {
    try {
      const user = await User.findOne({ email: posData.email });
      if (!user) continue;

      // Find supervisor
      if (posData.reportsTo) {
        const supervisorEmail = findSupervisorEmail(posData.reportsTo, posData.department);
        const supervisor = await User.findOne({ email: supervisorEmail });

        if (supervisor) {
          // Update user's supervisor
          user.supervisor = supervisor._id;
          
          // Add to supervisor's direct reports
          if (!supervisor.directReports.includes(user._id)) {
            supervisor.directReports.push(user._id);
            await supervisor.save();
          }
          
          await user.save();
          console.log(`  ✓ ${user.fullName} → ${supervisor.fullName}`);
          successCount++;
        }
      }

      // Set department head
      const dept = DEPARTMENT_STRUCTURE[posData.department];
      if (dept && dept.head.email !== user.email) {
        const deptHead = await User.findOne({ email: dept.head.email });
        if (deptHead) {
          user.departmentHead = deptHead._id;
          await user.save();
        }
      }

    } catch (error) {
      console.error(`  ❌ Error updating ${posData.name}:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n  ✅ Updated ${successCount} relationships`);
  if (errorCount > 0) {
    console.log(`  ⚠️  ${errorCount} errors encountered`);
  }
}

// Calculate hierarchy paths
async function calculateHierarchyPaths() {
  console.log('\n📊 Calculating hierarchy paths...\n');
  
  const users = await User.find({ role: { $ne: 'supplier' }, isActive: true });
  
  for (const user of users) {
    try {
      const path = [];
      let current = user;
      const visited = new Set([user._id.toString()]);

      while (current.supervisor) {
        const supervisor = await User.findById(current.supervisor);
        if (!supervisor || visited.has(supervisor._id.toString())) break;
        
        path.push(supervisor._id.toString());
        visited.add(supervisor._id.toString());
        current = supervisor;
      }

      user.hierarchyPath = path;
      await user.save();
      
      console.log(`  ✓ ${user.fullName}: ${path.length} levels`);

    } catch (error) {
      console.error(`  ❌ Error for ${user.fullName}:`, error.message);
    }
  }
}

// Main seeding function
async function seedAllUsers() {
  const startTime = Date.now();
  
  try {
    console.log('🌱 SEEDING ALL USERS FROM DEPARTMENT STRUCTURE');
    console.log('=' .repeat(60));
    console.log(`Default Password: ${DEFAULT_PASSWORD}\n`);

    await connectDB();

    const allPositions = getAllAvailablePositions();
    console.log(`📋 Found ${allPositions.length} positions to create\n`);

    // Group by department
    const byDepartment = {};
    for (const pos of allPositions) {
      if (!byDepartment[pos.department]) {
        byDepartment[pos.department] = [];
      }
      byDepartment[pos.department].push(pos);
    }

    let totalCreated = 0;
    let totalSkipped = 0;

    // Create users department by department
    for (const [deptName, positions] of Object.entries(byDepartment)) {
      console.log(`\n📁 ${deptName} (${positions.length} positions)`);
      console.log('-'.repeat(60));

      // Sort by hierarchy level (highest first)
      positions.sort((a, b) => b.hierarchyLevel - a.hierarchyLevel);

      for (const posData of positions) {
        const user = await createUser(posData);
        if (user) {
          totalCreated++;
        } else {
          totalSkipped++;
        }
      }
    }

    // Update relationships
    await updateSupervisorRelationships();

    // Calculate hierarchy paths
    await calculateHierarchyPaths();

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 SEEDING SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Users created: ${totalCreated}`);
    console.log(`⏩ Users skipped (already exist): ${totalSkipped}`);
    console.log(`📝 Total positions: ${allPositions.length}`);
    console.log(`⏱️  Duration: ${duration} seconds\n`);

    // Validation
    console.log('🔍 VALIDATION CHECKS');
    console.log('='.repeat(60));

    const stats = {
      total: await User.countDocuments({ role: { $ne: 'supplier' }, isActive: true }),
      withSupervisor: await User.countDocuments({ 
        role: { $ne: 'supplier' }, 
        isActive: true,
        supervisor: { $exists: true }
      }),
      withDeptHead: await User.countDocuments({
        role: { $ne: 'supplier' },
        isActive: true,
        departmentHead: { $exists: true }
      }),
      withHierarchyPath: await User.countDocuments({
        role: { $ne: 'supplier' },
        isActive: true,
        hierarchyPath: { $exists: true, $ne: [] }
      })
    };

    console.log(`Total active users: ${stats.total}`);
    console.log(`Users with supervisor: ${stats.withSupervisor}`);
    console.log(`Users with dept head: ${stats.withDeptHead}`);
    console.log(`Users with hierarchy path: ${stats.withHierarchyPath}\n`);

    // Department breakdown
    console.log('📁 DEPARTMENT BREAKDOWN');
    console.log('='.repeat(60));
    
    const deptStats = await User.aggregate([
      { $match: { role: { $ne: 'supplier' }, isActive: true } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    for (const dept of deptStats) {
      console.log(`${dept._id}: ${dept.count} users`);
    }

    // Login credentials
    console.log('\n' + '='.repeat(60));
    console.log('🔐 LOGIN CREDENTIALS');
    console.log('='.repeat(60));
    console.log('\nAll users can login with:');
    console.log(`Email: [their email from structure]`);
    console.log(`Password: ${DEFAULT_PASSWORD}\n`);

    console.log('Key Users:');
    const keyUsers = [
      'kelvin.eyong@gratoglobal.com',
      'didier.oyong@gratoengineering.com',
      'bruiline.tsitoh@gratoglobal.com',
      'lukong.lambert@gratoglobal.com',
      'ranibellmambo@gratoengineering.com'
    ];

    for (const email of keyUsers) {
      const user = await User.findOne({ email }).select('fullName position role');
      if (user) {
        console.log(`  ${user.fullName} (${user.position})`);
        console.log(`    Email: ${email}`);
        console.log(`    Role: ${user.role}\n`);
      }
    }

    console.log('🎉 Seeding completed successfully!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ SEEDING FAILED:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Clear all users (DANGEROUS - use with caution)
async function clearAllUsers() {
  try {
    console.log('⚠️  WARNING: This will delete ALL users!');
    console.log('Are you sure? (This action cannot be undone)\n');
    
    await connectDB();
    
    const result = await User.deleteMany({ role: { $ne: 'supplier' } });
    console.log(`Deleted ${result.deletedCount} users\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error clearing users:', error);
    process.exit(1);
  }
}

// Run based on command
const command = process.argv[2];

switch (command) {
  case 'seed':
    seedAllUsers();
    break;
  case 'clear':
    clearAllUsers();
    break;
  default:
    console.log(`
Usage:
  node scripts/seedAllUsers.js [command]

Commands:
  seed     - Create all users from department structure
  clear    - Delete all non-supplier users (DANGEROUS)

Example:
  node scripts/seedAllUsers.js seed
    `);
    process.exit(0);
}

module.exports = { seedAllUsers, clearAllUsers };