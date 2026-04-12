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

async function addEvelynIntern() {
  try {
    console.log('🔧 ADDING EVELYN NKWENTI - ENERGY MANAGEMENT INTERN');
    console.log('='.repeat(80) + '\n');

    await connectDB();

    // Find Kelvin Eyong (her supervisor)
    const kelvinEyong = await User.findOne({ email: 'kelvin.eyong@gratoglobal.com' });

    if (!kelvinEyong) {
      console.error('❌ ERROR: Kelvin Eyong not found in database!');
      console.error('   Evelyn cannot be added without her supervisor.');
      process.exit(1);
    }

    console.log('✅ Found supervisor: Kelvin Eyong');
    console.log('   ID:', kelvinEyong._id);
    console.log('   Position:', kelvinEyong.position);
    console.log('');

    // Check if Evelyn already exists
    const existingEvelyn = await User.findOne({ email: 'evelyn.nkwenti@gratoglobal.com' });

    if (existingEvelyn) {
      console.log('⚠️  Evelyn Nkwenti already exists in database');
      console.log('   Email:', existingEvelyn.email);
      console.log('   Position:', existingEvelyn.position);
      console.log('');

      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        readline.question('Do you want to update Evelyn\'s details? (yes/no): ', resolve);
      });
      readline.close();

      if (answer.toLowerCase() !== 'yes') {
        console.log('Cancelled.');
        process.exit(0);
      }

      // Update existing user
      existingEvelyn.password = 'Nkwe_Ev#26Cam';
      existingEvelyn.fullName = 'Ms. Evelyn Nkwenti';
      existingEvelyn.role = 'technical';
      existingEvelyn.department = 'Business Development & Supply Chain';
      existingEvelyn.position = 'Energy Management Intern';
      existingEvelyn.hierarchyLevel = 1;
      existingEvelyn.supervisor = kelvinEyong._id;
      existingEvelyn.departmentHead = kelvinEyong._id;
      existingEvelyn.directReports = [];
      existingEvelyn.approvalCapacities = [];
      existingEvelyn.departmentRole = 'staff';
      existingEvelyn.permissions = [
        'view_own_requests',
        'create_requisition',
        'view_team_reports'
      ];
      existingEvelyn.isActive = true;
      existingEvelyn.hierarchyPath = [kelvinEyong._id.toString()];

      await existingEvelyn.save();

      // Add Evelyn to Kelvin's directReports if not already there
      if (!kelvinEyong.directReports.some(id => id.toString() === existingEvelyn._id.toString())) {
        kelvinEyong.directReports.push(existingEvelyn._id);
        await kelvinEyong.save();
        console.log('✅ Added Evelyn to Kelvin\'s direct reports');
      }

      console.log('✅ Evelyn updated successfully!\n');
      await displayUserDetails(existingEvelyn, kelvinEyong);

    } else {
      // Create new user
      const evelynData = {
        email: 'evelyn.nkwenti@gratoglobal.com',
        password: 'Nkwe_Ev#26Cam',
        fullName: 'Ms. Evelyn Nkwenti',
        role: 'technical',
        department: 'Business Development & Supply Chain',
        position: 'Energy Management Intern',
        hierarchyLevel: 1,
        supervisor: kelvinEyong._id,
        departmentHead: kelvinEyong._id,
        directReports: [],
        approvalCapacities: [],
        departmentRole: 'staff',
        permissions: [
          'view_own_requests',
          'create_requisition',
          'view_team_reports'
        ],
        isActive: true,
        hierarchyPath: [kelvinEyong._id.toString()]
      };

      const evelyn = new User(evelynData);
      await evelyn.save();

      // Add Evelyn to Kelvin's directReports
      kelvinEyong.directReports.push(evelyn._id);
      await kelvinEyong.save();

      console.log('✅ Evelyn created successfully!\n');
      await displayUserDetails(evelyn, kelvinEyong);
    }

    // Verify login
    await testLogin('evelyn.nkwenti@gratoglobal.com', 'Nkwe_Ev#26Cam');

    console.log('\n✅ SETUP COMPLETE!');
    console.log('Evelyn Nkwenti is now an Energy Management Intern reporting to Kelvin Eyong.\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

async function displayUserDetails(user, supervisor) {
  console.log('📊 USER DETAILS');
  console.log('='.repeat(80));
  console.log(`Email              : ${user.email}`);
  console.log(`Full Name          : ${user.fullName}`);
  console.log(`Position           : ${user.position}`);
  console.log(`Department         : ${user.department}`);
  console.log(`Role               : ${user.role}`);
  console.log(`Hierarchy Level    : ${user.hierarchyLevel}`);
  console.log(`Supervisor         : ${supervisor.fullName} (${supervisor.email})`);
  console.log(`Department Role    : ${user.departmentRole}`);
  console.log(`Is Active          : ${user.isActive}`);
  console.log(`Permissions        : ${user.permissions.join(', ')}`);
  console.log('='.repeat(80) + '\n');

  console.log('🔐 LOGIN CREDENTIALS');
  console.log('='.repeat(80));
  console.log(`Email              : evelyn.nkwenti@gratoglobal.com`);
  console.log(`Password           : Nkwe_Ev#26Cam`);
  console.log('='.repeat(80) + '\n');
}

async function testLogin(email, password) {
  console.log('🧪 TESTING LOGIN');
  console.log('='.repeat(80));

  try {
    const user = await User.findOne({ email });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    if (!user.isActive) {
      console.log('❌ User is not active');
      return;
    }

    const isValidPassword = await user.comparePassword(password);

    if (isValidPassword) {
      console.log('✅ LOGIN TEST PASSED!');
      console.log('   Email:', email);
      console.log('   Password comparison: SUCCESS');
      console.log('   User is active: YES');
    } else {
      console.log('❌ LOGIN TEST FAILED - Password comparison returned false');
    }

  } catch (error) {
    console.error('❌ Login test error:', error.message);
  }

  console.log('='.repeat(80) + '\n');
}

if (require.main === module) {
  addEvelynIntern();
}

module.exports = { addEvelynIntern };








// require('dotenv').config();
// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');
// const User = require('../models/User');

// const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

// async function connectDB() {
//   try {
//     await mongoose.connect(MONGO_URI);
//     console.log('✅ Connected to MongoDB Atlas\n');
//   } catch (error) {
//     console.error('❌ Connection failed:', error.message);
//     process.exit(1);
//   }
// }

// async function addJulesTechnician() {
//   try {
//     console.log('🔧 ADDING JULES MOUNA - FIELD TECHNICIAN');
//     console.log('='.repeat(80) + '\n');

//     await connectDB();

//     // First, find Joseph Tayou (his supervisor)
//     const josephTayou = await User.findOne({ email: 'joseph.tayou@gratoglobal.com' });
    
//     if (!josephTayou) {
//       console.error('❌ ERROR: Joseph Tayou not found in database!');
//       console.error('   Jules cannot be added without his supervisor.');
//       process.exit(1);
//     }

//     console.log('✅ Found supervisor: Joseph Tayou');
//     console.log('   ID:', josephTayou._id);
//     console.log('   Position:', josephTayou.position);
//     console.log('');

//     // Check if Jules already exists
//     const existingJules = await User.findOne({ email: 'jules.mouna@gratoglobal.com' });
    
//     if (existingJules) {
//       console.log('⚠️  Jules Mouna already exists in database');
//       console.log('   Email:', existingJules.email);
//       console.log('   Position:', existingJules.position);
//       console.log('');
      
//       const readline = require('readline').createInterface({
//         input: process.stdin,
//         output: process.stdout
//       });
      
//       const answer = await new Promise(resolve => {
//         readline.question('Do you want to update Jules\' details? (yes/no): ', resolve);
//       });
//       readline.close();
      
//       if (answer.toLowerCase() !== 'yes') {
//         console.log('Cancelled.');
//         process.exit(0);
//       }
      
//       // Update existing user
//       existingJules.password = 'Jules_Tech_6018#';
//       existingJules.fullName = 'Mr. Jules Mouna';
//       existingJules.role = 'technical';
//       existingJules.department = 'Technical';
//       existingJules.position = 'Field Technician';
//       existingJules.hierarchyLevel = 1;
//       existingJules.supervisor = josephTayou._id;
//       existingJules.departmentHead = null; // Will be set by hierarchy system
//       existingJules.directReports = [];
//       existingJules.approvalCapacities = [];
//       existingJules.departmentRole = 'staff';
//       existingJules.permissions = [
//         'view_own_requests',
//         'create_requisition',
//         'view_team_reports'
//       ];
//       existingJules.isActive = true;
//       existingJules.hierarchyPath = [josephTayou._id.toString()];
      
//       await existingJules.save();
      
//       // Add Jules to Joseph's directReports
//       if (!josephTayou.directReports.some(id => id.toString() === existingJules._id.toString())) {
//         josephTayou.directReports.push(existingJules._id);
//         await josephTayou.save();
//         console.log('✅ Added Jules to Joseph\'s direct reports');
//       }
      
//       console.log('✅ Jules updated successfully!\n');
//       await displayUserDetails(existingJules, josephTayou);
      
//     } else {
//       // Create new user
//       const password = 'Jules_Tech_6018#';
      
//       const julesData = {
//         email: 'jules.mouna@gratoglobal.com',
//         password: password,
//         fullName: 'Mr. Jules Mouna',
//         role: 'technical',
//         department: 'Technical',
//         position: 'Field Technician',
//         hierarchyLevel: 1,
//         supervisor: josephTayou._id,
//         departmentHead: null, // Will be set by hierarchy system
//         directReports: [],
//         approvalCapacities: [],
//         departmentRole: 'staff',
//         permissions: [
//           'view_own_requests',
//           'create_requisition',
//           'view_team_reports'
//         ],
//         isActive: true,
//         hierarchyPath: [josephTayou._id.toString()]
//       };

//       const jules = new User(julesData);
//       await jules.save();

//       // Add Jules to Joseph's directReports
//       josephTayou.directReports.push(jules._id);
//       await josephTayou.save();

//       console.log('✅ Jules created successfully!\n');
//       await displayUserDetails(jules, josephTayou);
//     }

//     // Verify login
//     await testLogin('jules.mouna@gratoglobal.com', 'Jules_Tech_6018#');

//     // Display team structure
//     await displayTeamStructure(josephTayou);

//     console.log('\n✅ SETUP COMPLETE!');
//     console.log('Jules Mouna is now a Field Technician reporting to Joseph Tayou.\n');
    
//     process.exit(0);

//   } catch (error) {
//     console.error('\n❌ Setup failed:', error);
//     console.error(error.stack);
//     process.exit(1);
//   }
// }

// async function displayUserDetails(user, supervisor) {
//   console.log('📊 USER DETAILS');
//   console.log('='.repeat(80));
//   console.log(`Email              : ${user.email}`);
//   console.log(`Full Name          : ${user.fullName}`);
//   console.log(`Position           : ${user.position}`);
//   console.log(`Department         : ${user.department}`);
//   console.log(`Role               : ${user.role}`);
//   console.log(`Hierarchy Level    : ${user.hierarchyLevel}`);
//   console.log(`Supervisor         : ${supervisor.fullName} (${supervisor.email})`);
//   console.log(`Department Role    : ${user.departmentRole}`);
//   console.log(`Is Active          : ${user.isActive}`);
//   console.log(`Permissions        : ${user.permissions.join(', ')}`);
//   console.log('='.repeat(80) + '\n');

//   console.log('🔐 LOGIN CREDENTIALS');
//   console.log('='.repeat(80));
//   console.log(`Email              : jules.mouna@gratoglobal.com`);
//   console.log(`Password           : Jules_Tech_6018#`);
//   console.log('='.repeat(80) + '\n');
// }

// async function testLogin(email, password) {
//   console.log('🧪 TESTING LOGIN');
//   console.log('='.repeat(80));
  
//   try {
//     const user = await User.findOne({ email });
    
//     if (!user) {
//       console.log('❌ User not found');
//       return;
//     }

//     if (!user.isActive) {
//       console.log('❌ User is not active');
//       return;
//     }

//     const isValidPassword = await user.comparePassword(password);
    
//     if (isValidPassword) {
//       console.log('✅ LOGIN TEST PASSED!');
//       console.log('   Email:', email);
//       console.log('   Password comparison: SUCCESS');
//       console.log('   User is active: YES');
//     } else {
//       console.log('❌ LOGIN TEST FAILED - Password comparison returned false');
//     }
    
//   } catch (error) {
//     console.error('❌ Login test error:', error.message);
//   }
  
//   console.log('='.repeat(80) + '\n');
// }

// async function displayTeamStructure(supervisor) {
//   console.log('👥 TEAM STRUCTURE - JOSEPH TAYOU\'S TEAM');
//   console.log('='.repeat(80));
  
//   const team = await User.find({ 
//     _id: { $in: supervisor.directReports } 
//   }).select('fullName email position isActive');
  
//   console.log(`\nSupervisor: ${supervisor.fullName}`);
//   console.log(`Position: ${supervisor.position}`);
//   console.log(`\nDirect Reports (${team.length}):`);
  
//   team.forEach((member, index) => {
//     const status = member.isActive ? '✅' : '❌';
//     console.log(`  ${index + 1}. ${status} ${member.fullName}`);
//     console.log(`     Position: ${member.position}`);
//     console.log(`     Email: ${member.email}`);
//     console.log('');
//   });
  
//   console.log('='.repeat(80) + '\n');
// }

// if (require.main === module) {
//   addJulesTechnician();
// }

// module.exports = { addJulesTechnician };



