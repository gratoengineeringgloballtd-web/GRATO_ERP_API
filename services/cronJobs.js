const cron = require('node-cron');
const Quote = require('../models/Quote');
const DeliveryTracking = require('../models/DeliveryTracking');
const { sendBuyerNotificationEmail } = require('./buyerEmailService');

// Check for quotes approaching expiry (runs daily at 9 AM)
const checkExpiringQuotes = cron.schedule('0 9 * * *', async () => {
  try {
    console.log('Checking for expiring quotes...');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const expiringQuotes = await Quote.find({
      validUntil: {
        $gte: new Date(),
        $lte: tomorrow
      },
      status: { $in: ['received', 'under_review'] }
    })
    .populate('supplierId', 'name email')
    .populate('requisitionId', 'title')
    .populate('buyerId', 'fullName email');

    // Send notifications to buyers
    for (const quote of expiringQuotes) {
      if (quote.buyerId?.email) {
        await sendBuyerNotificationEmail.quoteEvaluationReminder(
          quote.buyerId.email,
          quote
        );
      }
    }
    
    console.log(`Sent ${expiringQuotes.length} quote expiry notifications`);
    
  } catch (error) {
    console.error('Error checking expiring quotes:', error);
  }
}, {
  scheduled: false 
});

const checkOverdueDeliveries = cron.schedule('0 8 * * *', async () => {
  try {
    console.log('Checking for overdue deliveries...');
    
    const overdueDeliveries = await DeliveryTracking.find({
      estimatedDeliveryDate: { $lt: new Date() },
      status: { $nin: ['delivered', 'cancelled'] }
    })
    .populate('buyerId', 'fullName email')
    .populate('supplierId', 'name email');

    // Group by buyer
    const deliveriesByBuyer = {};
    overdueDeliveries.forEach(delivery => {
      const buyerId = delivery.buyerId._id.toString();
      if (!deliveriesByBuyer[buyerId]) {
        deliveriesByBuyer[buyerId] = {
          buyer: delivery.buyerId,
          deliveries: []
        };
      }
      deliveriesByBuyer[buyerId].deliveries.push(delivery);
    });

    // Send notifications
    for (const [buyerId, data] of Object.entries(deliveriesByBuyer)) {
      if (data.buyer.email) {
        console.log(`Would send overdue delivery notification to ${data.buyer.email} for ${data.deliveries.length} deliveries`);
      }
    }
    
    console.log(`Found ${overdueDeliveries.length} overdue deliveries`);
    
  } catch (error) {
    console.error('Error checking overdue deliveries:', error);
  }
}, {
  scheduled: false 
});

// Post due fixed-asset depreciation (runs daily at 02:30; only lines whose date has passed)
const postDueDepreciation = cron.schedule('30 2 * * *', async () => {
  try {
    const User = require('../models/User');
    const accountingService = require('./accountingService');
    const poster = await User.findOne({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
    if (!poster) { console.warn('Depreciation job skipped: no admin user to post as'); return; }
    const result = await accountingService.postAllPendingDepreciations(poster._id);
    if (result.posted || result.errors.length) console.log(`Depreciation job: ${result.posted} posted, ${result.errors.length} errors`);
  } catch (error) {
    console.error('Error posting due depreciation:', error.message);
  }
}, { scheduled: false });

// Document expiry reminders and retention flagging (daily at 07:00)
const documentReminders = cron.schedule('0 7 * * *', async () => {
  try {
    const result = await require('./documentHubService').runReminders();
    if (result.sent || result.retentionFlagged) console.log(`Document job: ${result.sent} reminder email(s), ${result.retentionFlagged} flagged for retention review`);
  } catch (error) {
    console.error('Error running document reminders:', error.message);
  }
}, { scheduled: false });

const startBuyerCronJobs = () => {
  documentReminders.start();
  postDueDepreciation.start();
  checkExpiringQuotes.start();
  checkOverdueDeliveries.start();
  console.log('Buyer cron jobs started');
};

const stopBuyerCronJobs = () => {
  documentReminders.stop();
  postDueDepreciation.stop();
  checkExpiringQuotes.stop();
  checkOverdueDeliveries.stop();
  console.log('Buyer cron jobs stopped');
};

module.exports = {
  startBuyerCronJobs,
  stopBuyerCronJobs,
  checkExpiringQuotes,
  checkOverdueDeliveries,
  postDueDepreciation,
  documentReminders
};