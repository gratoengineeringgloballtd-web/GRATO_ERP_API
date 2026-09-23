const cron = require('node-cron');
const Maintenance = require('../models/Maintenance');
const Notification = require('../models/Notifications');
const pushNotificationService = require('./pushNotificationService');
const logger = require('../utils/logger');

class ReminderService {
    constructor() {
        // Scheduled task to run every day at 8:00 AM
        // You'll need to install node-cron: npm install node-cron
        this.startReminders();
    }

    startReminders() {
        // Run every day at 8:00 AM
        cron.schedule('0 8 * * *', async () => {
            console.log('Running daily maintenance reminders...');
            await this.checkAndSendReminders();
        });
    }

    async checkAndSendReminders() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Find maintenance tasks scheduled for today
            const dueToday = await Maintenance.find({
                visit_date: {
                    $gte: today,
                    $lt: tomorrow
                },
                status: { $in: ['scheduled', 'approved', 'pending'] }
            }).populate('technician');

            console.log(`Found ${dueToday.length} maintenance tasks due today.`);

            for (const maintenance of dueToday) {
                try {
                    const technicianId = maintenance.technician._id || maintenance.technician;
                    
                    const notificationData = {
                        recipient: technicianId,
                        type: 'maintenance_scheduled',
                        title: 'Maintenance Reminder',
                        message: `Reminder: You have a ${maintenance.visit_type} scheduled for today at site ${maintenance.site_id} (${maintenance.site_name}).`,
                        data: {
                            maintenanceId: maintenance._id,
                            siteId: maintenance.site_id,
                            siteName: maintenance.site_name,
                            visitType: (maintenance.visit_type || 'PM').includes('PM') ? 'preventive' : ((maintenance.visit_type || '').includes('RF') ? 'refueling' : 'corrective')
                        },
                        priority: 'high'
                    };

                    await Notification.create(notificationData);
                    
                    await pushNotificationService.sendToUser(technicianId, {
                        title: notificationData.title,
                        body: notificationData.message,
                        data: {
                            type: 'maintenance_scheduled',
                            maintenanceId: String(maintenance._id),
                            siteId: String(maintenance.site_id)
                        }
                    });

                    console.log(`Reminder sent to technician ${technicianId} for site ${maintenance.site_id}`);
                } catch (err) {
                    console.error(`Failed to send reminder for maintenance ${maintenance._id}:`, err.message);
                }
            }
        } catch (error) {
            console.error('Error in checkAndSendReminders:', error);
            logger.error('Error in checkAndSendReminders:', error);
        }
    }
}

module.exports = new ReminderService();
