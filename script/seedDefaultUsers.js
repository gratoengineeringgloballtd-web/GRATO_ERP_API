require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');

const getMongoUri = () =>
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/generator-management';

const connectDB = async () => {
  const mongoURI = getMongoUri();
  await mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('✓ MongoDB connected:', mongoURI);
};

const upsertUser = async ({ fullName, email, phone, role, password }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.toString().replace(/[\s\-()]/g, '');

  let user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user) {
    user = new User({
      fullName,
      email: normalizedEmail,
      phone: normalizedPhone,
      role,
      password, // will be hashed by pre-save hook
      isActive: true,
    });
  } else {
    user.fullName = fullName;
    user.phone = normalizedPhone;
    user.role = role;
    user.isActive = true;
    // Reset password to known value (requested: "all users deleted"; keeps script idempotent for re-runs)
    user.password = password;
  }

  await user.save();
  return user;
};

(async () => {
  try {
    await connectDB();

    // You can change these defaults if you want.
    const credentials = {
      admin: {
        fullName: 'Grato Admin',
        email: 'admin@grato.com',
        phone: '08000000001',
        role: 'admin',
        password: 'Grato@123',
      },
      supervisor: {
        fullName: 'Grato Supervisor',
        email: 'supervisor@grato.com',
        phone: '08000000002',
        role: 'supervisor',
        password: 'Grato@123',
      },
      technician: {
        fullName: 'Grato Technician',
        email: 'technician@grato.com',
        phone: '08000000003',
        role: 'technician',
        password: 'Grato@123',
      },
      dataCollector: {
        fullName: 'Grato Data Collector',
        email: 'datacollector@grato.com',
        phone: '08000000004',
        role: 'data_collector',
        password: 'Grato@123',
      },
      operations: {
        fullName: 'Grato Operations',
        email: 'operations@grato.com',
        phone: '08000000005',
        role: 'operations',
        password: 'Grato@123',
      },
    };

    // Create core users
    const admin = await upsertUser(credentials.admin);
    const supervisor = await upsertUser(credentials.supervisor);
    const technician = await upsertUser(credentials.technician);
    const dataCollector = await upsertUser(credentials.dataCollector);
    const operations = await upsertUser(credentials.operations);

    // Link technician -> supervisor (both directions)
    technician.supervisor = supervisor._id;
    await technician.save();

    const assigned = Array.isArray(supervisor.assignedTechnicians)
      ? supervisor.assignedTechnicians.map((id) => id.toString())
      : [];

    if (!assigned.includes(technician._id.toString())) {
      supervisor.assignedTechnicians = [...(supervisor.assignedTechnicians || []), technician._id];
      await supervisor.save();
    }

    console.log('\n=== USERS CREATED / UPDATED ===');
    console.log('Admin:', {
      id: admin._id.toString(),
      email: admin.email,
      phone: admin.phone,
      role: admin.role,
      password: credentials.admin.password,
    });

    console.log('Supervisor:', {
      id: supervisor._id.toString(),
      email: supervisor.email,
      phone: supervisor.phone,
      role: supervisor.role,
      password: credentials.supervisor.password,
      assignedTechnicians: (supervisor.assignedTechnicians || []).map((id) => id.toString()),
    });

    console.log('Technician:', {
      id: technician._id.toString(),
      email: technician.email,
      phone: technician.phone,
      role: technician.role,
      password: credentials.technician.password,
      supervisor: technician.supervisor?.toString?.() || technician.supervisor,
    });

    console.log('Data Collector:', {
      id: dataCollector._id.toString(),
      email: dataCollector.email,
      phone: dataCollector.phone,
      role: dataCollector.role,
      password: credentials.dataCollector.password,
    });

    console.log('Operations:', {
      id: operations._id.toString(),
      email: operations.email,
      phone: operations.phone,
      role: operations.role,
      password: credentials.operations.password,
    });

    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed default users:', err);
    process.exit(1);
  }
})();
