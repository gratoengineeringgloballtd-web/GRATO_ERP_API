const mongoose = require('mongoose');
const User = require('../models/User');
const Maintenance = require('../models/Maintenance');

async function migrateTechnicianTasks() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all technicians
    const technicians = await User.find({ role: 'technician' });
    console.log(`Found ${technicians.length} technicians`);

    for (const tech of technicians) {
      // Count active tasks
      const activeTasksCount = await Maintenance.countDocuments({
        technician: tech._id,
        status: { $in: ['pending', 'scheduled', 'in_progress'] }
      });

      // Update technician
      await User.findByIdAndUpdate(tech._id, {
        currentTasksCount: activeTasksCount
      });

      console.log(`Updated ${tech.fullName}: ${activeTasksCount} active tasks`);
    }

    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  migrateTechnicianTasks();
}

module.exports = migrateTechnicianTasks;
